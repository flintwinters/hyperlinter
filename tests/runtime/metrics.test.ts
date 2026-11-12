import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

import { RuntimeStore } from '../../src/runtime';

test('metric migration preserves unknown historical breadth and records new observations', (t) => {
  fs.mkdirSync('runtime', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('runtime/metric-migration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'ledger.sqlite');
  const legacy = new Database(file);
  legacy.exec(`CREATE TABLE module_metrics (
    run_id INTEGER NOT NULL, module TEXT NOT NULL, declarations INTEGER NOT NULL,
    public_surface INTEGER NOT NULL, public_surface_ratio REAL NOT NULL,
    dependencies INTEGER NOT NULL, dependents INTEGER NOT NULL, cross_module_references INTEGER NOT NULL
  ); INSERT INTO module_metrics VALUES (0, 'old', 1, 1, 1, 1, 0, 42);`);
  legacy.close();
  for (let i = 0; i < 2; i += 1) {
    const store = new RuntimeStore(file);
    store.record({ diagnostics: [], metrics: [{ module: 'new', declarations: 1, publicSurface: 1,
      publicSurfaceRatio: 1, dependencies: 1, dependents: 0, crossModuleReferences: 42, referencedContracts: 2 }] }, 1);
    store.close();
  }
  const database = new Database(file);
  try {
    assert.deepEqual(database.prepare('SELECT module, cross_module_references, referenced_contracts FROM module_metrics ORDER BY run_id').all(), [
      { module: 'old', cross_module_references: 42, referenced_contracts: null },
      { module: 'new', cross_module_references: 42, referenced_contracts: 2 },
      { module: 'new', cross_module_references: 42, referenced_contracts: 2 },
    ]);
  } finally { database.close(); }
});
