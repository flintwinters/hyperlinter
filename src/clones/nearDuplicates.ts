import crypto from 'node:crypto';

import ts from 'typescript';

import type { HyperlinterConfig } from '../config/HyperlinterConfig';
import type { ProjectModel } from '../project/ProjectModel';

type AnalyzableMethod = ts.FunctionLikeDeclarationBase & {
  readonly name: ts.Identifier;
  readonly body: ts.Block;
};

export interface NearDuplicateCluster {
  readonly methods: readonly AnalyzableMethod[];
  readonly similarity: number;
  readonly parameterized: boolean;
}

interface MethodFingerprint {
  readonly method: AnalyzableMethod;
  readonly nodes: number;
  readonly anchors: ReadonlySet<string>;
  readonly locals: ReadonlyMap<ts.Symbol, number>;
}

interface Similarity {
  readonly shared: number;
  readonly total: number;
  readonly parameterDifferences: number;
  readonly semanticDifferences: number;
}

/**
 * Uses normalized subtree hashes as an LSH-style candidate index, then confirms
 * candidates with anti-unification. Reporting requires a three-method cluster.
 */
export function findNearDuplicateClusters(project: ProjectModel, config: HyperlinterConfig): readonly NearDuplicateCluster[] {
  const methods = project.getModules().flatMap((module) => module.sourceFiles.flatMap(collectMethods));
  const fingerprints = methods
    .map((method) => fingerprint(method, project.checker))
    .filter((entry) => entry.nodes >= config.clones.nearMinimumMeaningfulNodes);
  const candidatePairs = candidatePairsFromAnchors(
    fingerprints,
    config.clones.nearMinimumSharedSubtreeHashes,
  );
  const edges: Array<{ left: number; right: number; similarity: Similarity }> = [];
  for (const [left, right] of candidatePairs) {
    const similarity = antiUnifySimilarity(
      fingerprints[left], fingerprints[right], project.checker,
    );
    if (similarity.shared / similarity.total >= config.clones.nearMinimumSimilarity
      && (similarity.shared < similarity.total || similarity.parameterDifferences > 0)) {
      edges.push({ left, right, similarity });
    }
  }
  return clustersFromEdges(fingerprints, edges, config.clones.nearMinimumClusterMethods);
}

function collectMethods(sourceFile: ts.SourceFile): AnalyzableMethod[] {
  const methods: AnalyzableMethod[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && ts.isIdentifier(node.name) && node.body) {
      methods.push(node as AnalyzableMethod);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return methods;
}

function fingerprint(method: AnalyzableMethod, checker: ts.TypeChecker): MethodFingerprint {
  const locals = localSymbols(method, checker);
  const anchors = new Set<string>();
  const visit = (node: ts.Node): string => {
    const children: string[] = [];
    ts.forEachChild(node, (child) => { children.push(visit(child)); });
    const shape = nodeShape(node, locals, checker, true, children);
    if (isMeaningful(node)) anchors.add(hash(shape));
    return shape;
  };
  visit(method.body);
  return { method, nodes: countMeaningfulNodes(method.body), anchors, locals };
}

function candidatePairsFromAnchors(
  fingerprints: readonly MethodFingerprint[],
  minimumSharedAnchors: number,
): readonly (readonly [number, number])[] {
  const methodsByAnchor = new Map<string, number[]>();
  fingerprints.forEach((fingerprint, index) => {
    for (const anchor of fingerprint.anchors) (methodsByAnchor.get(anchor) ?? methodsByAnchor.set(anchor, []).get(anchor)!).push(index);
  });
  const sharedAnchorsByPair = new Map<string, number>();
  for (const indexes of methodsByAnchor.values()) {
    for (let left = 0; left < indexes.length; left += 1) for (let right = left + 1; right < indexes.length; right += 1) {
      const pair = `${indexes[left]}:${indexes[right]}`;
      sharedAnchorsByPair.set(pair, (sharedAnchorsByPair.get(pair) ?? 0) + 1);
    }
  }
  return [...sharedAnchorsByPair]
    .filter(([, sharedAnchors]) => sharedAnchors >= minimumSharedAnchors)
    .map(([pair]) => pair.split(':').map(Number) as [number, number]);
}

function antiUnifySimilarity(
  left: MethodFingerprint,
  right: MethodFingerprint,
  checker: ts.TypeChecker,
): Similarity {
  const compare = (first: ts.Node, second: ts.Node): Similarity => {
    if (first.kind !== second.kind) return incompatibleNodes(first, second);
    if (ts.isIdentifier(first) && ts.isIdentifier(second)) {
      const matches = identifierKey(first, left.locals, checker) === identifierKey(second, right.locals, checker);
      return identifierSimilarity(matches);
    }
    if (isLiteral(first) && isLiteral(second)) {
      return literalSimilarity(first, second);
    }
    const firstChildren: ts.Node[] = [];
    const secondChildren: ts.Node[] = [];
    ts.forEachChild(first, (child) => { firstChildren.push(child); });
    ts.forEachChild(second, (child) => { secondChildren.push(child); });
    if (firstChildren.length !== secondChildren.length) return incompatibleNodes(first, second);
    return firstChildren.reduce<Similarity>((result, child, index) => addSimilarity(result, compare(child, secondChildren[index])), {
      shared: 1, total: 1, parameterDifferences: 0, semanticDifferences: 0,
    });
  };
  return compare(left.method.body, right.method.body);
}

function incompatibleNodes(first: ts.Node, second: ts.Node): Similarity {
  return {
    shared: 0,
    total: Math.max(nodeCount(first), nodeCount(second)),
    parameterDifferences: 0,
    semanticDifferences: 1,
  };
}

function identifierSimilarity(matches: boolean): Similarity {
  return {
    shared: matches ? 1 : 0,
    total: 1,
    parameterDifferences: 0,
    semanticDifferences: matches ? 0 : 1,
  };
}

function literalSimilarity(first: ts.Expression, second: ts.Expression): Similarity {
  return {
    shared: 1,
    total: 1,
    parameterDifferences: first.getText() === second.getText() ? 0 : 1,
    semanticDifferences: 0,
  };
}

function clustersFromEdges(
  fingerprints: readonly MethodFingerprint[],
  edges: readonly { left: number; right: number; similarity: Similarity }[],
  minimumClusterMethods: number,
): readonly NearDuplicateCluster[] {
  const adjacent = new Map<number, Set<number>>();
  for (const { left, right } of edges) {
    (adjacent.get(left) ?? adjacent.set(left, new Set()).get(left)!).add(right);
    (adjacent.get(right) ?? adjacent.set(right, new Set()).get(right)!).add(left);
  }
  const seen = new Set<number>();
  const clusters: NearDuplicateCluster[] = [];
  for (const index of adjacent.keys()) {
    if (seen.has(index)) continue;
    const members = connectedComponent(index, adjacent, seen).sort((left, right) => left - right);
    if (members.length < minimumClusterMethods) continue;
    const componentEdges = edges.filter(
      (edge) => members.includes(edge.left) && members.includes(edge.right),
    );
    const similarity = Math.min(...componentEdges.map((edge) => edge.similarity.shared / edge.similarity.total));
    const parameterized = componentEdges.every(
      (edge) => edge.similarity.semanticDifferences === 0 && edge.similarity.parameterDifferences > 0,
    );
    clusters.push({ methods: members.map((member) => fingerprints[member].method), similarity, parameterized });
  }
  return clusters;
}

function connectedComponent(
  start: number,
  adjacent: ReadonlyMap<number, ReadonlySet<number>>,
  seen: Set<number>,
): number[] {
  const pending = [start];
  const members: number[] = [];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    members.push(current);
    for (const neighbor of adjacent.get(current) ?? []) pending.push(neighbor);
  }
  return members;
}

