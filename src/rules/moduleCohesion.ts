import type { HyperlinterConfig } from '../config/HyperlinterConfig';
import type { ProjectModel } from '../project/ProjectModel';
import { moduleCohesion } from '../project/moduleCohesion';
import type { HyperlintRule } from './contracts/index';

export const moduleCohesionRule: HyperlintRule = {
  id: 'HL115',
  analyze(project: ProjectModel, config: HyperlinterConfig) {
    const threshold = config.cohesion;
    return project.getModules().flatMap((module) => {
      const evidence = moduleCohesion(project, module);
      if (!evidence || evidence.groups.length < 2
        || evidence.groups.some((group) => group.exports.length < threshold.minimumGroupExports)
        || evidence.groups.reduce((sum, group) => sum + group.exports.length, 0) < threshold.minimumExports
        || evidence.separatedPairRatio < threshold.minimumSeparatedPairRatio
        || evidence.consumerOverlap > threshold.maximumConsumerOverlap) return [];
      const groups = evidence.groups.map((group) =>
        `[${group.exports.join(', ')}] used by [${[...group.consumers].sort().join(', ')}]`).join('; ');
      return [{
        rule: 'HL115', severity: config.rules.moduleCohesion, module: module.id,
        score: evidence.separatedPairRatio,
        message: `Low module cohesion: separated export pairs ${evidence.separatedPairRatio.toFixed(3)} >= ${threshold.minimumSeparatedPairRatio}; `
          + `mean consumer Jaccard overlap ${evidence.consumerOverlap.toFixed(3)} <= ${threshold.maximumConsumerOverlap}. Groups: ${groups}. `
          + 'Refactor around shared behavior and owned state: separate independent responsibilities into cohesive modules, '
          + 'keep shared invariants with their owner, and update entrypoints and consumers. Do not add artificial dependencies to satisfy this check.',
      }];
    });
  },
};
