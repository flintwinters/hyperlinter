import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import test from 'node:test';

import { ProjectModel } from "../src/project";

test('includes test modules from the configured TypeScript project', () => {
  const project = ProjectModel.fromTsConfig();

  assert.equal(project.getModuleIdForFile(path.resolve('tests/moduleScores.test.ts')), 'tests');
});

test('StyleX indexes are public boundaries and a second index is still rejected', () => {
  const root = path.resolve(`runtime/stylex-boundary-${process.pid}`);
  const tokens = path.join(root, 'tokens');
  fs.mkdirSync(tokens, { recursive: true });
  try {
    fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ include: ['**/*.ts'] }));
    fs.writeFileSync(path.join(tokens, 'index.stylex.ts'), 'export const colors = {}; export const motion = {};');
    fs.writeFileSync(path.join(root, 'index.ts'), "import { colors } from './tokens/index.stylex'; void colors;");
    const project = ProjectModel.fromTsConfig(path.join(root, 'tsconfig.json'));
    assert.deepEqual(project.getEntrypointFiles('tokens'), ['tokens/index.stylex.ts']);
    assert.deepEqual(project.getPrivateModuleImports(), []);
    fs.writeFileSync(path.join(tokens, 'index.ts'), 'export {};');
    const duplicate = ProjectModel.fromTsConfig(path.join(root, 'tsconfig.json'));
    assert.equal(duplicate.getEntrypointFiles('tokens').length, 2);
    assert.equal(duplicate.getModules().find(({ id }) => id === 'tokens')!.entryPoint, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
