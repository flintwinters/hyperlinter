import type { HyperlinterConfig } from '../../config';
import type { HyperlintDiagnostic } from '../../diagnostics';
import type { StructuralModel } from '../../project';
import type { HyperlintRule } from '../contracts';

/** A directory module exposes exactly one API boundary file (`index.*` in TypeScript). */
export const moduleEntrypointRule: HyperlintRule<StructuralModel> = {
  id: 'HL108',
  analyze(project: StructuralModel, config: HyperlinterConfig): readonly HyperlintDiagnostic[] {
    return project.getModules().flatMap((module) => {
      const entryPoints = project.getEntrypointFiles(module);
      const diagnostics: HyperlintDiagnostic[] = [];
      if (entryPoints.length !== 1) diagnostics.push({
        rule: 'HL108',
        severity: config.rules.moduleEntrypoint,
        module: module.id,
        message: `Module must have exactly one public ${project.language.entrypoint} entrypoint; found ${entryPoints.length}.`,
      });
      return diagnostics;
    }).concat(project.getPrivateModuleImports().map((import_) => ({
      rule: 'HL108',
      severity: config.rules.moduleEntrypoint,
      module: import_.module,
      file: import_.file,
      message: `Import ${import_.targetModule} through its ${project.language.entrypoint}, not private file ${import_.targetFile}.`,
    })));
  },
};
