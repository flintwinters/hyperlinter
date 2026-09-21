import type { HyperlintRule } from './Rule';
import { dependencyCyclesRule } from './dependencyCycles';
import { moduleCouplingRule } from './moduleCoupling';
import { publicSurfaceRule } from './publicSurface';
import { exactDuplicatesRule } from './exactDuplicates';

export const rules: readonly HyperlintRule[] = [dependencyCyclesRule, publicSurfaceRule, moduleCouplingRule, exactDuplicatesRule];
