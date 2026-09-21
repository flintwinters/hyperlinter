import type { HyperlintDiagnostic } from '../diagnostics/Diagnostic';
import type { HyperlinterConfig } from '../config/HyperlinterConfig';
import type { ModuleMetrics, ProjectModel } from '../project/ProjectModel';
import type { HyperlintRule } from './Rule';

export const moduleCouplingRule: HyperlintRule = {
  id: 'HL103',
  analyze(project: ProjectModel, config: HyperlinterConfig): readonly HyperlintDiagnostic[] {
    const metrics = project.getAllMetrics();
    return metrics.flatMap((module) => couplingDiagnostics(module, metrics, config));
  },
};

function couplingDiagnostics(
  module: ModuleMetrics,
  allMetrics: readonly ModuleMetrics[],
  config: HyperlinterConfig,
): HyperlintDiagnostic[] {
  const diagnostics: HyperlintDiagnostic[] = [];
  const measures = [
    ['fan-in', module.dependents, (metrics: ModuleMetrics) => metrics.dependents],
    ['fan-out', module.dependencies, (metrics: ModuleMetrics) => metrics.dependencies],
    ['cross-module references', module.crossModuleReferences, (metrics: ModuleMetrics) => metrics.crossModuleReferences],
  ] as const;
  for (const [label, value, getValue] of measures) {
    const values = allMetrics.map(getValue);
    const mean = values.reduce((sum, current) => sum + current, 0) / values.length;
    const deviation = Math.sqrt(values.reduce((sum, current) => sum + (current - mean) ** 2, 0) / values.length);
    if (value >= config.coupling.minimumOutlierValue && deviation > 0 && (value - mean) / deviation >= config.coupling.minimumZScore) {
      diagnostics.push({
        rule: 'HL103',
        severity: 'smell',
        module: module.module,
        score: value,
        message: `${label} of ${value} is a repository outlier.`,
      });
    }
  }
  return diagnostics;
}
