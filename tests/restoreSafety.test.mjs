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
