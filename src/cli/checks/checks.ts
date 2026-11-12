import { agentInstructionsMessage, oversizedAgentInstructions, runSourceBudget } from '../../project';

export function runSourceChecks(arguments_: readonly string[], json: boolean): void {
  const sourceBudgetIndex = arguments_.indexOf('--source-budget');
  if (sourceBudgetIndex !== -1) {
    try {
      const result = runSourceBudget(arguments_[sourceBudgetIndex + 1]);
      process.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : `${result.message}\n`);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
    process.exit();
  }

  if (arguments_.includes('--check-agents')) {
    const violations = oversizedAgentInstructions(process.cwd());
    if (json) process.stdout.write(`${JSON.stringify({ violations }, null, 2)}\n`);
    else for (const violation of violations) {
      process.stderr.write(`${agentInstructionsMessage(violation.lines)}\n`);
    }
    process.exitCode = violations.length ? 1 : 0;
    process.exit();
  }
}
