import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const monitor = path.resolve('server/backup-monitor.sh');

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'malik-backup-monitor-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin');
  await mkdir(bin);
  const backup = path.join(dir, 'backup.sh');
  const health = path.join(dir, 'health.sh');
  const log = path.join(dir, 'webhook.log');
  await writeFile(backup, '#!/bin/sh\nexit 0\n');
  await writeFile(health, '#!/bin/sh\nexit 0\n');
  const wget = path.join(bin, 'wget');
  await writeFile(wget, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$WEBHOOK_LOG"\nexit 0\n');
  await chmod(wget, 0o755);
  return { dir, bin, backup, health, log };
}

function run(f, extra = {}) {
  return spawnSync('sh', [monitor], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: f.bin + path.delimiter + process.env.PATH,
      BACKUP_SCRIPT: f.backup,
      HEALTHCHECK_SCRIPT: f.health,
      WEBHOOK_LOG: f.log,
      ...extra
    }
  });
}

test('backup monitor exits cleanly when backup and health check pass', async t => {
  const f = await fixture(t);
  const result = run(f);
  assert.equal(result.status, 0, result.stderr);
});

test('backup monitor alerts when the backup command fails even if an older backup remains healthy', async t => {
  const f = await fixture(t);
  await writeFile(f.backup, '#!/bin/sh\nexit 1\n');
  const result = run(f, { BACKUP_ALERT_WEBHOOK_URL: 'https://example.invalid/webhook' });
  assert.equal(result.status, 1);
  const logged = await readFile(f.log, 'utf8');
  assert.match(logged, /Malik POS database backup is missing, stale, or invalid/);
});

test('backup monitor sends a static alert when health check fails', async t => {
  const f = await fixture(t);
  await writeFile(f.health, '#!/bin/sh\necho unhealthy >&2\nexit 1\n');
  const result = run(f, { BACKUP_ALERT_WEBHOOK_URL: 'https://example.invalid/webhook' });
  assert.equal(result.status, 1);
  const logged = await readFile(f.log, 'utf8');
  assert.match(logged, /--post-data=/);
  assert.match(logged, /Malik POS database backup is missing, stale, or invalid/);
  assert.doesNotMatch(logged, /DATABASE_URL|password/i);
});

test('backup monitor reports missing alert configuration without pretending it notified anyone', async t => {
  const f = await fixture(t);
  await writeFile(f.health, '#!/bin/sh\nexit 1\n');
  const result = run(f);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no remote alert was sent/);
});
