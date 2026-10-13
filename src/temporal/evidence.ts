import type { ChronolintConfig } from '../config';
import type { HistorySnapshot } from '../history';
import type { CorrelationFinding } from './contracts';

export interface ChronologyEvidence {
  readonly revision: string;
  readonly algorithm: 'HL119-v1';
  readonly options: ChronolintConfig;
  readonly coverage: HistorySnapshot['coverage'];
  readonly filters: { readonly oversized: number; readonly eligible: number; readonly analyzedFiles: number };
  readonly findings: readonly CorrelationFinding[];
}
