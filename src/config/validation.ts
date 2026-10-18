import type { DiagnosticSeverity } from '../diagnostics';

/** Shared validators keep every configuration error in one `file: key must ...` form. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function positiveInteger(value: unknown, fileName: string, key: string): number {
  return integerAtLeast(value, 1, fileName, key, 'positive');
}

export function nonNegativeInteger(value: unknown, fileName: string, key: string): number {
  return integerAtLeast(value, 0, fileName, key, 'non-negative');
}

function integerAtLeast(value: unknown, minimum: number, fileName: string, key: string, description: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new Error(`${fileName}: ${key} must be a ${description} integer.`);
  }
  return value;
}

export function fraction(value: unknown, fileName: string, key: string): number {
  if (typeof value !== 'number' || value <= 0 || value > 1) throw new Error(`${fileName}: ${key} must be within (0, 1].`);
  return value;
}

export function positiveNumber(value: unknown, fileName: string, key: string): number {
  if (typeof value !== 'number' || value <= 0) throw new Error(`${fileName}: ${key} must be positive.`);
  return value;
}

export function severity(value: unknown, fileName: string, key: string): Exclude<DiagnosticSeverity, 'warning'> {
  if (value !== 'info' && value !== 'smell' && value !== 'error') throw new Error(`${fileName}: ${key} must be info, smell, or error.`);
  return value;
}

export function unitInterval(value: unknown, fileName: string, key: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${fileName}: ${key} must be within [0, 1].`);
  }
  return value;
}
