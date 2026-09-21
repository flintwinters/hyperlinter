import type { HyperlinterConfig } from '../config/HyperlinterConfig';
import type { HyperlintDiagnostic } from '../diagnostics/Diagnostic';
import type { ProjectModel } from '../project/ProjectModel';
import type { HyperlintRule } from './Rule';

/** A directory module exposes exactly one `index.*` API boundary. */
export const moduleEntrypointRule: HyperlintRule = {
  id: 'HL108',
  analyze(project: ProjectModel, config: HyperlinterConfig): readonly HyperlintDiagnostic[] {
    return project.getModules().flatMap((module) => {
      const entryPoints = project.getEntrypointFiles(module);
      const diagnostics: HyperlintDiagnostic[] = [];
      if (entryPoints.length !== 1) diagnostics.push({
        rule: 'HL108',
        severity: config.rules.moduleEntrypoint,
        module: module.id,
        message: `Module must have exactly one public index entrypoint; found ${entryPoints.length}.`,
      });
      return diagnostics;
    }).concat(project.getPrivateModuleImports().map((import_) => ({
      rule: 'HL108',
      severity: config.rules.moduleEntrypoint,
      module: import_.module,
      file: import_.file,
      message: `Import ${import_.targetModule} through its index, not private file ${import_.targetFile}.`,
    })));
  },
};
