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
  const sources = project.getModules().flatMap(module => module.sourceFiles
    .filter(file => !file.isDeclarationFile).map(source => ({ source, module: module.id })));
  for (const { source, module } of sources) {
    const pending: ts.Node[] = [source];
    while (pending.length) {
      const node = pending.pop()!;
      if (ts.isFunctionLike(node) && 'body' in node && node.body) {
        const named = node.name ?? (ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent)
          || ts.isPropertyDeclaration(node.parent) ? node.parent.name : undefined);
        const name = named?.getText(source) ?? (ts.isConstructorDeclaration(node) ? 'constructor' : '<anonymous>');
        functions.set(node, { name, file: project.fileId(source.fileName),
          module,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
        const symbol = named && project.checker.getSymbolAtLocation(named);
        if (symbol) symbols.set(symbol, node);
      }
      ts.forEachChild(node, child => { pending.push(child); });
    }
  }
  const edges = new Map<ts.Node, Set<ts.Node>>([...functions.keys()].map(node => [node, new Set()]));
  const sites = new Map<ts.Node, Map<ts.Node, number>>([...functions.keys()].map(node => [node, new Map()]));
  for (const owner of functions.keys()) {
    if (!ts.isFunctionLike(owner) || !('body' in owner) || !owner.body) continue;
    const pending: ts.Node[] = [owner.body, ...owner.parameters];
    while (pending.length) {
      const node = pending.pop()!;
      if (node !== owner && functions.has(node)) continue;
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const declaration = project.checker.getResolvedSignature(node)?.declaration;
        const referenced = project.checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name : node.expression);
        const symbol = referenced && (referenced.flags & ts.SymbolFlags.Alias
          ? project.checker.getAliasedSymbol(referenced) : referenced);
        const target = declaration && functions.has(declaration) ? declaration : symbol && symbols.get(symbol);
        if (target) {
          edges.get(owner)!.add(target);
          const positions = sites.get(owner)!;
          const line = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;
          positions.set(target, Math.min(positions.get(target) ?? Infinity, line));
        }
      }
      ts.forEachChild(node, child => { pending.push(child); });
    }
  }
  const graph = { functions, edges, sites };
  graphs.set(project, graph);
  return graph;
}

/** Leaves are generation zero. Cycles and callers reaching them have no finite generation. */
export function functionGenerations(graph: FunctionCallGraph): Map<ts.Node, { depth: number; next?: ts.Node }> {
  const generations = new Map<ts.Node, { depth: number; next?: ts.Node }>();
  const remaining = new Map([...graph.edges].map(([node, targets]) => [node, targets.size]));
  const callers = new Map<ts.Node, ts.Node[]>([...graph.edges.keys()].map(node => [node, []]));
  for (const [node, targets] of graph.edges) for (const target of targets) callers.get(target)!.push(node);
  const queue = [...remaining].filter(([, count]) => count === 0).map(([node]) => node);
  for (const node of queue) generations.set(node, { depth: 0 });
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index];
    for (const caller of callers.get(node)!) {
      const candidate = generations.get(node)!.depth + 1;
      if (candidate > (generations.get(caller)?.depth ?? -1)) generations.set(caller, { depth: candidate, next: node });
      remaining.set(caller, remaining.get(caller)! - 1);
      if (remaining.get(caller) === 0) queue.push(caller);
    }
  }
  for (const [node, count] of remaining) if (count > 0) generations.delete(node);
  return generations;
}
