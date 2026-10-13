import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { analyze, analyzeChronolint } from '../../src';
import { loadHyperlinterConfig } from '../../src/config';
import { correlate, correlationDiagnostics } from '../../src/temporal';
import { RuntimeStore } from '../../src/runtime';
import { files, snapshot, support } from './fixtures';
const config = loadHyperlinterConfig();

test('ledger stores pinned chronology atomically and preserves ordinary runs', t => {
  mkdirSync('artifacts', { recursive: true });
  const root = mkdtempSync(path.resolve('artifacts/chronology-'));
  const store = new RuntimeStore(path.join(root, 'ledger.sqlite'));
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const result = correlate(snapshot(support()), files, config.chronolint);
  const chronology = { revision: 'pinned', algorithm: 'HL119-v1' as const, options: config.chronolint,
    coverage: snapshot(support()).coverage, ...result };
  const run = store.record({ diagnostics: correlationDiagnostics(result.findings), metrics: [], chronology }, 10);
  assert.equal(run.revision, 'pinned'); assert.equal(run.errors, 0); assert.equal(run.smells, 0);
  assert.deepEqual(store.chronology(run.id), chronology);
  const ordinary = store.record({ diagnostics: [], metrics: [] }, 0);
  assert.equal(store.chronology(ordinary.id), null); assert.equal(store.history().length, 2);
});

test('public dedicated analysis fails clearly without Git while static analysis stays independent', async t => {
  const { writeFileSync } = await import('node:fs');
  mkdirSync('artifacts', { recursive: true });
  const root = mkdtempSync(path.resolve('artifacts/chronology-project-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ include: ['*.ts'] }));
  writeFileSync(path.join(root, 'index.ts'), 'export {};');
  const oldPath = process.env.PATH;
  process.env.PATH = root;
  try {
    const staticResult = await analyze(path.join(root, 'tsconfig.json'));
    assert.equal(staticResult.diagnostics.some(diagnostic => diagnostic.rule === 'HL119'), false);
    await assert.rejects(analyzeChronolint(path.join(root, 'tsconfig.json')), /could not read local Git history/);
  } finally { process.env.PATH = oldPath; }
});
