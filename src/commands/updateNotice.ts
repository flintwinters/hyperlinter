import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Check the installed tool, never the target project's remote or policy. */
export function hyperlinterUpdateNotice(
  installation = fileURLToPath(new URL('../..', import.meta.url)),
): { severity: 'info'; code: string; message: string; commands: string[][] } | undefined {
  const git = (...args: string[]) => spawnSync('git', args, {
    cwd: installation, encoding: 'utf8', timeout: 2_000,
    maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
  });
  const root = git('rev-parse', '--show-toplevel');
  // An unpacked installation inside a host repository is not a Git checkout of the tool.
  if (root.status !== 0 || path.resolve(root.stdout.trim()) !== path.resolve(installation)) return;
  const local = git('rev-parse', '--verify', 'HEAD');
  if (local.status !== 0) return;
  const remote = git('ls-remote', '--symref', 'origin', 'HEAD');
  if (remote.status !== 0) return;
  const revision = /^([a-f0-9]{40,64})\s+HEAD$/m.exec(remote.stdout)?.[1];
  const branch = /^ref: refs\/heads\/(.+)\s+HEAD$/m.exec(remote.stdout)?.[1];
  if (!revision || !branch || revision === local.stdout.trim()) return;
  // Local development commits ahead of the remote do not need an update.
  if (git('merge-base', '--is-ancestor', revision, 'HEAD').status === 0) return;
  const commands = [
    ['git', '-C', installation, 'fetch', 'origin', `refs/heads/${branch}`],
    ['git', '-C', installation, 'merge', '--ff-only', 'FETCH_HEAD'],
    ['npm', '--prefix', installation, 'ci', '--include=dev'],
  ];
  return {
    severity: 'info', code: 'HYPERLINTER_UPDATE_AVAILABLE', commands,
    message: 'Hyperlinter has upstream updates. Update Hyperlinter by running the listed commands in order, '
      + 'then rerun the original command. Preserve local changes; resolve divergence if fast-forward fails. '
      + 'For a submodule installation, commit the updated submodule pointer in the host repository.',
  };
}
