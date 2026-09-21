import type { HyperlinterConfig } from '../config/HyperlinterConfig';
import type { HyperlintDiagnostic } from '../diagnostics/Diagnostic';

/** Turns accumulated findings into a refactor-blocking diagnostic per module. */
export function moduleScoreDiagnostics(
  diagnostics: readonly HyperlintDiagnostic[],
  config: HyperlinterConfig,
): readonly HyperlintDiagnostic[] {
  const scores = new Map<string, number>();
  for (const diagnostic of diagnostics) {
    if (!diagnostic.module) continue;
    const weight = config.scoring.severityWeights[diagnostic.severity];
    scores.set(diagnostic.module, (scores.get(diagnostic.module) ?? 0) + weight);
  }
  return [...scores.entries()]
    .filter(([, score]) => score >= config.scoring.moduleErrorThreshold)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([module, score]) => ({
      rule: 'HL106',
      severity: config.rules.moduleScore,
      module,
      score,
      message: `Module policy score ${score} reaches the configured error threshold ${config.scoring.moduleErrorThreshold}; refactor required.`,
    }));
}
