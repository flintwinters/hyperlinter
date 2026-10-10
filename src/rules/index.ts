import { uniqueRules, type HyperlintRule } from './contracts';
import { moduleCohesionRule } from './moduleCohesion';
import { deadImplementationRule } from './deadImplementation';
import { agentInstructionsRule } from './agentInstructions';
import {
  dependencyCyclesRule, moduleCouplingRule, moduleFileLimitRule, moduleEntrypointRule,
  publicSurfaceRule, publicSurfaceLimitRule, singlePublicMethodRule,
} from './structural';

import { noCssFilesRule } from './noCssFiles';
import { noInlineStylesRule } from './noInlineStyles';
import { colorFileLimitRule } from './colorFileLimit';

import { exactDuplicatesRule } from './exactDuplicates';
import { nearDuplicatesRule } from './nearDuplicates';

export const rules: readonly HyperlintRule[] = uniqueRules([
  deadImplementationRule,
  moduleCohesionRule,
  agentInstructionsRule,
  dependencyCyclesRule,
  publicSurfaceRule,
  publicSurfaceLimitRule,
  moduleEntrypointRule,
  moduleFileLimitRule,
  singlePublicMethodRule,
  noCssFilesRule,
  noInlineStylesRule,
  colorFileLimitRule,
  moduleCouplingRule,
  exactDuplicatesRule,
  nearDuplicatesRule,
]);

export { analyzeColorFiles, colorFileLimitRule } from './colorFileLimit';
export { deadImplementationRule } from './deadImplementation';
export { moduleCohesionRule } from './moduleCohesion';
