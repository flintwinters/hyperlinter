import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { analyze } from '../../src';
import { RustProject } from '../../src/project/rust';

/** A workspace exercising every module-ownership convention the Rust model claims to understand. */
const WORKSPACE: Record<string, string> = {
  'Cargo.toml': '[workspace]\nmembers = ["app"]\n',
  'app/Cargo.toml': '[package]\nname = "my-app"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1"\n',
  'app/src/lib.rs': [
    'pub mod config;', 'mod util;', 'pub use util::helper;', 'pub fn api() {}',
    '#[cfg(test)]', 'mod tests { use super::*; #[test] fn t() { api(); } }',
  ].join('\n'),
  'app/src/main.rs': 'fn main() { my_app::api(); let _ = my_app::config::parse::Thing; }',
  'app/src/config.rs': [
    'pub mod parse;', 'pub struct Settings;',
    'pub fn load() { println!("{}", crate::util::VERSION); }',
  ].join('\n'),
  'app/src/config/parse.rs': 'pub struct Thing;',
  'app/src/util/mod.rs': [
    'mod strings;', 'pub const VERSION: &str = "1";', 'pub fn helper() {}', 'pub fn unused() {}',
  ].join('\n'),
  'app/src/util/strings.rs': 'use crate::config::Settings;\nfn s(_: Settings) {}',
  'app/tests/smoke.rs': 'use my_app::config;\n#[test] fn smoke() { config::load(); }',
  // Build output and Git-ignored vendored registries are not authored code.
  'app/target/debug/build/Cargo.toml': '[package]\nname = "generated"\n',
  '.gitignore': '/vendor/\n',
  'vendor/dep/Cargo.toml': '[package]\nname = "dep"\n',
  'vendor/dep/src/lib.rs': 'pub fn vendored() {}',
};

async function workspace(t: TestContext): Promise<string> {
  const root = mkdtempSync(path.resolve('.test-rust-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(WORKSPACE)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

test('assigns Rust files to directory modules with one entrypoint each', async (t) => {
  const project = (await RustProject.load(await workspace(t)))!;
  assert.deepEqual(project.getModules().map(({ id }) => [id, project.getEntrypointFiles(id)]), [
    ['app/src', ['app/src/lib.rs']],
    ['app/src/config', ['app/src/config.rs']],
    ['app/src/main', ['app/src/main.rs']],
    ['app/src/util', ['app/src/util/mod.rs']],
    ['app/tests/smoke', ['app/tests/smoke.rs']],
  ]);
  assert.deepEqual(project.getModules().find(({ id }) => id === 'app/src/config')!.files.map((file) => path.basename(file)),
    ['config.rs', 'parse.rs']);
});

test('resolves crate, super, workspace-crate, alias and macro paths into module dependencies', async (t) => {
  const graph = (await RustProject.load(await workspace(t)))!.getDependencyGraph();
  assert.deepEqual(Object.fromEntries(graph.dependencies), {
    'app/src': ['app/src/util'],
    'app/src/config': ['app/src/util'],
    'app/src/main': ['app/src', 'app/src/config'],
    'app/src/util': ['app/src/config'],
    // A path depends on its deepest module; traversed parents only gain name consumers.
    'app/tests/smoke': ['app/src/config'],
  });
});

test('reports paths into private files and public names without external consumers', async (t) => {
  const project = (await RustProject.load(await workspace(t)))!;
  assert.deepEqual(project.getPrivateModuleImports(), [{
    module: 'app/src/main', file: 'app/src/main.rs', targetModule: 'app/src/config', targetFile: 'app/src/config/parse.rs',
  }]);
  assert.deepEqual(project.getPublicSurface('app/src/util'), [
    { name: 'VERSION', externalReferences: 1 }, { name: 'helper', externalReferences: 1 }, { name: 'unused', externalReferences: 0 },
  ]);
  assert.deepEqual(project.getPublicSurface('app/src').map(({ name, externalReferences }) => [name, externalReferences]),
    [['api', 1], ['config', 3], ['helper', 0]]);
});

test('runs language-neutral rules on a Rust-only repository', async (t) => {
  const root = await workspace(t);
  const result = await analyze(path.join(root, 'tsconfig.json'));
  const rules = new Set(result.diagnostics.map(({ rule }) => rule));
  assert.ok(rules.has('HL108'), 'private file path is a boundary violation');
  assert.ok(result.diagnostics.some(({ rule, message }) => rule === 'HL102' && /unused/.test(message)));
  assert.deepEqual(result.metrics.map(({ module }) => module),
    ['app/src', 'app/src/config', 'app/src/main', 'app/src/util', 'app/tests/smoke']);
});
