import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { canPushEntity } from './syncPolicy.mjs';

const { Pool } = pg;
const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';
const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
const bootstrapUser = process.env.BOOTSTRAP_ADMIN_USERNAME;
const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const defaultLocationName = process.env.DEFAULT_LOCATION_NAME || 'Main location';
const allowedOrigin = process.env.CORS_ORIGIN || '';
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
if (!databaseUrl || !jwtSecret || jwtSecret.length < 32) {
  console.error('Set DATABASE_URL and JWT_SECRET (at least 32 characters) before starting the API.');
  process.exit(1);
}
const pool = new Pool({ connectionString: databaseUrl, ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: true } : undefined, max: Number(process.env.DB_POOL_SIZE || 10) });
const b64 = value => Buffer.from(value).toString('base64url');
const sign = value => crypto.createHmac('sha256', jwtSecret).update(value).digest('base64url');
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(salt + ':' + key.toString('hex'))));
}
async function verifyPassword(password, encoded) {
  const [salt, expected] = String(encoded || '').split(':');
  if (!salt || !expected) return false;
  const actual = await hashPassword(password, salt);
  const actualBytes = Buffer.from(actual.split(':')[1] || '', 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  return actualBytes.length === expectedBytes.length && crypto.timingSafeEqual(actualBytes, expectedBytes);
}
function tokenFor(user) {
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64(JSON.stringify({ sub: user.id, username: user.username, role: user.role, locationId: user.location_id, exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60 }));
  const unsigned = header + '.' + payload;
  return unsigned + '.' + sign(unsigned);
}
function authFrom(req) {
  const raw = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const unsigned = parts.slice(0, 2).join('.');
  const expected = Buffer.from(sign(unsigned));
  const supplied = Buffer.from(parts[2]);
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!claims.sub || !claims.locationId || claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch { return null; }
}
function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}
async function bodyJson(req, maxBytes = 2_000_000) {
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw Object.assign(new Error('Request body is too large'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('Request body must be valid JSON'), { status: 400 }); }
}
function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '')); }
const roles = { admin: 3, manager: 2, cashier: 1 };
async function bootstrap() {
  if (bootstrapPassword && bootstrapPassword.length < 12) throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters.');
  await pool.query(await readFile(path.join(here, 'schema.sql'), 'utf8'));
  const count = await pool.query('SELECT count(*)::int AS n FROM locations');
  let locationId;
  if (!count.rows[0].n) {
    const location = await pool.query('INSERT INTO locations(name) VALUES ($1) RETURNING id', [defaultLocationName]);
    locationId = location.rows[0].id;
  } else {
    const location = await pool.query('SELECT id FROM locations ORDER BY created_at LIMIT 1');
    locationId = location.rows[0].id;
  }
  if (bootstrapUser && bootstrapPassword) {
    const existing = await pool.query('SELECT id FROM staff_users WHERE username=$1', [bootstrapUser.toLowerCase()]);
    if (!existing.rowCount) {
      await pool.query('INSERT INTO staff_users(location_id,username,password_hash,display_name,role) VALUES ($1,$2,$3,$4,$5)',
        [locationId, bootstrapUser.toLowerCase(), await hashPassword(bootstrapPassword), 'Administrator', 'admin']);
      console.log('Created bootstrap administrator. Change credentials using your deployment secret manager before production.');
    }
  }
  console.log('Malik POS API schema ready.');
}
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    if (allowedOrigin && req.headers.origin === allowedOrigin) res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Vary', 'Origin'); res.writeHead(204); return res.end();
  }
  if (allowedOrigin && req.headers.origin === allowedOrigin) { res.setHeader('Access-Control-Allow-Origin', allowedOrigin); res.setHeader('Vary', 'Origin'); }
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      await pool.query('SELECT 1'); return send(res, 200, { ok: true, service: 'malik-pos-api', database: 'connected' });
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const input = await bodyJson(req, 16_000);
      const username = String(input.username || '').trim().toLowerCase();
      const password = String(input.password || '');
      if (!username || !password || password.length > 1024) return send(res, 400, { error: 'Username and password are required.' });
      const ip = String(req.socket.remoteAddress || 'unknown');
      const now = Date.now();
      const prior = loginAttempts.get(ip);
      if (prior && now - prior.startedAt < LOGIN_WINDOW_MS && prior.count >= LOGIN_MAX_ATTEMPTS) {
        return send(res, 429, { error: 'Too many sign-in attempts. Wait 15 minutes and try again.' });
      }
      if (!prior || now - prior.startedAt >= LOGIN_WINDOW_MS) loginAttempts.set(ip, { startedAt: now, count: 0 });
      const found = await pool.query('SELECT id,location_id,username,password_hash,display_name,role,active FROM staff_users WHERE username=$1', [username]);
      const user = found.rows[0];
      if (!user || !user.active || !(await verifyPassword(password, user.password_hash))) {
        const attempt = loginAttempts.get(ip);
        attempt.count += 1;
        return send(res, 401, { error: 'Invalid username or password.' });
      }
      loginAttempts.delete(ip);
      return send(res, 200, { token: tokenFor(user), user: { id: user.id, username: user.username, name: user.display_name, role: user.role, locationId: user.location_id } });
    }
    const user = authFrom(req);
    if (!user) return send(res, 401, { error: 'Authentication required or session expired.' });
    if (req.method === 'GET' && url.pathname === '/api/me') return send(res, 200, { id: user.sub, username: user.username, role: user.role, locationId: user.locationId });
    if (req.method === 'GET' && url.pathname === '/api/records') {
      const entity = String(url.searchParams.get('entity') || '').trim();
      if (!/^[a-z][a-z0-9_-]{0,63}$/.test(entity)) return send(res, 400, { error: 'A valid entity filter is required.' });
      const result = await pool.query('SELECT entity,record_id,payload,revision,updated_at FROM pos_records WHERE location_id=$1 AND entity=$2 ORDER BY updated_at DESC LIMIT 5000', [user.locationId, entity]);
      return send(res, 200, { records: result.rows });
    }
    if (req.method === 'POST' && url.pathname === '/api/sync/push') {
      if (!roles[user.role]) return send(res, 403, { error: 'A recognized staff role is required.' });
      const input = await bodyJson(req);
      if (!Array.isArray(input.events) || input.events.length > 500) return send(res, 400, { error: 'Send an events array containing at most 500 events.' });
      const client = await pool.connect(); const results = [];
      try {
        await client.query('BEGIN');
        for (const event of input.events) {
          if (!canPushEntity(user.role, String(event.entity || ''))) throw Object.assign(new Error('Your role cannot sync this record type.'), { status: 403 });
          if (!isUuid(event.eventId) || !/^[a-z][a-z0-9_-]{0,63}$/.test(String(event.entity || '')) || !String(event.recordId || '').trim() || String(event.recordId).length > 200 || !['upsert','delete'].includes(event.operation)) {
            throw Object.assign(new Error('Each event needs a UUID eventId, valid entity/recordId and upsert/delete operation.'), { status: 400 });
          }
          const priorEvent = await client.query('SELECT sequence FROM sync_events WHERE event_id=$1', [event.eventId]);
          if (priorEvent.rowCount) { results.push({ eventId: event.eventId, status: 'duplicate', sequence: Number(priorEvent.rows[0].sequence) }); continue; }
          if (Object.hasOwn(event, 'expectedSequence')) {
            const latest = await client.query('SELECT sequence FROM sync_events WHERE location_id=$1 AND entity=$2 AND record_id=$3 ORDER BY sequence DESC LIMIT 1', [user.locationId,event.entity,event.recordId]);
            const expectedSequence = event.expectedSequence === null ? null : Number(event.expectedSequence);
            const actualSequence = latest.rowCount ? Number(latest.rows[0].sequence) : null;
            if (expectedSequence !== actualSequence) {
              throw Object.assign(new Error('Sync conflict: this record changed on the server. Sync again to review the conflict.'), { status: 409 });
            }
          }
          const inserted = await client.query('INSERT INTO sync_events(event_id,location_id,entity,record_id,operation,payload,actor_id,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(event_id) DO NOTHING RETURNING sequence',
            [event.eventId,user.locationId,event.entity,event.recordId,event.operation,event.payload === undefined ? null : JSON.stringify(event.payload),user.sub,event.occurredAt && Number.isFinite(Date.parse(event.occurredAt)) ? new Date(event.occurredAt).toISOString() : null]);
          if (!inserted.rowCount) { results.push({ eventId: event.eventId, status: 'duplicate' }); continue; }
          if (event.operation === 'delete') {
            await client.query('DELETE FROM pos_records WHERE location_id=$1 AND entity=$2 AND record_id=$3', [user.locationId,event.entity,event.recordId]);
          } else {
            if (event.payload === undefined || event.payload === null || typeof event.payload !== 'object') throw Object.assign(new Error('Upsert events require an object payload.'), { status: 400 });
            await client.query('INSERT INTO pos_records(location_id,entity,record_id,payload,updated_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(location_id,entity,record_id) DO UPDATE SET payload=EXCLUDED.payload,revision=pos_records.revision+1,updated_by=EXCLUDED.updated_by,updated_at=now()',
              [user.locationId,event.entity,event.recordId,JSON.stringify(event.payload),user.sub]);
          }
          results.push({ eventId: event.eventId, status: 'applied', sequence: inserted.rows[0].sequence });
        }
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
      return send(res, 200, { accepted: results.length, results });
    }
    if (req.method === 'GET' && url.pathname === '/api/sync/pull') {
      const after = Math.max(0, Number(url.searchParams.get('after') || 0));
      if (!Number.isSafeInteger(after)) return send(res, 400, { error: 'after must be a non-negative event sequence.' });
      const result = await pool.query('SELECT sequence,event_id,entity,record_id,operation,payload,actor_id,occurred_at,received_at FROM sync_events WHERE location_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 500', [user.locationId, after]);
      return send(res, 200, { events: result.rows, nextAfter: result.rows.length ? Number(result.rows[result.rows.length - 1].sequence) : after });
    }
    if (url.pathname === '/api/admin/users') {
      if (user.role !== 'admin') return send(res, 403, { error: 'Administrator role required.' });
      if (req.method === 'GET') {
        const result = await pool.query('SELECT id,username,display_name,role,active,created_at FROM staff_users WHERE location_id=$1 ORDER BY username', [user.locationId]);
        return send(res, 200, { users: result.rows });
      }
      if (req.method === 'POST') {
        const input = await bodyJson(req, 16_000);
        const username = String(input.username || '').trim().toLowerCase();
        const password = String(input.password || '');
        const displayName = String(input.displayName || '').trim();
        const role = String(input.role || '');
        if (!/^[a-z0-9._-]{3,64}$/.test(username)) return send(res, 400, { error: 'Username must be 3–64 characters using letters, numbers, dots, underscores or hyphens.' });
        if (password.length < 12 || password.length > 1024) return send(res, 400, { error: 'Password must be at least 12 characters.' });
        if (!displayName || displayName.length > 100) return send(res, 400, { error: 'Display name is required (maximum 100 characters).' });
        if (!['admin','manager','cashier'].includes(role)) return send(res, 400, { error: 'Role must be admin, manager or cashier.' });
        const inserted = await pool.query('INSERT INTO staff_users(location_id,username,password_hash,display_name,role) VALUES ($1,$2,$3,$4,$5) RETURNING id,username,display_name,role,active,created_at',
          [user.locationId, username, await hashPassword(password), displayName, role]);
        return send(res, 201, { user: inserted.rows[0] });
      }
      return send(res, 405, { error: 'Method not allowed.' });
    }
    const userActionMatch = url.pathname.match(/^\/api\/admin\/users\/([0-9a-f-]{36})\/(deactivate|activate|reset-password)$/i);
    if (req.method === 'POST' && userActionMatch) {
      if (user.role !== 'admin') return send(res, 403, { error: 'Administrator role required.' });
      const [, targetId, action] = userActionMatch;
      if (!isUuid(targetId)) return send(res, 400, { error: 'A valid user ID is required.' });
      const targetResult = await pool.query('SELECT id,location_id,role,active FROM staff_users WHERE id=$1 AND location_id=$2', [targetId, user.locationId]);
      const target = targetResult.rows[0];
      if (!target) return send(res, 404, { error: 'Staff account not found at this location.' });
      if (action === 'deactivate' || action === 'activate') {
        const active = action === 'activate';
        if (!active && target.id === user.sub) return send(res, 400, { error: 'You cannot deactivate your own account.' });
        if (!active && target.active && target.role === 'admin') {
          const count = await pool.query("SELECT count(*)::int AS n FROM staff_users WHERE location_id=$1 AND role='admin' AND active=true", [user.locationId]);
          if (count.rows[0].n <= 1) return send(res, 409, { error: 'Keep at least one active administrator at this location.' });
        }
        const updated = await pool.query('UPDATE staff_users SET active=$1,updated_at=now() WHERE id=$2 AND location_id=$3 RETURNING id,username,display_name,role,active,created_at', [active, targetId, user.locationId]);
        return send(res, 200, { user: updated.rows[0] });
      }
      if (action === 'reset-password') {
        const input = await bodyJson(req, 16_000);
        const password = String(input.password || '');
        if (password.length < 12 || password.length > 1024) return send(res, 400, { error: 'Password must be at least 12 characters.' });
        await pool.query('UPDATE staff_users SET password_hash=$1,updated_at=now() WHERE id=$2 AND location_id=$3', [await hashPassword(password), targetId, user.locationId]);
        return send(res, 200, { ok: true });
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/locations') {
      if (user.role !== 'admin') return send(res, 403, { error: 'Administrator role required.' });
      const result = await pool.query('SELECT id,name,timezone,active,created_at FROM locations ORDER BY name');
      return send(res, 200, { locations: result.rows });
    }
    return send(res, 404, { error: 'Route not found.' });
  } catch (error) {
    console.error('API request failed:', error);
    if (error.code === '23505') return send(res, 409, { error: 'That username already exists.' });
    return send(res, error.status || 500, { error: error.status ? error.message : 'Internal server error.' });
  }
});
bootstrap().then(() => server.listen(port, host, () => console.log('Malik POS API listening on ' + host + ':' + port))).catch(error => { console.error('API startup failed:', error); process.exit(1); });
process.on('SIGTERM', async () => { server.close(); await pool.end(); process.exit(0); });
process.on('SIGINT', async () => { server.close(); await pool.end(); process.exit(0); });
