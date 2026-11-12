import type { HyperlintDiagnostic } from '../../diagnostics';
import type { HyperlinterConfig } from '../../config';
import type { ModuleMetrics, StructuralModel } from '../../project';
import type { HyperlintRule } from '../contracts';

export const moduleCouplingRule: HyperlintRule<StructuralModel> = {
  id: 'HL103',
  analyze(project: StructuralModel, config: HyperlinterConfig): readonly HyperlintDiagnostic[] {
    const metrics = project.getAllMetrics();
    // Calculate each repository distribution once, rather than once per module.
    const outliers = {
      fanIn: outlierValues(metrics.map((module) => module.dependents), config),
      fanOut: outlierValues(metrics.map((module) => module.dependencies), config),
      references: outlierValues(metrics.map((module) => module.crossModuleReferences), config),
    };
    return metrics.flatMap((module) => couplingDiagnostics(module, outliers, config));
  },
};

function outlierValues(values: readonly number[], config: HyperlinterConfig): ReadonlySet<number> {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
  return new Set(values.filter((value) => value >= config.coupling.minimumOutlierValue
    && deviation > 0 && (value - mean) / deviation >= config.coupling.minimumZScore));
}

function couplingDiagnostics(
  module: ModuleMetrics,
  outliers: { fanIn: ReadonlySet<number>; fanOut: ReadonlySet<number>; references: ReadonlySet<number> },
  config: HyperlinterConfig,
): HyperlintDiagnostic[] {
  const diagnostics: HyperlintDiagnostic[] = [];
  const outward = outliers.fanOut.has(module.dependencies) || outliers.references.has(module.crossModuleReferences);
  // Fan-in measures change reach and reuse. A shared data/utility leaf need not
  // be split merely because it is popular; a widely used orchestration hub is
  // risky because changes in its many dependencies propagate to those users.
  const measures = [
    ['fan-in', module.dependents, outward && outliers.fanIn.has(module.dependents)],
    ['fan-out', module.dependencies, outliers.fanOut.has(module.dependencies)],
    ['cross-module references', module.crossModuleReferences, outliers.references.has(module.crossModuleReferences)],
  ] as const;
  for (const [label, value, isOutlier] of measures) {
    if (isOutlier) {
      diagnostics.push({
        rule: 'HL103',
        severity: config.rules.couplingOutliers,
        module: module.module,
        score: value,
        message: `${label} of ${value} is a repository outlier.${label === 'fan-in' ? ' Outward coupling is also concentrated in this module.' : ''}`,
      });
    }
  }
  return diagnostics;
}
