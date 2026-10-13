import type { HyperlintDiagnostic } from '../../diagnostics';
import type { HyperlinterConfig } from '../../config';
import type { ProjectModel } from '../../project';

export interface HyperlintRule {
  readonly id: string;
  analyze(project: ProjectModel, config: HyperlinterConfig): readonly HyperlintDiagnostic[];
}

/** Reject ambiguous IDs where rules are registered, before analysis or recording. */
export function uniqueRules(entries: readonly HyperlintRule[]): readonly HyperlintRule[] {
  const ids = new Set<string>();
  for (const rule of entries) {
    if (ids.has(rule.id)) throw new Error(`Duplicate Hyperlinter rule ID: ${rule.id}`);
    ids.add(rule.id);
  }
  return entries;
}
