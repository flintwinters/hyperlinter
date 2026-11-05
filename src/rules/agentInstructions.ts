import type { HyperlintDiagnostic } from '../diagnostics';
import { agentInstructionsMessage, oversizedAgentInstructions, type ProjectModel } from '../project';

import type { HyperlintRule } from './contracts';

export const agentInstructionsRule: HyperlintRule = {
  id: 'HL112',
  analyze(project: ProjectModel): readonly HyperlintDiagnostic[] {
    return oversizedAgentInstructions(project.getRootDir()).map((instructions) => ({
        rule: 'HL112',
        severity: 'error' as const,
        file: instructions.file,
        score: instructions.lines,
        message: agentInstructionsMessage(instructions.lines),
      }));
  },
};
