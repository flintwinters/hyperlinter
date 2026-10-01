import path from 'node:path';
import ts from 'typescript';

import type { HyperlinterConfig } from '../config/HyperlinterConfig';
import type { ProjectModel } from '../project/ProjectModel';
import type { HyperlintRule } from './Rule';

type Implementation = ts.FunctionDeclaration | ts.VariableDeclaration;

export const deadImplementationRule: HyperlintRule = {
  id: 'HL114',
  analyze(project: ProjectModel, config: HyperlinterConfig) {
    const files = project.getModules().flatMap((module) => module.sourceFiles)
      .filter((file) => !file.isDeclarationFile);
    const implementations = new Map<ts.Symbol, Implementation>();
    const owners = new Map<ts.Node, ts.Symbol>();
    const live = new Set<ts.Symbol>();
    const edges = new Map<ts.Symbol, Set<ts.Symbol>>();
    const resolve = (symbol: ts.Symbol): ts.Symbol => symbol.flags & ts.SymbolFlags.Alias
      ? project.checker.getAliasedSymbol(symbol) : symbol;

    for (const file of files) {
      for (const statement of file.statements) {
        const candidates = ts.isFunctionDeclaration(statement) && statement.body ? [statement]
          : ts.isVariableStatement(statement) ? statement.declarationList.declarations.filter((declaration) =>
            declaration.initializer && (ts.isArrowFunction(declaration.initializer)
              || ts.isFunctionExpression(declaration.initializer))) : [];
        for (const declaration of candidates) {
          if (!declaration.name || !ts.isIdentifier(declaration.name)) continue;
          const symbol = project.checker.getSymbolAtLocation(declaration.name);
          if (!symbol) continue;
          implementations.set(symbol, declaration);
          owners.set(declaration, symbol);
          edges.set(symbol, new Set());
        }
      }
    }

    for (const file of files) {
      // Exports are possible package/framework entrypoints. Without an explicit
      // execution-root contract, lack of in-project consumers cannot prove death.
      const module = project.checker.getSymbolAtLocation(file);
      if (module) for (const exported of project.checker.getExportsOfModule(module)) live.add(resolve(exported));
      const visit = (node: ts.Node, owner?: ts.Symbol): void => {
        owner = owners.get(node) ?? owner;
        if (ts.isIdentifier(node)) {
          const symbol = ts.isShorthandPropertyAssignment(node.parent)
            ? project.checker.getShorthandAssignmentValueSymbol(node.parent)
            : project.checker.getSymbolAtLocation(node);
          if (symbol && !symbol.declarations?.some((declaration) => 'name' in declaration && declaration.name === node)) {
            const target = resolve(symbol);
            if (implementations.has(target)) {
              if (owner) edges.get(owner)!.add(target);
              else live.add(target);
            }
          }
        }
        ts.forEachChild(node, (child) => visit(child, owner));
      };
      visit(file);
    }
    const pending = [...live];
    while (pending.length) {
      for (const target of edges.get(pending.pop()!) ?? []) {
        if (!live.has(target)) { live.add(target); pending.push(target); }
      }
    }
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
