import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { semanticConfig, type SemanticConfig } from './SemanticConfig';

import type { DiagnosticSeverity } from '../diagnostics';
import { fraction, isObject, nonNegativeInteger, positiveInteger, positiveNumber, severity, unitInterval } from './validation';

const ruleNames = ['dependencyCycles', 'deadImplementation', 'moduleCohesion', 'unusedPublicSurface', 'couplingOutliers',
  'exactDuplicates', 'nearDuplicates', 'publicSurfaceGrowth', 'publicSurfaceLimit', 'moduleEntrypoint',
  'singlePublicMethod', 'noCssFiles', 'noInlineStyles', 'moduleScore', 'moduleFileLimit'] as const;

type Validator = (value: unknown, fileName: string, key: string) => number;

/** One table owns both the numeric configuration shape and its validation. */
const numericSections = {
  clones: { exactMinimumMeaningfulNodes: positiveInteger, nearMinimumMeaningfulNodes: positiveInteger,
    nearMinimumSimilarity: fraction, nearMinimumClusterMethods: positiveInteger, nearMinimumSharedSubtreeHashes: positiveInteger },
  coupling: { minimumOutlierValue: positiveInteger, minimumZScore: positiveNumber },
  moduleFiles: { maximum: positiveInteger },
  cohesion: { minimumExports: positiveInteger, minimumGroupExports: positiveInteger,
    minimumSeparatedPairRatio: fraction, maximumConsumerOverlap: unitInterval },
  publicSurface: { maximum: positiveInteger },
  chronolint: { window: positiveInteger, maximumFiles: positiveInteger, minimumObservations: positiveInteger,
    minimumShared: positiveInteger, minimumRate: fraction, minimumLift: positiveNumber },
} satisfies Record<string, Record<string, Validator>>;

export type ChronolintConfig = NumericSections['chronolint'];

type NumericSections = { readonly [S in keyof typeof numericSections]: { readonly [K in keyof (typeof numericSections)[S]]: number } };

export type HyperlinterConfig = NumericSections & {
  readonly semantic: SemanticConfig;
  readonly rules: Readonly<Record<(typeof ruleNames)[number], DiagnosticSeverity>>;
  readonly scoring: {
    readonly severityWeights: Readonly<Record<Exclude<DiagnosticSeverity, 'warning'>, number>>;
    readonly moduleErrorThreshold: number;
  };
};

/** Loads versioned engine policy from the Hyperlinter root, never target-project policy. */
export function loadHyperlinterConfig(root = hyperlinterRoot()): HyperlinterConfig {
  const fileName = path.join(root, 'hyperlinter.config.json');
  if (!fs.existsSync(fileName)) throw new Error(`Missing Hyperlinter configuration: ${fileName}`);
  const value = JSON.parse(fs.readFileSync(fileName, 'utf8')) as unknown;
  return validateConfig(value, fileName);
}

/** A conventional submodule or working-directory config wins; otherwise use the running installation. */
function hyperlinterRoot(): string {
  const candidates = [path.resolve('tools/hyperlint'), process.cwd(), fileURLToPath(new URL('../..', import.meta.url))];
  return candidates.find((root) => fs.existsSync(path.join(root, 'hyperlinter.config.json'))) ?? process.cwd();
}

function section<T extends Record<string, Validator>>(
  value: unknown, validators: T, fileName: string, name: string,
): { readonly [K in keyof T]: number } {
  if (!isObject(value)) throw new Error(`${fileName}: ${name} must be an object.`);
  return Object.fromEntries(Object.entries(validators).map(([key, validate]) => [key, validate(value[key], fileName, `${name}.${key}`)])) as { [K in keyof T]: number };
}

function validateConfig(value: unknown, fileName: string): HyperlinterConfig {
  if (!isObject(value) || !isObject(value.rules) || !isObject(value.scoring)) {
    throw new Error(`Invalid Hyperlinter configuration: ${fileName}`);
  }
  const { rules, scoring } = value;
  return {
    semantic: semanticConfig(value.semantic),
    rules: Object.fromEntries(ruleNames.map((name) => [name, severity(rules[name], fileName, `rules.${name}`)])) as HyperlinterConfig['rules'],
    ...Object.fromEntries(Object.entries(numericSections).map(([name, validators]) => [name, section(value[name], validators, fileName, name)])) as NumericSections,
    scoring: {
      severityWeights: section(scoring.severityWeights, { error: nonNegativeInteger, smell: nonNegativeInteger, info: nonNegativeInteger },
        fileName, 'scoring.severityWeights'),
      moduleErrorThreshold: positiveInteger(scoring.moduleErrorThreshold, fileName, 'scoring.moduleErrorThreshold'),
    },
  };
}
