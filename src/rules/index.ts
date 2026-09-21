import type { HyperlintRule } from './Rule';
import { dependencyCyclesRule } from './dependencyCycles';
import { moduleCouplingRule } from './moduleCoupling';
import { publicSurfaceRule } from './publicSurface';
import { exactDuplicatesRule } from './exactDuplicates';
import { nearDuplicatesRule } from './nearDuplicates';
import { publicSurfaceLimitRule } from './publicSurfaceLimit';

export const rules: readonly HyperlintRule[] = [
  dependencyCyclesRule,
  publicSurfaceRule,
  publicSurfaceLimitRule,
  moduleCouplingRule,
  exactDuplicatesRule,
  nearDuplicatesRule,
];
