import { createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import ts from 'typescript';

import type { ProjectModel } from './ProjectModel';

export interface InlineStyle {
  file: string;
  line: number;
  signature: string;
}

/** Stable printed syntax keeps formatting changes from consuming the legacy allowance. */
export function inlineStyles(project: ProjectModel): readonly InlineStyle[] {
  const printer = ts.createPrinter({ removeComments: true });
  const findings: InlineStyle[] = [];
  for (const module of project.getModules()) {
    for (const sourceFile of module.sourceFiles) {
      if (!sourceFile.fileName.endsWith('.tsx')) continue;
      const file = path.relative(project.getRootDir(), sourceFile.fileName).split(path.sep).join('/');
      for (const node of inlineStyleNodes(sourceFile)) {
        const normalized = printer.printNode(ts.EmitHint.Unspecified, node, sourceFile);
        const signature = createHash('sha256').update(normalized).digest('hex');
        findings.push({ file, line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1, signature });
      }
    }
  }
  return findings.concat(htmlStyles(project));
}

/** Share the exact detection boundary with migration tools; never change allowances here. */
export function inlineStyleNodes(sourceFile: ts.SourceFile): readonly ts.Node[] {
  const nodes: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === 'style') nodes.push(node);
    if (ts.isJsxSpreadAttribute(node) && ts.isObjectLiteralExpression(node.expression)) {
      nodes.push(...node.expression.properties.filter(isStyleProperty));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return nodes;
}

function isStyleProperty(property: ts.ObjectLiteralElementLike): boolean {
  if (!('name' in property) || !property.name) return false;
  return (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === 'style';
}

export type InlineStyleBaseline = Record<string, Record<string, number>>;

export function inlineStyleBaseline(findings: readonly InlineStyle[]): InlineStyleBaseline {
  const baseline: InlineStyleBaseline = {};
  for (const { file, signature } of findings) {
    const signatures = baseline[file] ?? (baseline[file] = {});
    signatures[signature] = (signatures[signature] ?? 0) + 1;
  }
  return baseline;
}

/** Allow only the exact legacy expressions and multiplicities recorded at migration. */
export function newInlineStyles<T extends InlineStyle>(
  findings: readonly T[],
  baseline: InlineStyleBaseline = {},
): readonly T[] {
  const remaining = structuredClone(baseline);
  return findings.filter(({ file, signature }) => {
    const count = remaining[file]?.[signature] ?? 0;
    if (count === 0) return true;
    remaining[file][signature] = count - 1;
    return false;
  });
}

/** Templates beside/below configured source modules share their styling policy.
 * Scan HTML as markup: comments and raw-text elements are not executable tags.
 */
function htmlStyles(project: ProjectModel): InlineStyle[] {
  const findings: InlineStyle[] = [], visited = new Set<string>();
  const visit = (directory: string): void => {
    if (visited.has(directory)) return;
    visited.add(directory);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory() && !['node_modules', '.git', 'dist', 'build', 'coverage', 'runtime'].includes(entry.name)) visit(file);
      else if (entry.isFile() && /\.html?$/i.test(entry.name)) {
        const text = fs.readFileSync(file, 'utf8');
        for (const { offset, syntax } of htmlStyleSyntax(text)) findings.push({
          file: path.relative(project.getRootDir(), file).split(path.sep).join('/'),
          line: text.slice(0, offset).split('\n').length,
          signature: createHash('sha256').update(syntax).digest('hex'),
        });
      }
    }
  };
  for (const module of project.getModules()) for (const file of module.sourceFiles) visit(path.dirname(file.fileName));
  return findings.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
}
function htmlStyleSyntax(text: string): { offset: number; syntax: string }[] {
  const findings: { offset: number; syntax: string }[] = [];
  const tags = /<!--[\s\S]*?-->|<(?:"[^"]*"|'[^']*'|[^'">])*>/g;
  let match: RegExpExecArray | null;
  while ((match = tags.exec(text))) {
    const opening = /^<([a-z][\w:-]*)([\s\S]*)>$/i.exec(match[0]);
    if (!opening) continue;
    const name = opening[1].toLowerCase();
    const attributes = /(?:^|\s)([^\s=\/<>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
    for (const attribute of opening[2].matchAll(attributes)) {
      if (attribute[1].toLowerCase() === 'style') findings.push({ offset: match.index, syntax: `${name}:style:${attribute[2] ?? ''}` });
    }
    if (['script', 'style', 'textarea', 'title'].includes(name)) {
      const closing = new RegExp(`</${name}\\s*>`, 'gi');
      closing.lastIndex = tags.lastIndex;
      const end = closing.exec(text);
      const limit = end ? closing.lastIndex : text.length;
      if (name === 'style') findings.push({ offset: match.index, syntax: text.slice(match.index, limit) });
      tags.lastIndex = limit;
    }
  }
  return findings;
}
