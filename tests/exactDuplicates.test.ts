import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';

import ts from 'typescript';

import { findExactClones, MINIMUM_CLONE_NODES } from '../src/clones/exactDuplicates';
import { findNearDuplicateClusters, NEAR_CLONE_SIMILARITY } from '../src/clones/nearDuplicates';

function projectFor(fileName: string) {
  const program = ts.createProgram([fileName], { strict: true });
  const sourceFile = program.getSourceFile(fileName)!;
  return { checker: program.getTypeChecker(), getModules: () => [{ id: 'clones.ts', sourceFile }] } as never;
}

function find(fileName: string) {
  return findExactClones(projectFor(fileName));
}

test('detects alpha-renamed clones and anti-unifies literal differences', () => {
  const clones = find(path.resolve('tests/fixtures/exact-clones.ts'));
  assert.equal(clones.length, 3);
  assert.ok(clones[0].meaningfulNodes >= MINIMUM_CLONE_NODES);
  assert.equal(clones[0].differences.length, 1);
});

test('ignores structurally small duplicates', () => {
  assert.equal(find(path.resolve('tests/exactDuplicates.test.ts')).length, 0);
});

test('tracks only three-method near-duplicate clusters at the strict threshold', () => {
  const clusters = findNearDuplicateClusters(projectFor(path.resolve('tests/fixtures/exact-clones.ts')));
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].methods.length, 3);
  assert.ok(clusters[0].similarity >= NEAR_CLONE_SIMILARITY);
  assert.ok(clusters[0].parameterized);
});
