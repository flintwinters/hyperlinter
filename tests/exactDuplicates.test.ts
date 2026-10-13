import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import fs from 'node:fs';

import ts from 'typescript';

import { findExactClones } from "../src/clones";
import { loadHyperlinterConfig } from "../src/config";
import { findNearDuplicateClusters } from "../src/clones";

const config = loadHyperlinterConfig();

function projectFor(fileName: string) {
  const virtualName = fileName.endsWith('.fixture') ? `${fileName}.ts` : fileName;
  const options = { strict: true };
  const host = ts.createCompilerHost(options);
  const read = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    name === virtualName && virtualName !== fileName
      ? ts.createSourceFile(name, fs.readFileSync(fileName, 'utf8'), languageVersion, true)
      : read(name, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([virtualName], options, host);
  const sourceFile = program.getSourceFile(virtualName)!;
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
