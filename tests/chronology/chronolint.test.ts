import assert from 'node:assert/strict';
import test from 'node:test';
import { loadHyperlinterConfig } from '../../src/config';
import type { HistoryCommit } from '../../src/history';
import { correlate, correlationDiagnostics, type TemporalRule, type CorrelationFinding, temporalRules } from '../../src/temporal';
import { moduleScoreDiagnostics } from '../../src/scoring';

const config = loadHyperlinterConfig();
import { files, snapshot, support } from './fixtures';

test('inclusive support boundary, deterministic evidence and dependency context', () => {
  const rule: TemporalRule = temporalRules[0];
  const result = rule.analyze(snapshot(support()), files, config.chronolint);
  const finding: CorrelationFinding | undefined = result.findings[0];
  assert.ok(finding);
  assert.equal(result.findings.length, 1);
  assert.deepEqual(result.findings[0], { paths: ['a', 'b'], modules: ['a', 'b'], observations: 30, edits: [5, 5], shared: 5,
    rates: [1, 1], lift: 6, dependency: 'left-to-right', commits: ['0', '1', '2', '3', '4'] });
  assert.deepEqual(correlate(snapshot(support()), [...files].reverse(), config.chronolint), result);
  assert.deepEqual(moduleScoreDiagnostics(correlationDiagnostics(result.findings), config), []);
  assert.match(correlationDiagnostics(result.findings)[0].message, /shared invariant needs one owner/);
});

test('rejects inadequate support, asymmetry, independent high frequencies and same ownership', () => {
  assert.equal(correlate(snapshot(support().slice(0, 29)), files, config.chronolint).findings.length, 0);
  assert.equal(correlate(snapshot(support().map((edits, i) => i === 0 ? ['a'] : edits)), files, config.chronolint).findings.length, 0);
  assert.equal(correlate(snapshot([...support(), ['a'], ['a']]), files, config.chronolint).findings.length, 0);
  assert.equal(correlate(snapshot(Array.from({ length: 30 }, () => ['a', 'b'])), files, config.chronolint).findings.length, 0);
  assert.equal(correlate(snapshot(support()), files.map(file => ({ ...file, module: 'same' })), config.chronolint).findings.length, 0);
});

test('directional and lift thresholds are inclusive', () => {
  const history = snapshot([...Array.from({ length: 8 }, () => ['a', 'b']), ['a'], ['a'], ['b'], ['b'], ...Array.from({ length: 18 }, () => ['c'])]);
  assert.equal(correlate(history, files, config.chronolint).findings.length, 1);
  assert.equal(correlate(history, files, { ...config.chronolint, minimumRate: .80001 }).findings.length, 0);
  assert.equal(correlate(history, files, { ...config.chronolint, minimumLift: 2.4 }).findings.length, 1);
  assert.equal(correlate(history, files, { ...config.chronolint, minimumLift: 2.40001 }).findings.length, 0);
});

test('creation limits overlap; excluded renames still traverse identities', () => {
  const history = snapshot(support());
  const commits = [...history.commits];
  commits[5] = { ...commits[5], changes: [{ path: 'a', kind: 'A', contentChanged: true }] };
  assert.equal(correlate({ ...history, commits }, files, config.chronolint).findings.length, 0);
  const renamed = snapshot(support());
  const rename: HistoryCommit = { id: 'rename', parents: [], timestamp: 100, changes: [{ path: 'a', previousPath: 'old', kind: 'R', contentChanged: false },
    ...Array.from({ length: 20 }, (_, i) => ({ path: `other${i}`, kind: 'M' as const, contentChanged: true }))] };
  const older = renamed.commits.map(commit => ({ ...commit, changes: commit.changes.map(change => ({ ...change, path: change.path === 'a' ? 'old' : change.path })) }));
  const result = correlate({ ...renamed, commits: [rename, ...older] }, files, config.chronolint);
  assert.equal(result.findings.length, 1); assert.equal(result.filters.oversized, 1);
});

