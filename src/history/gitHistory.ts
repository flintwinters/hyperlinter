import { execFileSync } from 'node:child_process';
import type { HistoryChange, HistoryCommit, HistorySnapshot } from './snapshot';

function git(cwd: string, args: readonly string[]): string {
  try {
    return execFileSync('git', [...args], { cwd, encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`Chronolint could not read local Git history (${args[0]}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

function changes(raw: string): readonly HistoryChange[] {
  const tokens = raw.split('\0');
  if (tokens.pop() !== '') throw new Error('Chronolint: unterminated Git diff output.');
  const result: HistoryChange[] = [];
  while (tokens.length) {
    const header = tokens.shift()!.trimStart();
    const match = /^:\d+ \d+ ([a-f0-9]+) ([a-f0-9]+) ([AMDRT])\d*$/.exec(header);
    if (!match) throw new Error(`Chronolint: invalid Git raw diff header: ${header}`);
    const previous = tokens.shift();
    const renamed = match[3] === 'R';
    const current = renamed ? tokens.shift() : previous;
    if (!current || !previous) throw new Error('Chronolint: missing Git diff path.');
    result.push(Object.freeze({ path: current, ...(renamed ? { previousPath: previous } : {}),
      kind: match[3] as HistoryChange['kind'], contentChanged: match[1] !== match[2] }));
  }
  return Object.freeze(result);
}

export function collectHistory(projectRoot: string, window = 500): HistorySnapshot {
  if (!Number.isInteger(window) || window < 1) throw new Error('Chronolint window must be a positive integer.');
  const root = git(projectRoot, ['rev-parse', '--show-toplevel']).trim();
  const revision = git(root, ['rev-parse', '--verify', 'HEAD']).trim();
  const ids = git(root, ['rev-list', '--first-parent', `--max-count=${window + 1}`, revision]).trim().split('\n');
  const commits: HistoryCommit[] = [];
  let end: HistorySnapshot['coverage']['end'] = ids.length > window ? 'window' : 'root';
  for (const id of ids.slice(0, window)) {
    const metadata = git(root, ['cat-file', 'commit', id]).split('\n\n', 1)[0].split('\n');
    const parents = metadata.filter(line => line.startsWith('parent ')).map(line => line.slice(7));
    const timestamp = / (\d+) [+-]\d{4}$/.exec(metadata.find(line => line.startsWith('committer ')) ?? '')?.[1];
    if (!timestamp || parents.some(parent => !/^[a-f0-9]+$/.test(parent))) throw new Error('Chronolint: invalid Git commit metadata.');
    // rev-list hides parents at shallow boundaries; show retains the real parent.
    const visible = git(root, ['rev-list', '--parents', '--max-count=1', id]).trim().split(' ');
    if (parents.length && visible.length === 1) { end = 'shallow'; break; }
    const diffArgs = parents.length ? [parents[0], id] : ['--root', id];
    const raw = git(root, ['diff-tree', '--no-commit-id', '-r', '--raw', '-z', '--no-abbrev', '-M50%', ...diffArgs]);
    commits.push(Object.freeze({ id, parents: Object.freeze(parents), timestamp: Number(timestamp), changes: changes(raw) }));
  }
  const paths = git(root, ['ls-tree', '-r', '--name-only', '-z', revision]).split('\0');
  if (paths.pop() !== '') throw new Error('Chronolint: unterminated Git tree output.');
  return Object.freeze({ root, revision, paths: Object.freeze(paths), commits: Object.freeze(commits),
    coverage: Object.freeze({ end, inspected: commits.length, window }) });
}
