import type { HyperlintDiagnostic } from '../diagnostics';
import { agentInstructions, agentInstructionsMessage, MAX_AGENT_INSTRUCTION_LINES, type ProjectModel } from '../project';

import type { HyperlintRule } from './contracts';

export const agentInstructionsRule: HyperlintRule = {
  id: 'HL112',
  analyze(project: ProjectModel): readonly HyperlintDiagnostic[] {
    return agentInstructions(project.getRootDir())
      .filter((instructions) => instructions.lines > MAX_AGENT_INSTRUCTION_LINES)
      .map((instructions) => ({
        rule: 'HL112',
        severity: 'error' as const,
        file: instructions.file,
        score: instructions.lines,
        message: agentInstructionsMessage(instructions.lines),
      }));
  },
};
