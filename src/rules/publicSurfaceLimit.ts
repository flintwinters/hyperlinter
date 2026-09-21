import type { HyperlinterConfig } from '../config/HyperlinterConfig';
import type { HyperlintDiagnostic } from '../diagnostics/Diagnostic';
import type { ProjectModel } from '../project/ProjectModel';
import type { HyperlintRule } from './Rule';

/** Public APIs larger than this require an explicit decomposition. */
export const publicSurfaceLimitRule: HyperlintRule = {
  id: 'HL107',
  analyze(project: ProjectModel, config: HyperlinterConfig): readonly HyperlintDiagnostic[] {
    return project.getAllMetrics().flatMap((module): HyperlintDiagnostic[] => (
      module.publicSurface > config.publicSurface.maximum
        ? [{
          rule: 'HL107',
          severity: config.rules.publicSurfaceLimit,
          module: module.module,
          score: module.publicSurface,
          message: `Public surface of ${module.publicSurface} exceeds the configured maximum of ${config.publicSurface.maximum} symbols.`,
        }]
        : []
    ));
  },
};
