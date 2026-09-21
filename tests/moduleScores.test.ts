import assert from 'node:assert/strict';
import test from 'node:test';

import { loadHyperlinterConfig } from '../src/config/HyperlinterConfig';
import { moduleScoreDiagnostics } from '../src/scoring/moduleScores';

const config = loadHyperlinterConfig();

test('turns configured accumulated severity weight into one module error', () => {
  const diagnostics = moduleScoreDiagnostics([
    { rule: 'HL102', severity: 'smell', module: 'src/overloaded.ts', message: 'unused export' },
    { rule: 'HL105', severity: 'info', module: 'src/overloaded.ts', message: 'near duplicate' },
    { rule: 'HL103', severity: 'smell', module: 'src/overloaded.ts', message: 'coupling outlier' },
  ], config);

  assert.deepEqual(diagnostics, [{
    rule: 'HL106',
    severity: config.rules.moduleScore,
    module: 'src/overloaded.ts',
    score: 5,
    message: `Module policy score 5 reaches the configured error threshold ${config.scoring.moduleErrorThreshold}; refactor required.`,
  }]);
});

test('does not score findings without a module or below the configured threshold', () => {
  const diagnostics = moduleScoreDiagnostics([
    { rule: 'HL105', severity: 'info', module: 'src/small.ts', message: 'near duplicate' },
    { rule: 'HL105', severity: 'info', message: 'unattributed finding' },
  ], config);

  assert.deepEqual(diagnostics, []);
});

test('uses configured severity weights and threshold', () => {
  const scoring = moduleScoreDiagnostics([
    { rule: 'HL102', severity: 'smell', module: 'src/configured.ts', message: 'first smell' },
    { rule: 'HL103', severity: 'smell', module: 'src/configured.ts', message: 'second smell' },
  ], {
    ...config,
    scoring: {
      severityWeights: { error: 8, smell: 3, info: 0 },
      moduleErrorThreshold: 6,
    },
  });

  assert.equal(scoring[0]?.score, 6);
});
