import { findNearDuplicateClusters } from '../clones/nearDuplicates';
import type { HyperlinterConfig } from '../config/HyperlinterConfig';
import type { HyperlintDiagnostic } from '../diagnostics/Diagnostic';
import type { ProjectModel } from '../project/ProjectModel';
import type { HyperlintRule } from './Rule';

export const nearDuplicatesRule: HyperlintRule = {
  id: 'HL105',
  analyze(project: ProjectModel, config: HyperlinterConfig): readonly HyperlintDiagnostic[] {
    return findNearDuplicateClusters(project, config).map((cluster): HyperlintDiagnostic => {
      const first = cluster.methods[0];
      const names = cluster.methods.map((method) => method.name.text).join(', ');
      const similarity = Math.round(cluster.similarity * 100);
      return {
        rule: 'HL105', severity: config.rules.nearDuplicates, file: first.getSourceFile().fileName,
        module: project.getModuleIdForFile(first.getSourceFile().fileName),
        line: first.getSourceFile().getLineAndCharacterOfPosition(first.getStart()).line + 1,
        score: cluster.similarity,
        message: [
          `${cluster.methods.length} near-duplicate methods (${similarity}% shared normalized AST): ${names}.`,
          cluster.parameterized ? 'Differences are parameter/literal-only.' : '',
        ].filter(Boolean).join(' '),
      };
    });
  },
};
