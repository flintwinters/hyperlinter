import type { HyperlintDiagnostic } from "../../diagnostics";
import type { HyperlinterConfig } from "../../config";
import type { ProjectModel } from "../../project";

export interface HyperlintRule {
  readonly id: string;
  analyze(project: ProjectModel, config: HyperlinterConfig): readonly HyperlintDiagnostic[];
}
