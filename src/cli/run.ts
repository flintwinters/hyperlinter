import path from 'node:path';
import { cliDiscovery, printCliHelp } from '../commands';
import { semanticReport } from '../semantic';
import { runSourceChecks } from './checks';
import { runStylingChecks } from './styling';
import { runAudit } from './audit';

export async function runCli(arguments_: readonly string[]): Promise<void> {
  const formatIndex = arguments_.indexOf('--format');
  const format = arguments_.find(argument => argument.startsWith('--format='))?.slice('--format='.length)
    ?? (formatIndex === -1 ? 'json' : arguments_[formatIndex + 1]);
  if (format !== 'json' && format !== 'text') {
    process.stderr.write('Invalid output format: use --format=json or --format=text.\n');
    process.exit(1);
  }
  const json = format === 'json';
  if (arguments_.some(argument => ['--help', '-h', '--discover'].includes(argument))) {
    if (json) process.stdout.write(`${JSON.stringify(cliDiscovery, null, 2)}\n`);
    else printCliHelp();
    process.exit();
  }
  const chronolint = arguments_.includes('--chronolint');
  if (chronolint && arguments_.some(argument => cliDiscovery.constraints.chronolintExcludes.includes(argument))) {
    process.stderr.write('Chronolint must run separately from fixing, baseline writing, and other analysis modes.\n');
    process.exit(1);
  }
  const commandFlags = cliDiscovery.commands.flatMap(({ flag, modifiesAudit }) => (
    flag && arguments_.includes(flag) ? [{ flag, modifiesAudit }] : []));
  if (commandFlags.length > 1 && commandFlags.some(({ modifiesAudit }) => !modifiesAudit)) {
    process.stderr.write(`Use one command per invocation; ${commandFlags.map(({ flag }) => flag).join(', ')} cannot combine. `
      + `Only audit modifiers combine: ${cliDiscovery.commands.filter(command => command.modifiesAudit).map(command => command.flag).join(', ')}.\n`);
    process.exit(1);
  }
  if (arguments_.includes('--semantic-report')) {
    try {
      if (cliDiscovery.commands.some(({ flag }) => flag && flag !== '--semantic-report' && arguments_.includes(flag))) {
        throw new Error('Semantic reporting must run separately from other commands.');
      }
      const option = (name: string, fallback: string) => {
        const index = arguments_.indexOf(name);
        if (index === -1) return fallback;
        const value = arguments_[index + 1];
        if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}.`);
        return value;
      };
      const root = process.cwd();
      const result = semanticReport(root, path.resolve(option('--output', 'artifacts/semantic-report')),
        option('--python', process.platform === 'win32' ? 'python' : 'python3'));
      process.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n`
        : `PNG: ${result.png}\nResidual PNG: ${result.residual}\nHL116 gates: ${result.funnel.join(' → ')}\n`);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
    process.exit();
  }
  runSourceChecks(arguments_, json);
  runStylingChecks(arguments_, json);
  await runAudit(arguments_, json, chronolint);
}
