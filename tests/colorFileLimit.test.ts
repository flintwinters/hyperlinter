import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import ts from 'typescript';

import { loadColorFilePolicy } from '../src/config';
import { colorLiterals } from '../src/project';
import { ProjectModel } from '../src/project';
import { colorFileLimitRule } from '../src/rules';
import { analyze } from '../src';


function literals(text: string): readonly string[] {
  return colorLiterals(ts.createSourceFile('view.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX))
    .map(({ value }) => value);
}

function fixture(t: TestContext): string {
  const root = mkdtempSync(path.resolve('.test-color-files-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, '.git'));
  mkdirSync(path.join(root, 'src'));
  mkdirSync(path.join(root, 'tests'));
  writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ include: ['**/*.ts', '**/*.tsx'] }));
  writeFileSync(path.join(root, 'src', 'colors.ts'), 'export const colors = ["#fff", "red", "#fff"];');
  writeFileSync(path.join(root, 'src', 'view.tsx'), 'export const view = <svg fill="rebeccapurple" />;');
  writeFileSync(path.join(root, 'src', 'consumer.ts'), 'import { colors } from "./colors"; export const text = colors[0];');
  writeFileSync(path.join(root, 'src', 'declarations.d.ts'), 'declare const defaultColor: "#abc";');
  writeFileSync(path.join(root, 'tests', 'fixture.ts'), 'export const red = "#f00";');
  return root;
}

function policy(root: string, colorFiles: unknown): void {
  writeFileSync(path.join(root, 'hyperlinter.project.json'), JSON.stringify({ colorFiles }));
}

test('finds hex, named, modern functional, SVG and compound literal colors', () => {
  const values = literals([
    'const a = ["#abc", "#abcd", "#ABCDEF", "#abcdef80", "RebeccaPurple"];',
    'const b = { boxShadow: "0 2px 4px rgba(0, 0, 0, .5)", background: "linear-gradient(red, #fff)" };',
    'const c = ["hsl(20 50% 30%)", "oklch(60% .2 30)", "color(display-p3 1 0 0)"];',
    'const view = <svg fill="white" stroke="#123" />;',
    'const frames = { "50%": { filter: "drop-shadow(0 0 2px #ff0)" } };',
  ].join('\n'));
  for (const value of ['#abc', '#abcd', '#ABCDEF', '#abcdef80', 'RebeccaPurple', 'red', '#fff', 'white', '#123', '#ff0']) {
    assert.ok(values.includes(value), `missing ${value}`);
  }
  assert.ok(values.some((value) => value.startsWith('rgba(')));
  assert.ok(values.some((value) => value.startsWith('hsl(')));
  assert.ok(values.some((value) => value.startsWith('oklch(')));
  assert.ok(values.some((value) => value.startsWith('color(')));
});

test('finds generated color functions, interpolation arguments, and embedded CSS declarations', () => {
  assert.ok(literals('const c = `hsl(${index * 137} 78% 55%)`;').some((value) => value.startsWith('hsl(')));
  assert.ok(literals('const c = `${flag ? "#abc" : "#def"}`;').includes('#abc'));
  const values = literals('const css = `#abc { color: #fff; background: rgb(0 0 0); }`;');
  assert.ok(values.includes('#fff'));
  assert.ok(!values.includes('#abc'), 'selectors are not color definitions');
});

test('ignores comments, URLs, CSS strings, invalid hex, imports, types and neutral keywords', () => {
  assert.deepEqual(literals([
    '// color: "#abc"',
    'import value from "red"; export { value } from "blue";',
    'type Color = "#abc";',
    'const x = ["https://example.test/#abc", "url(#abc)", "#12345", "#abcdefghi", "transparent", "currentColor", "inherit"];',
    'const css = `a { content: "red"; background: url(#abc); }`;',
  ].join('\n')), []);
});

test('disabled by default; inclusive cap counts files once, across directories, within source roots', async (t) => {
  const root = fixture(t);
  const project = ProjectModel.fromTsConfig(path.join(root, 'tsconfig.json'));
  assert.deepEqual(colorFileLimitRule.analyze(project), []);
  policy(root, { maximum: 2, sourceRoots: ['src'] });
  assert.deepEqual(colorFileLimitRule.analyze(project), []);
  policy(root, { maximum: 1, sourceRoots: ['src'], severity: 'smell' });
  const diagnostics = colorFileLimitRule.analyze(project);
  assert.deepEqual(diagnostics.map(({ file, severity, score }) => ({ file, severity, score })), [
    { file: 'src/colors.ts', severity: 'smell', score: 2 },
    { file: 'src/view.tsx', severity: 'smell', score: 2 },
  ]);
  assert.equal((await analyze(path.join(root, 'tsconfig.json'))).diagnostics.filter(({ rule }) => rule === 'HL118').length, 2);
  policy(root, { maximum: 0 });
  assert.equal(colorFileLimitRule.analyze(project).length, 3);
});

test('rejects invalid policy instead of silently disabling enforcement', (t) => {
  const root = fixture(t);
  for (const invalid of [null, { maximum: -1 }, { maximum: 1.5 }, { maximum: '2' },
    { maximum: 1, severity: 'off' }, { maximum: 1, sourceRoots: [] },
    { maximum: 1, sourceRoots: ['../src'] }, { maximum: 1, sourceRoots: ['/src'] }]) {
    policy(root, invalid);
    assert.throws(() => loadColorFilePolicy(root), /colorFiles/);
  }
});

test('CLI inventories colors and styles enforcement respects the configured severity', (t) => {
  const root = fixture(t);
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const tsx = fileURLToPath(import.meta.resolve('tsx'));
  const run = (flag: string) => spawnSync(process.execPath, ['--import', tsx, cli, flag, '--format=json'], {
    cwd: root, encoding: 'utf8',
  });
  policy(root, { maximum: 1, sourceRoots: ['src'] });
  const inventory = run('--check-colors');
  assert.equal(inventory.status, 1, inventory.stderr);
  const result = JSON.parse(inventory.stdout);
  assert.equal(result.count, 2);
  assert.equal(result.files.length, 2);
  assert.equal(result.diagnostics.length, 2);
  const styles = run('--check-styles');
  assert.equal(styles.status, 1, styles.stderr);
  assert.equal(JSON.parse(styles.stdout).colors.length, 2);
  policy(root, { maximum: 1, sourceRoots: ['src'], severity: 'info' });
  assert.equal(run('--check-styles').status, 0);
  policy(root, { maximum: 2, sourceRoots: ['src'] });
  assert.equal(run('--check-colors').status, 0);
});
