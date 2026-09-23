import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import ts from 'typescript';

interface SourceBudgetCheckpoint {
  readonly threshold: number;
}

interface SourceBudgetLedger {
  readonly version: number;
  readonly sourceDirectories: readonly string[];
  readonly extensions: readonly string[];
  readonly growthIncrement: number;
  readonly requiredRefactorReduction: number;
  readonly checkpoints: readonly SourceBudgetCheckpoint[];
  currentThresholdOverride?: number;
}

function sourceBudgetError(message: string): never {
  throw new Error(`Source-line budget: ${message}`);
}

function git(root: string, args: readonly string[]): string {
  try {
    return execFileSync('git', ['-c', `safe.directory=${root}`, ...args], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return sourceBudgetError(`unable to run git ${args.join(' ')}`);
  }
}

function readLedger(root: string): SourceBudgetLedger {
  const ledgerPath = resolve(root, 'source-line-budget.json');
  let ledger: unknown;
  try {
    ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  } catch {
    return sourceBudgetError('could not read source-line-budget.json');
  }
  if (!isLedger(ledger)) return sourceBudgetError('source-line-budget.json has an unsupported shape');
  return ledger;
}

function isLedger(value: unknown): value is SourceBudgetLedger {
  if (!isObject(value)) return false;
  return hasLedgerFields(value) && hasValidOverride(value);
}

function hasLedgerFields(value: Record<string, unknown>): boolean {
  return value.version === 1
    && stringArray(value.sourceDirectories)
    && stringArray(value.extensions)
    && Array.isArray(value.checkpoints)
    && value.checkpoints.length > 0
    && value.checkpoints.every(isObject)
    && positiveInteger(value.growthIncrement)
    && positiveInteger(value.requiredRefactorReduction);
}

function hasValidOverride(value: Record<string, unknown>): boolean {
  return value.currentThresholdOverride === undefined || nonNegativeInteger(value.currentThresholdOverride);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Counts physical lines containing TypeScript scanner tokens, excluding trivia. */
export function meaningfulLineCount(source: string, extension: string): number {
  const normalizedSource = source.replace(/\r\n?/g, '\n');
  const lineStarts = [0];
  for (let index = 0; index < normalizedSource.length; index += 1) {
    if (normalizedSource[index] === '\n') lineStarts.push(index + 1);
  }

  const lineAt = (position: number): number => {
    let low = 0;
    let high = lineStarts.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (lineStarts[middle] <= position) low = middle;
      else high = middle;
    }
    return low;
  };
  const countedLines = new Set<number>();
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    extension === '.tsx' || extension === '.jsx' ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
    normalizedSource,
  );
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    const start = scanner.getTokenPos();
    const end = scanner.getTextPos();
    for (let line = lineAt(start); line <= lineAt(end - 1); line += 1) countedLines.add(line);
  }
  return countedLines.size;
}

function authoredSourceLineCount(root: string, ledger: SourceBudgetLedger): number {
  let total = 0;
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile() && ledger.extensions.includes(entry.name.slice(entry.name.lastIndexOf('.')))) {
        total += meaningfulLineCount(readFileSync(entryPath, 'utf8'), entry.name.slice(entry.name.lastIndexOf('.')));
      }
    }
  };
  for (const directory of ledger.sourceDirectories) {
    const directoryPath = resolve(root, directory);
    if (!statSync(directoryPath).isDirectory()) sourceBudgetError(`${directory} is not a source directory`);
    visit(directoryPath);
  }
  return total;
}

function currentBudget(ledger: SourceBudgetLedger) {
  const checkpoint = ledger.checkpoints.at(-1);
  if (!nonNegativeInteger(checkpoint?.threshold)) sourceBudgetError('latest checkpoint is invalid');
  const threshold = ledger.currentThresholdOverride ?? checkpoint.threshold + ledger.growthIncrement;
  return {
    threshold,
    refactorTarget: threshold - ledger.requiredRefactorReduction,
    requiredReduction: ledger.requiredRefactorReduction,
  };
}

function check(root: string, ledger: SourceBudgetLedger): void {
  const total = authoredSourceLineCount(root, ledger);
  const budget = currentBudget(ledger);
  if (total < budget.threshold) {
    process.stdout.write(`Source-line budget: ${total}/${budget.threshold} lines (${budget.threshold - total} remaining).\n`);
    return;
  }
  sourceBudgetError(
    `The project has ${total.toLocaleString()} authored source lines, reaching the ${budget.threshold.toLocaleString()}-line checkpoint. ` +
    `Refactor it down to ${budget.refactorTarget.toLocaleString()} lines or fewer ` +
    `(a ${budget.requiredReduction.toLocaleString()}-line reduction from this checkpoint) ` +
    'as part of this task’s acceptance criteria. Do not treat this as separate or follow-up work: ' +
    'reduce the repository before reporting the task complete. Prefer static analysis to intelligently ' +
    'and deterministically find duplicated logic that can be reused or centralized. ' +
    'Dynamic/manual/non-static analysis and reduction is permitted.',
  );
}

function advance(root: string, ledger: SourceBudgetLedger): void {
  if (git(root, ['status', '--porcelain'])) {
    sourceBudgetError('record threshold reach and advance only from a clean committed worktree');
  }
  const budget = currentBudget(ledger);
  const total = authoredSourceLineCount(root, ledger);
  if (total > budget.refactorTarget) {
    sourceBudgetError(`refactor target is ${budget.refactorTarget} lines or fewer; current total is ${total}.`);
  }
  const checkpoint = {
    threshold: budget.threshold, commit: git(root, ['rev-parse', 'HEAD']), timestamp: new Date().toISOString(),
  };
  const nextLedger = { ...ledger, checkpoints: [...ledger.checkpoints, checkpoint] };
  delete nextLedger.currentThresholdOverride;
  writeFileSync(resolve(root, 'source-line-budget.json'), `${JSON.stringify(nextLedger, null, 2)}\n`);
  process.stdout.write(`Source-line budget: advanced past checkpoint ${budget.threshold} after refactoring to ${total} lines.\n`);
}

export function runSourceBudget(command: string | undefined, root = process.cwd()): void {
  const ledger = readLedger(root);
  if (command === 'check') check(root, ledger);
  else if (command === 'advance') advance(root, ledger);
  else if (command === 'advance-if-pending') {
    if (ledger.currentThresholdOverride === undefined) process.stdout.write('Source-line budget: no checkpoint is pending.\n');
    else advance(root, ledger);
  } else sourceBudgetError('use check, advance, or advance-if-pending');
}
