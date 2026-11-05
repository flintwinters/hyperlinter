import { ProjectModel } from '../src/project';
import { functionCallGraph, functionGenerations, isTestFile } from '../src/project/calls';

const graph = functionCallGraph(ProjectModel.fromTsConfig());
const generations = functionGenerations(graph);
const histogram = new Map<number, { source: number; tests: number }>();
let totalEdges = 0;
let excludedEdges = 0;
for (const [caller, targets] of graph.edges) for (const target of targets) {
  totalEdges++;
  const from = generations.get(caller), to = generations.get(target);
  if (!from || !to) { excludedEdges++; continue; }
  const gap = from.depth - to.depth;
  const bucket = histogram.get(gap) ?? { source: 0, tests: 0 };
  if (isTestFile(graph.functions.get(caller)!.file)) bucket.tests++;
  else bucket.source++;
  histogram.set(gap, bucket);
}
const maximumGap = Math.max(0, ...histogram.keys());
const limits = Array.from({ length: maximumGap + 1 }, (_, limit) => {
  let source = 0, tests = 0;
  for (const [gap, bucket] of histogram) if (gap > limit) { source += bucket.source; tests += bucket.tests; }
  return { limit, violations: source + tests, source, tests };
});
console.log(JSON.stringify({
  definition: 'One violation per distinct caller/callee edge whose generation gap exceeds the limit.',
  functions: graph.functions.size, finiteGenerationFunctions: generations.size, totalEdges, excludedEdges,
  maximumGap, limits,
}, null, 2));
