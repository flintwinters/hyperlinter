export interface HistoryChange {
  readonly path: string;
  readonly previousPath?: string;
  readonly kind: 'A' | 'D' | 'M' | 'R' | 'T';
  readonly contentChanged: boolean;
}
export interface HistoryCommit {
  readonly id: string;
  readonly parents: readonly string[];
  readonly timestamp: number;
  readonly changes: readonly HistoryChange[];
}
export interface HistorySnapshot {
  readonly root: string;
  readonly revision: string;
  readonly paths: readonly string[];
  /** Newest first; each diff compares only to the first parent. */
  readonly commits: readonly HistoryCommit[];
  readonly coverage: { readonly end: 'root' | 'window' | 'shallow'; readonly inspected: number; readonly window: number };
}
