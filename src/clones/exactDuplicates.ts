import crypto from 'node:crypto';

import ts from 'typescript';

import type { HyperlinterConfig } from '../config/HyperlinterConfig';
import type { ProjectModel } from '../project/ProjectModel';

interface ExactClone {
  readonly file: string;
  readonly first: EligibleFunction;
  readonly second: EligibleFunction;
  readonly meaningfulNodes: number;
  readonly hash: string;
  readonly differences: readonly CloneDifference[];
}

interface CloneDifference {
  readonly first: ts.Expression;
  readonly second: ts.Expression;
}

type EligibleFunction = ts.FunctionDeclaration & { readonly name: ts.Identifier; readonly body: ts.Block };

interface NormalizationState {
  readonly locals: Map<ts.Symbol, number>;
  nextLocal: number;
}

/** Finds alpha-renamed exact AST clones and anti-unifies literal differences. */
export function findExactClones(project: ProjectModel, config: HyperlinterConfig): readonly ExactClone[] {
  const clones: ExactClone[] = [];
  for (const module of project.getModules()) {
    const functions = module.sourceFile.statements.filter(isEligibleFunction);
    for (let left = 0; left < functions.length; left += 1) for (let right = left + 1; right < functions.length; right += 1) {
      const first = functions[left];
      const second = functions[right];
      const meaningfulNodes = countMeaningfulNodes(first.body);
      if (meaningfulNodes < config.clones.exactMinimumMeaningfulNodes || meaningfulNodes !== countMeaningfulNodes(second.body)) continue;
      const differences: CloneDifference[] = [];
      const matches = antiUnify(first.body, second.body, first, second, project.checker, differences);
      if (!matches) continue;
      clones.push({
        file: module.id,
        first,
        second,
        meaningfulNodes,
        hash: normalizedHash(first.body, localNormalizationState(first, project.checker), project.checker),
        differences,
      });
    }
  }
  return clones;
}

export function applyExactCloneRefactors(project: ProjectModel, config: HyperlinterConfig): readonly ExactClone[] {
  const selected = findExactClones(project, config);
  const byFile = new Map<string, ExactClone[]>();
  for (const clone of selected) {
    const existing = byFile.get(clone.first.getSourceFile().fileName) ?? [];
    if (existing.some((entry) => overlaps(clone, entry))) continue;
    existing.push(clone);
    byFile.set(clone.first.getSourceFile().fileName, existing);
  }
  for (const [fileName, clones] of byFile) {
    const source = clones[0].first.getSourceFile();
    const edits: TextEdit[] = [];
    for (const [index, clone] of clones.entries()) {
      const helper = `_hyperlintClone${index}`;
      const rendered = renderHelper(clone, helper, project.checker);
      if (!rendered) continue;
      edits.push({ start: clone.first.getFullStart(), end: clone.first.getFullStart(), text: `${rendered.helper}\n\n` });
      edits.push({ start: clone.first.body.getStart(source), end: clone.first.body.end, text: rendered.firstBody });
      edits.push({ start: clone.second.body.getStart(source), end: clone.second.body.end, text: rendered.secondBody });
    }
    if (edits.length > 0) ts.sys.writeFile(fileName, applyEdits(source.text, edits));
  }
  return [...byFile.values()].flat();
}

function isEligibleFunction(statement: ts.Statement): statement is EligibleFunction {
  return ts.isFunctionDeclaration(statement) && !!statement.name && !!statement.body
    && !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DeclareKeyword || modifier.kind === ts.SyntaxKind.AsyncKeyword)
    && !statement.asteriskToken && statement.typeParameters === undefined
    && statement.parameters.every((parameter) => ts.isIdentifier(parameter.name) && !parameter.dotDotDotToken && !parameter.questionToken && !parameter.initializer);
}

function countMeaningfulNodes(root: ts.Node): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (node.kind !== ts.SyntaxKind.Block && !ts.isIdentifier(node) && !ts.isTypeNode(node)) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(root);
  return count;
}

function normalizedHash(root: ts.Node, state: NormalizationState, checker: ts.TypeChecker): string {
  return crypto.createHash('sha256').update(normalize(root, state, checker)).digest('hex');
}

function normalize(root: ts.Node, state: NormalizationState, checker: ts.TypeChecker): string {
  const visit = (node: ts.Node): string => {
    if (ts.isIdentifier(node)) return `id:${identifierKey(node, checker, state)}`;
    if (isLiteral(node)) return `${ts.SyntaxKind[node.kind]}:${node.getText()}`;
    const children: string[] = [];
    ts.forEachChild(node, (child) => { children.push(visit(child)); });
    return `${ts.SyntaxKind[node.kind]}(${children.join(',')})`;
  };
  return visit(root);
}

