import type { HyperlintDiagnostic } from '../diagnostics/Diagnostic';
import type { ModuleMetrics, ProjectModel } from '../project/ProjectModel';
import type { HyperlintRule } from './Rule';

export const moduleCouplingRule: HyperlintRule = {
  id: 'HL103',
  analyze(project: ProjectModel): readonly HyperlintDiagnostic[] {
    const metrics = project.getAllMetrics();
    return metrics.flatMap((module) => couplingDiagnostics(module, metrics));
  },
};

function couplingDiagnostics(module: ModuleMetrics, allMetrics: readonly ModuleMetrics[]): HyperlintDiagnostic[] {
  const diagnostics: HyperlintDiagnostic[] = [];
  for (const [label, value] of [['fan-in', module.dependents], ['fan-out', module.dependencies], ['cross-module references', module.crossModuleReferences]] as const) {
    const values = allMetrics.map((metrics) => label === 'fan-in' ? metrics.dependents : label === 'fan-out' ? metrics.dependencies : metrics.crossModuleReferences);
    const mean = values.reduce((sum, current) => sum + current, 0) / values.length;
    const deviation = Math.sqrt(values.reduce((sum, current) => sum + (current - mean) ** 2, 0) / values.length);
    if (value >= 3 && deviation > 0 && (value - mean) / deviation >= 2) {
      diagnostics.push({ rule: 'HL103', severity: 'smell', module: module.module, score: value, message: `${label} of ${value} is a repository outlier.` });
    }
  }
  return diagnostics;
}
