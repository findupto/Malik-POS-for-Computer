import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'malik-backup-health-'));
  const backups = path.join(root, 'backups');
  const bin = path.join(root, 'bin');
  await mkdir(backups);
  await mkdir(bin);
  const pgRestore = path.join(bin, 'pg_restore');
  await writeFile(pgRestore, '#!/bin/sh\n[ "$1" = "--list" ] && [ -f "$2" ]\n', { mode: 0o755 });
  await chmod(pgRestore, 0o755);
  const archive = path.join(backups, 'malik-pos-test.dump');
  await writeFile(archive, 'test backup archive');
  const digest = crypto.createHash('sha256').update('test backup archive').digest('hex');
  await writeFile(archive + '.sha256', digest + '  malik-pos-test.dump\n');
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, backups, bin, archive };
}

function runCheck(f) {
  return spawnSync('sh', ['server/backup-healthcheck.sh'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      BACKUP_DIR: f.backups,
      BACKUP_MAX_AGE_SECONDS: '90000',
      PATH: f.bin + path.delimiter + process.env.PATH
    }
  });
}

test('backup health check accepts a fresh checksum-valid archive', async t => {
  const f = await fixture(t);
  const result = runCheck(f);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Backup health OK/);
});

test('backup health check rejects a stale archive', async t => {
  const f = await fixture(t);
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await utimes(f.archive, old, old);
  const result = runCheck(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /stale/);
});

test('backup health check rejects a checksum mismatch', async t => {
  const f = await fixture(t);
  await writeFile(f.archive + '.sha256', '0000000000000000000000000000000000000000000000000000000000000000  malik-pos-test.dump\n');
  const result = runCheck(f);
  assert.notEqual(result.status, 0);
});

test('backup health check rejects a checksum manifest for a different archive', async t => {
  const f = await fixture(t);
  await writeFile(f.archive, 'corrupted newest archive');
  const other = path.join(f.backups, 'malik-pos-other.dump');
  await writeFile(other, 'different valid archive');
  const older = new Date(Date.now() - 60_000);
  await utimes(other, older, older);
  const digest = crypto.createHash('sha256').update('different valid archive').digest('hex');
  await writeFile(f.archive + '.sha256', digest + '  malik-pos-other.dump\n');
  const result = runCheck(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not name the newest archive/);
});
