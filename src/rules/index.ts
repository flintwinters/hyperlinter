import type { HyperlintRule } from './Rule';
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

export const rules: readonly HyperlintRule[] = [
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
];
