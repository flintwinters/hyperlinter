import fs from 'node:fs';
import path from 'node:path';

import type { DiagnosticSeverity } from '../diagnostics';

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
  if (!Number.isInteger(maximum) || typeof maximum !== 'number' || maximum < 0) {
    throw new Error(`${file}: colorFiles.maximum must be a non-negative integer.`);
  }
  return { maximum, severity: validateSeverity(severity, file), sourceRoots: validateRoots(sourceRoots, file) };
}

function validateSeverity(value: unknown, file: string): ColorFilePolicy['severity'] {
  if (value !== 'error' && value !== 'smell' && value !== 'info') {
    throw new Error(`${file}: colorFiles.severity must be error, smell, or info.`);
  }
  return value;
}

function validateRoots(value: unknown, file: string): readonly string[] {
  if (!Array.isArray(value) || !value.length || !value.every(validRoot)) {
    throw new Error(`${file}: colorFiles.sourceRoots must be nonempty, normalized project-relative directories.`);
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validRoot(value: unknown): value is string {
  return typeof value === 'string' && (value === '.' || (
    value.length > 0 && !value.includes('\\') && !path.posix.isAbsolute(value)
    && value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
  ));
}
