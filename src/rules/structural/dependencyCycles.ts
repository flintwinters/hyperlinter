import { cycleWitness, stronglyConnectedComponents } from '../../graphs';
import type { HyperlintDiagnostic } from '../../diagnostics';
import type { HyperlinterConfig } from '../../config';
import { type ProjectModel } from '../../project';

import type { HyperlintRule } from '../contracts';

export const dependencyCyclesRule: HyperlintRule = {
  id: 'HL101',
  analyze(project: ProjectModel, config: HyperlinterConfig): readonly HyperlintDiagnostic[] {
    const graph = new Map([...project.getDependencyGraph().dependencies].map(([id, targets]) => [id, new Set(targets)]));
    return stronglyConnectedComponents(graph)
      .filter((component) => component.length > 1)
      .map((component) => ({
        rule: 'HL101',
        severity: config.rules.dependencyCycles,
        module: component[0],
        message: `Circular dependency: ${cycleWitness(graph, component).join(' -> ')}.`,
      }));
  },
};
