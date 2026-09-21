import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { ProjectModel } from '../src/project/ProjectModel.js';

test('includes test modules from the configured TypeScript project', () => {
  const project = ProjectModel.fromTsConfig();

  assert.equal(project.getModuleIdForFile(path.resolve('tests/moduleScores.test.ts')), 'tests');
});
