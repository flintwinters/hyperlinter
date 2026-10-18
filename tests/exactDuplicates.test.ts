import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import fs from 'node:fs';

import ts from 'typescript';

import { findExactClones } from '../src/clones';
import { loadHyperlinterConfig } from '../src/config';
import { findNearDuplicateClusters } from '../src/clones';
import { ProjectModel } from '../src/project';
import { nearDuplicatesRule } from '../src/rules';

const config = loadHyperlinterConfig();

function projectFor(fileName: string) {
  const program = ts.createProgram([fileName], { strict: true, allowNonTsExtensions: true });
  const sourceFile = program.getSourceFile(fileName)!;
  return {
    checker: program.getTypeChecker(),
    getModuleIdForFile: () => 'clones.ts',
    getModules: () => [{ id: 'clones.ts', sourceFiles: [sourceFile] }],
  } as never;
}

function find(fileName: string) {
  return findExactClones(projectFor(fileName), config);
}

test('detects alpha-renamed clones and anti-unifies literal differences', () => {
  const clones = find(path.resolve('tests/fixtures/exact-clones.fixture'));
  assert.equal(clones.length, 3);
  assert.ok(clones[0].meaningfulNodes >= config.clones.exactMinimumMeaningfulNodes);
  assert.equal(clones[0].differences.length, 1);
});

test('ignores structurally small duplicates', () => {
  assert.equal(find(path.resolve('tests/exactDuplicates.test.ts')).length, 0);
});

test('tracks only three-method near-duplicate clusters at the strict threshold', () => {
  const clusters = findNearDuplicateClusters(projectFor(path.resolve('tests/fixtures/exact-clones.fixture')), config);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].methods.length, 3);
  assert.ok(clusters[0].similarity >= config.clones.nearMinimumSimilarity);
  assert.ok(clusters[0].parameterized);
});

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
