import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { loadHyperlinterConfig } from '../src/config';
import { ProjectModel } from '../src/project';
import { deadImplementationRule } from '../src/rules';
import { rules } from '../src/rules';

test('dead implementations include chains and recursive groups, while roots preserve callbacks and exports', () => {
  const fixture = path.resolve(`runtime/dead-implementation-${process.pid}`);
  fs.mkdirSync(fixture, { recursive: true });
  try {
    fs.writeFileSync(path.join(fixture, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2022', strict: true }, include: ['*.ts'],
    }));
    fs.writeFileSync(path.join(fixture, 'implementation.ts'), `
function deadLeaf() { return 1; }
function deadChain() { return deadLeaf(); }
function recursiveA(): number { return recursiveB(); }
function recursiveB(): number { return recursiveA(); }
const unusedArrow = () => deadLeaf();
function callback() { return 2; }
[1].map(callback);
function shorthand() { return 3; }
console.log({ shorthand });
function publicHelper() { return 4; }
export function api() { return publicHelper(); }
function aliased() { return 5; }
export { aliased as entry };
const liveArrow = () => publicHelper();
liveArrow();
function local() { const deadLeaf = () => 9; return deadLeaf(); }
local();
`);
    fs.writeFileSync(path.join(fixture, 'consumer.ts'), `import { api } from './implementation'; api();`);
    const findings = deadImplementationRule.analyze(ProjectModel.fromTsConfig(path.join(fixture, 'tsconfig.json')), loadHyperlinterConfig());
    assert.deepEqual(findings.map((finding) => finding.message.split(' ')[2]),
      ['deadLeaf:', 'deadChain:', 'recursiveA:', 'recursiveB:', 'unusedArrow:']);
    assert.ok(findings.every((finding) => finding.severity === 'error' && finding.rule === 'HL114'
      && finding.file === 'implementation.ts' && finding.line! > 0));
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('registered diagnostics distinguish agent length and module entrypoints', () => {
  assert.equal(new Set(rules.map((rule) => rule.id)).size, rules.length);
  assert.ok(rules.some((rule) => rule.id === 'HL108'));
  assert.ok(rules.some((rule) => rule.id === 'HL112'));
});
