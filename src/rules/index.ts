import { functionCyclesRule, functionGenerationGapRule } from './functionCalls';
import { uniqueRules, type HyperlintRule } from './contracts';
import type { ProjectModel, StructuralModel } from '../project';
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

/** Repository policy: runs once per analysis root, whatever languages it holds. */
export const repositoryRules: readonly HyperlintRule<StructuralModel>[] = [agentInstructionsRule];

/** Module-structure rules: run on every language model. */
export const structuralRules: readonly HyperlintRule<StructuralModel>[] = [
  dependencyCyclesRule,
  publicSurfaceRule,
  publicSurfaceLimitRule,
  moduleEntrypointRule,
  moduleFileLimitRule,
  singlePublicMethodRule,
  moduleCouplingRule,
];

/** Rules that need TypeScript compiler evidence or web styling policy. */
export const typescriptRules: readonly HyperlintRule<ProjectModel>[] = [
  functionCyclesRule,
  functionGenerationGapRule,
  deadImplementationRule,
  moduleCohesionRule,
  noCssFilesRule,
  noInlineStylesRule,
  colorFileLimitRule,
  exactDuplicatesRule,
  nearDuplicatesRule,
];

export const rules: readonly HyperlintRule[] = uniqueRules([...repositoryRules, ...structuralRules, ...typescriptRules]);

export { analyzeColorFiles, colorFileLimitRule } from './colorFileLimit';
export { deadImplementationRule } from './deadImplementation';
export { moduleCohesionRule } from './moduleCohesion';
export { nearDuplicatesRule } from './nearDuplicates';
export { noInlineStylesRule } from './noInlineStyles';
