import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'malik-restore-safety-'));
  const bin = path.join(root, 'bin');
  await mkdir(bin);
  const archive = path.join(root, 'backup.dump');
  await writeFile(archive, 'verified backup fixture');
  const digest = crypto.createHash('sha256').update('verified backup fixture').digest('hex');
  await writeFile(archive + '.sha256', digest + '  backup.dump\n');
  const log = path.join(root, 'pg-restore.log');
  await writeFile(path.join(bin, 'pg_restore'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$PG_RESTORE_LOG"\n[ "$1" = "--list" ] && exit 0\nexit 0\n', { mode: 0o755 });
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, bin, archive, log };
}

function runRestore(f, extraEnv = {}, archive = f.archive) {
  return spawnSync('sh', ['server/restore.sh', archive], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: f.bin + path.delimiter + process.env.PATH,
      DATABASE_URL: 'postgres://restore-test.invalid/test',
      PG_RESTORE_LOG: f.log,
      ...extraEnv
    }
  });
}

async function restoreLog(f) {
  try { return await readFile(f.log, 'utf8'); } catch { return ''; }
}

test('restore refuses to run without explicit confirmation', async t => {
  const f = await fixture(t);
  const result = runRestore(f);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to restore/);
  assert.equal(await restoreLog(f), '');
});

test('restore refuses an archive that does not exist', async t => {
  const f = await fixture(t);
  const result = runRestore(f, { CONFIRM_RESTORE: 'YES' }, path.join(f.root, 'missing.dump'));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Backup archive not found/);
  assert.equal(await restoreLog(f), '');
});

test('restore refuses a checksum file naming a different archive', async t => {
  const f = await fixture(t);
  await writeFile(f.archive + '.sha256', 'a'.repeat(64) + '  some-other.dump\n');
  const result = runRestore(f, { CONFIRM_RESTORE: 'YES' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /must contain one SHA-256 entry/);
  assert.equal(await restoreLog(f), '');
});

test('restore refuses a checksum mismatch before invoking pg_restore', async t => {
  const f = await fixture(t);
  await writeFile(f.archive + '.sha256', '0'.repeat(64) + '  backup.dump\n');
  const result = runRestore(f, { CONFIRM_RESTORE: 'YES' });
  assert.notEqual(result.status, 0);
  assert.equal(await restoreLog(f), '');
});

test('restore validates the archive before executing the restore command', async t => {
  const f = await fixture(t);
  const result = runRestore(f, { CONFIRM_RESTORE: 'YES' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = (await restoreLog(f)).trim().split('\n');
  assert.equal(calls.length, 2);
  assert.match(calls[0], /^--list /);
  assert.match(calls[1], /--single-transaction/);
  assert.match(calls[1], /--exit-on-error/);
});
