import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';

import ts from 'typescript';

import { findExactClones } from '../src/clones/exactDuplicates';
import { loadHyperlinterConfig } from '../src/config/HyperlinterConfig';
import { findNearDuplicateClusters } from '../src/clones/nearDuplicates';

const config = loadHyperlinterConfig();

function projectFor(fileName: string) {
  const program = ts.createProgram([fileName], { strict: true });
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
  const clones = find(path.resolve('tests/fixtures/exact-clones.ts'));
  assert.equal(clones.length, 3);
  assert.ok(clones[0].meaningfulNodes >= config.clones.exactMinimumMeaningfulNodes);
  assert.equal(clones[0].differences.length, 1);
});

test('ignores structurally small duplicates', () => {
  assert.equal(find(path.resolve('tests/exactDuplicates.test.ts')).length, 0);
});

test('tracks only three-method near-duplicate clusters at the strict threshold', () => {
  const clusters = findNearDuplicateClusters(projectFor(path.resolve('tests/fixtures/exact-clones.ts')), config);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].methods.length, 3);
  assert.ok(clusters[0].similarity >= config.clones.nearMinimumSimilarity);
  assert.ok(clusters[0].parameterized);
});
