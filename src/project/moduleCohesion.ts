import ts from 'typescript';

import type { ProjectModel, ProjectModule } from './ProjectModel';

interface CohesionGroup {
  exports: string[];
  consumers: Set<string>;
}

export interface CohesionEvidence {
  groups: CohesionGroup[];
  separatedPairRatio: number;
  consumerOverlap: number;
}

/** Types and literal constants do not establish shared behavior or state. */
function ownsBehaviorOrState(node: ts.Node): boolean {
  if (ts.isFunctionDeclaration(node)) return !!node.body;
  if (ts.isClassDeclaration(node)) return true;
  return ts.isVariableDeclaration(node) && !!node.initializer
    && (!(node.parent.flags & ts.NodeFlags.Const)
      || (!ts.isLiteralExpression(node.initializer)
        && node.initializer.kind !== ts.SyntaxKind.TrueKeyword
        && node.initializer.kind !== ts.SyntaxKind.FalseKeyword
        && node.initializer.kind !== ts.SyntaxKind.NullKeyword));
}

export function moduleCohesion(project: ProjectModel, module: ProjectModule): CohesionEvidence | undefined {
  const declarations = new Map<ts.Symbol, ts.Node>();
  for (const file of module.sourceFiles.filter((file) => !file.isDeclarationFile)) {
    for (const statement of file.statements) {
      const candidates = ts.isVariableStatement(statement) ? statement.declarationList.declarations : [statement];
      for (const node of candidates) {
        if (!ownsBehaviorOrState(node) || !('name' in node)) continue;
        const name = node.name as ts.DeclarationName | undefined;
        const symbol = name && project.checker.getSymbolAtLocation(name);
        if (symbol) declarations.set(symbol, node);
      }
    }
  }
  const edges = new Map<ts.Symbol, Set<ts.Symbol>>();
  for (const [symbol, declaration] of declarations) {
    const references = new Set<ts.Symbol>();
    const visit = (node: ts.Node): void => {
      if (ts.isTypeNode(node)) return;
      if (ts.isIdentifier(node)) {
        const target = project.getReferencedSymbol(node);
        if (target && declarations.has(target)) references.add(target);
      }
      ts.forEachChild(node, visit);
    };
    visit(declaration);
    edges.set(symbol, references);
  }
  const exports = project.getPublicSurface(module).filter((entry) => declarations.has(entry.symbol));
  if (exports.length < 2) return undefined;
  const reachable = exports.map((entry) => {
    const found = new Set<ts.Symbol>([entry.symbol]);
    const pending = [entry.symbol];
    while (pending.length) for (const target of edges.get(pending.pop()!) ?? []) {
      if (!found.has(target)) { found.add(target); pending.push(target); }
    }
    return found;
  });
  // Transitive merging prevents a bridging export from yielding an artificial split.
  const components = exports.map((_, index) => new Set([index]));
  for (let left = 0; left < exports.length; left++) for (let right = left + 1; right < exports.length; right++) {
    if (![...reachable[left]].some((symbol) => reachable[right].has(symbol))) continue;
    const first = components.find((component) => component.has(left))!;
    const second = components.find((component) => component.has(right))!;
    if (first !== second) {
      for (const index of second) first.add(index);
      components.splice(components.indexOf(second), 1);
    }
  }
  const groups = components.map((component) => ({
    exports: [...component].map((index) => exports[index].name).sort(),
    consumers: new Set([...component].flatMap((index) => project.getExternalReferences(exports[index].symbol))),
  }));
  const totalPairs = exports.length * (exports.length - 1) / 2;
  const joinedPairs = groups.reduce((sum, group) => sum + group.exports.length * (group.exports.length - 1) / 2, 0);
  let overlap = 0;
  let pairs = 0;
  for (let left = 0; left < groups.length; left++) for (let right = left + 1; right < groups.length; right++) {
    const a = groups[left].consumers;
    const b = groups[right].consumers;
    // Missing consumers are absence of evidence, not evidence of separation.
    if (!a.size || !b.size) return undefined;
    const intersection = [...a].filter((consumer) => b.has(consumer)).length;
    overlap += intersection / (a.size + b.size - intersection);
    pairs++;
  }
  return { groups, separatedPairRatio: (totalPairs - joinedPairs) / totalPairs, consumerOverlap: pairs ? overlap / pairs : 1 };
}
