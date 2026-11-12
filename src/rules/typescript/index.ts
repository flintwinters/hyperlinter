import { functionCyclesRule, functionGenerationGapRule } from '../functionCalls';
import { noCssFilesRule, noInlineStylesRule, colorFileLimitRule } from '../styling';
import { exactDuplicatesRule, nearDuplicatesRule } from '../duplicates';
import { deadImplementationRule } from './deadImplementation';
import { moduleCohesionRule } from './moduleCohesion';

/** Rules requiring TypeScript compiler evidence or web styling policy. */
export const typescriptRules = [functionCyclesRule, functionGenerationGapRule,
  deadImplementationRule, moduleCohesionRule, noCssFilesRule, noInlineStylesRule,
  colorFileLimitRule, exactDuplicatesRule, nearDuplicatesRule] as const;

export { deadImplementationRule, moduleCohesionRule };
