import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { loadHyperlinterConfig } from '../src/config/HyperlinterConfig';
import { ProjectModel } from '../src/project/ProjectModel';
import { moduleFileLimitRule } from '../src/rules/structural/index';
import { analyze } from '../src/runner';

const config = loadHyperlinterConfig();

function fixture(t: TestContext, directories: Record<string, number>): string {
  const root = mkdtempSync(path.resolve('.test-module-files-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ include: ['**/*.ts'] }));
  for (const [directory, count] of Object.entries(directories)) {
    const owner = path.join(root, directory);
    mkdirSync(owner, { recursive: true });
    for (let index = 0; index < count; index += 1) {
      // File roles do not exempt implementation from the ownership budget.
      const name = ['index', 'themeStyles', 'generated', 'feature.test'][index] ?? `file${index}`;
      writeFileSync(path.join(owner, `${name}.ts`), 'export {};\n');
    }
  }
  return path.join(root, 'tsconfig.json');
}

test('allows the configured maximum and counts descendants separately', (t) => {
  const project = ProjectModel.fromTsConfig(fixture(t, { frontend: 12, 'frontend/account': 12 }));
  assert.deepEqual(moduleFileLimitRule.analyze(project, config), []);
});

test('reports 13 directly owned files, including the entrypoint and every file role', (t) => {
  const tsconfig = fixture(t, { frontend: 13, 'frontend/account': 2 });
  const findings = moduleFileLimitRule.analyze(ProjectModel.fromTsConfig(tsconfig), config);
  assert.deepEqual(findings, [{
    rule: 'HL115', severity: 'error', module: 'frontend', score: 13,
    message: 'Module owns 13 source files; maximum is 12. Extract cohesive directory modules with index entrypoints.',
  }]);
  assert.equal(analyze(tsconfig).diagnostics.filter((finding) => finding.rule === 'HL115').length, 1);
});

test('uses the configured limit and severity', (t) => {
  const project = ProjectModel.fromTsConfig(fixture(t, { frontend: 3 }));
  const findings = moduleFileLimitRule.analyze(project, {
    ...config, moduleFiles: { maximum: 2 }, rules: { ...config.rules, moduleFileLimit: 'smell' },
  });
  assert.equal(findings[0]?.severity, 'smell');
  assert.equal(findings[0]?.score, 3);
});
