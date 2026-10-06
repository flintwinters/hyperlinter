import type { SemanticConfig } from '../config/SemanticConfig';
import type { HyperlintDiagnostic } from '../diagnostics/Diagnostic';
import type { SemanticFunction } from './semanticFunctions';

function cosineDistance(left: readonly number[], right: readonly number[]): number {
  const leftNorm = Math.hypot(...left);
  const rightNorm = Math.hypot(...right);
  const dot = left.reduce((sum, value, index) => sum + (value / leftNorm) * (right[index] / rightNorm), 0);
  return Math.max(0, Math.min(2, 1 - dot));
}

function functionsByModule(functions: readonly SemanticFunction[]): Map<string, SemanticFunction[]> {
  const modules = new Map<string, SemanticFunction[]>();
  for (const fn of functions) {
    const members = modules.get(fn.module) ?? [];
    members.push(fn);
    modules.set(fn.module, members);
  }
  return modules;
}

function completeLinkGroups(
  members: readonly SemanticFunction[], distance: (left: SemanticFunction, right: SemanticFunction) => number, maximum: number,
): SemanticFunction[][] {
  const groups: SemanticFunction[][] = [];
  // Deterministic complete-link assignment prevents chains of weakly related
  // functions from joining two otherwise unrelated groups.
  for (const fn of members) {
    const group = groups.find((candidate) => candidate.every((other) => distance(fn, other) <= maximum));
    if (group) group.push(fn);
    else groups.push([fn]);
  }
  return groups;
}

function describe(group: readonly SemanticFunction[]): string {
  const locations = group.slice(0, 8).map((fn) => `${fn.file}:${fn.line}`).join(', ');
  return `${group.length} functions [${locations}${group.length > 8 ? ', …' : ''}]`;
}

export function semanticGrouping(
  functions: readonly SemanticFunction[], vectors: ReadonlyMap<string, readonly number[]>, config: SemanticConfig,
): HyperlintDiagnostic[] {
  const modules = functionsByModule(functions);
  const diagnostics: HyperlintDiagnostic[] = [];
  const distance = (left: SemanticFunction, right: SemanticFunction) => cosineDistance(vectors.get(left.id)!, vectors.get(right.id)!);
  for (const [module, members] of modules) {
    if (members.length < 2 * config.minimumClusterFunctions) continue;
    const groups = completeLinkGroups(members, distance, config.maximumWithinClusterDistance);
    const large = groups.filter((group) => group.length >= config.minimumClusterFunctions);
    for (let left = 0; left < large.length; left++) {
      for (let right = left + 1; right < large.length; right++) {
        const separation = large[left].reduce((minimum, fn) =>
          large[right].reduce((value, other) => Math.min(value, distance(fn, other)), minimum), 2);
        if (separation < config.minimumClusterDistance) continue;
        diagnostics.push({
          rule: 'HL116', severity: 'warning', module, score: separation,
          message: `EXPERIMENTAL semantic grouping: ${describe(large[left])} and ${describe(large[right])}; `
            + `minimum cross-group cosine distance ${separation.toFixed(3)} >= ${config.minimumClusterDistance}; `
            + `each group has >= ${config.minimumClusterFunctions} functions. Agent examination requested. `
            + 'This is a noisy advisory warning, not a hard architectural rule or a requirement to refactor. '
            + 'Examine responsibilities, shared state, invariants, and consumers before considering declustering into separate modules. '
            + 'If you do not think declustering is needed, you should probably adjust semantic.minimumClusterFunctions '
            + 'and/or semantic.minimumClusterDistance in hyperlinter.config.json instead. '
            + 'Also investigate whether this trigger reveals a general improvement to Hyperlinter, where applicable: '
            + 'embedding input/context, clustering behavior, cosine-distance evidence, function-count and distance thresholds, '
            + 'or deterministic behavior/state/consumer evidence that could confirm or reject semantic separation. '
            + 'Identify applicable opportunities and explain how the triggering evidence supports them; '
            + 'preserve reproducible analysis failures as regression tests when proposing detection changes. '
            + 'Threshold tuning is permitted for this experimental semantic advice; do not weaken other enforcement merely to pass. '
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
