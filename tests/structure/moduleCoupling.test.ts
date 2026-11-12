import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { loadHyperlinterConfig } from '../../src/config';
import { ProjectModel, type StructuralModel } from '../../src/project';
import { RustProject } from '../../src/project/rust';
import { moduleCouplingRule } from '../../src/rules/structural';

const config = loadHyperlinterConfig();
type Shape = 'data' | 'leaf' | 'hub' | 'references' | 'unpopular';

/** The same dependency shapes exercise both language implementations of the metric contract. */
async function fixture(t: TestContext, language: 'typescript' | 'rust', shape: Shape): Promise<StructuralModel> {
  const root = mkdtempSync(path.resolve('.test-coupling-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const rust = language === 'rust';
  const names = ['shared', ...Array.from({ length: 12 }, (_, i) => `client${i}`),
    ...Array.from({ length: 12 }, (_, i) => `dependency${i}`)];
  const write = (file: string, source: string): void => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), source);
  };
  const writeModule = (name: string, source: string): void => write(rust ? `src/${name}.rs` : `${name}/index.ts`, source);
  if (rust) {
    write('Cargo.toml', '[package]\nname = "coupling"\nversion = "0.1.0"\n');
    write('src/lib.rs', names.map((name) => `mod ${name};`).join('\n'));
  } else write('tsconfig.json', JSON.stringify({ compilerOptions: { moduleResolution: 'bundler' }, include: ['**/*.ts'] }));
  for (let i = 0; i < 12; i += 1) {
    writeModule(`dependency${i}`, rust ? 'pub fn part() -> i32 { 1 }' : 'export function part() { return 1; }');
    const client = shape === 'data'
      ? (rust ? 'use crate::shared::Data; pub fn consume(_: Data) {}'
        : 'import type { Data } from "../shared"; export function consume(_: Data) {}')
      : (rust ? 'pub fn consume() -> i32 { crate::shared::run() }'
        : 'import { run } from "../shared"; export function consume() { return run(); }');
    writeModule(`client${i}`, shape === 'unpopular' ? (rust ? 'fn idle() {}' : 'export {};') : client);
  }
  let shared = rust ? 'pub struct Data { pub value: i32 }' : 'export interface Data { value: number }';
  if (shape !== 'data') {
    const count = shape === 'hub' || shape === 'unpopular' ? 12 : shape === 'references' ? 32 : 0;
    const imports = !rust && count ? Array.from({ length: shape === 'references' ? 1 : count }, (_, i) =>
      `import { part as part${i} } from "../dependency${i}";`).join('\n') : '';
    const calls = Array.from({ length: count }, (_, i) => {
      const dependency = shape === 'references' ? 0 : i;
      return rust ? `crate::dependency${dependency}::part()` : `part${dependency}()`;
    }).join(' + ') || '1';
    shared = imports + (rust ? `pub fn run() -> i32 { ${calls} }` : `export function run() { return ${calls}; }`);
  }
  writeModule('shared', shared);
  return rust ? (await RustProject.load(root))! : ProjectModel.fromTsConfig(path.join(root, 'tsconfig.json'));
}

for (const language of ['typescript', 'rust'] as const) {
  for (const shape of ['data', 'leaf'] as const) {
    test(`${language}: widely reused ${shape} leaves retain raw fan-in without a coupling smell`, async (t) => {
      const project = await fixture(t, language, shape);
      const before = project.getAllMetrics();
      assert.equal(before.find((module) => module.module.endsWith('shared'))!.dependents, 12);
      assert.deepEqual(moduleCouplingRule.analyze(project, config), []);
      assert.deepEqual(project.getAllMetrics(), before, 'policy must not alter raw structural evidence');
    });
  }
  for (const shape of ['hub', 'references', 'unpopular'] as const) {
    test(`${language}: ${shape} retains outward coupling pressure and contextual fan-in`, async (t) => {
      const project = await fixture(t, language, shape);
      const findings = moduleCouplingRule.analyze(project, config);
      const labels = findings.map((finding) => finding.message.split(' of ')[0]);
      assert.deepEqual(labels, shape === 'hub' ? ['fan-in', 'fan-out', 'cross-module references']
        : shape === 'references' ? ['fan-in', 'cross-module references'] : ['fan-out', 'cross-module references']);
      assert.ok(findings.every((finding) => finding.module?.endsWith('shared')));
      assert.ok(findings.filter((finding) => finding.message.startsWith('fan-in')).every((finding) =>
        finding.message.includes('Outward coupling')));
      assert.deepEqual(moduleCouplingRule.analyze(project, { ...config, coupling: {
        ...config.coupling, minimumOutlierValue: 1000,
      } }), []);
    });
  }
}
