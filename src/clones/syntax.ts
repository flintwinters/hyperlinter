import ts from 'typescript';

/** Exact and near clone detection must agree on which nodes count toward clone size. */
export function isMeaningful(node: ts.Node): boolean {
  return node.kind !== ts.SyntaxKind.Block && !ts.isIdentifier(node) && !ts.isTypeNode(node);
}

export function countMeaningfulNodes(root: ts.Node): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (isMeaningful(node)) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(root);
  return count;
}

export function isLiteral(node: ts.Node): node is ts.Expression {
  return ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isBigIntLiteral(node)
    || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword;
}
