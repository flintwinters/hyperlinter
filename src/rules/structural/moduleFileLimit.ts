import type { HyperlinterConfig } from '../../config';
import type { HyperlintDiagnostic } from '../../diagnostics';
import type { ProjectModel } from '../../project';
import type { HyperlintRule } from '../contracts';

/** Bound directly owned implementation, not descendants belonging to other modules. */
export const moduleFileLimitRule: HyperlintRule = {
  id: 'HL117',
  analyze(project: ProjectModel, config: HyperlinterConfig): readonly HyperlintDiagnostic[] {
    return project.getModules().flatMap((module) => {
      // Entrypoints, styles, generated sources and tests included by tsconfig are
      // source files too: filename conventions must not bypass the module budget.
      const count = module.sourceFiles.length;
      return count > config.moduleFiles.maximum ? [{
        rule: 'HL117',
        severity: config.rules.moduleFileLimit,
        module: module.id,
        score: count,
        message: `Module owns ${count} source files; maximum is ${config.moduleFiles.maximum}. `
          + 'Extract cohesive directory modules with index entrypoints.',
      }] : [];
    });
  },
};
