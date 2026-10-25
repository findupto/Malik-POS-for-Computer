import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const restoreScript = path.join(root, 'server', 'restore.sh');

test('restore refuses an archive without a checksum before invoking pg_restore', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'malik-pos-restore-'));
  const archive = path.join(directory, 'backup.dump');
  try {
    await writeFile(archive, 'not a real database archive');
    const result = spawnSync('sh', [restoreScript, archive], {
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://test:test@127.0.0.1/test',
        CONFIRM_RESTORE: 'YES'
      }
    });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /checksum file not found/);
    assert.doesNotMatch(result.stderr, /pg_restore/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('restore rejects a checksum entry that names a different file', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'malik-pos-restore-'));
  const archive = path.join(directory, 'backup.dump');
  const other = path.join(directory, 'other.bin');
  try {
    await writeFile(archive, 'archive bytes');
    await writeFile(other, 'different file bytes');
    const checksum = spawnSync('sha256sum', [other], { encoding: 'utf8' });
    assert.equal(checksum.status, 0, checksum.stderr);
    await writeFile(archive + '.sha256', checksum.stdout);
    const result = spawnSync('sh', [restoreScript, archive], {
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: 'postgresql://test:test@127.0.0.1/test',
        CONFIRM_RESTORE: 'YES'
      }
    });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /checksum file must contain one SHA-256 entry/);
    assert.doesNotMatch(result.stderr, /pg_restore/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('restore applies a verified archive in a single transaction', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'malik-pos-restore-'));
  const bin = path.join(directory, 'bin');
  const archive = path.join(directory, 'backup.dump');
  const log = path.join(directory, 'pg-restore-args.txt');
  try {
    await import('node:fs/promises').then(({ mkdir }) => mkdir(bin));
    await writeFile(archive, 'mock verified archive');
    const checksum = spawnSync('sha256sum', [archive], { encoding: 'utf8' });
    assert.equal(checksum.status, 0, checksum.stderr);
    await writeFile(archive + '.sha256', checksum.stdout);
    const fakePgRestore = path.join(bin, 'pg_restore');
    await writeFile(fakePgRestore, '#!/bin/sh\nif [ "$1" = "--list" ]; then exit 0; fi\nprintf "%s\\n" "$@" > "$PG_RESTORE_ARGS_LOG"\n', { mode: 0o755 });
    const result = spawnSync('sh', [restoreScript, archive], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: bin + path.delimiter + process.env.PATH,
        PG_RESTORE_ARGS_LOG: log,
        DATABASE_URL: 'postgresql://test:test@127.0.0.1/test',
        CONFIRM_RESTORE: 'YES'
      }
    });
    assert.equal(result.status, 0, result.stderr);
    const args = (await import('node:fs/promises').then(({ readFile }) => readFile(log, 'utf8'))).trim().split(/\\r?\\n/);
    assert.ok(args.includes('--single-transaction'), 'restore must roll back rather than leave a partially restored database');
    assert.ok(args.includes('--exit-on-error'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
