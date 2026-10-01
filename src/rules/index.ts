import type { HyperlintRule } from './Rule';
import { deadImplementationRule } from './deadImplementation';
import { agentInstructionsRule } from './agentInstructions';
import { dependencyCyclesRule } from './dependencyCycles';
import { moduleCouplingRule } from './moduleCoupling';
import { moduleEntrypointRule } from './moduleEntrypoint';
import { noCssFilesRule } from './noCssFiles';
import { noInlineStylesRule } from './noInlineStyles';
import { publicSurfaceRule } from './publicSurface';
import { exactDuplicatesRule } from './exactDuplicates';
import { nearDuplicatesRule } from './nearDuplicates';
import { publicSurfaceLimitRule } from './publicSurfaceLimit';
import { singlePublicMethodRule } from './singlePublicMethod';

export const rules: readonly HyperlintRule[] = uniqueRules([
  deadImplementationRule,
  agentInstructionsRule,
  dependencyCyclesRule,
  publicSurfaceRule,
  publicSurfaceLimitRule,
  moduleEntrypointRule,
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
