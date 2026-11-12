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
      references: outlierValues(metrics.map((module) => module.referencedContracts), config),
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
  // Broad module reach and broad contract knowledge corroborate concentration.
  // Neither relative outlier alone establishes a consumer architecture defect.
  if (!outliers.fanOut.has(module.dependencies) || !outliers.references.has(module.referencedContracts)) return [];
  const diagnostics: HyperlintDiagnostic[] = [{
    rule: 'HL103',
    severity: config.rules.couplingOutliers,
    module: module.module,
    score: module.referencedContracts,
    message: `Outward coupling concentration: fan-out of ${module.dependencies} and ${module.referencedContracts} referenced contracts are both repository outliers.`,
  }];
  // Reach increases the impact of an already corroborated concentration; the
  // two correlated outward measurements produce one diagnostic, not two votes.
  if (outliers.fanIn.has(module.dependents)) {
    diagnostics.push({
      rule: 'HL103',
      severity: config.rules.couplingOutliers,
      module: module.module,
      score: module.dependents,
      message: `fan-in of ${module.dependents} is a repository outlier. Outward coupling is also concentrated in this module.`,
    });
  }
  return diagnostics;
}