function antiUnify(
  first: ts.Node,
  second: ts.Node,
  firstFunction: EligibleFunction,
  secondFunction: EligibleFunction,
  checker: ts.TypeChecker,
  differences: CloneDifference[],
): boolean {
  const firstState = localNormalizationState(firstFunction, checker);
  const secondState = localNormalizationState(secondFunction, checker);
  const visit = (left: ts.Node, right: ts.Node): boolean => {
    if (left.kind !== right.kind) return recordDifference(left, right, differences);
    if (ts.isIdentifier(left) && ts.isIdentifier(right)) return identifierKey(left, checker, firstState) === identifierKey(right, checker, secondState);
    if (isLiteral(left) && isLiteral(right)) {
      return left.getText() === right.getText() || recordDifference(left, right, differences);
    }
    const leftChildren: ts.Node[] = [];
    const rightChildren: ts.Node[] = [];
    ts.forEachChild(left, (child) => { leftChildren.push(child); });
    ts.forEachChild(right, (child) => { rightChildren.push(child); });
    if (leftChildren.length !== rightChildren.length) return recordDifference(left, right, differences);
    return leftChildren.every((child, index) => visit(child, rightChildren[index]));
  };
  return visit(first, second);
}

function recordDifference(first: ts.Node, second: ts.Node, differences: CloneDifference[]): boolean {
  if (!isLiteral(first) || !isLiteral(second)) return false;
  differences.push({ first, second });
  return true;
}

function isLiteral(node: ts.Node): node is ts.Expression {
  return ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isBigIntLiteral(node)
    || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword;
}

function identifierKey(node: ts.Identifier, checker: ts.TypeChecker, state: NormalizationState): string {
  const symbol = checker.getSymbolAtLocation(node);
  const index = symbol && state.locals.get(symbol);
  return index === undefined ? `external:${node.text}` : `local:${index}`;
}

function localNormalizationState(functionDeclaration: EligibleFunction, checker: ts.TypeChecker): NormalizationState {
  const state: NormalizationState = { locals: new Map(), nextLocal: 0 };
  const add = (name: ts.BindingName): void => {
    if (!ts.isIdentifier(name)) return;
    const symbol = checker.getSymbolAtLocation(name);
    if (symbol && !state.locals.has(symbol)) {
      state.locals.set(symbol, state.nextLocal);
      state.nextLocal += 1;
    }
  };
  functionDeclaration.parameters.forEach((parameter) => add(parameter.name));
  const visit = (node: ts.Node): void => {
    if (node !== functionDeclaration.body && ts.isFunctionLike(node)) return;
    if (ts.isVariableDeclaration(node) || ts.isBindingElement(node)) {
      if ('name' in node && node.name) add(node.name as ts.BindingName);
    }
    ts.forEachChild(node, visit);
  };
  visit(functionDeclaration.body);
  return state;
}

function overlaps(left: ExactClone, right: ExactClone): boolean {
  return left.first === right.first || left.first === right.second || left.second === right.first || left.second === right.second;
}

function renderHelper(clone: ExactClone, helper: string, checker: ts.TypeChecker): { helper: string; firstBody: string; secondBody: string } {
  const parameters = clone.first.parameters.map((parameter) => parameter.getText()).join(', ');
  const firstArguments = clone.first.parameters.map((parameter) => parameter.name.getText());
  const secondArguments = clone.second.parameters.map((parameter) => parameter.name.getText());
  const differenceParameters = clone.differences.map((difference, index) => `${helper}Value${index}: ${literalType(difference.first)}`);
  const helperParameters = [parameters, ...differenceParameters].filter(Boolean).join(', ');
  const body = replaceLiterals(clone.first.body.getText(), clone.first.body.getStart(), clone.differences.map((difference, index) => ({ node: difference.first, text: `${helper}Value${index}` })));
  const signature = checker.getSignatureFromDeclaration(clone.first)!;
  const returnsVoid = (checker.getReturnTypeOfSignature(signature).flags & ts.TypeFlags.Void) !== 0;
  const firstCall = `${helper}(${[...firstArguments, ...clone.differences.map((difference) => difference.first.getText())].join(', ')})`;
  const secondCall = `${helper}(${[...secondArguments, ...clone.differences.map((difference) => difference.second.getText())].join(', ')})`;
  return { helper: `function ${helper}(${helperParameters}) ${body}`, firstBody: `{ ${returnsVoid ? `${firstCall};` : `return ${firstCall};`} }`, secondBody: `{ ${returnsVoid ? `${secondCall};` : `return ${secondCall};`} }` };
}

function literalType(node: ts.Expression): string {
  if (ts.isStringLiteral(node)) return 'string';
  if (ts.isNumericLiteral(node)) return 'number';
  if (ts.isBigIntLiteral(node)) return 'bigint';
  if (node.kind === ts.SyntaxKind.NullKeyword) return 'null';
  return 'boolean';
}

function replaceLiterals(text: string, offset: number, replacements: readonly { node: ts.Node; text: string }[]): string {
  return applyEdits(text, replacements.map(({ node, text: replacement }) => ({ start: node.getStart() - offset, end: node.end - offset, text: replacement })));
}

interface TextEdit { start: number; end: number; text: string; }

function applyEdits(text: string, edits: readonly TextEdit[]): string {
  return [...edits].sort((left, right) => right.start - left.start).reduce((result, edit) => result.slice(0, edit.start) + edit.text + result.slice(edit.end), text);
}