function localSymbols(method: AnalyzableMethod, checker: ts.TypeChecker): ReadonlyMap<ts.Symbol, number> {
  const locals = new Map<ts.Symbol, number>();
  const add = (name: ts.BindingName): void => {
    if (!ts.isIdentifier(name)) return;
    const symbol = checker.getSymbolAtLocation(name);
    if (symbol && !locals.has(symbol)) locals.set(symbol, locals.size);
  };
  method.parameters.forEach((parameter) => add(parameter.name));
  const visit = (node: ts.Node): void => {
    if (node !== method.body && ts.isFunctionLike(node)) return;
    if (ts.isVariableDeclaration(node) || ts.isBindingElement(node)) add(node.name);
    ts.forEachChild(node, visit);
  };
  visit(method.body);
  return locals;
}

function nodeShape(
  node: ts.Node,
  locals: ReadonlyMap<ts.Symbol, number>,
  checker: ts.TypeChecker,
  normalizeLiterals: boolean,
  children: readonly string[],
): string {
  if (ts.isIdentifier(node)) return `id:${identifierKey(node, locals, checker)}`;
  if (isLiteral(node)) return normalizeLiterals ? `literal:${ts.SyntaxKind[node.kind]}` : `literal:${node.getText()}`;
  return `${ts.SyntaxKind[node.kind]}(${children.join(',')})`;
}

function identifierKey(node: ts.Identifier, locals: ReadonlyMap<ts.Symbol, number>, checker: ts.TypeChecker): string {
  const symbol = checker.getSymbolAtLocation(node);
  const local = symbol && locals.get(symbol);
  if (local !== undefined) return `local:${local}`;
  if (!symbol) return `text:${node.text}`;
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  return `symbol:${checker.getFullyQualifiedName(resolved)}`;
}

function countMeaningfulNodes(root: ts.Node): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (isMeaningful(node)) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(root);
  return count;
}

function isMeaningful(node: ts.Node): boolean {
  return node.kind !== ts.SyntaxKind.Block && !ts.isIdentifier(node) && !ts.isTypeNode(node);
}

function nodeCount(root: ts.Node): number {
  let count = 0;
  const visit = (node: ts.Node): void => { count += 1; ts.forEachChild(node, visit); };
  visit(root);
  return count;
}

function isLiteral(node: ts.Node): node is ts.Expression {
  return ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isBigIntLiteral(node)
    || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword
    || node.kind === ts.SyntaxKind.NullKeyword;
}

function addSimilarity(left: Similarity, right: Similarity): Similarity {
  return {
    shared: left.shared + right.shared,
    total: left.total + right.total,
    parameterDifferences: left.parameterDifferences + right.parameterDifferences,
    semanticDifferences: left.semanticDifferences + right.semanticDifferences,
  };
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
