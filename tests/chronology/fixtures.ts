import type { TemporalFile } from '../../src/temporal';
import type { HistorySnapshot, HistoryCommit } from '../../src/history';
export const files: TemporalFile[] = ['a', 'b', 'c'].map(name => ({ path: name, module: name, dependencies: name === 'a' ? ['b'] : [] }));
export function snapshot(edits: string[][]): HistorySnapshot {
  return { root: '/', revision: 'pinned', paths: ['a', 'b', 'c'], coverage: { end: 'root', inspected: edits.length, window: 500 },
    commits: edits.map((paths, i): HistoryCommit => ({ id: String(i), parents: [], timestamp: i,
      changes: paths.map(path => ({ path, kind: 'M', contentChanged: true })) })) };
}
export const support = () => [...Array.from({ length: 5 }, () => ['a', 'b']), ...Array.from({ length: 25 }, () => ['c'])];

