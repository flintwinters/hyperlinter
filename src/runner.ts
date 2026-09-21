import type { HyperlintDiagnostic } from './diagnostics/Diagnostic';
import { loadHyperlinterConfig } from './config/HyperlinterConfig';
import { ProjectModel } from './project/ProjectModel';
import { rules } from './rules';
import { moduleScoreDiagnostics } from './scoring/moduleScores';

export interface HyperlintResult {
  diagnostics: readonly HyperlintDiagnostic[];
  metrics: ReturnType<ProjectModel['getAllMetrics']>;
}

export function analyze(tsconfigPath?: string): HyperlintResult {
  const project = ProjectModel.fromTsConfig(tsconfigPath);
  const config = loadHyperlinterConfig();
  const diagnostics = rules.flatMap((rule) => rule.analyze(project, config));
  return {
    diagnostics: [...diagnostics, ...moduleScoreDiagnostics(diagnostics, config)],
    metrics: project.getAllMetrics(),
  };
}
