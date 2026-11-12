import { ProjectModel } from '../src/project';
import { functionCallGraph, moduleGenerationGaps, isTestFile } from '../src/project/calls';

const graph = functionCallGraph(ProjectModel.fromTsConfig());
const { generations, edges } = moduleGenerationGaps(graph);
const histogram = new Map<number, { source: number; tests: number }>();
const totalEdges = [...graph.edges.values()].reduce((count, targets) => count + targets.size, 0);
const excludedEdges = totalEdges - edges.length;
for (const { caller, gap } of edges) {
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
  scope: 'module',
  definition: 'One violation per distinct caller/callee edge whose module-local generation gap exceeds the limit; external module interfaces are generation-zero leaves.',
  functions: graph.functions.size, finiteGenerationFunctions: generations.size, totalEdges, excludedEdges,
  maximumGap, limits,
}, null, 2));
