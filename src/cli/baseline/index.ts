import fs from 'node:fs';
import path from 'node:path';
import type { HyperlintDiagnostic } from '../../diagnostics';
import { type ModuleMetrics, type InlineStyleBaseline, newInlineStyles } from '../../project';
import { projectStatePath, type HyperlintResult } from '../../runtime';
import { loadHyperlinterConfig, type HyperlinterConfig } from '../../config';
import { noInlineStylesRule } from '../../rules';

interface Baseline {
  metrics: Record<string, Pick<ModuleMetrics, 'publicSurface'>>;
  inlineStyles?: InlineStyleBaseline;
}

export function baselinePath(): string { return projectStatePath(process.cwd(), 'baseline.json'); }

export function readBaseline(fileName = baselinePath()): Baseline | undefined {
  if (!fs.existsSync(fileName)) return undefined;
  return JSON.parse(fs.readFileSync(fileName, 'utf8')) as Baseline;
}

export function writeBaseline(baseline: Baseline): void {
  const fileName = baselinePath();
  fs.mkdirSync(path.dirname(fileName), { recursive: true });
  fs.writeFileSync(fileName, `${JSON.stringify(baseline, null, 2)}\n`);
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
      rule: 'HL113', severity: config.rules.publicSurfaceGrowth, module: metric.module,
      message: `Public surface increased from ${prior.publicSurface} to ${metric.publicSurface} symbols since the baseline.`,
    }];
  });
}

export function filterDiagnostics(result: HyperlintResult, baseline: Baseline | undefined, chronolint: boolean): HyperlintDiagnostic[] {
  const styleDiagnostics = result.diagnostics.filter((diagnostic): diagnostic is HyperlintDiagnostic & {
    file: string; line: number; signature: string;
  } => diagnostic.rule === noInlineStylesRule.id && !!diagnostic.file && !!diagnostic.line && !!diagnostic.signature);
  const newStyles = new Set<HyperlintDiagnostic>(newInlineStyles(styleDiagnostics, baseline?.inlineStyles));
  return [
    ...result.diagnostics.filter((diagnostic) => diagnostic.rule !== noInlineStylesRule.id || newStyles.has(diagnostic)),
    ...(chronolint ? [] : baselineDiagnostics(result.metrics, baseline, loadHyperlinterConfig())),
  ];
}
