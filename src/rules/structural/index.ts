export { moduleCouplingRule } from './moduleCoupling';
export { moduleFileLimitRule } from './moduleFileLimit';

import { dependencyCyclesRule } from './dependencyCycles';
import { publicSurfaceRule } from './publicSurface';
import { publicSurfaceLimitRule } from './publicSurfaceLimit';
import { moduleEntrypointRule } from './moduleEntrypoint';
import { moduleFileLimitRule } from './moduleFileLimit';
import { singlePublicMethodRule } from './singlePublicMethod';
import { moduleCouplingRule } from './moduleCoupling';

/** Module-structure rules applied to every language model. */
export const structuralRules = [dependencyCyclesRule, publicSurfaceRule, publicSurfaceLimitRule,
  moduleEntrypointRule, moduleFileLimitRule, singlePublicMethodRule, moduleCouplingRule] as const;
