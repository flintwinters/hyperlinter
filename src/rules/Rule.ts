import type { HyperlintDiagnostic } from '../diagnostics/Diagnostic';
import type { HyperlinterConfig } from '../config/HyperlinterConfig';
import type { ProjectModel } from '../project/ProjectModel';

export interface HyperlintRule {
  readonly id: string;
  analyze(project: ProjectModel, config: HyperlinterConfig): readonly HyperlintDiagnostic[];
}
