interface LinkageMerge { left: number; right: number; distance: number; size: number }
export interface LinkageTree { leaves: number[]; merges: LinkageMerge[]; clusters: number[][] }

/** Full average-linkage tree; the cut is separate from tree construction. Leaf IDs use canonical key order. */
export function averageLinkage(
  keys: readonly string[], distance: (left: number, right: number) => number, maximumMergeDistance: number,
): LinkageTree {
  if (!Number.isFinite(maximumMergeDistance) || maximumMergeDistance < 0) throw new Error('Invalid average-linkage cut.');
  const leaves = keys.map((_, i) => i).sort((a, b) => keys[a] < keys[b] ? -1 : keys[a] > keys[b] ? 1 : 0);
  const width = Math.max(0, 2 * leaves.length - 1);
  const matrix = Array.from({ length: width }, () => new Float64Array(width));
  for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
    const value = distance(leaves[i], leaves[j]);
    if (!Number.isFinite(value) || value < 0) throw new Error('Average linkage requires finite, nonnegative distances.');
    matrix[i][j] = matrix[j][i] = value;
  }
  return mergeTree(leaves, matrix, maximumMergeDistance);
}

function closest(ids: readonly number[], matrix: readonly Float64Array[]): [number, number, number] {
  let left = ids[0], right = ids[1], best = Infinity;
  // Ascending canonical node IDs break exact distance ties independently of input traversal order.
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const value = matrix[ids[i]][ids[j]];
    if (value < best) { left = ids[i]; right = ids[j]; best = value; }
  }
  return [left, right, best];
}

function mergeTree(leaves: number[], matrix: Float64Array[], cut: number): LinkageTree {
  const active = new Map(leaves.map((leaf, i) => [i, [leaf]]));
  const merges: LinkageMerge[] = [];
  let clusters: number[][] | undefined;
  while (active.size > 1) {
    const [left, right, distance] = closest([...active.keys()], matrix);
    if (clusters === undefined && distance > cut) clusters = [...active.values()];
    const a = active.get(left)!, b = active.get(right)!;
    const node = leaves.length + merges.length;
    for (const other of active.keys()) {
      matrix[node][other] = matrix[other][node] =
        (a.length * matrix[left][other] + b.length * matrix[right][other]) / (a.length + b.length);
    }
    merges.push({ left, right, distance, size: a.length + b.length });
    active.delete(left); active.delete(right); active.set(node, [...a, ...b]);
  }
  return { leaves, merges, clusters: clusters ?? [...active.values()] };
}
