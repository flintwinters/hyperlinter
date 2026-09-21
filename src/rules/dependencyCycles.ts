import type { HyperlintDiagnostic } from '../diagnostics/Diagnostic';
import type { ModuleId, ModuleGraph } from '../project/ModuleGraph';
import type { ProjectModel } from '../project/ProjectModel';
import type { HyperlintRule } from './Rule';

export const dependencyCyclesRule: HyperlintRule = {
  id: 'HL101',
  analyze(project: ProjectModel): readonly HyperlintDiagnostic[] {
    return stronglyConnectedComponents(project.getDependencyGraph())
      .filter((component) => component.length > 1)
      .map((component) => ({
        rule: 'HL101',
        severity: 'error' as const,
        module: component[0],
        message: `Circular dependency: ${component.join(' -> ')} -> ${component[0]}.`,
      }));
  },
};

function stronglyConnectedComponents(graph: ModuleGraph): ModuleId[][] {
  let index = 0;
  const indexes = new Map<ModuleId, number>();
  const lowLinks = new Map<ModuleId, number>();
  const stack: ModuleId[] = [];
  const onStack = new Set<ModuleId>();
  const components: ModuleId[][] = [];

  const visit = (module: ModuleId): void => {
    indexes.set(module, index);
    lowLinks.set(module, index++);
    stack.push(module);
    onStack.add(module);
    for (const dependency of graph.dependencies.get(module) ?? []) {
      if (!indexes.has(dependency)) {
        visit(dependency);
        lowLinks.set(module, Math.min(lowLinks.get(module)!, lowLinks.get(dependency)!));
      } else if (onStack.has(dependency)) {
        lowLinks.set(module, Math.min(lowLinks.get(module)!, indexes.get(dependency)!));
      }
    }
    if (lowLinks.get(module) === indexes.get(module)) {
      const component: ModuleId[] = [];
      let member: ModuleId;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
      } while (member !== module);
      components.push(component.sort());
    }
  };

  for (const module of graph.dependencies.keys()) if (!indexes.has(module)) visit(module);
  return components;
}
