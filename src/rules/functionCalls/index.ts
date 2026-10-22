import { cycleWitness, stronglyConnectedComponents } from '../../graphs';
import { functionCallGraph, functionGenerations } from '../../project/calls';
import type { HyperlintRule } from '../contracts';

export const functionCyclesRule: HyperlintRule = {
  id: 'HL120',
  analyze(project, config) {
    const graph = functionCallGraph(project);
    return stronglyConnectedComponents(graph.edges)
      .filter(group => group.length > 1 || graph.edges.get(group[0])!.has(group[0]))
      .map(group => {
        const witness = cycleWitness(graph.edges, group);
        const first = graph.functions.get(witness[0])!;
        return { rule: 'HL120', severity: config.rules.functionCycles,
          module: first.module, file: first.file, line: first.line,
          message: `Function call cycle (${group.length} functions): ${witness.map(node => {
            const entry = graph.functions.get(node)!;
            return `${entry.name} (${entry.file}:${entry.line})`;
          }).join(' -> ')}. Break the cycle by separating orchestration from implementation.` };
      });
  },
};

export const functionGenerationGapRule: HyperlintRule = {
  id: 'HL121',
  analyze(project, config) {
    const graph = functionCallGraph(project);
    const generations = functionGenerations(graph);
    return [...graph.edges].flatMap(([caller, targets]) => [...targets].flatMap(target => {
      const from = generations.get(caller);
      const to = generations.get(target);
      if (!from || !to || from.depth - to.depth <= config.functionCalls.maximumGenerationGap) return [];
      const entry = graph.functions.get(caller)!;
      const destination = graph.functions.get(target)!;
      const chain: string[] = [];
      for (let node: typeof caller | undefined = caller; node; node = generations.get(node)?.next) {
        const step = graph.functions.get(node)!;
        chain.push(`${step.name} (${step.file}:${step.line})`);
      }
      return [{ rule: 'HL121', severity: config.rules.functionGenerationGap, module: entry.module,
        file: entry.file, line: graph.sites.get(caller)!.get(target),
        message: `Call ${entry.name} -> ${destination.name} (${destination.file}:${destination.line}) spans `
          + `${from.depth - to.depth} generations (${from.depth} -> ${to.depth}); maximum ${config.functionCalls.maximumGenerationGap}. `
          + `Longest caller chain: ${chain.join(' -> ')}. Move the responsibility to the appropriate generation.` }];
    }));
  },
};
