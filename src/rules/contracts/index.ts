import type { HyperlintDiagnostic } from '../../diagnostics';
import type { HyperlinterConfig } from '../../config';
import type { ProjectModel, StructuralModel } from '../../project';

/** Rules typed over `StructuralModel` apply to every language; the default binds TypeScript evidence. */
export interface HyperlintRule<Model extends StructuralModel = ProjectModel> {
  readonly id: string;
  analyze(project: Model, config: HyperlinterConfig): readonly HyperlintDiagnostic[];
}

/** Reject ambiguous IDs where rules are registered, before analysis or recording. */
export function uniqueRules<T extends { readonly id: string }>(entries: readonly T[]): readonly T[] {
  const ids = new Set<string>();
  for (const rule of entries) {
    if (ids.has(rule.id)) throw new Error(`Duplicate Hyperlinter rule ID: ${rule.id}`);
    ids.add(rule.id);
  }
  return entries;
}
