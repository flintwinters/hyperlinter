import type { HyperlintDiagnostic } from '../diagnostics/Diagnostic';
import type { ProjectModel } from '../project/ProjectModel';

export interface HyperlintRule {
  readonly id: string;
  analyze(project: ProjectModel): readonly HyperlintDiagnostic[];
}
