import type { HyperlintRule } from './Rule';
import { dependencyCyclesRule } from './dependencyCycles';
import { moduleCouplingRule } from './moduleCoupling';
import { moduleEntrypointRule } from './moduleEntrypoint';
import { publicSurfaceRule } from './publicSurface';
import { exactDuplicatesRule } from './exactDuplicates';
import { nearDuplicatesRule } from './nearDuplicates';
import { publicSurfaceLimitRule } from './publicSurfaceLimit';
import { singlePublicMethodRule } from './singlePublicMethod';

export const rules: readonly HyperlintRule[] = [
  dependencyCyclesRule,
  publicSurfaceRule,
  publicSurfaceLimitRule,
  moduleEntrypointRule,
  singlePublicMethodRule,
  moduleCouplingRule,
  exactDuplicatesRule,
  nearDuplicatesRule,
];
