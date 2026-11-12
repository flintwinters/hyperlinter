import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { collectHistory, type HistoryChange } from '../../src/history';

test('root, rename, recreation, merge, worktree and shallow coverage', (t) => {
  mkdirSync('artifacts', { recursive: true });
  const root = mkdtempSync(path.resolve('artifacts/history-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-b', 'main'); git('config', 'user.email', 'test@example.test'); git('config', 'user.name', 'Test');
  const commit = () => { git('add', '.'); git('commit', '-m', 'observation'); };
  writeFileSync(path.join(root, 'odd\nname.ts'), 'hello\n'); commit();
  git('mv', 'odd\nname.ts', 'renamed.ts'); commit();
  assert.equal(collectHistory(root).commits[0].changes[0].contentChanged, false);
  git('rm', 'renamed.ts'); commit(); writeFileSync(path.join(root, 'renamed.ts'), 'new\n'); commit();
  git('checkout', '-b', 'branch'); writeFileSync(path.join(root, 'branch.ts'), 'branch'); commit();
  git('checkout', 'main'); git('merge', '--no-ff', 'branch', '-m', 'integration');
  const snapshot = collectHistory(root);
  assert.equal(snapshot.commits.length, 5); assert.equal(snapshot.commits[0].parents.length, 2);
  const rootChange: HistoryChange | undefined = snapshot.commits.at(-1)?.changes[0];
  assert.equal(rootChange?.kind, 'A');
  assert.equal(rootChange?.path, 'odd\nname.ts');
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.commits) && Object.isFrozen(rootChange)); assert.equal(snapshot.coverage.end, 'root');
  assert.equal(collectHistory(root, 2).coverage.end, 'window');
  const worktree = path.join(root, 'worktree'); git('worktree', 'add', '--detach', worktree);
  assert.equal(collectHistory(worktree).revision, snapshot.revision);
  const shallow = path.join(root, 'shallow'); git('clone', '--depth=1', `file://${root}`, shallow);
  assert.equal(collectHistory(shallow).coverage.end, 'shallow');
  assert.throws(() => collectHistory(path.dirname(root) + '/missing'), /could not read local Git history/);
});

test('edited renames preserve content evidence; copies and mode-only edits have distinct semantics', t => {
  mkdirSync('artifacts', { recursive: true });
  const root = mkdtempSync(path.resolve('artifacts/history-edits-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-b', 'main'); git('config', 'user.email', 'test@example.test'); git('config', 'user.name', 'Test');
  const commit = () => { git('add', '.'); git('commit', '-m', 'observation'); };
  const text = Array.from({ length: 30 }, (_, i) => `line ${i}\n`).join('');
  writeFileSync(path.join(root, 'before.ts'), text); commit();
  git('mv', 'before.ts', 'after.ts'); writeFileSync(path.join(root, 'after.ts'), text + 'edited\n'); commit();
  const renamed = collectHistory(root).commits[0].changes[0];
  assert.equal(renamed.kind, 'R'); assert.equal(renamed.previousPath, 'before.ts'); assert.equal(renamed.contentChanged, true);
  writeFileSync(path.join(root, 'copy.ts'), text + 'edited\n'); commit();
  assert.equal(collectHistory(root).commits[0].changes[0].kind, 'A');
  git('update-index', '--chmod=+x', 'after.ts'); git('commit', '-m', 'mode');
  assert.equal(collectHistory(root).commits[0].changes[0].contentChanged, false);
  mkdirSync(path.join(root, 'nested'));
  assert.equal(collectHistory(path.join(root, 'nested')).root, root);
});

test('malformed reads and subprocess timeouts fail the explicit history boundary', async t => {
  const { chmodSync } = await import('node:fs');
  mkdirSync('artifacts', { recursive: true });
  const root = mkdtempSync(path.resolve('artifacts/history-failure-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const oldPath = process.env.PATH;
  const executable = path.join(root, 'git');
  process.env.PATH = root;
  try {
    writeFileSync(executable, '#!/bin/sh\ncase "$1" in\nrev-parse) echo "' + root + '";;\nrev-list) echo abc;;\ncat-file) echo malformed;;\nesac\n');
    chmodSync(executable, 0o755);
    assert.throws(() => collectHistory(root), /invalid Git commit metadata/);
    writeFileSync(executable, '#!/bin/sh\nexec /bin/sleep 40\n');
    const started = Date.now();
    assert.throws(() => collectHistory(root), /could not read local Git history.*ETIMEDOUT/s);
    assert.ok(Date.now() - started >= 29_000);
  } finally { process.env.PATH = oldPath; }
});
