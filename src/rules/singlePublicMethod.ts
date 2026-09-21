import type { HyperlinterConfig } from '../config/HyperlinterConfig';
import type { HyperlintDiagnostic } from '../diagnostics/Diagnostic';
import type { ProjectModel } from '../project/ProjectModel';
import type { HyperlintRule } from './Rule';

/** One-symbol public files are needless architectural boundaries. */
export const singlePublicMethodRule: HyperlintRule = {
  id: 'HL109',
  analyze(project: ProjectModel, config: HyperlinterConfig): readonly HyperlintDiagnostic[] {
    return project.getModules().flatMap((module) => project.getFileMetrics(module)
      .filter((file) => project.getEntrypointFiles(module).includes(file.file))
      .filter((file) => file.declarations === 1 && file.exports === 1)
      .map((file) => ({
        rule: 'HL109',
        severity: config.rules.singlePublicMethod,
        module: module.id,
        file: file.file,
        message: 'A one-declaration public file must be combined with another file.',
      })));
  },
};
