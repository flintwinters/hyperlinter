import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

import { applyExactCloneRefactors, findExactClones } from '../../src/clones';
import { loadHyperlinterConfig } from '../../src/config';
import { projectFor } from './fixtures';

test('clone refactoring preserves execution, avoids overlapping edits, and is repeatable', () => {
  fs.mkdirSync('artifacts', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('artifacts/clone-refactor-'));
  try {
    const file = path.join(root, 'index.ts');
    const original = fs.readFileSync('tests/fixtures/exact-clones.fixture', 'utf8')
      + '\nexport const results = [first(10), second(10), third(10)];\n';
    fs.writeFileSync(file, original);
    const config = loadHyperlinterConfig();
    assert.equal(findExactClones(projectFor(file), config).length, 3);
    assert.equal(applyExactCloneRefactors(projectFor(file), config).length, 1);
    const rewritten = fs.readFileSync(file, 'utf8');
    const evaluate = (source: string) => {
      const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
      const exports: Record<string, unknown> = {};
      vm.runInNewContext(output, { exports });
      return JSON.stringify(exports.results);
    };
    assert.equal(evaluate(rewritten), evaluate(original));
    assert.match(rewritten, /function _hyperlintClone0/);
    assert.equal(applyExactCloneRefactors(projectFor(file), config).length, 0);
    assert.equal(fs.readFileSync(file, 'utf8'), rewritten);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
