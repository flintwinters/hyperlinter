import { semanticFunctions, semanticGrouping, updateEmbeddingIndex, ProjectModel } from './project';

import { projectStatePath, type HyperlintResult } from './runtime';
import type { HyperlintDiagnostic } from './diagnostics';
import { loadHyperlinterConfig } from './config';

import { rules } from './rules';
import { moduleScoreDiagnostics } from './scoring';
import { analyzeProjectChronology } from './chronolint';
import type { ChronologyEvidence } from './temporal';

export async function analyze(tsconfigPath?: string, buildEmbeddings = false): Promise<HyperlintResult> {
  const project = ProjectModel.fromTsConfig(tsconfigPath);
  const config = loadHyperlinterConfig();
  const diagnostics = rules.flatMap((rule) => rule.analyze(project, config));
  if (config.semantic.enabled || buildEmbeddings) {
    try {
      const functions = semanticFunctions(project);
      const vectors = await updateEmbeddingIndex(functions, config.semantic.model,
        projectStatePath(project.getRootDir(), 'semantic-embeddings.json'));
      diagnostics.push(...semanticGrouping(functions, vectors, config.semantic));
    } catch (error) {
      if (buildEmbeddings) throw error;
      diagnostics.push({ rule: 'HL116', severity: 'warning',
        message: `Experimental semantic analysis unavailable: ${error instanceof Error ? error.message : String(error)} `
          + 'No semantic conclusions were drawn.' });
    }
  }
  let chronology: ChronologyEvidence | undefined;
  try {
    const temporal = analyzeProjectChronology(project, config.chronolint);
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
    metrics: project.getAllMetrics(),
  };
}
