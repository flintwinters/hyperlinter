export { hyperlinterUpdateNotice } from './updateNotice';
interface Command {
  readonly flag: string | null;
  readonly description: string;
  readonly arguments: readonly { name: string; values: readonly string[] }[];
  readonly json: boolean;
  readonly writes: readonly string[];
  readonly requires: readonly string[];
  readonly network: boolean;
  /** Modifiers adjust the default audit and may combine; every other command runs alone. */
  readonly modifiesAudit?: true;
}

const commands: readonly Command[] = [
  { flag: null, description: 'Audit static structure and local chronology; apply local baselines.',
    arguments: [], json: true, writes: ['evidence'], requires: ['tsconfig.json', 'Git metadata'], network: true },
  { flag: '--chronolint', description: 'Analyze local Git co-change evidence only; unavailable history fails.',
    arguments: [], json: true, writes: ['evidence'], requires: ['tsconfig.json', 'Git history'], network: true },
  { flag: '--history', description: 'Read recorded audit evidence; initialize the ledger if absent.',
    arguments: [], json: true, writes: ['ledger initialization'], requires: ['Git metadata'], network: true },
  { flag: '--check-colors', description: 'Inventory literal color files and enforce the optional project cap.',
    arguments: [], json: true, writes: [], requires: ['tsconfig.json', 'Git metadata'], network: true },
  { flag: '--check-styles', description: 'Check CSS files, new inline styles, and the color-file cap.',
    arguments: [], json: true, writes: [], requires: ['tsconfig.json', 'Git metadata'], network: true },
  { flag: '--check-no-css', description: 'Check for forbidden standalone CSS files.',
    arguments: [], json: true, writes: [], requires: ['Git metadata'], network: true },
  { flag: '--check-agents', description: 'Check the root agent instruction length.',
    arguments: [], json: true, writes: [], requires: ['Git metadata'], network: true },
  { flag: '--source-budget', description: 'Check the source-line budget or advance its ledger after refactoring; advancing requires a clean worktree.',
    arguments: [{ name: 'action', values: ['check', 'advance', 'advance-if-pending'] }],
    json: true, writes: ['source-line-budget.json (advance actions only)'],
    requires: ['source-line-budget.json', 'Git metadata'], network: true },
  { flag: '--fix', description: 'Audit, extract eligible exact clones, then reanalyze changed source.',
    arguments: [], json: true, writes: ['source', 'evidence'], requires: ['tsconfig.json', 'Git metadata'], network: true, modifiesAudit: true },
  { flag: '--fix-private-exports', description: 'Audit, privatize eligible unused exports, then reanalyze changed source.',
    arguments: [], json: true, writes: ['source', 'evidence'], requires: ['tsconfig.json', 'Git metadata'], network: true, modifiesAudit: true },
  { flag: '--write-baseline', description: 'Audit and replace the local public-surface baseline; changes enforcement policy.',
    arguments: [], json: true, writes: ['baseline', 'evidence'], requires: ['tsconfig.json', 'Git metadata'], network: true, modifiesAudit: true },
  { flag: '--write-inline-style-baseline', description: 'Replace the local inline-style baseline; changes enforcement policy.',
    arguments: [], json: true, writes: ['baseline'], requires: ['tsconfig.json', 'Git metadata'], network: true },
  { flag: '--build-embeddings', description: 'Audit and refresh the optional semantic cache using configured embeddings; may send implementation text to the provider.',
    arguments: [], json: true, writes: ['semantic cache', 'evidence'],
    requires: ['tsconfig.json', 'Git metadata', 'semantic configuration and provider credentials when enabled'], network: true, modifiesAudit: true },
];

/** Discovery is static: it never reads target configuration or opens the evidence ledger. */
export const cliDiscovery = {
  schemaVersion: 1,
  defaultFormat: 'json',
  usage: 'hyperlinter [command] [--format=text|json]',
  workingDirectory: 'Run audits from the target repository root; discovery works from any directory.',
  commands,
  updateCheck: {
    remote: 'Installed Hyperlinter checkout origin HEAD; skipped for help and discovery.',
    output: 'Advisory INFO on stderr (JSON in JSON mode); never changes enforcement or exit status.',
    timeoutMs: 2000,
  },
  options: [
    { flags: ['--help', '-h'], description: 'Show CLI discovery without running an audit.' },
    { flags: ['--discover'], description: 'Describe CLI capabilities without running an audit.' },
    { flags: ['--format'], values: ['json', 'text'], description: 'Defaults to JSON. Use --format=text or --format text for readable output.' },
  ],
  constraints: {
    chronolintExcludes: commands.flatMap(({ flag }) => flag && flag !== '--chronolint' ? [flag] : []),
    combinations: 'Use one command per invocation. Fixing, baseline writing, and embedding flags modify the default audit; other modes return early.',
  },
  exitCodes: { '0': 'Completed without enforcement errors.', '1': 'Enforcement errors or an operational failure; inspect output.' },
  agentGuidance: [
    'JSON is the default for discovery and reports. Use --format=text for readable output. A nonzero exit can still include a valid report.',
    'Runs check for Hyperlinter updates over Git with a bounded timeout; offline checks are silently skipped. Update instructions appear on stderr.',
    'Baseline writes change policy; do not use them to make a failing audit pass.',
    'If Git is blocked by the sandbox (for example, spawnSync git EPERM), request elevated Git access and rerun.',
    'Discovery describes capabilities; it does not verify dependencies, credentials, or repository readiness.',
  ],
};

export function printCliHelp(): void {
  const lines = [cliDiscovery.usage, cliDiscovery.workingDirectory, '', 'Commands:'];
  for (const command of cliDiscovery.commands) {
    const arguments_ = command.arguments.map(({ values }) => `<${values.join('|')}>`).join(' ');
    lines.push(`  ${command.flag ?? '(default audit)'}${arguments_ ? ` ${arguments_}` : ''}: ${command.description}`);
    lines.push(`    JSON: ${command.json ? 'yes' : 'no'}; writes: ${command.writes.join(', ') || 'none'}; network: ${command.network ? 'possible' : 'no'}.`);
  }
  lines.push('', 'Options:');
  for (const option of cliDiscovery.options) lines.push(`  ${option.flags.join(', ')}: ${option.description}`);
  lines.push('', `Chronolint cannot combine with: ${cliDiscovery.constraints.chronolintExcludes.join(', ')}.`,
    cliDiscovery.constraints.combinations, '', 'Exit codes: 0 = success; 1 = enforcement errors or operational failure.',
    '', ...cliDiscovery.agentGuidance);
  process.stdout.write(`${lines.join('\n')}\n`);
}
