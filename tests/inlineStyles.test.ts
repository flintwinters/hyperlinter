import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { inlineStyleBaseline, inlineStyleNodes, inlineStyles, newInlineStyles } from '../src/project';
import { ProjectModel } from '../src/project';

test('inline style policy detects direct and literal spread styles and preserves legacy counts', () => {
  const fixture = path.resolve(`runtime/inline-styles-fixture-${process.pid}`);
  fs.mkdirSync(fixture, { recursive: true });
  try {
    fs.writeFileSync(path.join(fixture, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { jsx: 'preserve', target: 'ES2022' }, include: ['*.tsx'],
    }));
    fs.writeFileSync(path.join(fixture, 'view.tsx'), [
      'const stylex = { props: () => ({ className: "x" }) };',
      'export const view = <><div style={{ color: "red" }} /><div {...stylex.props()} />',
      '<div {...{ style: { color: "blue" } }} /><div style={{ color: "red" }} /></>;',
    ].join('\n'));
    const project = ProjectModel.fromTsConfig(path.join(fixture, 'tsconfig.json'));
    const findings = inlineStyles(project);
    const source = project.getModules().flatMap(({ sourceFiles }) => sourceFiles).find(({ fileName }) => fileName.endsWith('view.tsx'))!;
    assert.equal(inlineStyleNodes(source).length, findings.length);
    assert.deepEqual(findings.map(({ line }) => line), [2, 3, 3]);
    assert.deepEqual(newInlineStyles(findings, inlineStyleBaseline(findings.slice(0, 2))), [findings[2]]);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('writing a baseline keeps project paths inside private Git metadata', () => {
  const fixture = path.resolve(`runtime/inline-style-baseline-fixture-${process.pid}`);
  fs.mkdirSync(fixture, { recursive: true });
  try {
    const init = spawnSync('git', ['init', '-q'], { cwd: fixture, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);
    fs.writeFileSync(path.join(fixture, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { jsx: 'preserve', target: 'ES2022' }, include: ['*.tsx'],
    }));
    fs.writeFileSync(path.join(fixture, 'private-view.tsx'), 'export const view = <div style={{ color: "red" }} />;\n');
    const cli = path.resolve('src/cli.ts');
    const tsx = fileURLToPath(import.meta.resolve('tsx'));
    const write = spawnSync(process.execPath, ['--import', tsx, cli, '--write-inline-style-baseline'], { cwd: fixture, encoding: 'utf8' });
    assert.equal(write.status, 0, write.stderr);
    const baseline = path.join(fixture, '.git/hyperlinter/baseline.json');
    assert.ok(fs.existsSync(baseline));
    assert.match(fs.readFileSync(baseline, 'utf8'), /private-view\.tsx/);
    assert.equal(fs.existsSync(path.join(fixture, 'baseline.json')), false);
    const check = spawnSync(process.execPath, ['--import', tsx, cli, '--check-styles'], { cwd: fixture, encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('HTML stylesheet blocks and attributes are enforced without parsing comments or raw text as markup', () => {
  const fixture = path.resolve(`runtime/html-style-fixture-${process.pid}`);
  fs.mkdirSync(path.join(fixture, 'src', 'templates'), { recursive: true });
  try {
    fs.writeFileSync(path.join(fixture, 'tsconfig.json'), JSON.stringify({ include: ['src/**/*.ts'] }));
    fs.writeFileSync(path.join(fixture, 'src', 'index.ts'), 'export {};');
    fs.writeFileSync(path.join(fixture, 'src', 'templates', 'view.html'), [
      '<!-- <style>ignored</style> <div style="ignored"> -->',
      '<script>const example = "<style>ignored</style>";</script>',
      '<textarea><div style="ignored"></textarea>',
      '<div data-note="style=ignored" title="a > b">text</div>',
      '<STYLE media="screen">',
      'body { color: red; }',
      '</STYLE>',
      '<div STYLE="color: blue" data-note=">">text</div>',
      '<span style=color:red>text</span>',
      '<link rel="stylesheet" href="/dependency.css">',
    ].join('\n'));
    const findings = inlineStyles(ProjectModel.fromTsConfig(path.join(fixture, 'tsconfig.json')));
    assert.deepEqual(findings.map(({ file, line }) => ({ file, line })), [5, 8, 9].map((line) => ({ file: 'src/templates/view.html', line })));
    assert.deepEqual(newInlineStyles(findings, inlineStyleBaseline(findings.slice(0, 2))), [findings[2]]);
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});
