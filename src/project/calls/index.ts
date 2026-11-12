import ts from 'typescript';
import type { ProjectModel } from '..';

interface FunctionNode {
  name: string;
  file: string;
  line: number;
  module: string;
}

interface FunctionCallGraph {
  functions: ReadonlyMap<ts.Node, FunctionNode>;
  edges: ReadonlyMap<ts.Node, ReadonlySet<ts.Node>>;
  sites: ReadonlyMap<ts.Node, ReadonlyMap<ts.Node, number>>;
}

/** Caller paths own source/test policy, including colocated tests and test helpers. */
export function isTestFile(file: string): boolean {
  return /(?:^|\/)(?:tests?|__tests__)(?:\/)|\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(file.replaceAll('\\', '/'));
}

const graphs = new WeakMap<ProjectModel, FunctionCallGraph>();

/** Only statically resolved invocations establish edges; references alone are not calls. */
export function functionCallGraph(project: ProjectModel): FunctionCallGraph {
  const existing = graphs.get(project);
  if (existing) return existing;
  const functions = new Map<ts.Node, FunctionNode>();
  const symbols = new Map<ts.Symbol, ts.Node>();
  for (const module of project.getModules()) {
    for (const source of module.sourceFiles.filter(file => !file.isDeclarationFile)) {
      collectFunctions(project, source, module.id, functions, symbols);
    }
  }
  const edges = new Map<ts.Node, Set<ts.Node>>([...functions.keys()].map(node => [node, new Set()]));
  const sites = new Map<ts.Node, Map<ts.Node, number>>([...functions.keys()].map(node => [node, new Map()]));
  for (const owner of functions.keys()) {
    collectCalls(project, owner, functions, symbols, edges.get(owner)!, sites.get(owner)!);
  }
  const graph = { functions, edges, sites };
  graphs.set(project, graph);
  return graph;
}

/** Leaves are generation zero. Module scope ends each external call at an interface leaf.
 * Cycles and callers reaching them within the selected scope have no finite generation. */
export function functionGenerations(graph: FunctionCallGraph, scope: 'repository' | 'module' = 'repository'): Map<ts.Node, { depth: number; next?: ts.Node }> {
  const generations = new Map<ts.Node, { depth: number; next?: ts.Node }>();
  const edges = new Map<ts.Node, ReadonlySet<ts.Node>>();
  for (const [caller, targets] of graph.edges) {
    if (scope === 'repository') { edges.set(caller, targets); continue; }
    const internal = new Set<ts.Node>();
    for (const target of targets) {
      if (graph.functions.get(caller)!.module === graph.functions.get(target)!.module) internal.add(target);
      else if (!generations.has(caller)) generations.set(caller, { depth: 1, next: target });
    }
    edges.set(caller, internal);
  }
  const remaining = new Map([...edges].map(([node, targets]) => [node, targets.size]));
  const callers = new Map<ts.Node, ts.Node[]>([...edges.keys()].map(node => [node, []]));
  populateCallers(edges, callers);
  const queue = [...remaining].filter(([, count]) => count === 0).map(([node]) => node);
  for (const node of queue) if (!generations.has(node)) generations.set(node, { depth: 0 });
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index];
    for (const caller of callers.get(node)!) {
      const candidate = generations.get(node)!.depth + 1;
      if (candidate > (generations.get(caller)?.depth ?? -1)) generations.set(caller, { depth: candidate, next: node });
      remaining.set(caller, remaining.get(caller)! - 1);
      if (remaining.get(caller) === 0) queue.push(caller);
    }
  }
  for (const node of [...remaining].filter(([, count]) => count > 0).map(([node]) => node)) generations.delete(node);
  return generations;
}

/** One authoritative module-local edge gap for enforcement and sensitivity reports. */
export function moduleGenerationGaps(graph: FunctionCallGraph) {
  const generations = functionGenerations(graph, 'module');
  const edges: { caller: ts.Node; target: ts.Node; from: number; to: number; gap: number }[] = [];
  for (const [caller, targets] of graph.edges) {
    const from = generations.get(caller)?.depth;
    if (from === undefined) continue;
    for (const target of targets) {
      const to = graph.functions.get(caller)!.module === graph.functions.get(target)!.module
        ? generations.get(target)?.depth : 0;
      if (to !== undefined) edges.push({ caller, target, from, to, gap: from - to });
    }
  }
  return { generations, edges };
}

function functionName(node: ts.SignatureDeclaration) {
  if (node.name) return node.name;
  const parent = node.parent;
  return ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)
    ? parent.name : undefined;
}

function collectFunctions(project: ProjectModel, source: ts.SourceFile, module: string,
  functions: Map<ts.Node, FunctionNode>, symbols: Map<ts.Symbol, ts.Node>) {
  const pending: ts.Node[] = [source];
  while (pending.length) {
    const node = pending.pop()!;
    if (hasImplementation(node)) {
      const named = functionName(node);
      const name = named?.getText(source) ?? (ts.isConstructorDeclaration(node) ? 'constructor' : '<anonymous>');
      functions.set(node, { name, file: project.fileId(source.fileName), module,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
      const symbol = named && project.checker.getSymbolAtLocation(named);
      if (symbol) symbols.set(symbol, node);
    }
    ts.forEachChild(node, child => { pending.push(child); });
  }
}

function callTarget(project: ProjectModel, node: ts.CallExpression | ts.NewExpression,
  functions: ReadonlyMap<ts.Node, FunctionNode>, symbols: ReadonlyMap<ts.Symbol, ts.Node>) {
  const declaration = project.checker.getResolvedSignature(node)?.declaration;
  if (declaration && functions.has(declaration)) return declaration;
  const referenced = project.checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node.expression)
    ? node.expression.name : node.expression);
  if (!referenced) return undefined;
  const symbol = referenced.flags & ts.SymbolFlags.Alias ? project.checker.getAliasedSymbol(referenced) : referenced;
  return symbols.get(symbol);
}

function collectCalls(project: ProjectModel, owner: ts.Node, functions: ReadonlyMap<ts.Node, FunctionNode>,
  symbols: ReadonlyMap<ts.Symbol, ts.Node>, edges: Set<ts.Node>, positions: Map<ts.Node, number>) {
  if (!hasImplementation(owner)) return;
  const pending: ts.Node[] = [owner.body, ...owner.parameters];
  while (pending.length) {
    const node = pending.pop()!;
    if (functions.has(node)) continue;
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const target = callTarget(project, node, functions, symbols);
      if (target) {
        edges.add(target);
        const line = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;
        positions.set(target, Math.min(positions.get(target) ?? Infinity, line));
      }
    }
    ts.forEachChild(node, child => { pending.push(child); });
  }
}

function populateCallers(edges: FunctionCallGraph['edges'], callers: Map<ts.Node, ts.Node[]>) {
  for (const [node, targets] of edges) {
    for (const target of targets) callers.get(target)!.push(node);
  }
}

function hasImplementation(node: ts.Node): node is ts.FunctionLikeDeclaration & { body: ts.ConciseBody } {
  return ts.isFunctionLike(node) && 'body' in node && Boolean(node.body);
}
