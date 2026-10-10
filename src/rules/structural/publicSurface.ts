import type { HyperlintDiagnostic } from '../../diagnostics';
import type { HyperlinterConfig } from '../../config';
import type { ProjectModel } from '../../project';
import type { HyperlintRule } from '../contracts';

export const publicSurfaceRule: HyperlintRule = {
  id: 'HL102',
  analyze(project: ProjectModel, config: HyperlinterConfig): readonly HyperlintDiagnostic[] {
    return project.getModules().flatMap((module) => {
      const unused = project.getPublicSurface(module)
        .filter((entry) => entry.externalReferences === 0);
      const diagnostics: HyperlintDiagnostic[] = [];
      if (unused.length > 0) diagnostics.push({
        rule: 'HL102',
        severity: config.rules.unusedPublicSurface,
        module: module.id,
        message: `${unused.length} exported symbol${unused.length === 1 ? '' : 's'} ` +
          `have no external consumer: ${unused.map((entry) => entry.name).join(', ')}.`,
      });
      return diagnostics;
    });
  },
};
