import { findExactClones } from '../clones';
import type { HyperlinterConfig } from '../config';
import type { HyperlintDiagnostic } from '../diagnostics';
import type { ProjectModel } from '../project';
import type { HyperlintRule } from './contracts';

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
