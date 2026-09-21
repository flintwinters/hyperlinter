import { findExactClones } from '../clones/exactDuplicates';
import type { HyperlinterConfig } from '../config/HyperlinterConfig';
import type { HyperlintDiagnostic } from '../diagnostics/Diagnostic';
import type { ProjectModel } from '../project/ProjectModel';
import type { HyperlintRule } from './Rule';

export const exactDuplicatesRule: HyperlintRule = {
  id: 'HL104',
  analyze(project: ProjectModel, config: HyperlinterConfig): readonly HyperlintDiagnostic[] {
    return findExactClones(project, config).map((clone): HyperlintDiagnostic => ({
      rule: 'HL104', severity: config.rules.exactDuplicates, file: clone.file,
      module: project.getModuleIdForFile(clone.first.getSourceFile().fileName),
      line: clone.first.getSourceFile().getLineAndCharacterOfPosition(clone.first.getStart()).line + 1,
      message: `Exact AST clone (${clone.meaningfulNodes} meaningful nodes) with ${clone.second.name?.text}; run with --fix to extract it.`,
    }));
  },
};
