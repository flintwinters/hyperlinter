import type { ChronolintConfig } from '../config';
import type { HyperlintDiagnostic } from '../diagnostics';
import type { HistorySnapshot } from '../history';
import { uniqueRules } from '../rules/contracts';
import { rules } from '../rules';
import { correlate } from './correlation';
import type { TemporalFile, CorrelationFinding } from './contracts';
export { correlate } from './correlation';
export type { TemporalFile, CorrelationFinding } from './contracts';

export interface TemporalRule<Result = unknown> {
  readonly id: string;
  analyze(history: HistorySnapshot, files: readonly TemporalFile[], options: ChronolintConfig): Result;
}
export const temporalRules: readonly TemporalRule<ReturnType<typeof correlate>>[] = [{ id: 'HL119', analyze: correlate }];
uniqueRules([...rules, ...temporalRules]);

export function correlationDiagnostics(findings: readonly CorrelationFinding[]): HyperlintDiagnostic[] {
  return findings.map(finding => ({ rule: 'HL119', severity: 'warning', module: finding.modules[0], file: finding.paths[0],
    message: `${JSON.stringify(finding.paths)} in modules ${JSON.stringify(finding.modules)}: `
      + `N=${finding.observations}, edits=${finding.edits.join('/')}, shared=${finding.shared}, `
      + `rates=${finding.rates.map(rate => rate.toFixed(3)).join('/')}, lift=${finding.lift.toFixed(3)}, `
      + `dependency=${finding.dependency}; supporting commits=${finding.commits.join(', ')}. `
      + 'Review whether a shared invariant needs one owner or related code belongs together.' }));
}
export { type ChronologyEvidence } from './evidence';
