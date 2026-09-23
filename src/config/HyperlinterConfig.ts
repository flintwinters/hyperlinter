import fs from 'node:fs';
import path from 'node:path';

import type { DiagnosticSeverity } from '../diagnostics/Diagnostic';

export interface HyperlinterConfig {
  readonly rules: {
    readonly dependencyCycles: DiagnosticSeverity;
    readonly unusedPublicSurface: DiagnosticSeverity;
    readonly couplingOutliers: DiagnosticSeverity;
    readonly exactDuplicates: DiagnosticSeverity;
    readonly nearDuplicates: DiagnosticSeverity;
    readonly publicSurfaceGrowth: DiagnosticSeverity;
    readonly publicSurfaceLimit: DiagnosticSeverity;
    readonly moduleEntrypoint: DiagnosticSeverity;
    readonly singlePublicMethod: DiagnosticSeverity;
    readonly noCssFiles: DiagnosticSeverity;
    readonly noInlineStyles: DiagnosticSeverity;
    readonly moduleScore: DiagnosticSeverity;
  };
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
  readonly publicSurface: {
    readonly maximum: number;
  };
  readonly scoring: {
    readonly severityWeights: Readonly<Record<DiagnosticSeverity, number>>;
    readonly moduleErrorThreshold: number;
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
  if (!isObject(value)
    || !isObject(value.rules)
    || !isObject(value.clones)
    || !isObject(value.coupling)
    || !isObject(value.publicSurface)
    || !isObject(value.scoring)) {
    throw new Error(`Invalid Hyperlinter configuration: ${fileName}`);
  }
  const rules = value.rules;
  const clones = value.clones;
  const coupling = value.coupling;
  const publicSurface = value.publicSurface;
  const scoring = value.scoring;
  if (!isObject(scoring.severityWeights)) throw new Error(`Invalid Hyperlinter configuration: ${fileName}`);
  const severityWeights = scoring.severityWeights;
  return {
    rules: {
      dependencyCycles: severity(rules.dependencyCycles, fileName, 'rules.dependencyCycles'),
      unusedPublicSurface: severity(rules.unusedPublicSurface, fileName, 'rules.unusedPublicSurface'),
      couplingOutliers: severity(rules.couplingOutliers, fileName, 'rules.couplingOutliers'),
      exactDuplicates: severity(rules.exactDuplicates, fileName, 'rules.exactDuplicates'),
      nearDuplicates: severity(rules.nearDuplicates, fileName, 'rules.nearDuplicates'),
      publicSurfaceGrowth: severity(rules.publicSurfaceGrowth, fileName, 'rules.publicSurfaceGrowth'),
      publicSurfaceLimit: severity(rules.publicSurfaceLimit, fileName, 'rules.publicSurfaceLimit'),
      moduleEntrypoint: severity(rules.moduleEntrypoint, fileName, 'rules.moduleEntrypoint'),
      singlePublicMethod: severity(rules.singlePublicMethod, fileName, 'rules.singlePublicMethod'),
      noCssFiles: severity(rules.noCssFiles, fileName, 'rules.noCssFiles'),
      noInlineStyles: severity(rules.noInlineStyles, fileName, 'rules.noInlineStyles'),
      moduleScore: severity(rules.moduleScore, fileName, 'rules.moduleScore'),
    },
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
    publicSurface: {
      maximum: positiveInteger(publicSurface.maximum, fileName, 'publicSurface.maximum'),
    },
    scoring: {
      severityWeights: {
        error: nonNegativeInteger(severityWeights.error, fileName, 'scoring.severityWeights.error'),
        smell: nonNegativeInteger(severityWeights.smell, fileName, 'scoring.severityWeights.smell'),
        info: nonNegativeInteger(severityWeights.info, fileName, 'scoring.severityWeights.info'),
      },
      moduleErrorThreshold: positiveInteger(scoring.moduleErrorThreshold, fileName, 'scoring.moduleErrorThreshold'),
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function positiveInteger(value: unknown, fileName: string, key: string): number {
  return integerAtLeast(value, 1, fileName, key, 'positive');
}

function nonNegativeInteger(value: unknown, fileName: string, key: string): number {
  return integerAtLeast(value, 0, fileName, key, 'non-negative');
}

function integerAtLeast(value: unknown, minimum: number, fileName: string, key: string, description: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new Error(`${fileName}: ${key} must be a ${description} integer.`);
  }
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

function severity(value: unknown, fileName: string, key: string): DiagnosticSeverity {
  if (value !== 'info' && value !== 'smell' && value !== 'error') throw new Error(`${fileName}: ${key} must be info, smell, or error.`);
  return value;
}
