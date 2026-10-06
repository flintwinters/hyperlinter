export interface SemanticConfig {
  readonly enabled: boolean;
  readonly model: string;
  readonly minimumClusterFunctions: number;
  readonly maximumWithinClusterDistance: number;
  readonly minimumClusterDistance: number;
}

/** Experimental advisory policy deliberately tolerates large, distant groups. */
export const semanticDefaults: SemanticConfig = {
  enabled: false,
  model: 'openai/text-embedding-3-small',
  minimumClusterFunctions: 8,
  maximumWithinClusterDistance: 0.25,
  minimumClusterDistance: 0.8,
};

export function semanticConfig(value: unknown): SemanticConfig {
  if (value === undefined) return semanticDefaults;
  if (typeof value !== 'object' || value === null) throw new Error('semantic must be an object.');
  const config = { ...semanticDefaults, ...value };
  validateIdentity(config);
  validateThresholds(config);
  return config;
}

function validateIdentity(config: SemanticConfig): void {
  if (typeof config.enabled !== 'boolean' || typeof config.model !== 'string' || !config.model.trim()) {
    throw new Error('semantic.enabled must be boolean and semantic.model must be a nonempty model ID.');
  }
}

function validateThresholds(config: SemanticConfig): void {
  if (!Number.isInteger(config.minimumClusterFunctions) || config.minimumClusterFunctions < 2) {
    throw new Error('semantic.minimumClusterFunctions must be an integer >= 2.');
  }
  for (const key of ['maximumWithinClusterDistance', 'minimumClusterDistance'] as const) {
    validateDistance(config[key], key);
  }
  if (config.minimumClusterDistance <= config.maximumWithinClusterDistance) {
    throw new Error('semantic.minimumClusterDistance must exceed maximumWithinClusterDistance.');
  }
}

function validateDistance(value: unknown, key: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 2) {
    throw new Error(`semantic.${key} must be within [0, 2].`);
  }
}
