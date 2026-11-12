import type { HyperlintDiagnostic } from '../../diagnostics';
import type { ModuleMetrics } from '../../project';
import type { RuntimeRun } from '../../runtime';
import type { ChronologyEvidence } from '../../temporal';

function printTable(columns: readonly string[], rows: readonly (readonly unknown[])[]): void {
  // A leading '#' marks a right-aligned numeric column.
  const lines = [columns.map((column) => column.replace(/^#/, '')).join(' | '),
    columns.map((column) => (column.startsWith('#') ? '---:' : '---')).join(' | '), ...rows.map((row) => row.join(' | '))];
  process.stdout.write(`${lines.join('\n')}\n`);
}

export function printMetrics(metrics: readonly ModuleMetrics[]): void {
  printTable(['Module', '#Public surface', '#Declarations', '#Ratio', '#Dependencies', '#Dependents', '#Cross-module refs', '#Referenced contracts'],
    metrics.map((metric) => [metric.module, metric.publicSurface, metric.declarations, `${Math.round(metric.publicSurfaceRatio * 100)}%`,
      metric.dependencies, metric.dependents, metric.crossModuleReferences, metric.referencedContracts]));
}

export function printHistory(runs: readonly RuntimeRun[]): void {
  printTable(['#Run', 'Started', '#Duration', 'Revision', '#Modules', '#Diagnostics', '#Errors', '#Smells'],
    runs.map((run) => [run.id, new Date(run.startedAt * 1000).toISOString(), `${run.durationMs}ms`, run.revision?.slice(0, 12) ?? 'unknown',
      run.modules, run.diagnostics, run.errors, run.smells]));
}

export function formatDiagnostic(diagnostic: HyperlintDiagnostic): string {
  const module = diagnostic.module ? ` ${diagnostic.module}` : '';
  const line = diagnostic.line ? `:${diagnostic.line}` : '';
  const file = diagnostic.file ? ` ${diagnostic.file}${line}` : '';
  return `${diagnostic.severity.toUpperCase()} ${diagnostic.rule}${module}${file}: ${diagnostic.message}`;
}

export function printChronology(evidence: ChronologyEvidence): void {
  process.stdout.write(`Chronolint ${evidence.algorithm} at ${evidence.revision}: `
    + `${evidence.coverage.inspected}/${evidence.coverage.window} commits; coverage=${evidence.coverage.end}; `
    + `eligible=${evidence.filters.eligible}; oversized=${evidence.filters.oversized}; `
    + `analyzed files=${evidence.filters.analyzedFiles}.\n`);
  process.stdout.write(`Evidence: ${JSON.stringify(evidence)}\n`);
}
