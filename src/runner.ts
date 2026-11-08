import { semanticFunctions, semanticClustering, updateEmbeddingIndex } from './semantic';
import { loadProjects, type LoadedProjects } from './project';

import { projectStatePath, type HyperlintResult } from './runtime';
import type { HyperlintDiagnostic } from './diagnostics';
import { loadHyperlinterConfig } from './config';

import { repositoryRules, structuralRules, typescriptRules } from './rules';
import { moduleScoreDiagnostics } from './scoring';
import { analyzeProjectChronology } from './chronolint';
import type { ChronologyEvidence } from './temporal';

export async function analyze(tsconfigPath?: string, buildEmbeddings = false): Promise<HyperlintResult> {
  return analyzeProjects(await loadProjects(tsconfigPath), buildEmbeddings);
}

/** Execute analysis against every prepared language model and the root's project policy. */
async function analyzeProjects(
  { rootDir, typescript, models }: LoadedProjects, buildEmbeddings: boolean,
): Promise<HyperlintResult> {
  const config = loadHyperlinterConfig(undefined, rootDir);
  const enabled = <Rule extends { id: string }>(entries: readonly Rule[]) => entries.filter(rule => !config.disabledRules.includes(rule.id));
  const diagnostics = [
    ...enabled(repositoryRules).flatMap((rule) => rule.analyze(models[0], config)),
    ...models.flatMap((model) => enabled(structuralRules).flatMap((rule) => rule.analyze(model, config))),
    ...(typescript ? enabled(typescriptRules).flatMap((rule) => rule.analyze(typescript, config)) : []),
  ];
  if (typescript && (config.semantic.enabled || buildEmbeddings)) {
    try {
      const functions = semanticFunctions(typescript);
      const vectors = await updateEmbeddingIndex(functions, config.semantic.model,
        projectStatePath(rootDir, 'semantic-embeddings.json'));
      diagnostics.push(...semanticClustering(functions, vectors, config.semantic));
    } catch (error) {
      if (buildEmbeddings) throw error;
      diagnostics.push({ rule: 'HL116', severity: 'warning',
        message: `Experimental semantic analysis unavailable: ${error instanceof Error ? error.message : String(error)} `
          + 'No semantic conclusions were drawn.' });
    }
  }
  let chronology: ChronologyEvidence | undefined;
  try {
    const temporal = analyzeProjectChronology(models, config.chronolint);
    chronology = temporal.chronology;
    diagnostics.push(...temporal.diagnostics);
  } catch (error) {
    diagnostics.push({ rule: 'HL119', severity: 'warning',
      message: `Chronolint unavailable: ${error instanceof Error ? error.message : String(error)} `
        + 'No historical correlation conclusions were drawn.' });
  }
  return {
    chronology,
    diagnostics: [...diagnostics, ...moduleScoreDiagnostics(diagnostics, config)],
    metrics: models.flatMap((model) => model.getAllMetrics()),
  };
}
