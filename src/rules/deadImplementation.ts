import path from 'node:path';
import ts from 'typescript';

import type { HyperlinterConfig } from '../config/HyperlinterConfig';
import type { ProjectModel } from '../project/ProjectModel';
import type { HyperlintRule } from './contracts/index';

type Implementation = ts.FunctionDeclaration | ts.VariableDeclaration;

function candidateImplementations(statement: ts.Statement): readonly Implementation[] {
  if (ts.isFunctionDeclaration(statement) && statement.body) return [statement];
  if (!ts.isVariableStatement(statement)) return [];
  return statement.declarationList.declarations.filter((declaration) =>
    declaration.initializer && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)));
}

function collectImplementations(project: ProjectModel, files: readonly ts.SourceFile[]): Map<ts.Symbol, Implementation> {
  const implementations = new Map<ts.Symbol, Implementation>();
  for (const file of files) {
    for (const statement of file.statements) {
      for (const declaration of candidateImplementations(statement)) {
        if (!declaration.name || !ts.isIdentifier(declaration.name)) continue;
        const symbol = project.checker.getSymbolAtLocation(declaration.name);
        if (symbol) implementations.set(symbol, declaration);
      }
    }
  }
  return implementations;
}

function markReachable(live: Set<ts.Symbol>, edges: ReadonlyMap<ts.Symbol, ReadonlySet<ts.Symbol>>): void {
  const pending = [...live];
  while (pending.length) {
    for (const target of edges.get(pending.pop()!) ?? []) {
      if (!live.has(target)) { live.add(target); pending.push(target); }
    }
  }
}

export const deadImplementationRule: HyperlintRule = {
  id: 'HL114',
  analyze(project: ProjectModel, config: HyperlinterConfig) {
    const files = project.getModules().flatMap((module) => module.sourceFiles)
      .filter((file) => !file.isDeclarationFile);
    const implementations = collectImplementations(project, files);
    const owners = new Map<ts.Node, ts.Symbol>([...implementations].map(([symbol, declaration]) => [declaration, symbol]));
    const live = new Set<ts.Symbol>();
    const edges = new Map<ts.Symbol, Set<ts.Symbol>>([...implementations.keys()].map((symbol) => [symbol, new Set()]));
    const resolve = (symbol: ts.Symbol): ts.Symbol => symbol.flags & ts.SymbolFlags.Alias
      ? project.checker.getAliasedSymbol(symbol) : symbol;

    for (const file of files) {
      // Exports are possible package/framework entrypoints. Without an explicit
      // execution-root contract, lack of in-project consumers cannot prove death.
      const module = project.checker.getSymbolAtLocation(file);
      if (module) for (const exported of project.checker.getExportsOfModule(module)) live.add(resolve(exported));
      const visit = (node: ts.Node, owner?: ts.Symbol): void => {
        owner = owners.get(node) ?? owner;
        if (ts.isIdentifier(node)) {
          const target = project.getReferencedSymbol(node);
          if (target && implementations.has(target)) {
            if (owner) edges.get(owner)!.add(target);
            else live.add(target);
          }
        }
        ts.forEachChild(node, (child) => visit(child, owner));
      };
      visit(file);
    }
    markReachable(live, edges);
    return [...implementations].filter(([symbol]) => !live.has(symbol)).map(([symbol, declaration]) => {
      const file = declaration.getSourceFile();
      return {
        rule: 'HL114', severity: config.rules.deadImplementation,
        module: project.getModuleIdForFile(file.fileName),
        file: path.relative(project.getRootDir(), file.fileName).split(path.sep).join('/'),
        line: file.getLineAndCharacterOfPosition(declaration.getStart()).line + 1,
        message: `Dead implementation ${symbol.getName()}: unreachable from exports or code outside candidate implementations.`,
      };
    });
  },
};
