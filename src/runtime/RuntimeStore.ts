import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import type { HyperlintDiagnostic } from '../diagnostics/Diagnostic';
import type { ModuleMetrics } from '../project/ProjectModel';
import type { HyperlintResult } from '../runner';

export interface RuntimeRun {
  id: number;
  startedAt: number;
  durationMs: number;
  revision: string | null;
  modules: number;
  diagnostics: number;
  errors: number;
  smells: number;
}

export class RuntimeStore {
  private readonly database: Database.Database;

  constructor(fileName = path.resolve('tools/hyperlint/runtime/hyperlint.sqlite')) {
    fs.mkdirSync(path.dirname(fileName), { recursive: true });
    this.database = new Database(fileName);
    this.database.pragma('journal_mode = WAL');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY,
        started_at INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        revision TEXT,
        modules INTEGER NOT NULL,
        diagnostics INTEGER NOT NULL,
        errors INTEGER NOT NULL,
        smells INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS diagnostics (
        run_id INTEGER NOT NULL REFERENCES runs(id),
        rule TEXT NOT NULL,
        severity TEXT NOT NULL,
        module TEXT,
        file TEXT,
        line INTEGER,
        message TEXT NOT NULL,
        score REAL
      );
      CREATE TABLE IF NOT EXISTS module_metrics (
        run_id INTEGER NOT NULL REFERENCES runs(id),
        module TEXT NOT NULL,
        declarations INTEGER NOT NULL,
        public_surface INTEGER NOT NULL,
        public_surface_ratio REAL NOT NULL,
        dependencies INTEGER NOT NULL,
        dependents INTEGER NOT NULL,
        cross_module_references INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS diagnostics_by_run ON diagnostics(run_id);
      CREATE INDEX IF NOT EXISTS module_metrics_by_module ON module_metrics(module);
    `);
  }

  record(result: HyperlintResult, durationMs: number, startedAt = Date.now()): RuntimeRun {
    const diagnostics = result.diagnostics;
    const run = {
      startedAt: Math.floor(startedAt / 1000),
      durationMs,
      revision: gitRevision(),
      modules: result.metrics.length,
      diagnostics: diagnostics.length,
      errors: diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
      smells: diagnostics.filter((diagnostic) => diagnostic.severity === 'smell').length,
    };
    const insertRun = this.database.prepare(`
      INSERT INTO runs (started_at, duration_ms, revision, modules, diagnostics, errors, smells)
      VALUES (@startedAt, @durationMs, @revision, @modules, @diagnostics, @errors, @smells)
    `);
    const insertDiagnostic = this.database.prepare(`
      INSERT INTO diagnostics (run_id, rule, severity, module, file, line, message, score)
      VALUES (@runId, @rule, @severity, @module, @file, @line, @message, @score)
    `);
    const insertMetric = this.database.prepare(`
      INSERT INTO module_metrics (
        run_id, module, declarations, public_surface, public_surface_ratio,
        dependencies, dependents, cross_module_references
      ) VALUES (
        @runId, @module, @declarations, @publicSurface, @publicSurfaceRatio,
        @dependencies, @dependents, @crossModuleReferences
      )
    `);

    const id = this.database.transaction(() => {
      const inserted = insertRun.run(run);
      const runId = Number(inserted.lastInsertRowid);
      diagnostics.forEach((diagnostic) => insertDiagnostic.run(toDiagnosticRow(runId, diagnostic)));
      result.metrics.forEach((metric) => insertMetric.run({ runId, ...metric }));
      return runId;
    })();

    return { id, ...run };
  }

  history(limit = 20): readonly RuntimeRun[] {
    return this.database.prepare(`
      SELECT
        id,
        started_at AS startedAt,
        duration_ms AS durationMs,
        revision,
        modules,
        diagnostics,
        errors,
        smells
      FROM runs
      ORDER BY id DESC
      LIMIT ?
    `).all(limit) as RuntimeRun[];
  }

  close(): void {
    this.database.close();
  }
}

function toDiagnosticRow(runId: number, diagnostic: HyperlintDiagnostic) {
  return {
    runId,
    ...diagnostic,
    module: diagnostic.module ?? null,
    file: diagnostic.file ?? null,
    line: diagnostic.line ?? null,
    score: diagnostic.score ?? null,
  };
}

function gitRevision(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
