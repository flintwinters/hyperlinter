import fs from 'node:fs';
import ts from 'typescript';

import type { ProjectModule, ProjectModel, PublicSymbol } from '../project/ProjectModel';

interface PrivateExportFix {
  fileName: string;
  start: number;
  end: number;
  module: string;
  symbol: string;
}

function modifierOwner(declaration: ts.Declaration): ts.Node | undefined {
  if (ts.isVariableDeclaration(declaration)) {
    const statement = declaration.parent.parent;
    return ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1
      ? statement
      : undefined;
  }
  return ts.canHaveModifiers(declaration) ? declaration : undefined;
}

function singleDeclaration(symbol: PublicSymbol): ts.Declaration | undefined {
  const declarations = symbol.symbol.declarations;
  return declarations?.length === 1 ? declarations[0] : undefined;
}

function directExportModifier(declaration: ts.Declaration): ts.Modifier | undefined {
  const owner = modifierOwner(declaration);
  if (!owner || !ts.canHaveModifiers(owner)) return undefined;
  const modifiers = ts.getModifiers(owner);
  if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) return undefined;
  return modifiers?.find((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function directUnusedExport(module: ProjectModule, symbol: PublicSymbol): PrivateExportFix | undefined {
  // Re-exports, overloads, and multi-variable statements need a semantic edit,
  // not removal of one shared `export` token. Leave those decisions to people.
  if (symbol.name === 'default') return undefined;
  const declaration = singleDeclaration(symbol);
  if (!declaration) return undefined;
  if (declaration.getSourceFile() !== module.sourceFile) return undefined;
  const exportModifier = directExportModifier(declaration);
  if (!exportModifier) return undefined;
  let end = exportModifier.getEnd();
  while (module.sourceFile.text[end] === ' ' || module.sourceFile.text[end] === '\t') end += 1;
  return {
    fileName: module.sourceFile.fileName,
    start: exportModifier.getStart(module.sourceFile),
    end,
    module: module.id,
    symbol: symbol.name,
  };
}

/**
 * Finds exports proven private within the analyzed project. A module with no
 * in-project dependents may be a framework or package entrypoint, so it is
 * deliberately never rewritten.
 */
export function privateUnusedExportFixes(project: ProjectModel): readonly PrivateExportFix[] {
  return project.getModules().flatMap((module) => {
    if (project.getDependents(module).length === 0) return [];
    return project.getPublicSurface(module)
      .filter((symbol) => symbol.externalReferences === 0)
      .flatMap((symbol) => {
        const fix = directUnusedExport(module, symbol);
        return fix ? [fix] : [];
      });
  });
}

export function applyPrivateUnusedExportFixes(project: ProjectModel): readonly PrivateExportFix[] {
  const fixes = privateUnusedExportFixes(project);
  const fixesByFile = new Map<string, PrivateExportFix[]>();
  for (const fix of fixes) {
    const fileFixes = fixesByFile.get(fix.fileName) ?? [];
    fileFixes.push(fix);
    fixesByFile.set(fix.fileName, fileFixes);
  }
  for (const [fileName, fileFixes] of fixesByFile) {
    let source = fs.readFileSync(fileName, 'utf8');
    for (const fix of fileFixes.sort((left, right) => right.start - left.start))
      source = `${source.slice(0, fix.start)}${source.slice(fix.end)}`;
    fs.writeFileSync(fileName, source);
  }
  return fixes;
}
