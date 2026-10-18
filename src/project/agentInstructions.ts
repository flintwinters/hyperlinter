import fs from 'node:fs';
import path from 'node:path';

const MAX_AGENT_INSTRUCTION_LINES = 150;

export interface AgentInstructions {
  file: string;
  lines: number;
}

export function agentInstructionsMessage(lines: number): string {
  return [
    `AGENTS.md has ${lines} lines; keep it broad strokes and treat it as a semantic`,
    'entrypoint for agents, not an all-encompassing project map.',
  ].join(' ');
}

/** Rule and CLI share one limit check. */
export function oversizedAgentInstructions(root: string): readonly AgentInstructions[] {
  return agentInstructions(root).filter((instructions) => instructions.lines > MAX_AGENT_INSTRUCTION_LINES);
}

/** AGENTS.md is a concise semantic entrypoint, not a complete project map. */
function agentInstructions(root: string): readonly AgentInstructions[] {
  const fileName = path.join(root, 'AGENTS.md');
  if (!fs.existsSync(fileName)) return [];
  const text = fs.readFileSync(fileName, 'utf8');
  const lines = text === '' ? 0 : text.split(/\r?\n/).length - Number(text.endsWith('\n'));
  return [{ file: 'AGENTS.md', lines }];
}
