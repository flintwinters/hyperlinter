import fs from 'node:fs';
import path from 'node:path';

export interface HyperlinterConfig {
  readonly clones: {
    readonly exactMinimumMeaningfulNodes: number;
    readonly nearMinimumMeaningfulNodes: number;
    readonly nearMinimumSimilarity: number;
    readonly nearMinimumClusterMethods: number;
    readonly nearMinimumSharedSubtreeHashes: number;
  };
  readonly coupling: {
    readonly minimumOutlierValue: number;
    readonly minimumZScore: number;
  };
}

/** Loads versioned engine policy from the Hyperlinter root, never target-project policy. */
export function loadHyperlinterConfig(root = hyperlinterRoot()): HyperlinterConfig {
  const fileName = path.join(root, 'hyperlinter.config.json');
  if (!fs.existsSync(fileName)) throw new Error(`Missing Hyperlinter configuration: ${fileName}`);
  const value = JSON.parse(fs.readFileSync(fileName, 'utf8')) as unknown;
  return validateConfig(value, fileName);
}

function hyperlinterRoot(): string {
  const submoduleRoot = path.resolve('tools/hyperlint');
  return fs.existsSync(path.join(submoduleRoot, 'hyperlinter.config.json')) ? submoduleRoot : process.cwd();
}

function validateConfig(value: unknown, fileName: string): HyperlinterConfig {
  if (!isObject(value) || !isObject(value.clones) || !isObject(value.coupling)) throw new Error(`Invalid Hyperlinter configuration: ${fileName}`);
  const clones = value.clones;
  const coupling = value.coupling;
  return {
    clones: {
      exactMinimumMeaningfulNodes: positiveInteger(clones.exactMinimumMeaningfulNodes, fileName, 'clones.exactMinimumMeaningfulNodes'),
      nearMinimumMeaningfulNodes: positiveInteger(clones.nearMinimumMeaningfulNodes, fileName, 'clones.nearMinimumMeaningfulNodes'),
      nearMinimumSimilarity: fraction(clones.nearMinimumSimilarity, fileName, 'clones.nearMinimumSimilarity'),
      nearMinimumClusterMethods: positiveInteger(clones.nearMinimumClusterMethods, fileName, 'clones.nearMinimumClusterMethods'),
      nearMinimumSharedSubtreeHashes: positiveInteger(clones.nearMinimumSharedSubtreeHashes, fileName, 'clones.nearMinimumSharedSubtreeHashes'),
    },
    coupling: {
      minimumOutlierValue: positiveInteger(coupling.minimumOutlierValue, fileName, 'coupling.minimumOutlierValue'),
      minimumZScore: positiveNumber(coupling.minimumZScore, fileName, 'coupling.minimumZScore'),
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function positiveInteger(value: unknown, fileName: string, key: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new Error(`${fileName}: ${key} must be a positive integer.`);
  return value;
}

function fraction(value: unknown, fileName: string, key: string): number {
  if (typeof value !== 'number' || value <= 0 || value > 1) throw new Error(`${fileName}: ${key} must be within (0, 1].`);
  return value;
}

function positiveNumber(value: unknown, fileName: string, key: string): number {
  if (typeof value !== 'number' || value <= 0) throw new Error(`${fileName}: ${key} must be positive.`);
  return value;
}
