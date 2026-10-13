import path from 'node:path';

import { loadColorFilePolicy, type ColorFilePolicy } from '../config';
import type { HyperlintDiagnostic } from '../diagnostics';
import { colorLiterals, type ColorLiteral, type ProjectModel } from '../project';

import type { HyperlintRule } from './contracts';

interface ColorFile {
  readonly file: string;
  readonly literals: readonly ColorLiteral[];
}

/** A repository-wide definition budget pressures callers to import shared colors. */
export const colorFileLimitRule = {
  id: 'HL118',
  analyze(project: ProjectModel): readonly HyperlintDiagnostic[] {
    return analyzeColorFiles(project).diagnostics;
  },
} satisfies HyperlintRule;

/** Inventory and enforcement share one policy snapshot and one source traversal. */
export function analyzeColorFiles(project: ProjectModel): {
  policy: ColorFilePolicy | undefined;
  files: readonly ColorFile[];
  diagnostics: readonly HyperlintDiagnostic[];
} {
  const policy = loadColorFilePolicy(project.getRootDir());
  const files = policy ? colorFiles(project, policy) : [];
  const diagnostics = policy && files.length > policy.maximum ? files.map(({ file, literals }) => ({
    rule: 'HL118', severity: policy.severity, file, line: literals[0].line, score: files.length,
    message: `Hardcoded colors occur in ${files.length} source files; maximum is ${policy.maximum}. `
      + `Centralize color definitions. This file defines: ${[...new Set(literals.map(({ value }) => value))].join(', ')}.`,
  })) : [];
  return { policy, files, diagnostics };
}

function colorFiles(project: ProjectModel, policy: ColorFilePolicy): readonly ColorFile[] {
  return project.getModules().flatMap(({ sourceFiles }) => sourceFiles.flatMap((source) => {
    const file = path.relative(project.getRootDir(), source.fileName).split(path.sep).join('/');
    if (source.isDeclarationFile || !policy.sourceRoots.some((root) => root === '.' || file.startsWith(`${root}/`))) return [];
    const literals = colorLiterals(source);
    return literals.length ? [{ file, literals }] : [];
  })).sort((left, right) => left.file.localeCompare(right.file));
}
