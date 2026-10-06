import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { loadHyperlinterConfig } from '../src/config/HyperlinterConfig';
import { ProjectModel } from '../src/project/ProjectModel';
import { moduleCohesion } from '../src/project/moduleCohesion';
import { moduleCohesionRule } from '../src/rules/moduleCohesion';

const config = loadHyperlinterConfig();

function withProject(consumers: string, shared: string, action: (project: ProjectModel) => void) {
  const root = path.resolve(`runtime/cohesion-${process.pid}`);
  fs.mkdirSync(path.join(root, 'service'), { recursive: true });
  fs.mkdirSync(path.join(root, 'clients'), { recursive: true });
  try {
    fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'esnext', moduleResolution: 'bundler' }, include: ['**/*.ts'],
    }));
    fs.writeFileSync(path.join(root, 'service', 'index.ts'), `
const common = 1;
interface Shared { value: number }
function parseCore(value: Shared) { return value.value + common; }
function renderCore(value: Shared) { return value.value + common; }
export function parse(value: Shared) { return parseCore(value); }
export function validate(value: Shared) { return parseCore(value); }
export function render(value: Shared) { return renderCore(value); }
export function format(value: Shared) { return renderCore(value); }
${shared}
`);
    fs.writeFileSync(path.join(root, 'clients', 'index.ts'), consumers);
    fs.mkdirSync(path.join(root, 'viewer'), { recursive: true });
    fs.writeFileSync(path.join(root, 'viewer', 'index.ts'), `import { render, format } from '../service'; console.log(render, format);`);
    action(ProjectModel.fromTsConfig(path.join(root, 'tsconfig.json')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const separate = `import { parse, validate } from '../service'; console.log(parse, validate);`;

test('independent behavior groups and disjoint consumers trigger measured refactor instructions', () => {
  withProject(separate, '', (project) => {
    const findings = moduleCohesionRule.analyze(project, config);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, 'HL115');
    assert.equal(findings[0].severity, 'info');
    assert.equal(findings[0].score, 4 / 6);
    assert.match(findings[0].message, /Refactor around shared behavior/);
    assert.match(findings[0].message, /\[parse, validate\] used by \[clients\]/);
    assert.match(findings[0].message, /0\.000 <= 0\.2/);
    assert.equal(moduleCohesionRule.analyze(project, { ...config, cohesion: {
      ...config.cohesion, minimumSeparatedPairRatio: 4 / 6, maximumConsumerOverlap: 0,
    } }).length, 1);
    for (const overrides of [
      { minimumSeparatedPairRatio: 0.7 }, { minimumGroupExports: 3 }, { minimumExports: 5 },
    ]) assert.equal(moduleCohesionRule.analyze(project, { ...config, cohesion: {
      ...config.cohesion, ...overrides,
    } }).length, 0);
  });
});

test('consumer overlap threshold is inclusive and configurable', () => {
  withProject(`import { parse, validate, render, format } from '../service'; console.log(parse, validate, render, format);`, '', (project) => {
    assert.equal(moduleCohesionRule.analyze(project, config).length, 0);
    assert.equal(moduleCohesionRule.analyze(project, { ...config, cohesion: {
      ...config.cohesion, maximumConsumerOverlap: 0.5,
    } }).length, 1);
  });
});

test('directory re-exports resolve to implementation groups rather than connecting the facade', () => {
  withProject(separate, '', (original) => {
    const directory = path.join(original.getRootDir(), 'service');
    fs.renameSync(path.join(directory, 'index.ts'), path.join(directory, 'implementation.ts'));
    fs.writeFileSync(path.join(directory, 'index.ts'), "export * from './implementation';");
    const project = ProjectModel.fromTsConfig(path.join(original.getRootDir(), 'tsconfig.json'));
    const findings = moduleCohesionRule.analyze(project, config);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].score, 4 / 6);
  });
});

test('bridging behavior merges groups transitively; unknown consumers cannot establish separation', () => {
  withProject(separate, 'export function bridge(value: Shared) { return parse(value) + render(value); }', (project) => {
    assert.equal(moduleCohesionRule.analyze(project, config).length, 0);
    assert.equal(moduleCohesion(project, project.getModules().find((module) => module.id === 'service')!)?.groups.length, 1);
  });
  withProject('', '', (project) => assert.equal(moduleCohesionRule.analyze(project, config).length, 0));
});

test('cohesion configuration rejects invalid quantitative thresholds', () => {
  const root = path.resolve(`runtime/cohesion-config-${process.pid}`);
  fs.mkdirSync(root, { recursive: true });
  try {
    for (const overrides of [
      { maximumConsumerOverlap: -0.1 }, { maximumConsumerOverlap: 1.1 },
      { minimumSeparatedPairRatio: 0 }, { minimumExports: 1.5 }, { minimumGroupExports: 0 },
    ]) {
      fs.writeFileSync(path.join(root, 'hyperlinter.config.json'), JSON.stringify({
        ...config, cohesion: { ...config.cohesion, ...overrides },
      }));
      assert.throws(() => loadHyperlinterConfig(root), /cohesion\./);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
