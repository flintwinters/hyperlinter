import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { RuntimeStore } from '../../src/runtime';

function fixture(t: TestContext, pointer = false) {
  fs.mkdirSync('artifacts', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('artifacts/runtime-cleanup-'));
  const metadata = path.join(root, pointer ? 'metadata' : '.git');
  fs.mkdirSync(metadata);
  if (pointer) fs.writeFileSync(path.join(root, '.git'), 'gitdir: metadata\n');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const legacy = path.join(root, 'runtime/hyperlint.sqlite');
  const destination = path.join(metadata, 'hyperlinter/hyperlint.sqlite');
  const history = () => {
    const result = spawnSync(process.execPath, ['--import', path.resolve('node_modules/tsx/dist/loader.mjs'),
      path.resolve('src/cli.ts'), '--history'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).runs;
  };
  return { root, legacy, destination, history };
}

function seed(file: string) {
  const store = new RuntimeStore(file);
  try { return store.record({ diagnostics: [], metrics: [] }, 7); }
  finally { store.close(); }
}

for (const pointer of [false, true]) {
  test(`default ledger stays private and preserves history (Git pointer: ${pointer})`, t => {
    const { root, destination, history } = fixture(t, pointer);
    assert.deepEqual(history(), []);
    assert.ok(fs.existsSync(destination));
    assert.equal(fs.existsSync(path.join(root, 'runtime')), false);
    const run = seed(destination);
    assert.deepEqual(history(), [{ ...run, chronology: null }]);
    assert.deepEqual(history(), [{ ...run, chronology: null }]);
    assert.equal(fs.existsSync(destination + '-wal'), false);
    assert.equal(fs.existsSync(destination + '-shm'), false);
  });
}

test('legacy ledger moves without copying and removes its empty directory', t => {
  const { root, legacy, destination, history } = fixture(t);
  const run = seed(legacy);
  const inode = fs.statSync(legacy).ino;
  assert.deepEqual(history(), [{ ...run, chronology: null }]);
  assert.equal(fs.statSync(destination).ino, inode);
  assert.equal(fs.existsSync(path.join(root, 'runtime')), false);
});

test('migration preserves unrelated runtime files and explicit ledger paths', t => {
  const { root, legacy, history } = fixture(t);
  const run = seed(legacy);
  const unrelated = path.join(root, 'runtime/keep.txt');
  fs.writeFileSync(unrelated, 'keep');
  assert.ok(fs.existsSync(legacy));
  assert.deepEqual(history(), [{ ...run, chronology: null }]);
  assert.equal(fs.existsSync(legacy), false);
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'keep');
});

test('an existing destination never overwrites or deletes a legacy ledger', t => {
  const { legacy, destination, history } = fixture(t);
  seed(legacy);
  const run = seed(destination);
  const original = fs.readFileSync(legacy);
  assert.deepEqual(history(), [{ ...run, chronology: null }]);
  assert.deepEqual(fs.readFileSync(legacy), original);
});

test('live WAL defers migration until the connection closes', t => {
  const { legacy, destination, history } = fixture(t);
  const store = new RuntimeStore(legacy);
  try {
    const run = store.record({ diagnostics: [], metrics: [] }, 9);
    assert.ok(fs.existsSync(legacy + '-wal'));
    assert.deepEqual(history(), [{ ...run, chronology: null }]);
    assert.equal(fs.existsSync(destination), false);
  } finally { store.close(); }
  assert.equal(history().length, 1);
  assert.ok(fs.existsSync(destination));
  assert.equal(fs.existsSync(legacy), false);
});

test('the former tools/hyperlint layout migrates into target-private metadata', t => {
  const { root, destination, history } = fixture(t);
  const legacy = path.join(root, 'tools/hyperlint/runtime/hyperlint.sqlite');
  const run = seed(legacy);
  assert.deepEqual(history(), [{ ...run, chronology: null }]);
  assert.ok(fs.existsSync(destination));
  assert.equal(fs.existsSync(path.dirname(legacy)), false);
  assert.ok(fs.existsSync(path.join(root, 'tools/hyperlint')));
});
