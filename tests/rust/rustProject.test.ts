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

test('treats every file reached by `mod` as its own module, as rustc does', async (t) => {
  const project = (await RustProject.load(await workspace(t)))!;
  assert.deepEqual(project.getModules().map(({ id }) => [id, project.getEntrypointFiles(id)]), [
    ['app/src', ['app/src/lib.rs']],
    ['app/src/config', ['app/src/config.rs']],
    ['app/src/config/parse', ['app/src/config/parse.rs']],
    ['app/src/main', ['app/src/main.rs']],
    ['app/src/util', ['app/src/util/mod.rs']],
    ['app/src/util/strings', ['app/src/util/strings.rs']],
    ['app/tests/smoke', ['app/tests/smoke.rs']],
  ]);
});

test('a module directly owns itself plus the files of the child modules it declares', async (t) => {
  const project = (await RustProject.load(await workspace(t)))!;
  assert.deepEqual(project.getOwnedFiles('app/src'), ['app/src/lib.rs', 'app/src/util/mod.rs', 'app/src/config.rs']);
  assert.deepEqual(project.getOwnedFiles('app/src/config'), ['app/src/config.rs', 'app/src/config/parse.rs']);
  assert.deepEqual(project.getOwnedFiles('app/src/config/parse'), ['app/src/config/parse.rs']);
});

test('resolves crate, super, workspace-crate, alias and macro paths into module dependencies', async (t) => {
  const graph = (await RustProject.load(await workspace(t)))!.getDependencyGraph();
  assert.deepEqual(Object.fromEntries(graph.dependencies), {
    'app/src': ['app/src/util'],
    'app/src/config': ['app/src/util'],
    'app/src/config/parse': [],
    // A path depends on its deepest module; traversed parents only gain name consumers.
    'app/src/main': ['app/src', 'app/src/config/parse'],
    'app/src/util': [],
    // A private child module reaching its parent's sibling is not a cycle through the directory.
    'app/src/util/strings': ['app/src/config'],
    'app/tests/smoke': ['app/src/config'],
  });
});

test('has no entrypoint-bypass evidence: a `pub mod` path is the module system working as designed', async (t) => {
  const project = (await RustProject.load(await workspace(t)))!;
  assert.equal(project.language.boundary, 'visibility');
  assert.deepEqual(project.getPrivateModuleImports(), []);
  assert.deepEqual(project.getPublicSurface('app/src/util'), [
    { name: 'VERSION', externalReferences: 1 }, { name: 'helper', externalReferences: 1 }, { name: 'unused', externalReferences: 0 },
  ]);
  assert.deepEqual(project.getPublicSurface('app/src').map(({ name, externalReferences }) => [name, externalReferences]),
    [['api', 1], ['config', 3], ['helper', 0]]);
});

test('runs language-neutral rules on a Rust-only repository without TypeScript module-shape rules', async (t) => {
  const root = await workspace(t);
  const result = await analyze(path.join(root, 'tsconfig.json'));
  const rules = new Set(result.diagnostics.map(({ rule }) => rule));
  assert.ok(!rules.has('HL108'), 'deep `pub mod` paths are legitimate Rust');
  assert.ok(!rules.has('HL109'), 'small modules are idiomatic Rust');
  assert.ok(result.diagnostics.some(({ rule, message }) => rule === 'HL102' && /unused/.test(message)));
  assert.deepEqual(result.metrics.map(({ module }) => module),
    ['app/src', 'app/src/config', 'app/src/config/parse', 'app/src/main', 'app/src/util', 'app/src/util/strings', 'app/tests/smoke']);
});

test('bounds a module by the child modules it declares, not by directory contents', async (t) => {
  const root = mkdtempSync(path.resolve('.test-rust-fanout-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const children = Array.from({ length: 13 }, (_, index) => `child${index}`);
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'Cargo.toml'), '[package]\nname = "fan"\nversion = "0.1.0"\n');
  writeFileSync(path.join(root, 'src/lib.rs'), children.map((name) => `mod ${name};`).join('\n'));
  for (const name of children) writeFileSync(path.join(root, `src/${name}.rs`), 'fn private() {}\n');
  const findings = (await analyze(path.join(root, 'tsconfig.json'))).diagnostics.filter(({ rule }) => rule === 'HL117');
  assert.deepEqual(findings.map(({ module, score }) => [module, score]), [['src', 14]]);
  assert.match(findings[0].message, /child modules/);
});

test('sees dependency cycles between sibling files that share a directory', async (t) => {
  const root = mkdtempSync(path.resolve('.test-rust-cycle-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'Cargo.toml'), '[package]\nname = "loop"\nversion = "0.1.0"\n');
  writeFileSync(path.join(root, 'src/lib.rs'), 'mod a;\nmod b;\n');
  writeFileSync(path.join(root, 'src/a.rs'), 'pub fn a() { crate::b::b(); }\n');
  writeFileSync(path.join(root, 'src/b.rs'), 'pub fn b() { crate::a::a(); }\n');
  const cycles = (await analyze(path.join(root, 'tsconfig.json'))).diagnostics.filter(({ rule }) => rule === 'HL101');
  assert.equal(cycles.length > 0, true, JSON.stringify(cycles));
});
