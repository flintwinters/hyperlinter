import type { HyperlintDiagnostic } from './diagnostics/Diagnostic';
import { loadHyperlinterConfig } from './config/HyperlinterConfig';
import { ProjectModel } from './project/ProjectModel';
import { rules } from './rules';

export interface HyperlintResult {
  diagnostics: readonly HyperlintDiagnostic[];
  metrics: ReturnType<ProjectModel['getAllMetrics']>;
}

export function analyze(tsconfigPath?: string): HyperlintResult {
  const project = ProjectModel.fromTsConfig(tsconfigPath);
  const config = loadHyperlinterConfig();
  return {
    diagnostics: rules.flatMap((rule) => rule.analyze(project, config)),
    metrics: project.getAllMetrics(),
  };
}
