import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { analyze } from '../../src';
import { loadHyperlinterConfig } from '../../src/config';

test('engine configuration resolves from the installation outside conventional working directories', (t) => {
  fs.mkdirSync('artifacts', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('artifacts/config-root-'));
  const originalDirectory = process.cwd();
  t.after(() => { process.chdir(originalDirectory); fs.rmSync(root, { recursive: true, force: true }); });
  process.chdir(root);
  assert.equal(loadHyperlinterConfig().rules.moduleScore, 'error');
});

test('explicit target rule opt-outs do not change engine defaults or other projects', async (t) => {
  fs.mkdirSync('artifacts', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('artifacts/config-rules-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tsconfig = path.join(root, 'tsconfig.json');
  fs.writeFileSync(tsconfig, JSON.stringify({ compilerOptions: { target: 'ES2022' }, include: ['*.ts'] }));
  fs.writeFileSync(path.join(root, 'index.ts'), 'export function recurse(): void { recurse(); }');
  const before = await analyze(tsconfig);
  assert.ok(before.diagnostics.some(item => item.rule === 'HL120'));
  const file = path.join(root, 'hyperlinter.project.json');
  fs.writeFileSync(file, JSON.stringify({ disabledRules: ['HL120', 'HL121'] }));
  assert.deepEqual(loadHyperlinterConfig(undefined, root).disabledRules, ['HL120', 'HL121']);
  assert.deepEqual(loadHyperlinterConfig().disabledRules, []);
  const after = await analyze(tsconfig);
  assert.equal(after.diagnostics.some(item => ['HL120', 'HL121'].includes(item.rule)), false);
  fs.writeFileSync(file, JSON.stringify({ disabledRules: ['not-a-rule'] }));
  assert.throws(() => loadHyperlinterConfig(undefined, root), /disabledRules must be an array of HL rule IDs/);
});
