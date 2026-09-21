import type { HyperlintDiagnostic } from './diagnostics/Diagnostic';
import { ProjectModel } from './project/ProjectModel';
import { rules } from './rules';

export interface HyperlintResult {
  diagnostics: readonly HyperlintDiagnostic[];
  metrics: ReturnType<ProjectModel['getAllMetrics']>;
}

export function analyze(tsconfigPath?: string): HyperlintResult {
  const project = ProjectModel.fromTsConfig(tsconfigPath);
  return {
    diagnostics: rules.flatMap((rule) => rule.analyze(project)),
    metrics: project.getAllMetrics(),
  };
}
