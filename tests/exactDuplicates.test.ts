import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';

import ts from 'typescript';

import { findExactClones, MINIMUM_CLONE_NODES } from '../src/clones/exactDuplicates';

function find(fileName: string) {
  const program = ts.createProgram([fileName], { strict: true });
  const sourceFile = program.getSourceFile(fileName)!;
  return findExactClones({ checker: program.getTypeChecker(), getModules: () => [{ id: 'clones.ts', sourceFile }] } as never);
}

test('detects alpha-renamed clones and anti-unifies literal differences', () => {
  const clones = find(path.resolve('tests/fixtures/exact-clones.ts'));
  assert.equal(clones.length, 1);
  assert.ok(clones[0].meaningfulNodes >= MINIMUM_CLONE_NODES);
  assert.equal(clones[0].differences.length, 1);
});

test('ignores structurally small duplicates', () => {
  assert.equal(find(path.resolve('tests/exactDuplicates.test.ts')).length, 0);
});
