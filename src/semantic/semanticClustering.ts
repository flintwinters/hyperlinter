import type { SemanticConfig } from '../config';
import type { HyperlintDiagnostic } from '../diagnostics';
import { averageLinkage, type LinkageTree } from '../clustering';
import { validateVectors } from './semanticEmbeddings';
import type { SemanticFunction } from './semanticFunctions';

function normalizedVectors(members: readonly SemanticFunction[], vectors: ReadonlyMap<string, readonly number[]>): number[][] {
  const values = members.map(fn => vectors.get(fn.id));
  validateVectors(values, members.length);
  return values.map(vector => { const norm = Math.hypot(...vector); return vector.map(value => value / norm); });
}

function cosineDistance(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  for (let i = 0; i < left.length; i++) dot += left[i] * right[i];
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

export interface SemanticClusterEvidence {
  module: string;
  functions: number;
  eligible: boolean;
  tree: LinkageTree;
  clusters: SemanticFunction[][];
  largeClusters: number;
  bestSeparation: number | null;
  separated: { left: number; right: number; distance: number } | null;
}

/** The linter and offline reports consume the same clustering and separation decisions. */
export function semanticClusterEvidence(
  functions: readonly SemanticFunction[], vectors: ReadonlyMap<string, readonly number[]>, config: SemanticConfig,
): SemanticClusterEvidence[] {
  return [...functionsByModule(functions)].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([module, members]) => {
    const normalized = normalizedVectors(members, vectors);
    const distance = (a: number, b: number) => cosineDistance(normalized[a], normalized[b]);
    const keys = members.map(fn => `${fn.file}\0${fn.hash}\0${fn.line}`);
    const tree = averageLinkage(keys, distance, config.maximumMergeDistance);
    const clusters = tree.clusters.map(cluster => cluster.map(i => members[i]));
    const large = tree.clusters.map((cluster, i) => ({ cluster, i })).filter(item => item.cluster.length >= config.minimumClusterFunctions);
    let bestSeparation: number | null = null;
    let separated: SemanticClusterEvidence['separated'] = null;
    for (let a = 0; a < large.length; a++) for (let b = a + 1; b < large.length; b++) {
      const separation = large[a].cluster.reduce((minimum, left) =>
        large[b].cluster.reduce((value, right) => Math.min(value, distance(left, right)), minimum), 2);
      bestSeparation = Math.max(bestSeparation ?? 0, separation);
      if (separation >= config.minimumClusterDistance && separated === null) {
        separated = { left: large[a].i, right: large[b].i, distance: separation };
      }
    }
    return { module, functions: members.length, eligible: members.length >= 2 * config.minimumClusterFunctions,
      tree, clusters, largeClusters: large.length, bestSeparation, separated };
  });
}

function describe(cluster: readonly SemanticFunction[]): string {
  const locations = cluster.slice(0, 8).map((fn) => `${fn.file}:${fn.line}`).join(', ');
  return `${cluster.length} functions [${locations}${cluster.length > 8 ? ', …' : ''}]`;
}

export function semanticClustering(
  functions: readonly SemanticFunction[], vectors: ReadonlyMap<string, readonly number[]>, config: SemanticConfig,
): HyperlintDiagnostic[] {
  const diagnostics: HyperlintDiagnostic[] = [];
  for (const evidence of semanticClusterEvidence(functions, vectors, config)) {
    if (!evidence.eligible || !evidence.separated) continue;
    const { module, clusters, separated } = evidence;
    const separation = separated.distance;
    diagnostics.push({
      rule: 'HL116', severity: 'warning', module, score: separation,
      message: `EXPERIMENTAL semantic clustering: ${describe(clusters[separated.left])} and ${describe(clusters[separated.right])}; `
        + `minimum cross-cluster cosine distance ${separation.toFixed(3)} >= ${config.minimumClusterDistance}; `
        + `each cluster has >= ${config.minimumClusterFunctions} functions. Agent examination requested. `
        + 'Each module is partitioned into disjoint function clusters; every function belongs to exactly one cluster. '
        + 'Average linkage repeatedly merges the closest clusters by mean cross-cluster cosine distance. '
        + `The tree is cut at merge distance ${config.maximumMergeDistance}; stable source keys break exact ties. `
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
  }
  return diagnostics;
}
