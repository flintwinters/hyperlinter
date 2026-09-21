import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

export interface VerificationRun {
  id: number;
  startedAt: number;
  durationMs: number | null;
  revision: string | null;
  command: string;
  status: 'running' | 'passed' | 'failed';
  error: string | null;
  host: VerificationHost | null;
}

export interface VerificationHost {
  hostname: string;
  platform: NodeJS.Platform;
  release: string;
  architecture: string;
  nodeVersion: string;
  cpuModel: string | null;
  cpuCount: number;
  totalMemoryBytes: number;
}

export interface VerificationStep {
  name: string;
  command: string;
  startedAt: number;
  durationMs: number;
  status: 'passed' | 'failed' | 'terminated';
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  output: string;
  outputBytes: number;
  outputTruncated: boolean;
}

export class RuntimeStore {
  private readonly database: Database.Database;

  constructor(fileName = path.resolve('tools/hyperlint/runtime/hyperlint.sqlite')) {
    fs.mkdirSync(path.dirname(fileName), { recursive: true });
    this.database = new Database(fileName);
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('busy_timeout = 5000');
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
      CREATE TABLE IF NOT EXISTS verification_runs (
        id INTEGER PRIMARY KEY,
        started_at INTEGER NOT NULL,
        duration_ms INTEGER,
        revision TEXT,
        command TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        host_json TEXT
      );
      CREATE TABLE IF NOT EXISTS verification_steps (
        id INTEGER PRIMARY KEY,
        verification_run_id INTEGER NOT NULL REFERENCES verification_runs(id),
        name TEXT NOT NULL,
        command TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        exit_code INTEGER,
        signal TEXT,
        error TEXT,
        output TEXT NOT NULL,
        output_bytes INTEGER NOT NULL,
        output_truncated INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS verification_steps_by_run ON verification_steps(verification_run_id);
    `);
    this.ensureColumn('verification_runs', 'host_json', 'TEXT');
    this.database.prepare(`
      UPDATE verification_runs
      SET
        duration_ms = (? - started_at) * 1000,
        status = 'failed',
        error = 'Verifier process ended before recording an outcome.'
      WHERE status = 'running'
    `).run(Math.floor(Date.now() / 1000));
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

  startVerification(command: string, startedAt = Date.now()): number {
    const inserted = this.database.prepare(`
      INSERT INTO verification_runs (started_at, revision, command, status, host_json)
      VALUES (?, ?, ?, 'running', ?)
    `).run(Math.floor(startedAt / 1000), gitRevision(), command, JSON.stringify(verificationHost()));
    return Number(inserted.lastInsertRowid);
  }

  recordVerificationStep(verificationRunId: number, step: VerificationStep): void {
    this.database.prepare(`
      INSERT INTO verification_steps (
        verification_run_id, name, command, started_at, duration_ms, status,
        exit_code, signal, error, output, output_bytes, output_truncated
      ) VALUES (
        @verificationRunId, @name, @command, @startedAt, @durationMs, @status,
        @exitCode, @signal, @error, @output, @outputBytes, @outputTruncated
      )
    `).run({
      verificationRunId,
      ...step,
      startedAt: Math.floor(step.startedAt / 1000),
      outputTruncated: step.outputTruncated ? 1 : 0,
    });
  }

  finishVerification(id: number, status: 'passed' | 'failed', durationMs: number, error: string | null): void {
    this.database.prepare(`
      UPDATE verification_runs
      SET duration_ms = ?, status = ?, error = ?
      WHERE id = ?
    `).run(durationMs, status, error, id);
  }

  verificationHistory(limit = 20): readonly VerificationRun[] {
    const rows = this.database.prepare(`
      SELECT id, started_at AS startedAt, duration_ms AS durationMs, revision, command, status, error, host_json AS hostJson
      FROM verification_runs
      ORDER BY id DESC
      LIMIT ?
    `).all(limit) as Array<Omit<VerificationRun, 'host'> & { hostJson: string | null }>;
    return rows.map(({ hostJson, ...run }) => ({ ...run, host: hostJson ? JSON.parse(hostJson) as VerificationHost : null }));
  }

  verificationSteps(verificationRunId: number): readonly VerificationStep[] {
    const rows = this.database.prepare(`
      SELECT
        name,
        command,
        started_at AS startedAt,
        duration_ms AS durationMs,
        status,
        exit_code AS exitCode,
        signal,
        error,
        output,
        output_bytes AS outputBytes,
        output_truncated AS outputTruncated
      FROM verification_steps
      WHERE verification_run_id = ?
      ORDER BY id
    `).all(verificationRunId) as Array<Omit<VerificationStep, 'outputTruncated'> & { outputTruncated: number }>;
    return rows.map((step) => ({
      ...step,
      outputTruncated: Boolean(step.outputTruncated),
    }));
  }

  close(): void {
    this.database.close();
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((existing) => existing.name === column)) {
      this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
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

function verificationHost(): VerificationHost {
  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    platform: process.platform,
    release: os.release(),
    architecture: process.arch,
    nodeVersion: process.version,
    cpuModel: cpus[0]?.model ?? null,
    cpuCount: cpus.length,
    totalMemoryBytes: os.totalmem(),
  };
}
