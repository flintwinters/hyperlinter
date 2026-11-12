import type { HyperlintDiagnostic } from '../../diagnostics';
import { agentInstructionsMessage, oversizedAgentInstructions, type StructuralModel } from '../../project';

import type { HyperlintRule } from '../contracts';

const agentInstructionsRule: HyperlintRule<StructuralModel> = {
  id: 'HL112',
  analyze(project: StructuralModel): readonly HyperlintDiagnostic[] {
    return oversizedAgentInstructions(project.getRootDir()).map((instructions) => ({
        rule: 'HL112',
        severity: 'error' as const,
        file: instructions.file,
        score: instructions.lines,
        message: agentInstructionsMessage(instructions.lines),
      }));
  },
};

/** Rules applied once to the repository, regardless of language. */
export const repositoryRules = [agentInstructionsRule] as const;
