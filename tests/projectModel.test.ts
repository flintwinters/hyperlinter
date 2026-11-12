import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import test from 'node:test';

import { ProjectModel } from '../src/project';
import { analyze } from '../src';

test('includes test modules from the configured TypeScript project', () => {
  const project = ProjectModel.fromTsConfig();

  assert.equal(project.getModuleIdForFile(path.resolve('tests/moduleScores.test.ts')), 'tests');
});

test('cross-module references count authored modules, not standard or package declarations', (t) => {
  fs.mkdirSync('runtime', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('runtime/reference-ownership-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files: Record<string, string> = {
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'esnext',
      moduleResolution: 'bundler', skipLibCheck: true }, include: ['**/*.ts'] }),
    'node_modules/vendor/index.d.ts': 'export interface VendorData { value: number } export function vendor(): VendorData;',
    'external/index.ts': `import { readFileSync } from 'node:fs';
      import { vendor, type VendorData } from 'vendor';
      const data: VendorData = vendor();
      export const size = Math.max(data.value, readFileSync('x').length, ...[1, 2].map(n => n));`,
    'local/index.ts': 'export const local = 1;',
    'consumer/index.ts': `import { local } from '../local'; export const result = local;`,
  };
  for (const [file, source] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), source);
  }
  const project = ProjectModel.fromTsConfig(path.join(root, 'tsconfig.json'));
  assert.deepEqual(project.program.getSemanticDiagnostics(), [], 'external symbols must actually resolve');
  assert.equal(project.getMetrics('external').crossModuleReferences, 0);
  assert.deepEqual(project.getImports('external'), []);
  assert.equal(project.getMetrics('consumer').crossModuleReferences, 1);
  assert.deepEqual(project.getImports('consumer'), ['local']);
  assert.deepEqual(project.getPublicSurface('local').map(({ name, externalReferences }) => ({ name, externalReferences })),
    [{ name: 'local', externalReferences: 1 }]);
});

test('contract breadth deduplicates aliases and members of one authored type', (t) => {
  fs.mkdirSync('runtime', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('runtime/reference-contracts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files: Record<string, string> = {
    'tsconfig.json': JSON.stringify({ compilerOptions: { moduleResolution: 'bundler' }, include: ['**/*.ts'] }),
    'model/index.ts': 'export interface Data { left: number; right: number } export function read() { return 1; }',
    'facade/index.ts': 'export { Data as Alias, read as renamed } from "../model";',
    'consumer/index.ts': `import { Data, read } from '../model'; import { Alias, renamed } from '../facade';
      export function consume(a: Data, b: Alias) { return a.left + b.right + read() + renamed() + read(); }`,
  };
  for (const [file, source] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), source);
  }
  const project = ProjectModel.fromTsConfig(path.join(root, 'tsconfig.json'));
  assert.deepEqual(project.program.getSemanticDiagnostics(), []);
  const metric = project.getMetrics('consumer');
  assert.equal(metric.referencedContracts, 2);
  assert.ok(metric.crossModuleReferences > metric.referencedContracts);
});

test('the analyzer satisfies its own enforcement rules without suppressions', async () => {
  const result = await analyze();
  assert.deepEqual(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), [],
    JSON.stringify(result.diagnostics.filter(diagnostic => diagnostic.severity === 'error' || diagnostic.severity === 'smell'), null, 2));
  const files = ProjectModel.fromTsConfig().getModules().flatMap((module) => module.sourceFiles.map((file) => file.fileName));
  assert.ok(files.some((file) => file.endsWith('projectModel.test.ts')));
  assert.ok(!files.some((file) => file.includes('/fixtures/')));
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

test('JavaScript entrypoints use the same directory boundary as TypeScript', () => {
  const root = path.resolve(`runtime/javascript-boundary-${process.pid}`);
  fs.mkdirSync(root, { recursive: true });
  try {
    fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { allowJs: true }, include: ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'],
    }));
    for (const extension of ['js', 'jsx', 'mjs', 'cjs']) {
      const directory = path.join(root, extension);
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, `index.${extension}`), 'export const first = 1; export const second = 2;');
    }
    fs.writeFileSync(path.join(root, 'index.js'), "import { first } from './js/index.js'; void first;");
    const project = ProjectModel.fromTsConfig(path.join(root, 'tsconfig.json'));
    for (const extension of ['js', 'jsx', 'mjs', 'cjs']) {
      assert.deepEqual(project.getEntrypointFiles(extension), [`${extension}/index.${extension}`]);
    }
    assert.deepEqual(project.getPrivateModuleImports(), []);
    fs.writeFileSync(path.join(root, 'js/index.stylex.js'), 'export const third = 3;');
    const duplicate = ProjectModel.fromTsConfig(path.join(root, 'tsconfig.json'));
    assert.equal(duplicate.getEntrypointFiles('js').length, 2);
    assert.equal(duplicate.getModules().find(({ id }) => id === 'js')!.entryPoint, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
