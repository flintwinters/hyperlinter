import type { HyperlintDiagnostic } from '../diagnostics/Diagnostic';
import {
  agentInstructions,
  agentInstructionsMessage,
  MAX_AGENT_INSTRUCTION_LINES,
} from '../project/agentInstructions';
import type { ProjectModel } from '../project/ProjectModel';
import type { HyperlintRule } from './Rule';

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
