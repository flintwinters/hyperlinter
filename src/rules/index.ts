import type { HyperlintRule } from './contracts/index';
import { deadImplementationRule } from './deadImplementation';
import { agentInstructionsRule } from './agentInstructions';
import { dependencyCyclesRule, moduleCouplingRule, moduleFileLimitRule, moduleEntrypointRule, publicSurfaceRule, publicSurfaceLimitRule, singlePublicMethodRule } from "./structural/index";

import { noCssFilesRule } from './noCssFiles';
import { noInlineStylesRule } from './noInlineStyles';

import { exactDuplicatesRule } from './exactDuplicates';
import { nearDuplicatesRule } from './nearDuplicates';

export const rules: readonly HyperlintRule[] = uniqueRules([
  deadImplementationRule,
  agentInstructionsRule,
  dependencyCyclesRule,
  publicSurfaceRule,
  publicSurfaceLimitRule,
  moduleEntrypointRule,
  moduleFileLimitRule,
  singlePublicMethodRule,
  noCssFilesRule,
  noInlineStylesRule,
  moduleCouplingRule,
  exactDuplicatesRule,
  nearDuplicatesRule,
]);

/** Reject ambiguous IDs where rules are registered, before analysis or recording. */
function uniqueRules(entries: readonly HyperlintRule[]): readonly HyperlintRule[] {
  const ids = new Set<string>();
  for (const rule of entries) {
    if (ids.has(rule.id)) throw new Error(`Duplicate Hyperlinter rule ID: ${rule.id}`);
    ids.add(rule.id);
  }
  return entries;
}
