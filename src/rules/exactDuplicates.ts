import { findExactClones } from '../clones/exactDuplicates';
import type { HyperlintDiagnostic } from '../diagnostics/Diagnostic';
import type { ProjectModel } from '../project/ProjectModel';
import type { HyperlintRule } from './Rule';

export const exactDuplicatesRule: HyperlintRule = {
  id: 'HL104',
  analyze(project: ProjectModel): readonly HyperlintDiagnostic[] {
    return findExactClones(project).map((clone): HyperlintDiagnostic => ({
      rule: 'HL104', severity: 'smell', file: clone.file,
      line: clone.first.getSourceFile().getLineAndCharacterOfPosition(clone.first.getStart()).line + 1,
      message: `Exact AST clone (${clone.meaningfulNodes} meaningful nodes) with ${clone.second.name?.text}; run with --fix to extract it.`,
    }));
  },
};
