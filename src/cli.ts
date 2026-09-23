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
import { loadHyperlinterConfig, type HyperlinterConfig } from './config/HyperlinterConfig';
import { applyPrivateUnusedExportFixes } from './fixes/privateExports';
import {
  agentInstructions,
  agentInstructionsMessage,
  MAX_AGENT_INSTRUCTION_LINES,
} from './project/agentInstructions';
import { cssFiles } from './project/cssFiles';
import { inlineStyleBaseline, inlineStyles, newInlineStyles, type InlineStyleBaseline } from './project/inlineStyles';
import { runSourceBudget } from './project/sourceBudget';

interface Baseline {
  metrics: Record<string, Pick<ModuleMetrics, 'publicSurface'>>;
  inlineStyles?: InlineStyleBaseline;
}

const arguments_ = process.argv.slice(2);
const json = arguments_.includes('--format=json') || arguments_.at(arguments_.indexOf('--format') + 1) === 'json';
// A baseline contains target paths and policy. Git's private metadata keeps it
// local even when Hyperlinter is installed as a public submodule.
const baselinePath = localBaselinePath();

const sourceBudgetIndex = arguments_.indexOf('--source-budget');
if (sourceBudgetIndex !== -1) {
  try {
    runSourceBudget(arguments_[sourceBudgetIndex + 1]);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
  process.exit();
}

if (arguments_.includes('--check-styles')) {
  const css = cssFiles(process.cwd());
  const styles = newInlineStyles(inlineStyles(ProjectModel.fromTsConfig()), readBaseline(baselinePath)?.inlineStyles);
  if (json) process.stdout.write(`${JSON.stringify({ css, styles }, null, 2)}\n`);
  else {
    for (const file of css) process.stderr.write(`CSS file forbidden: ${file}\n`);
    for (const { file, line } of styles) process.stderr.write(`Inline JSX style forbidden: ${file}:${line}.\n`);
  }
  process.exitCode = css.length || styles.length ? 1 : 0;
  process.exit();
}

if (arguments_.includes('--check-no-css')) {
  const files = cssFiles(process.cwd());
  if (json) process.stdout.write(`${JSON.stringify({ files }, null, 2)}\n`);
  else if (files.length) process.stderr.write(`CSS files are forbidden: ${files.join(', ')}\n`);
  process.exitCode = files.length ? 1 : 0;
  process.exit();
}

if (arguments_.includes('--check-agents')) {
  const violations = agentInstructions(process.cwd())
    .filter((instructions) => instructions.lines > MAX_AGENT_INSTRUCTION_LINES);
  if (json) process.stdout.write(`${JSON.stringify({ violations }, null, 2)}\n`);
  else for (const violation of violations) {
    process.stderr.write(`${agentInstructionsMessage(violation.lines)}\n`);
  }
  process.exitCode = violations.length ? 1 : 0;
  process.exit();
}

if (arguments_.includes('--write-inline-style-baseline')) {
  const baseline = readBaseline(baselinePath);
  writeBaseline({ metrics: baseline?.metrics ?? {}, inlineStyles: inlineStyleBaseline(inlineStyles(ProjectModel.fromTsConfig())) });
  process.exit();
}

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
const fixProject = arguments_.includes('--fix-private-exports')
  ? ProjectModel.fromTsConfig()
  : undefined;
const fixes = fixProject ? applyPrivateUnusedExportFixes(fixProject) : [];
if (arguments_.includes('--fix')) {
  const project = ProjectModel.fromTsConfig();
  if (applyExactCloneRefactors(project, loadHyperlinterConfig()).length > 0) result = analyze();
}
const baseline = readBaseline(baselinePath);
const styleDiagnostics = result.diagnostics.filter((diagnostic): diagnostic is HyperlintDiagnostic & {
  file: string; line: number; signature: string;
} => diagnostic.rule === 'HL111' && !!diagnostic.file && !!diagnostic.line && !!diagnostic.signature);
const newStyles = new Set<HyperlintDiagnostic>(newInlineStyles(styleDiagnostics, baseline?.inlineStyles));
const diagnostics = [
  ...result.diagnostics.filter((diagnostic) => diagnostic.rule !== 'HL111' || newStyles.has(diagnostic)),
  ...baselineDiagnostics(result.metrics, baseline, loadHyperlinterConfig()),
];
const run = runtime.record({ ...result, diagnostics }, Date.now() - startedAt, startedAt);
runtime.close();

if (arguments_.includes('--write-baseline')) {
  const metrics = Object.fromEntries(result.metrics.map((metric) => [
    metric.module,
    { publicSurface: metric.publicSurface },
  ]));
  writeBaseline({ ...baseline, metrics });
}

if (json) {
  process.stdout.write(`${JSON.stringify({ run, diagnostics, metrics: result.metrics, fixes }, null, 2)}\n`);
} else {
  if (fixes.length > 0)
    process.stdout.write(`Privatized ${fixes.length} unused export${fixes.length === 1 ? '' : 's'}.\n`);
  printMetrics(result.metrics);
  for (const diagnostic of diagnostics) process.stdout.write(`${formatDiagnostic(diagnostic)}\n`);
}

if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) process.exitCode = 1;

function readBaseline(fileName: string): Baseline | undefined {
  if (!fs.existsSync(fileName)) return undefined;
  return JSON.parse(fs.readFileSync(fileName, 'utf8')) as Baseline;
}

function localBaselinePath(): string {
  const marker = path.resolve('.git');
  if (fs.statSync(marker).isDirectory()) return path.join(marker, 'hyperlinter/baseline.json');
  const match = /^gitdir: (.+)\s*$/m.exec(fs.readFileSync(marker, 'utf8'));
  if (!match) throw new Error(`Invalid Git metadata pointer: ${marker}`);
  return path.resolve(path.dirname(marker), match[1], 'hyperlinter/baseline.json');
}

function writeBaseline(baseline: Baseline): void {
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
}

function baselineDiagnostics(
  metrics: readonly ModuleMetrics[],
  baseline: Baseline | undefined,
  config: HyperlinterConfig,
): HyperlintDiagnostic[] {
  if (!baseline) return [];
  return metrics.flatMap((metric) => {
    const prior = baseline.metrics[metric.module];
    if (!prior || metric.publicSurface <= prior.publicSurface) return [];
    return [{
      rule: 'HL102', severity: config.rules.publicSurfaceGrowth, module: metric.module,
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
