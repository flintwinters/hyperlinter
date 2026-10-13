import type { Observation } from './observations';
import type { TemporalFile, CorrelationFinding } from './contracts';
import type { ChronolintConfig } from '../config';

export function pairEvidence(observations: readonly Observation[], left: number, right: number,
  a: TemporalFile, b: TemporalFile): CorrelationFinding {
  let n = 0, ac = 0, bc = 0, shared = 0;
  const commits: string[] = [];
  for (const observation of observations) {
    if (!observation.alive.has(left) || !observation.alive.has(right)) continue;
    n++;
    const ae = observation.edited.has(left), be = observation.edited.has(right);
    ac += Number(ae); bc += Number(be);
    if (ae && be) { shared++; commits.push(observation.id); }
  }
  return { paths: [a.path, b.path], modules: [a.module, b.module], observations: n, edits: [ac, bc], shared,
    rates: [shared / ac, shared / bc], lift: shared * n / (ac * bc),
    dependency: dependency(a, b), commits: commits.slice(0, 5) };
}
function dependency(a: TemporalFile, b: TemporalFile): CorrelationFinding['dependency'] {
  const ab = a.dependencies.includes(b.module), ba = b.dependencies.includes(a.module);
  if (ab && ba) return 'both';
  if (ab) return 'left-to-right';
  return ba ? 'right-to-left' : 'none';
}
export function qualifies(finding: CorrelationFinding, options: ChronolintConfig): boolean {
  return finding.observations >= options.minimumObservations && finding.shared >= options.minimumShared
    && finding.rates.every(rate => rate >= options.minimumRate) && finding.lift >= options.minimumLift;
}
export function compareFindings(a: CorrelationFinding, b: CorrelationFinding): number {
  return Math.min(...b.rates) - Math.min(...a.rates) || b.shared - a.shared || b.lift - a.lift
    || comparePaths(a.paths[0], b.paths[0]) || comparePaths(a.paths[1], b.paths[1]);
}
export function comparePaths(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
