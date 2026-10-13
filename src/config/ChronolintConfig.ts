export interface ChronolintConfig {
  readonly window: number;
  readonly maximumFiles: number;
  readonly minimumObservations: number;
  readonly minimumShared: number;
  readonly minimumRate: number;
  readonly minimumLift: number;
}
export function chronolintConfig(value: unknown): ChronolintConfig {
  if (!value || typeof value !== 'object') throw new Error('Missing chronolint engine configuration.');
  const options = value as Record<keyof ChronolintConfig, unknown>;
  for (const key of ['window', 'maximumFiles', 'minimumObservations', 'minimumShared'] as const) {
    positiveInteger(options[key], key);
  }
  for (const key of ['minimumRate', 'minimumLift'] as const) {
    positiveFinite(options[key], key);
  }
  if (Number(options.minimumRate) > 1) throw new Error('chronolint.minimumRate must be at most one.');
  return Object.freeze({ ...options }) as unknown as ChronolintConfig;
}

function positiveInteger(value: unknown, key: string): void {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`chronolint.${key} must be a positive integer.`);
}
function positiveFinite(value: unknown, key: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    throw new Error(`chronolint.${key} must be finite and positive.`);
}
