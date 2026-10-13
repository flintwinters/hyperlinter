import type { HistorySnapshot, HistoryChange } from '../history';
export interface Observation {
  readonly id: string;
  readonly alive: ReadonlySet<number>;
  readonly edited: ReadonlySet<number>;
}
/** Paths move backwards simultaneously; additions terminate identities. */
export function observations(history: HistorySnapshot, initialPaths: readonly string[], maximumFiles: number) {
  const paths = new Map(initialPaths.map((file, i) => [i, file]));
  const eligible: Observation[] = [];
  let oversized = 0;
  for (const commit of history.commits) {
    const edited = new Set<number>();
    const alive = new Set(paths.keys());
    for (const [identity, current] of [...paths]) {
      const change = commit.changes.find(change => change.path === current);
      if (!change) continue;
      if (isEdit(change)) edited.add(identity);
      if (change.kind === 'A') paths.delete(identity);
      else if (change.kind === 'R') paths.set(identity, change.previousPath!);
    }
    if (commit.changes.length > maximumFiles) oversized++;
    else if (edited.size) eligible.push({ id: commit.id, alive, edited });
  }
  return { eligible, oversized };
}

function isEdit(change: HistoryChange): boolean { return change.contentChanged && change.kind !== 'D'; }
