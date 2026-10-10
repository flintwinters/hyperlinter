import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { ProjectModel } from '../src/project';
import { analyze } from '../src';

test('includes test modules from the configured TypeScript project', () => {
  const project = ProjectModel.fromTsConfig();

  assert.equal(project.getModuleIdForFile(path.resolve('tests/moduleScores.test.ts')), 'tests');
});

test('the analyzer satisfies its own enforcement rules without suppressions', async () => {
  const result = await analyze();
  assert.deepEqual(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), []);
  const files = ProjectModel.fromTsConfig().getModules().flatMap((module) => module.sourceFiles.map((file) => file.fileName));
  assert.ok(files.some((file) => file.endsWith('projectModel.test.ts')));
  assert.ok(!files.some((file) => file.includes('/fixtures/')));
});
