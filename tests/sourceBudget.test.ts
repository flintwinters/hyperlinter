import assert from 'node:assert/strict';
import test from 'node:test';

import { meaningfulLineCount } from '../src/project/sourceBudget';

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
