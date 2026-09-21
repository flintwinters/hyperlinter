#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';

import type { HyperlintDiagnostic } from './diagnostics/Diagnostic';
import type { ModuleMetrics } from './project/ProjectModel';
import { ProjectModel } from './project/ProjectModel';
import {
  RuntimeStore,
  type RuntimeRun,
  type VerificationRun,
  type VerificationStep,
} from './runtime/RuntimeStore';
import { analyze } from './runner';
import { applyExactCloneRefactors } from './clones/exactDuplicates';
import { loadHyperlinterConfig } from './config/HyperlinterConfig';

interface Baseline {
  metrics: Record<string, Pick<ModuleMetrics, 'publicSurface'>>;
}

const arguments_ = process.argv.slice(2);
const json = arguments_.includes('--format=json') || arguments_.at(arguments_.indexOf('--format') + 1) === 'json';
const toolRoot = fs.existsSync(path.resolve('tools/hyperlint/src/cli.ts'))
  ? path.resolve('tools/hyperlint')
  : process.cwd();
const baselinePath = path.join(toolRoot, 'baseline.json');
const runtime = new RuntimeStore();

if (arguments_.includes('--history')) {
  const history = runtime.history();
  const verifications = runtime.verificationHistory().map((verification) => ({
    ...verification,
    steps: runtime.verificationSteps(verification.id),
  }));
  if (json) process.stdout.write(`${JSON.stringify({ runs: history, verifications }, null, 2)}\n`);
  else {
    printHistory(history);
    printVerificationHistory(verifications);
  }
  runtime.close();
  process.exit();
}

const startedAt = Date.now();
let result = analyze();
if (arguments_.includes('--fix')) {
  const project = ProjectModel.fromTsConfig();
  if (applyExactCloneRefactors(project, loadHyperlinterConfig()).length > 0) result = analyze();
}
const diagnostics = [...result.diagnostics, ...baselineDiagnostics(result.metrics, readBaseline(baselinePath))];
const run = runtime.record({ ...result, diagnostics }, Date.now() - startedAt, startedAt);
runtime.close();

if (arguments_.includes('--write-baseline')) {
  const metrics = Object.fromEntries(result.metrics.map((metric) => [
    metric.module,
    { publicSurface: metric.publicSurface },
  ]));
  fs.writeFileSync(baselinePath, `${JSON.stringify({ metrics }, null, 2)}\n`);
}

if (json) {
  process.stdout.write(`${JSON.stringify({ run, diagnostics, metrics: result.metrics }, null, 2)}\n`);
} else {
  printMetrics(result.metrics);
  for (const diagnostic of diagnostics) process.stdout.write(`${formatDiagnostic(diagnostic)}\n`);
}

if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) process.exitCode = 1;

function readBaseline(fileName: string): Baseline | undefined {
  if (!fs.existsSync(fileName)) return undefined;
  return JSON.parse(fs.readFileSync(fileName, 'utf8')) as Baseline;
}

function baselineDiagnostics(metrics: readonly ModuleMetrics[], baseline: Baseline | undefined): HyperlintDiagnostic[] {
  if (!baseline) return [];
  return metrics.flatMap((metric) => {
    const prior = baseline.metrics[metric.module];
    if (!prior || metric.publicSurface <= prior.publicSurface) return [];
    return [{
      rule: 'HL102', severity: 'smell' as const, module: metric.module,
      message: `Public surface increased from ${prior.publicSurface} to ${metric.publicSurface} symbols since the baseline.`,
    }];
  });
}

function printMetrics(metrics: readonly ModuleMetrics[]): void {
  process.stdout.write('Module | Public surface | Declarations | Ratio | Dependencies | Dependents | Cross-module refs\n');
  process.stdout.write('--- | ---: | ---: | ---: | ---: | ---: | ---:\n');
  for (const metric of metrics) {
    const ratio = Math.round(metric.publicSurfaceRatio * 100);
    process.stdout.write(
      `${metric.module} | ${metric.publicSurface} | ${metric.declarations} | ${ratio}% | ` +
      `${metric.dependencies} | ${metric.dependents} | ${metric.crossModuleReferences}\n`,
    );
  }
}

function printHistory(runs: readonly RuntimeRun[]): void {
  process.stdout.write('Run | Started | Duration | Revision | Modules | Diagnostics | Errors | Smells\n');
  process.stdout.write('---: | --- | ---: | --- | ---: | ---: | ---: | ---:\n');
  for (const run of runs) {
    const revision = run.revision?.slice(0, 12) ?? 'unknown';
    const startedAt = new Date(run.startedAt * 1000).toISOString();
    process.stdout.write(
      `${run.id} | ${startedAt} | ${run.durationMs}ms | ${revision} | ` +
      `${run.modules} | ${run.diagnostics} | ${run.errors} | ${run.smells}\n`,
    );
  }
}

function printVerificationHistory(
  runs: readonly (VerificationRun & { steps: readonly VerificationStep[] })[],
): void {
  if (runs.length === 0) return;
  process.stdout.write('\nVerification run | Status | Duration | Revision | Host | Steps\n');
  process.stdout.write('---: | --- | ---: | --- | --- | ---:\n');
  for (const run of runs) {
    const revision = run.revision?.slice(0, 12) ?? 'unknown';
    const status = run.status;
    const duration = run.durationMs === null ? 'running' : `${run.durationMs}ms`;
    const host = run.host?.hostname ?? 'unknown';
    process.stdout.write(`${run.id} | ${status} | ${duration} | ${revision} | ${host} | ${run.steps.length}\n`);
  }
}

function formatDiagnostic(diagnostic: HyperlintDiagnostic): string {
  return `${diagnostic.severity.toUpperCase()} ${diagnostic.rule}${diagnostic.module ? ` ${diagnostic.module}` : ''}: ${diagnostic.message}`;
}
