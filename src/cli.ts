#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';

import type { HyperlintDiagnostic } from './diagnostics/Diagnostic';
import type { ModuleMetrics } from './project/ProjectModel';
import { analyze } from './runner';

interface Baseline {
  metrics: Record<string, Pick<ModuleMetrics, 'publicSurface'>>;
}

const arguments_ = process.argv.slice(2);
const json = arguments_.includes('--format=json') || arguments_.at(arguments_.indexOf('--format') + 1) === 'json';
const baselinePath = path.resolve('tools/hyperlint/baseline.json');
const result = analyze();
const diagnostics = [...result.diagnostics, ...baselineDiagnostics(result.metrics, readBaseline(baselinePath))];

if (arguments_.includes('--write-baseline')) {
  const metrics = Object.fromEntries(result.metrics.map((metric) => [
    metric.module,
    { publicSurface: metric.publicSurface },
  ]));
  fs.writeFileSync(baselinePath, `${JSON.stringify({ metrics }, null, 2)}\n`);
}

if (json) {
  process.stdout.write(`${JSON.stringify({ diagnostics, metrics: result.metrics }, null, 2)}\n`);
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

function formatDiagnostic(diagnostic: HyperlintDiagnostic): string {
  return `${diagnostic.severity.toUpperCase()} ${diagnostic.rule}${diagnostic.module ? ` ${diagnostic.module}` : ''}: ${diagnostic.message}`;
}
