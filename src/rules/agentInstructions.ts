import type { HyperlintDiagnostic } from '../diagnostics/Diagnostic';
import {
  agentInstructions,
  agentInstructionsMessage,
  MAX_AGENT_INSTRUCTION_LINES,
} from '../project/agentInstructions';
import type { ProjectModel } from '../project/ProjectModel';
import type { HyperlintRule } from './Rule';

export const agentInstructionsRule: HyperlintRule = {
  id: 'HL108',
  analyze(project: ProjectModel): readonly HyperlintDiagnostic[] {
    return agentInstructions(project.getRootDir())
      .filter((instructions) => instructions.lines > MAX_AGENT_INSTRUCTION_LINES)
      .map((instructions) => ({
        rule: 'HL108',
        severity: 'error' as const,
        file: instructions.file,
        score: instructions.lines,
        message: agentInstructionsMessage(instructions.lines),
      }));
  },
};
