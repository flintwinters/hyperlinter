import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { analyzeChronolint } from '../../src';
import { loadHyperlinterConfig } from '../../src/config';

test('dedicated CLI text, JSON and recorded-history evidence agree and fixing is rejected', async t => {
  mkdirSync('artifacts', { recursive: true });
  const root = mkdtempSync(path.resolve('artifacts/chronology-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.test');
  writeFileSync(path.join(root, 'hyperlinter.config.json'), JSON.stringify(loadHyperlinterConfig()));
  writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ include: ['src/**/*.ts'] }));
  for (const name of ['a', 'b', 'c']) {
    mkdirSync(path.join(root, 'src', name), { recursive: true });
    writeFileSync(path.join(root, 'src', name, 'index.ts'), 'export const value = 0;\n');
  }
  const commit = () => { git('add', '.'); git('commit', '-m', 'observation'); };
  commit();
  for (let i = 1; i <= 30; i++) {
    for (const name of i <= 5 ? ['a', 'b'] : ['c'])
      writeFileSync(path.join(root, 'src', name, 'index.ts'), `export const value = ${i};\n`);
    commit();
  }
  const cli = path.resolve('src/cli.ts');
  const loader = path.resolve('node_modules/tsx/dist/loader.mjs');
  const invoke = (...args: string[]) => execFileSync(process.execPath, ['--import', loader, cli, ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, HYPERLINT_JOURNAL_MODE: 'DELETE' },
  });
  const first = JSON.parse(invoke('--chronolint', '--format=json'));
  const second = JSON.parse(invoke('--chronolint', '--format', 'json'));
  assert.deepEqual(first.chronology, second.chronology);
  assert.deepEqual(first.diagnostics, second.diagnostics);
  assert.equal(first.chronology.findings.length, 1);
  assert.equal(first.run.errors, 0); assert.equal(first.run.smells, 0);
  const text = invoke('--chronolint');
  assert.ok(text.includes(first.diagnostics[0].message));
  assert.ok(text.includes(JSON.stringify(first.chronology)));
  const recorded = JSON.parse(invoke('--history', '--format=json'));
  assert.deepEqual(recorded.runs[0].chronology, first.chronology);
  const original = readFileSync(path.join(root, 'src/a/index.ts'), 'utf8');
  for (const option of ['--fix', '--fix-private-exports', '--write-baseline', '--write-inline-style-baseline']) {
    const rejected = spawnSync(process.execPath, ['--import', loader, cli, '--chronolint', option], { cwd: root, encoding: 'utf8' });
    assert.equal(rejected.status, 1); assert.match(rejected.stderr, /must run separately/);
  }
  assert.equal(readFileSync(path.join(root, 'src/a/index.ts'), 'utf8'), original);
  const result = await analyzeChronolint(path.join(root, 'tsconfig.json'));
  assert.deepEqual(result.chronology, first.chronology);
});
