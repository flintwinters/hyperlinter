/** Iterative Kosaraju traversal: graph size must not consume the JavaScript stack. */
export function stronglyConnectedComponents<T>(graph: ReadonlyMap<T, ReadonlySet<T>>): T[][] {
  const seen = new Set<T>();
  const order: T[] = [];
  const reverse = new Map<T, Set<T>>([...graph.keys()].map(node => [node, new Set<T>()]));
  for (const [node, targets] of graph) for (const target of targets) reverse.get(target)!.add(node);
  finishingOrder(graph, seen, order);
  seen.clear();
  const components: T[][] = [];
  for (const root of order.reverse()) {
    if (!seen.has(root)) components.push(collectComponent(reverse, root, seen));
  }
  return components;
}

/** A real directed cycle, rather than an arbitrary ordering of SCC members. */
export function cycleWitness<T>(graph: ReadonlyMap<T, ReadonlySet<T>>, component: readonly T[]): T[] {
  const root = component[0];
  const allowed = new Set(component);
  const parents = new Map<T, T>();
  const queue = [root];
  const seen = new Set([root]);
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index];
    for (const target of graph.get(node)!) {
      if (!allowed.has(target)) continue;
      if (target === root) {
        const path = [node];
        while (path.at(-1) !== root) path.push(parents.get(path.at(-1)!)!);
        return [...path.reverse(), root];
      }
      if (!seen.has(target)) { seen.add(target); parents.set(target, node); queue.push(target); }
    }
  }
  return [];
}

function finishingOrder<T>(graph: ReadonlyMap<T, ReadonlySet<T>>, seen: Set<T>, order: T[]) {
  for (const root of graph.keys()) {
    const pending: [T, boolean][] = [[root, false]];
    while (pending.length) {
      const [node, finished] = pending.pop()!;
      if (finished) { order.push(node); continue; }
      if (seen.has(node)) continue;
      seen.add(node);
      pending.push([node, true]);
      for (const target of graph.get(node)!) if (!seen.has(target)) pending.push([target, false]);
    }
  }
}

function collectComponent<T>(reverse: ReadonlyMap<T, ReadonlySet<T>>, root: T, seen: Set<T>): T[] {
  const component: T[] = [];
  const pending = [root];
  seen.add(root);
  while (pending.length) {
    const node = pending.pop()!;
    component.push(node);
    for (const target of reverse.get(node)!) if (!seen.has(target)) {
      seen.add(target); pending.push(target);
    }
  }
  return component;
}
