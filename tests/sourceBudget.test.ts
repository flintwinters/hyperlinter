import assert from 'node:assert/strict';
import test from 'node:test';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { meaningfulLineCount, runSourceBudget } from '../src/project';

test('source budget excludes blank lines and comments', () => {
  const source = [
    '',
    '  // a line comment',
    'const first = 1; // an inline comment',
    '',
    '/*',
    ' * a block comment',
    ' */',
    'const message = `',
    '  kept template content',
    '`;',
    '   ',
  ].join('\n');

  assert.equal(meaningfulLineCount(source, '.ts'), 4);
});


test('exceeding the budget requires resolving the active task rather than disclosing or deferring failure', t => {
  mkdirSync('artifacts', { recursive: true });
  const root = mkdtempSync(path.resolve('artifacts/source-budget-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src/index.ts'), 'export const value = 1;\n'.repeat(20));
  writeFileSync(path.join(root, 'source-line-budget.json'), JSON.stringify({
    version: 1, sourceDirectories: ['src'], extensions: ['.ts'], growthIncrement: 10,
    requiredRefactorReduction: 5, checkpoints: [{ threshold: 10 }],
  }));
  assert.throws(() => runSourceBudget('check', root), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /15 lines or fewer/);
    assert.match(error.message, /MUST be resolved before you finish or report completion/);
    assert.match(error.message, /Continue working autonomously/);
    assert.match(error.message, /do not merely disclose the failure/);
    assert.match(error.message, /do not raise thresholds/);
    return true;
  });
  writeFileSync(path.join(root, 'src/index.ts'), 'export const value = 1;\n'.repeat(15));
  const report = runSourceBudget('check', root);
  assert.ok('total' in report);
  assert.equal(report.total, 15);
});
