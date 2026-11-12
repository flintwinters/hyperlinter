import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { semanticReport } from '../../src/semantic';

function fixture(t: test.TestContext) {
  fs.mkdirSync('artifacts', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('artifacts/semantic-report-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function cache(root: string, active: unknown[]) {
  const metadata = path.join(root, 'metadata');
  fs.mkdirSync(path.join(metadata, 'hyperlinter'), { recursive: true });
  // Exercise the Git worktree pointer, not the conventional .git directory.
  fs.writeFileSync(path.join(root, '.git'), 'gitdir: metadata\n');
  fs.writeFileSync(path.join(metadata, 'hyperlinter/semantic-embeddings.json'), JSON.stringify({
    model: 'saved-model', active, vectors: { a: [1, 0], b: [0, 1] },
  }));
}

test('semantic reporting rejects absent and empty caches before rendering', t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, '.git'));
  assert.throws(() => semanticReport(root, path.join(root, 'output'), 'missing-python'), /No semantic cache/);
  fs.rmSync(path.join(root, '.git'), { recursive: true });
  cache(root, []);
  assert.throws(() => semanticReport(root, path.join(root, 'output'), 'missing-python'), /no active functions/);
  assert.equal(fs.existsSync(path.join(root, 'output')), false);
});

test('portable offline CLI renders the authoritative partition using worktree metadata', {
  skip: !process.env.HYPERLINTER_REPORT_PYTHON && 'Run manage.py test-semantic-report with Python reporting dependencies',
}, t => {
  const root = fixture(t);
  const active = Array.from({ length: 4 }, (_, i) => ({ id: `f${i}`, hash: i < 2 ? 'a' : 'b',
    input: 'PRIVATE_SOURCE_MUST_NOT_BE_EXPORTED', module: 'feature', file: 'feature/index.ts', line: i + 1 }));
  cache(root, active);
  fs.writeFileSync(path.join(root, 'hyperlinter.project.json'), JSON.stringify({
    semantic: { enabled: true, minimumClusterFunctions: 2, maximumMergeDistance: 0.25, minimumClusterDistance: 0.8 },
  }));
  const result = spawnSync(process.execPath, ['--import', path.resolve('node_modules/tsx/dist/loader.mjs'),
    path.resolve('src/cli.ts'), '--semantic-report', '--python', process.env.HYPERLINTER_REPORT_PYTHON!,
    '--output', 'custom output'], { cwd: root, encoding: 'utf8', env: { ...process.env, OPENROUTER_API_KEY: 'must-never-be-used' } });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.funnel, [1, 1, 1, 1]);
  assert.ok(fs.existsSync(report.samples));
  assert.equal(fs.readFileSync(report.residual).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const summary = JSON.parse(fs.readFileSync(report.summary, 'utf8'));
  assert.equal(summary.residual.available, false);
  assert.equal(summary.residual.renormalized, false);
  assert.equal(report.model, 'saved-model');
  assert.equal(fs.readFileSync(report.png).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const evidence = JSON.parse(fs.readFileSync(report.evidence, 'utf8'));
  assert.deepEqual(evidence.records[0].clusters.map((cluster: string[]) => cluster.length), [2, 2]);
  assert.equal(evidence.records[0].merges.length, 3);
  for (const file of [report.evidence, report.summary]) {
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(!content.includes('PRIVATE_SOURCE_MUST_NOT_BE_EXPORTED'));
    assert.ok(!content.includes('"vectors"'));
  }
  assert.deepEqual(fs.readdirSync(path.join(root, 'metadata/hyperlinter')), ['semantic-embeddings.json', 'semantic-projection.npz']);
});
