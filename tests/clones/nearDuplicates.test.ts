import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { loadHyperlinterConfig } from '../../src/config';
import { ProjectModel } from '../../src/project';
import { nearDuplicatesRule } from '../../src/rules';

const config = loadHyperlinterConfig();

test('near-duplicate findings report repository-relative files like every other rule', (t) => {
  fs.mkdirSync('artifacts', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('artifacts/near-duplicates-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ include: ['src/**/*.ts'] }));
  const variant = (name: string, offset: number) => `export function ${name}(values: number[]): number {
  let total = 0;
  for (const value of values) {
    if (value > ${offset}) total += value * 2 + ${offset};
    else total -= value - 1;
  }
  return total > 100 ? total / 2 : total + ${offset};
}
`;
  fs.writeFileSync(path.join(root, 'src/index.ts'), variant('first', 3) + variant('second', 5) + variant('third', 7));
  const findings = nearDuplicatesRule.analyze(ProjectModel.fromTsConfig(path.join(root, 'tsconfig.json')), config);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, 'src/index.ts');
});
