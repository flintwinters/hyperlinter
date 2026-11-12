import { uniqueRules } from './contracts';
import { repositoryRules } from './repository';
import { structuralRules } from './structural';
import { typescriptRules } from './typescript';

export { repositoryRules, structuralRules, typescriptRules };
export const rules = uniqueRules([...repositoryRules, ...structuralRules, ...typescriptRules]);

export { analyzeColorFiles, colorFileLimitRule, noInlineStylesRule } from './styling';
export { deadImplementationRule, moduleCohesionRule } from './typescript';
export { nearDuplicatesRule } from './duplicates';
