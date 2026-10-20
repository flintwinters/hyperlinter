import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
test('SQLite statements survive asynchronous garbage collection and repeated close/reopen cycles', t => {
  mkdirSync('artifacts', { recursive: true });
  const directory = mkdtempSync(path.resolve('artifacts/sqlite-lifecycle-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bindings = new Set([require.resolve('better-sqlite3'), createRequire(path.resolve('package.json')).resolve('better-sqlite3')]);
  for (const [index, binding] of [...bindings].entries()) {
    const result = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(new URL('./lifecycle.mjs', import.meta.url)),
      binding, path.join(directory, `evidence-${index}.sqlite`)], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.error, undefined, `${String(result.error)}\n${result.stdout}\n${result.stderr}`);
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /persistent evidence reopened successfully/);
  }
});
