import { createHash } from 'node:crypto';
import path from 'node:path';
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
      const record = (node: ts.Node): void => {
        const normalized = printer.printNode(ts.EmitHint.Unspecified, node, sourceFile);
        const signature = createHash('sha256').update(normalized).digest('hex');
        findings.push({ file, line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1, signature });
      };
      const visit = (node: ts.Node): void => {
        if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === 'style') record(node);
        if (ts.isJsxSpreadAttribute(node) && ts.isObjectLiteralExpression(node.expression)) {
          for (const property of node.expression.properties) {
            if (isStyleProperty(property)) record(property);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }
  }
  return findings;
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
