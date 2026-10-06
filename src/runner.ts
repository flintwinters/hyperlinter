import { semanticFunctions } from './project/semanticFunctions';
import { semanticGrouping } from './project/semanticGrouping';
import { updateEmbeddingIndex } from './project/semanticEmbeddings';
import { projectStatePath } from './runtime/projectState';
import type { HyperlintDiagnostic } from './diagnostics/Diagnostic';
import { loadHyperlinterConfig } from './config/HyperlinterConfig';
import { ProjectModel } from './project/ProjectModel';
import { rules } from './rules';
import { moduleScoreDiagnostics } from './scoring/moduleScores';

export interface HyperlintResult {
  diagnostics: readonly HyperlintDiagnostic[];
  metrics: ReturnType<ProjectModel['getAllMetrics']>;
}

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
  return {
    diagnostics: [...diagnostics, ...moduleScoreDiagnostics(diagnostics, config)],
    metrics: project.getAllMetrics(),
  };
}
