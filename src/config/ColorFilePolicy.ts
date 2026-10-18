import fs from 'node:fs';
import path from 'node:path';

import type { DiagnosticSeverity } from '../diagnostics';
import { isObject, nonNegativeInteger, severity as validateSeverity } from './validation';

export interface ColorFilePolicy {
  readonly maximum: number;
  readonly severity: Exclude<DiagnosticSeverity, 'warning'>;
  readonly sourceRoots: readonly string[];
}

/** Optional, versioned target policy; never stored in the engine's configuration. */
export function loadColorFilePolicy(root: string): ColorFilePolicy | undefined {
  const file = path.join(root, 'hyperlinter.project.json');
  if (!fs.existsSync(file)) return undefined;
  const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!isObject(value)) throw new Error(`${file}: expected an object.`);
  if (value.colorFiles === undefined) return undefined;
  return validatePolicy(value.colorFiles, file);
}

function validatePolicy(value: unknown, file: string): ColorFilePolicy {
  if (!isObject(value)) throw new Error(`${file}: colorFiles must be an object.`);
  const { maximum, severity = 'error', sourceRoots = ['.'] } = value;
  return { maximum: nonNegativeInteger(maximum, file, 'colorFiles.maximum'), severity: validateSeverity(severity, file, 'colorFiles.severity'), sourceRoots: validateRoots(sourceRoots, file) };
}

function validateRoots(value: unknown, file: string): readonly string[] {
  if (!Array.isArray(value) || !value.length || !value.every(validRoot)) {
    throw new Error(`${file}: colorFiles.sourceRoots must be nonempty, normalized project-relative directories.`);
  }
  return value;
}

function validRoot(value: unknown): value is string {
  return typeof value === 'string' && (value === '.' || (
    value.length > 0 && !value.includes('\\') && !path.posix.isAbsolute(value)
    && value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
  ));
}
