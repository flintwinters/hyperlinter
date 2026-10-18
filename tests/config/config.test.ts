import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { loadHyperlinterConfig } from '../../src/config';

test('engine configuration resolves from the installation outside conventional working directories', (t) => {
  fs.mkdirSync('artifacts', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('artifacts/config-root-'));
  const originalDirectory = process.cwd();
  t.after(() => { process.chdir(originalDirectory); fs.rmSync(root, { recursive: true, force: true }); });
  process.chdir(root);
  assert.equal(loadHyperlinterConfig().rules.moduleScore, 'error');
});
