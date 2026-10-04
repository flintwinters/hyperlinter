import type { SemanticConfig } from '../config/SemanticConfig';
import type { HyperlintDiagnostic } from '../diagnostics/Diagnostic';
import type { SemanticFunction } from './semanticFunctions';

function cosineDistance(left: readonly number[], right: readonly number[]): number {
  const leftNorm = Math.hypot(...left);
  const rightNorm = Math.hypot(...right);
  const dot = left.reduce((sum, value, index) => sum + (value / leftNorm) * (right[index] / rightNorm), 0);
  return Math.max(0, Math.min(2, 1 - dot));
}

export function semanticGrouping(
  functions: readonly SemanticFunction[], vectors: ReadonlyMap<string, readonly number[]>, config: SemanticConfig,
): HyperlintDiagnostic[] {
  const modules = new Map<string, SemanticFunction[]>();
  for (const fn of functions) {
    const members = modules.get(fn.module) ?? [];
    members.push(fn);
    modules.set(fn.module, members);
  }
  const diagnostics: HyperlintDiagnostic[] = [];
  const distance = (left: SemanticFunction, right: SemanticFunction) => cosineDistance(vectors.get(left.id)!, vectors.get(right.id)!);
  for (const [module, members] of modules) {
    if (members.length < 2 * config.minimumClusterFunctions) continue;
    const groups: SemanticFunction[][] = [];
    // Deterministic complete-link assignment prevents chains of weakly related
    // functions from joining two otherwise unrelated groups.
    for (const fn of members) {
      const group = groups.find((candidate) => candidate.every((other) => distance(fn, other) <= config.maximumWithinClusterDistance));
      if (group) group.push(fn);
      else groups.push([fn]);
    }
    const large = groups.filter((group) => group.length >= config.minimumClusterFunctions);
    for (let left = 0; left < large.length; left++) {
      for (let right = left + 1; right < large.length; right++) {
        const separation = large[left].reduce((minimum, fn) => large[right].reduce((value, other) => Math.min(value, distance(fn, other)), minimum), 2);
        if (separation < config.minimumClusterDistance) continue;
        const describe = (group: SemanticFunction[]) => `${group.length} functions [${group.slice(0, 8).map((fn) => `${fn.file}:${fn.line}`).join(', ')}${group.length > 8 ? ', …' : ''}]`;
        diagnostics.push({
          rule: 'HL116', severity: 'warning', module, score: separation,
          message: `EXPERIMENTAL semantic grouping: ${describe(large[left])} and ${describe(large[right])}; `
            + `minimum cross-group cosine distance ${separation.toFixed(3)} >= ${config.minimumClusterDistance}; `
            + `each group has >= ${config.minimumClusterFunctions} functions. Agent examination requested. `
            + 'This is a noisy advisory warning, not a hard architectural rule or a requirement to refactor. '
            + 'Examine responsibilities, shared state, invariants, and consumers before considering declustering into separate modules. '
            + 'If you do not think declustering is needed, you should probably adjust semantic.minimumClusterFunctions '
            + 'and/or semantic.minimumClusterDistance in hyperlinter.config.json instead. '
            + 'Explain your judgment; do not introduce artificial structure merely to satisfy embeddings.',
        });
        // One prompt per module is enough; avoid quadratic diagnostic output.
        break;
      }
      if (diagnostics.at(-1)?.module === module) break;
    }
  }
  return diagnostics;
}
