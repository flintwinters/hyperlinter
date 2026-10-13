export interface TemporalFile {
  readonly path: string;
  readonly module: string;
  readonly dependencies: readonly string[];
}
export interface CorrelationFinding {
  readonly paths: readonly [string, string];
  readonly modules: readonly [string, string];
  readonly observations: number;
  readonly edits: readonly [number, number];
  readonly shared: number;
  readonly rates: readonly [number, number];
  readonly lift: number;
  readonly dependency: 'none' | 'left-to-right' | 'right-to-left' | 'both';
  readonly commits: readonly string[];
}

