import type { HyperlinterConfig } from '../../config';
import type { HyperlintDiagnostic } from '../../diagnostics';
import type { ProjectModel } from '../../project';
import type { HyperlintRule } from '../contracts';

/**
 * Pressure flat directories into a hierarchy: bound directly owned files, not
 * descendants, which become separate modules behind their own index.
 */
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
        message: moduleFileLimitMessage(count, config.moduleFiles.maximum),
      }] : [];
    });
  },
};

function moduleFileLimitMessage(count: number, maximum: number): string {
  return `Directory directly owns ${count} source files; maximum is ${maximum}. This limit exists to grow a hierarchy: `
    + 'move groups of related files into subdirectories, each with its own index entrypoint (tests too, e.g. tests/<area>/). '
    + 'Do not merge unrelated files or pack code into existing files to lower the count.';
}
