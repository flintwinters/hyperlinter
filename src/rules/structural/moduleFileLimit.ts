import type { HyperlinterConfig } from '../../config';
import type { HyperlintDiagnostic } from '../../diagnostics';
import type { LanguageProfile, StructuralModel } from '../../project';
import type { HyperlintRule } from '../contracts';

/**
 * Pressure flat directories into a hierarchy: bound directly owned files, not
 * descendants, which become separate modules behind their own index.
 */
export const moduleFileLimitRule: HyperlintRule<StructuralModel> = {
  id: 'HL117',
  analyze(project: StructuralModel, config: HyperlinterConfig): readonly HyperlintDiagnostic[] {
    return project.getModules().flatMap((module) => {
      // Entrypoints, styles, generated sources and tests included by the language model are
      // source files too: filename conventions must not bypass the module budget.
      const count = project.getOwnedFiles(module).length;
      return count > config.moduleFiles.maximum ? [{
        rule: 'HL117',
        severity: config.rules.moduleFileLimit,
        module: module.id,
        score: count,
        message: moduleFileLimitMessage(count, config.moduleFiles.maximum, project.language),
      }] : [];
    });
  },
};

function moduleFileLimitMessage(count: number, maximum: number, language: LanguageProfile): string {
  if (language.boundary === 'visibility') {
    return `Module directly declares ${count} source files (its own plus child modules); maximum is ${maximum}. This limit exists to grow a hierarchy: `
      + 'group related child modules under a new parent module (name.rs with a name/ directory) and keep each module\'s items private unless a sibling needs them. '
      + 'Do not merge unrelated modules or pack code into existing files to lower the count.';
  }
  return `Directory directly owns ${count} source files; maximum is ${maximum}. This limit exists to grow a hierarchy: `
    + `move groups of related files into subdirectories, each with its own ${language.entrypoint} entrypoint (tests too, e.g. tests/<area>/). `
    + 'Do not merge unrelated files or pack code into existing files to lower the count.';
}
