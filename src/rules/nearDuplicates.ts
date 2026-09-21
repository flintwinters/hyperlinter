import { findNearDuplicateClusters } from '../clones/nearDuplicates';
import type { HyperlintDiagnostic } from '../diagnostics/Diagnostic';
import type { ProjectModel } from '../project/ProjectModel';
import type { HyperlintRule } from './Rule';

export const nearDuplicatesRule: HyperlintRule = {
  id: 'HL105',
  analyze(project: ProjectModel): readonly HyperlintDiagnostic[] {
    return findNearDuplicateClusters(project).map((cluster): HyperlintDiagnostic => {
      const first = cluster.methods[0];
      const names = cluster.methods.map((method) => method.name.text).join(', ');
      const similarity = Math.round(cluster.similarity * 100);
      return {
        rule: 'HL105', severity: 'info', file: first.getSourceFile().fileName,
        line: first.getSourceFile().getLineAndCharacterOfPosition(first.getStart()).line + 1,
        score: cluster.similarity,
        message: `${cluster.methods.length} near-duplicate methods (${similarity}% shared normalized AST): ${names}.${cluster.parameterized ? ' Differences are parameter/literal-only.' : ''}`,
      };
    });
  },
};
