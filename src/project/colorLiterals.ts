import { generate, lexer, parse, walk } from 'css-tree';
import type { CssNode, WalkContext } from 'css-tree';
import ts from 'typescript';

export interface ColorLiteral {
  readonly line: number;
  readonly value: string;
}

/** Inspect authored string values, not comments, identifiers, imports, or declaration types. */
export function colorLiterals(source: ts.SourceFile): readonly ColorLiteral[] {
  const findings: ColorLiteral[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node) || ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    const text = literalText(node);
    if (text !== undefined) {
      for (const value of cssColors(text)) {
        findings.push({ line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, value });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

function literalText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return undefined;
  // A numeric placeholder lets generated HSL channels be inspected without executing code.
  return node.head.text + node.templateSpans.map((span) => `0${span.literal.text}`).join('');
}

function cssColors(text: string): readonly string[] {
  const colors = new Set<string>();
  // Values cover arrays, JSX/SVG attributes, StyleX, and compound shadows/gradients.
  // Stylesheet parsing additionally distinguishes CSS selectors from declaration values.
  for (const context of ['value', 'stylesheet'] as const) {
    let ast: CssNode;
    try {
      ast = parse(text, { context });
    } catch {
      // Ordinary application strings are not necessarily valid CSS.
      continue;
    }
    walk(ast, {
      enter(this: WalkContext, node: CssNode) {
        if (node.type === 'Url' || node.type === 'String') return walk.skip;
        if (context === 'stylesheet' && !this.declaration) return;
        if (!['Hash', 'Identifier', 'Function'].includes(node.type)) return;
        if (node.type === 'Identifier' && ['transparent', 'currentcolor'].includes(node.name.toLowerCase())) return;
        if (lexer.matchType('color', node).matched) {
          colors.add(generate(node));
          return walk.skip;
        }
      },
    });
  }
  return [...colors].sort();
}
