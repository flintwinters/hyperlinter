import { observations } from './observations';
import { pairEvidence, qualifies, compareFindings, comparePaths } from './pairEvidence';
import type { ChronolintConfig } from '../config';
import type { HistorySnapshot } from '../history';

import type { TemporalFile, CorrelationFinding } from './contracts';
/** All qualifying cross-module pairs, without transitive clustering. */
export function correlate(history: HistorySnapshot, files: readonly TemporalFile[], options: ChronolintConfig) {
  const tracked = files.filter(file => history.paths.includes(file.path)).sort((a, b) => comparePaths(a.path, b.path));
  const { eligible, oversized } = observations(history, tracked.map(file => file.path), options.maximumFiles);
  const findings: CorrelationFinding[] = [];
  for (let left = 0; left < tracked.length; left++) for (let right = left + 1; right < tracked.length; right++) {
    const a = tracked[left], b = tracked[right];
    if (a.module === b.module) continue;
    const finding = pairEvidence(eligible, left, right, a, b);
    if (qualifies(finding, options)) findings.push(finding);
  }
  findings.sort(compareFindings);
  return { findings, filters: { oversized, eligible: eligible.length, analyzedFiles: tracked.length } };
}
