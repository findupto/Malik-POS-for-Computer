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
  const payload = b64(JSON.stringify({ sub: user.id, username: user.username, role: user.role, locationId: user.location_id, iatMs: Date.now(), exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60 }));
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
    const claims = authFrom(req);
    if (!claims) return send(res, 401, { error: 'Authentication required or session expired.' });
    const activeUserResult = await pool.query('SELECT id,username,display_name,role,location_id,active,updated_at FROM staff_users WHERE id=$1', [claims.sub]);
    const activeUser = activeUserResult.rows[0];
    if (!activeUser || !activeUser.active || activeUser.location_id !== claims.locationId) {
      return send(res, 401, { error: 'This staff account is inactive or no longer valid. Sign in again.' });
    }
    if (claims.iatMs && new Date(activeUser.updated_at).getTime() > Number(claims.iatMs)) {
      return send(res, 401, { error: 'Your staff account or password changed. Sign in again.' });
    }
    // Always authorize with current database role, not the role captured in a long-lived token.
    const user = { ...claims, username: activeUser.username, role: activeUser.role, locationId: activeUser.location_id };
    if (req.method === 'GET' && url.pathname === '/api/me') return send(res, 200, { id: user.sub, username: user.username, name: activeUser.display_name, role: user.role, locationId: user.locationId });
    if (req.method === 'GET' && url.pathname === '/api/records') {
      const entity = String(url.searchParams.get('entity') || '').trim();
      if (!/^[a-z][a-z0-9_-]{0,63}$/.test(entity)) return send(res, 400, { error: 'A valid entity filter is required.' });
      const result = await pool.query('SELECT entity,record_id,payload,revision,updated_at FROM pos_records WHERE location_id=$1 AND entity=$2 ORDER BY updated_at DESC LIMIT 5000', [user.locationId, entity]);
      return send(res, 200, { records: result.rows });
    }
    if (req.method === 'POST' && url.pathname === '/api/transactions') {
      if (!['admin','manager','cashier'].includes(user.role)) return send(res, 403, { error: 'Your role cannot create sales.' });
      const input = await bodyJson(req, 1_000_000);
      const idempotencyKey = String(input.idempotencyKey || '');
      const orderId = String(input.orderId || '').trim();
      const items = input.items;
      const tenders = input.tenders === undefined ? [] : input.tenders;
      if (!isUuid(idempotencyKey)) return send(res, 400, { error: 'A UUID idempotencyKey is required and must be reused for retries.' });
      if (!orderId || orderId.length > 200) return send(res, 400, { error: 'A valid orderId is required (maximum 200 characters).' });
      if (!Array.isArray(items) || items.length < 1 || items.length > 200) return send(res, 400, { error: 'A sale must contain between 1 and 200 line items.' });
      if (!Array.isArray(tenders) || tenders.length > 20) return send(res, 400, { error: 'Tenders must be an array of at most 20 payments.' });
      const moneyValue = (value, field) => {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000) throw Object.assign(new Error(field + ' must be a non-negative amount.'), { status: 400 });
        return Math.round((n + Number.EPSILON) * 100) / 100;
      };
      const lines = [];
      let subtotal = 0;
      for (const item of items) {
        const productName = String(item?.productName || '').trim();
        const productId = String(item?.productId ?? '').trim();
        const sku = String(item?.sku ?? '').trim();
        const quantity = Number(item?.quantity);
        if (!productName || productName.length > 200 || productId.length > 200 || sku.length > 100 || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000 || !Number.isFinite(Number(quantity.toFixed(3)))) {
          return send(res, 400, { error: 'Each line needs a product name, valid identifiers, and a positive quantity.' });
        }
        const unitPrice = moneyValue(item?.unitPrice, 'unitPrice');
        const lineTotal = Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100;
        subtotal = Math.round((subtotal + lineTotal + Number.EPSILON) * 100) / 100;
        lines.push({ productId, sku, productName, quantity: Number(quantity.toFixed(3)), unitPrice, lineTotal });
      }
      const discountAmount = moneyValue(input.discountAmount ?? 0, 'discountAmount');
      const taxAmount = moneyValue(input.taxAmount ?? 0, 'taxAmount');
      const serviceChargeAmount = moneyValue(input.serviceChargeAmount ?? 0, 'serviceChargeAmount');
      const deliveryFee = moneyValue(input.deliveryFee ?? 0, 'deliveryFee');
      if (discountAmount > subtotal) return send(res, 400, { error: 'Discount cannot exceed the subtotal.' });
      const total = Math.round((subtotal - discountAmount + taxAmount + serviceChargeAmount + deliveryFee + Number.EPSILON) * 100) / 100;
      const tenderRows = [];
      for (const tender of tenders) {
        const method = String(tender?.method || '');
        if (!['Cash','Card','Bank Transfer','Mobile Wallet','Credit','Other'].includes(method)) return send(res, 400, { error: 'Unsupported tender method.' });
        const amount = moneyValue(tender?.amount, 'tender amount');
        const reference = String(tender?.reference || '').trim();
        if (reference.length > 200) return send(res, 400, { error: 'Tender reference must be at most 200 characters.' });
        tenderRows.push({ method, amount, reference });
      }
      const customerName = String(input.customerName || 'Walk-in Customer').trim().slice(0, 200) || 'Walk-in Customer';
      const notes = String(input.notes || '').slice(0, 2000);
      const occurredAt = input.occurredAt && Number.isFinite(Date.parse(input.occurredAt)) ? new Date(input.occurredAt).toISOString() : null;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [user.locationId + ':transaction:' + idempotencyKey]);
        const existing = await client.query('SELECT id,order_id,total,created_at FROM pos_transactions WHERE location_id=$1 AND idempotency_key=$2', [user.locationId, idempotencyKey]);
        if (existing.rowCount) {
          await client.query('COMMIT');
          return send(res, 200, { status: 'duplicate', transaction: existing.rows[0] });
        }
        const inserted = await client.query(
          'INSERT INTO pos_transactions(location_id,idempotency_key,order_id,customer_name,subtotal,discount_amount,tax_amount,service_charge_amount,delivery_fee,total,notes,payload,created_by,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id,order_id,total,created_at',
          [user.locationId,idempotencyKey,orderId,customerName,subtotal,discountAmount,taxAmount,serviceChargeAmount,deliveryFee,total,notes,JSON.stringify({ serviceType: String(input.serviceType || '').slice(0,40), tableNumber: String(input.tableNumber || '').slice(0,40) }),user.sub,occurredAt]
        );
        const transaction = inserted.rows[0];
        for (const line of lines) {
          await client.query('INSERT INTO pos_transaction_lines(transaction_id,product_id,sku,product_name,quantity,unit_price,line_total) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [transaction.id,line.productId,line.sku,line.productName,line.quantity,line.unitPrice,line.lineTotal]);
        }
        // Deduct stock only for products explicitly initialized in inventory_balances.
        // Untracked catalog items remain saleable until an opening balance is recorded.
        for (const line of lines) {
          if (!line.productId) continue;
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [user.locationId + ':inventory:' + line.productId]);
          const balance = await client.query('SELECT quantity,sku,product_name FROM inventory_balances WHERE location_id=$1 AND product_id=$2 FOR UPDATE', [user.locationId,line.productId]);
          if (!balance.rowCount) continue;
          const before = Number(balance.rows[0].quantity);
          if (before < line.quantity) throw Object.assign(new Error('Insufficient stock for ' + line.productName + '. Available: ' + before), { status: 409 });
          const after = Math.round((before - line.quantity + Number.EPSILON) * 1000) / 1000;
          await client.query('UPDATE inventory_balances SET quantity=$1,updated_by=$2,updated_at=now() WHERE location_id=$3 AND product_id=$4', [after,user.sub,user.locationId,line.productId]);
          await client.query('INSERT INTO inventory_movements(location_id,idempotency_key,product_id,sku,product_name,quantity_delta,quantity_after,reason,reference_type,reference_id,actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
            [user.locationId,crypto.randomUUID(),line.productId,line.sku,line.productName,-line.quantity,after,'Sale '+orderId,'sale',transaction.id,user.sub]);
        }
        for (const tender of tenderRows) {
          await client.query('INSERT INTO pos_tenders(transaction_id,method,amount,reference) VALUES ($1,$2,$3,$4)', [transaction.id,tender.method,tender.amount,tender.reference]);
        }
        await client.query('INSERT INTO audit_events(location_id,actor_id,action,entity,record_id,details) VALUES ($1,$2,$3,$4,$5,$6)',
          [user.locationId,user.sub,'sale.created','pos_transactions',transaction.id,JSON.stringify({ orderId, total, lineCount: lines.length, tenderCount: tenderRows.length })]);
        await client.query('COMMIT');
        return send(res, 201, { status: 'created', transaction: { ...transaction, subtotal, discountAmount, taxAmount, serviceChargeAmount, deliveryFee, currency: 'PKR' } });
      } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505' && error.constraint === 'pos_transactions_location_id_order_id_key') {
          return send(res, 409, { error: 'An order with this orderId already exists at this location. Retry with the original idempotency key for duplicate submissions.' });
        }
        throw error;
      } finally {
        client.release();
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/inventory/adjustments') {
      if (!['admin','manager'].includes(user.role)) return send(res, 403, { error: 'Administrator or manager role required for stock adjustments.' });
      const input = await bodyJson(req, 32_000);
      const idempotencyKey = String(input.idempotencyKey || '');
      const productId = String(input.productId ?? '').trim();
      const productName = String(input.productName || '').trim();
      const sku = String(input.sku || '').trim();
      const reason = String(input.reason || '').trim();
      const delta = Number(input.quantityDelta);
      if (!isUuid(idempotencyKey)) return send(res, 400, { error: 'A UUID idempotencyKey is required.' });
      if (!productId || productId.length > 200 || !productName || productName.length > 200 || sku.length > 100) return send(res, 400, { error: 'A valid productId and productName are required.' });
      if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 1_000_000 || Math.abs(delta * 1000 - Math.round(delta * 1000)) > 1e-6) return send(res, 400, { error: 'quantityDelta must be non-zero with at most three decimal places.' });
      if (!reason || reason.length > 500) return send(res, 400, { error: 'A reason is required (maximum 500 characters).' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [user.locationId + ':inventory-adjustment:' + idempotencyKey]);
        const prior = await client.query('SELECT id,product_id,quantity_delta,quantity_after,created_at FROM inventory_movements WHERE location_id=$1 AND idempotency_key=$2', [user.locationId,idempotencyKey]);
        if (prior.rowCount) { await client.query('COMMIT'); return send(res, 200, { status: 'duplicate', movement: prior.rows[0] }); }
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [user.locationId + ':inventory:' + productId]);
        const existing = await client.query('SELECT quantity FROM inventory_balances WHERE location_id=$1 AND product_id=$2 FOR UPDATE', [user.locationId,productId]);
        const before = existing.rowCount ? Number(existing.rows[0].quantity) : 0;
        const after = Math.round((before + delta + Number.EPSILON) * 1000) / 1000;
        if (after < 0) { await client.query('ROLLBACK'); return send(res, 409, { error: 'Adjustment would make stock negative. Available: ' + before }); }
        await client.query('INSERT INTO inventory_balances(location_id,product_id,sku,product_name,quantity,updated_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(location_id,product_id) DO UPDATE SET sku=EXCLUDED.sku,product_name=EXCLUDED.product_name,quantity=EXCLUDED.quantity,updated_by=EXCLUDED.updated_by,updated_at=now()', [user.locationId,productId,sku,productName,after,user.sub]);
        const movement = await client.query('INSERT INTO inventory_movements(location_id,idempotency_key,product_id,sku,product_name,quantity_delta,quantity_after,reason,reference_type,actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,\'adjustment\',$9) RETURNING id,product_id,quantity_delta,quantity_after,created_at', [user.locationId,idempotencyKey,productId,sku,productName,delta,after,reason,user.sub]);
        await client.query('INSERT INTO audit_events(location_id,actor_id,action,entity,record_id,details) VALUES ($1,$2,$3,$4,$5,$6)', [user.locationId,user.sub,'inventory.adjusted','inventory_balances',productId,JSON.stringify({ quantityDelta: delta, quantityAfter: after, reason })]);
        await client.query('COMMIT');
        return send(res, 201, { status: 'created', movement: movement.rows[0] });
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
    if (req.method === 'POST' && url.pathname === '/api/inventory/initialize') {
      if (!['admin','manager'].includes(user.role)) return send(res, 403, { error: 'Administrator or manager role required to initialize inventory.' });
      const input = await bodyJson(req, 16_000);
      const productId = String(input.productId ?? '').trim();
      const productName = String(input.productName || '').trim();
      const sku = String(input.sku || '').trim();
      const quantity = Number(input.quantity);
      if (!productId || productId.length > 200 || !productName || productName.length > 200 || sku.length > 100) return send(res, 400, { error: 'A valid productId and productName are required.' });
      if (!Number.isFinite(quantity) || quantity < 0 || quantity > 1_000_000_000 || Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 1e-6) return send(res, 400, { error: 'quantity must be zero or greater with at most three decimal places.' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [user.locationId + ':inventory:' + productId]);
        const existing = await client.query('SELECT product_id,sku,product_name,quantity,updated_at FROM inventory_balances WHERE location_id=$1 AND product_id=$2 FOR UPDATE', [user.locationId,productId]);
        if (existing.rowCount) {
          await client.query('COMMIT');
          return send(res, 200, { status: 'already_initialized', inventory: existing.rows[0] });
        }
        const created = await client.query('INSERT INTO inventory_balances(location_id,product_id,sku,product_name,quantity,updated_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING product_id,sku,product_name,quantity,updated_at', [user.locationId,productId,sku,productName,quantity,user.sub]);
        if (quantity > 0) {
          await client.query('INSERT INTO inventory_movements(location_id,idempotency_key,product_id,sku,product_name,quantity_delta,quantity_after,reason,reference_type,actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [user.locationId,crypto.randomUUID(),productId,sku,productName,quantity,quantity,'Initial stock imported from desktop catalog','adjustment',user.sub]);
        }
        await client.query('INSERT INTO audit_events(location_id,actor_id,action,entity,record_id,details) VALUES ($1,$2,$3,$4,$5,$6)', [user.locationId,user.sub,'inventory.initialized','inventory_balances',productId,JSON.stringify({ quantity, source: 'desktop catalog' })]);
        await client.query('COMMIT');
        return send(res, 201, { status: 'initialized', inventory: created.rows[0] });
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
    if (req.method === 'GET' && url.pathname === '/api/inventory/movements') {
      const rawLimit = Number(url.searchParams.get('limit') || 50);
      const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, Math.trunc(rawLimit))) : 50;
      const productId = String(url.searchParams.get('productId') || '').trim();
      const values = [user.locationId];
      let productClause = '';
      if (productId) { values.push(productId); productClause = ' AND m.product_id=$2'; }
      values.push(limit);
      const limitParam = '$' + values.length;
      const result = await pool.query(
        'SELECT m.id,m.product_id,m.sku,m.product_name,m.quantity_delta,m.quantity_after,m.reason,m.reference_type,m.reference_id,m.created_at,u.username AS actor_username ' +
        'FROM inventory_movements m LEFT JOIN staff_users u ON u.id=m.actor_id ' +
        'WHERE m.location_id=$1' + productClause + ' ORDER BY m.created_at DESC,m.id DESC LIMIT ' + limitParam,
        values
      );
      return send(res, 200, { movements: result.rows });
    }
    if (req.method === 'GET' && url.pathname === '/api/inventory') {
      const result = await pool.query('SELECT product_id,sku,product_name,quantity,updated_at FROM inventory_balances WHERE location_id=$1 ORDER BY product_name', [user.locationId]);
      return send(res, 200, { inventory: result.rows });
    }
    const refundMatch = url.pathname.match(/^\/api\/transactions\/([0-9a-f-]{36})\/refunds$/i);
    if (req.method === 'POST' && refundMatch) {
      if (!['admin','manager'].includes(user.role)) return send(res, 403, { error: 'Administrator or manager role required for refunds.' });
      const [, transactionId] = refundMatch;
      if (!isUuid(transactionId)) return send(res, 400, { error: 'A valid transaction ID is required.' });
      const input = await bodyJson(req, 64_000);
      const idempotencyKey = String(input.idempotencyKey || '');
      const amount = Number(input.amount);
      const method = String(input.method || '');
      const reason = String(input.reason || '').trim();
      const restock = input.restock === true;
      const items = input.items === undefined ? [] : input.items;
      if (!isUuid(idempotencyKey)) return send(res, 400, { error: 'A UUID idempotencyKey is required and must be reused for retries.' });
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) return send(res, 400, { error: 'Refund amount must be a positive amount with at most two decimal places.' });
      if (!['Cash','Card','Bank Transfer','Mobile Wallet','Other'].includes(method)) return send(res, 400, { error: 'Unsupported refund method.' });
      if (!reason || reason.length > 500) return send(res, 400, { error: 'A refund reason is required (maximum 500 characters).' });
      if (!Array.isArray(items) || items.length > 200) return send(res, 400, { error: 'Refund items must be an array of at most 200 entries.' });
      for (const item of items) {
        const quantity = Number(item?.quantity);
        if (!String(item?.productId ?? '').trim() || !String(item?.productName || '').trim() || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000 || Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 1e-6) return send(res, 400, { error: 'Each refund item needs productId, productName and a positive quantity with at most three decimals.' });
      }
      if (restock && !items.length) return send(res, 400, { error: 'Provide refunded items when restocking inventory.' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [user.locationId + ':refund:' + idempotencyKey]);
        const prior = await client.query('SELECT id,transaction_id,amount,method,restocked,created_at FROM pos_refunds WHERE location_id=$1 AND idempotency_key=$2', [user.locationId,idempotencyKey]);
        if (prior.rowCount) { await client.query('COMMIT'); return send(res, 200, { status: 'duplicate', refund: prior.rows[0] }); }
        const sale = await client.query('SELECT id,total FROM pos_transactions WHERE id=$1 AND location_id=$2 FOR UPDATE', [transactionId,user.locationId]);
        if (!sale.rowCount) { await client.query('ROLLBACK'); return send(res, 404, { error: 'Sale transaction not found at this location.' }); }
        const refunded = await client.query('SELECT COALESCE(sum(amount),0)::numeric AS amount FROM pos_refunds WHERE transaction_id=$1', [transactionId]);
        const remaining = Number(sale.rows[0].total) - Number(refunded.rows[0].amount);
        if (amount > remaining + 0.000001) { await client.query('ROLLBACK'); return send(res, 409, { error: 'Refund exceeds the remaining refundable amount of ' + Math.max(0, remaining).toFixed(2) + '.' }); }
        const saleLines = await client.query('SELECT product_id,product_name,quantity FROM pos_transaction_lines WHERE transaction_id=$1', [transactionId]);
        const refundQuantities = new Map();
        for (const item of items) refundQuantities.set(String(item.productId), (refundQuantities.get(String(item.productId)) || 0) + Number(item.quantity));
        for (const [productId, requested] of refundQuantities) {
          const sold = saleLines.rows.filter(line => line.product_id === productId).reduce((sum,line) => sum + Number(line.quantity),0);
          const already = await client.query('SELECT COALESCE(sum(rl.quantity),0)::numeric AS quantity FROM pos_refund_lines rl JOIN pos_refunds r ON r.id=rl.refund_id WHERE r.transaction_id=$1 AND rl.product_id=$2', [transactionId,productId]);
          if (requested > sold - Number(already.rows[0].quantity) + 0.000001) { await client.query('ROLLBACK'); return send(res, 409, { error: 'Refund quantity exceeds the unrefunded sold quantity for product ' + productId + '.' }); }
        }
        const inserted = await client.query('INSERT INTO pos_refunds(location_id,transaction_id,idempotency_key,amount,method,reason,restocked,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,transaction_id,amount,method,reason,restocked,created_at', [user.locationId,transactionId,idempotencyKey,amount,method,reason,restock,user.sub]);
        const refund = inserted.rows[0];
        for (const item of items) {
          const productId = String(item.productId);
          const productName = String(item.productName).slice(0,200);
          const quantity = Number(item.quantity);
          await client.query('INSERT INTO pos_refund_lines(refund_id,product_id,product_name,quantity) VALUES ($1,$2,$3,$4)', [refund.id,productId,productName,quantity]);
          if (restock) {
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [user.locationId + ':inventory:' + productId]);
            const balance = await client.query('SELECT quantity,sku,product_name FROM inventory_balances WHERE location_id=$1 AND product_id=$2 FOR UPDATE', [user.locationId,productId]);
            if (!balance.rowCount) throw Object.assign(new Error('Cannot restock ' + productName + ' because inventory tracking has not been initialized for this product.'), { status: 409 });
            const after = Math.round((Number(balance.rows[0].quantity) + quantity + Number.EPSILON) * 1000) / 1000;
            await client.query('UPDATE inventory_balances SET quantity=$1,updated_by=$2,updated_at=now() WHERE location_id=$3 AND product_id=$4', [after,user.sub,user.locationId,productId]);
            await client.query('INSERT INTO inventory_movements(location_id,idempotency_key,product_id,sku,product_name,quantity_delta,quantity_after,reason,reference_type,reference_id,actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [user.locationId,crypto.randomUUID(),productId,balance.rows[0].sku,productName,quantity,after,'Refund '+refund.id,'refund',refund.id,user.sub]);
          }
        }
        await client.query('INSERT INTO audit_events(location_id,actor_id,action,entity,record_id,details) VALUES ($1,$2,$3,$4,$5,$6)', [user.locationId,user.sub,'sale.refunded','pos_refunds',refund.id,JSON.stringify({ transactionId, amount, method, reason, restock, itemCount: items.length })]);
        await client.query('COMMIT');
        return send(res, 201, { status: 'created', refund });
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
    if (req.method === 'GET' && url.pathname === '/api/transactions') {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)));
      if (!Number.isInteger(limit)) return send(res, 400, { error: 'limit must be an integer from 1 to 200.' });
      const result = await pool.query('SELECT id,order_id,customer_name,subtotal,discount_amount,tax_amount,service_charge_amount,delivery_fee,total,created_by,occurred_at,created_at FROM pos_transactions WHERE location_id=$1 ORDER BY created_at DESC LIMIT $2', [user.locationId,limit]);
      return send(res, 200, { transactions: result.rows });
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
            // Serialize writers for this location/entity/record so the compare-and-write check is atomic.
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [user.locationId + ':' + event.entity + ':' + event.recordId]);
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
    const roleChangeMatch = url.pathname.match(/^\/api\/admin\/users\/([0-9a-f-]{36})\/role$/i);
    if (req.method === 'POST' && roleChangeMatch) {
      if (user.role !== 'admin') return send(res, 403, { error: 'Administrator role required.' });
      const [, targetId] = roleChangeMatch;
      if (!isUuid(targetId)) return send(res, 400, { error: 'A valid user ID is required.' });
      const input = await bodyJson(req, 16_000);
      const role = String(input.role || '');
      if (!['admin','manager','cashier'].includes(role)) return send(res, 400, { error: 'Role must be admin, manager or cashier.' });
      const targetResult = await pool.query('SELECT id,role,active FROM staff_users WHERE id=$1 AND location_id=$2', [targetId, user.locationId]);
      const target = targetResult.rows[0];
      if (!target) return send(res, 404, { error: 'Staff account not found at this location.' });
      if (target.active && target.role === 'admin' && role !== 'admin') {
        const count = await pool.query("SELECT count(*)::int AS n FROM staff_users WHERE location_id=$1 AND role='admin' AND active=true", [user.locationId]);
        if (count.rows[0].n <= 1) return send(res, 409, { error: 'Keep at least one active administrator at this location.' });
      }
      const updated = await pool.query('UPDATE staff_users SET role=$1,updated_at=now() WHERE id=$2 AND location_id=$3 RETURNING id,username,display_name,role,active,created_at', [role,targetId,user.locationId]);
      return send(res, 200, { user: updated.rows[0] });
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
 + values.length;
      const result = await pool.query(
        `SELECT m.id,m.product_id,m.sku,m.product_name,m.quantity_delta,m.quantity_after,m.reason,m.reference_type,m.reference_id,m.created_at,u.username AS actor_username FROM inventory_movements m LEFT JOIN staff_users u ON u.id=m.actor_id WHERE m.location_id=$1${productClause} ORDER BY m.created_at DESC,m.id DESC LIMIT ${limitParam}`,
        values
      );
      return send(res, 200, { movements: result.rows });
    }
    if (req.method === 'GET' && url.pathname === '/api/inventory') {
      const result = await pool.query('SELECT product_id,sku,product_name,quantity,updated_at FROM inventory_balances WHERE location_id=$1 ORDER BY product_name', [user.locationId]);
      return send(res, 200, { inventory: result.rows });
    }
    const refundMatch = url.pathname.match(/^\/api\/transactions\/([0-9a-f-]{36})\/refunds$/i);
    if (req.method === 'POST' && refundMatch) {
      if (!['admin','manager'].includes(user.role)) return send(res, 403, { error: 'Administrator or manager role required for refunds.' });
      const [, transactionId] = refundMatch;
      if (!isUuid(transactionId)) return send(res, 400, { error: 'A valid transaction ID is required.' });
      const input = await bodyJson(req, 64_000);
      const idempotencyKey = String(input.idempotencyKey || '');
      const amount = Number(input.amount);
      const method = String(input.method || '');
      const reason = String(input.reason || '').trim();
      const restock = input.restock === true;
      const items = input.items === undefined ? [] : input.items;
      if (!isUuid(idempotencyKey)) return send(res, 400, { error: 'A UUID idempotencyKey is required and must be reused for retries.' });
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) return send(res, 400, { error: 'Refund amount must be a positive amount with at most two decimal places.' });
      if (!['Cash','Card','Bank Transfer','Mobile Wallet','Other'].includes(method)) return send(res, 400, { error: 'Unsupported refund method.' });
      if (!reason || reason.length > 500) return send(res, 400, { error: 'A refund reason is required (maximum 500 characters).' });
      if (!Array.isArray(items) || items.length > 200) return send(res, 400, { error: 'Refund items must be an array of at most 200 entries.' });
      for (const item of items) {
        const quantity = Number(item?.quantity);
        if (!String(item?.productId ?? '').trim() || !String(item?.productName || '').trim() || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000 || Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 1e-6) return send(res, 400, { error: 'Each refund item needs productId, productName and a positive quantity with at most three decimals.' });
      }
      if (restock && !items.length) return send(res, 400, { error: 'Provide refunded items when restocking inventory.' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [user.locationId + ':refund:' + idempotencyKey]);
        const prior = await client.query('SELECT id,transaction_id,amount,method,restocked,created_at FROM pos_refunds WHERE location_id=$1 AND idempotency_key=$2', [user.locationId,idempotencyKey]);
        if (prior.rowCount) { await client.query('COMMIT'); return send(res, 200, { status: 'duplicate', refund: prior.rows[0] }); }
        const sale = await client.query('SELECT id,total FROM pos_transactions WHERE id=$1 AND location_id=$2 FOR UPDATE', [transactionId,user.locationId]);
        if (!sale.rowCount) { await client.query('ROLLBACK'); return send(res, 404, { error: 'Sale transaction not found at this location.' }); }
        const refunded = await client.query('SELECT COALESCE(sum(amount),0)::numeric AS amount FROM pos_refunds WHERE transaction_id=$1', [transactionId]);
        const remaining = Number(sale.rows[0].total) - Number(refunded.rows[0].amount);
        if (amount > remaining + 0.000001) { await client.query('ROLLBACK'); return send(res, 409, { error: 'Refund exceeds the remaining refundable amount of ' + Math.max(0, remaining).toFixed(2) + '.' }); }
        const saleLines = await client.query('SELECT product_id,product_name,quantity FROM pos_transaction_lines WHERE transaction_id=$1', [transactionId]);
        const refundQuantities = new Map();
        for (const item of items) refundQuantities.set(String(item.productId), (refundQuantities.get(String(item.productId)) || 0) + Number(item.quantity));
        for (const [productId, requested] of refundQuantities) {
          const sold = saleLines.rows.filter(line => line.product_id === productId).reduce((sum,line) => sum + Number(line.quantity),0);
          const already = await client.query('SELECT COALESCE(sum(rl.quantity),0)::numeric AS quantity FROM pos_refund_lines rl JOIN pos_refunds r ON r.id=rl.refund_id WHERE r.transaction_id=$1 AND rl.product_id=$2', [transactionId,productId]);
          if (requested > sold - Number(already.rows[0].quantity) + 0.000001) { await client.query('ROLLBACK'); return send(res, 409, { error: 'Refund quantity exceeds the unrefunded sold quantity for product ' + productId + '.' }); }
        }
        const inserted = await client.query('INSERT INTO pos_refunds(location_id,transaction_id,idempotency_key,amount,method,reason,restocked,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,transaction_id,amount,method,reason,restocked,created_at', [user.locationId,transactionId,idempotencyKey,amount,method,reason,restock,user.sub]);
        const refund = inserted.rows[0];
        for (const item of items) {
          const productId = String(item.productId);
          const productName = String(item.productName).slice(0,200);
          const quantity = Number(item.quantity);
          await client.query('INSERT INTO pos_refund_lines(refund_id,product_id,product_name,quantity) VALUES ($1,$2,$3,$4)', [refund.id,productId,productName,quantity]);
          if (restock) {
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [user.locationId + ':inventory:' + productId]);
            const balance = await client.query('SELECT quantity,sku,product_name FROM inventory_balances WHERE location_id=$1 AND product_id=$2 FOR UPDATE', [user.locationId,productId]);
            if (!balance.rowCount) throw Object.assign(new Error('Cannot restock ' + productName + ' because inventory tracking has not been initialized for this product.'), { status: 409 });
            const after = Math.round((Number(balance.rows[0].quantity) + quantity + Number.EPSILON) * 1000) / 1000;
            await client.query('UPDATE inventory_balances SET quantity=$1,updated_by=$2,updated_at=now() WHERE location_id=$3 AND product_id=$4', [after,user.sub,user.locationId,productId]);
            await client.query('INSERT INTO inventory_movements(location_id,idempotency_key,product_id,sku,product_name,quantity_delta,quantity_after,reason,reference_type,reference_id,actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [user.locationId,crypto.randomUUID(),productId,balance.rows[0].sku,productName,quantity,after,'Refund '+refund.id,'refund',refund.id,user.sub]);
          }
        }
        await client.query('INSERT INTO audit_events(location_id,actor_id,action,entity,record_id,details) VALUES ($1,$2,$3,$4,$5,$6)', [user.locationId,user.sub,'sale.refunded','pos_refunds',refund.id,JSON.stringify({ transactionId, amount, method, reason, restock, itemCount: items.length })]);
        await client.query('COMMIT');
        return send(res, 201, { status: 'created', refund });
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
    if (req.method === 'GET' && url.pathname === '/api/transactions') {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)));
      if (!Number.isInteger(limit)) return send(res, 400, { error: 'limit must be an integer from 1 to 200.' });
      const result = await pool.query('SELECT id,order_id,customer_name,subtotal,discount_amount,tax_amount,service_charge_amount,delivery_fee,total,created_by,occurred_at,created_at FROM pos_transactions WHERE location_id=$1 ORDER BY created_at DESC LIMIT $2', [user.locationId,limit]);
      return send(res, 200, { transactions: result.rows });
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
            // Serialize writers for this location/entity/record so the compare-and-write check is atomic.
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [user.locationId + ':' + event.entity + ':' + event.recordId]);
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
    const roleChangeMatch = url.pathname.match(/^\/api\/admin\/users\/([0-9a-f-]{36})\/role$/i);
    if (req.method === 'POST' && roleChangeMatch) {
      if (user.role !== 'admin') return send(res, 403, { error: 'Administrator role required.' });
      const [, targetId] = roleChangeMatch;
      if (!isUuid(targetId)) return send(res, 400, { error: 'A valid user ID is required.' });
      const input = await bodyJson(req, 16_000);
      const role = String(input.role || '');
      if (!['admin','manager','cashier'].includes(role)) return send(res, 400, { error: 'Role must be admin, manager or cashier.' });
      const targetResult = await pool.query('SELECT id,role,active FROM staff_users WHERE id=$1 AND location_id=$2', [targetId, user.locationId]);
      const target = targetResult.rows[0];
      if (!target) return send(res, 404, { error: 'Staff account not found at this location.' });
      if (target.active && target.role === 'admin' && role !== 'admin') {
        const count = await pool.query("SELECT count(*)::int AS n FROM staff_users WHERE location_id=$1 AND role='admin' AND active=true", [user.locationId]);
        if (count.rows[0].n <= 1) return send(res, 409, { error: 'Keep at least one active administrator at this location.' });
      }
      const updated = await pool.query('UPDATE staff_users SET role=$1,updated_at=now() WHERE id=$2 AND location_id=$3 RETURNING id,username,display_name,role,active,created_at', [role,targetId,user.locationId]);
      return send(res, 200, { user: updated.rows[0] });
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
