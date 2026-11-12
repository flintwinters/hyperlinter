import path from 'node:path';
import { loadHyperlinterConfig, type ChronolintConfig } from '../../config';
import { collectHistory } from '../../history';
import { loadProjects, type StructuralModel } from '../../project';
import { temporalRules, correlationDiagnostics, type ChronologyEvidence } from '../../temporal';
import type { HyperlintResult } from '../../runtime';

export async function analyzeChronolint(tsconfigPath?: string): Promise<HyperlintResult & { chronology: ChronologyEvidence }> {
  const { models } = await loadProjects(tsconfigPath);
  return analyzeProjectChronology(models, loadHyperlinterConfig().chronolint);
}

export function analyzeProjectChronology(
  models: readonly StructuralModel[], options: ChronolintConfig,
): HyperlintResult & { chronology: ChronologyEvidence } {
  const history = collectHistory(models[0].getRootDir(), options.window);
  const files = models.flatMap(project => project.getModules().flatMap(module => module.files.map(file => ({
    path: path.relative(history.root, file).split(path.sep).join('/'), module: module.id,
    dependencies: project.getImports(module),
  }))));
  const results = temporalRules.map(rule => rule.analyze(history, files, options));
  const findings = results.flatMap(result => result.findings);
  return { diagnostics: correlationDiagnostics(findings), metrics: models.flatMap(project => project.getAllMetrics()),
    chronology: { revision: history.revision, algorithm: 'HL119-v1', options, coverage: history.coverage,
      filters: results[0].filters, findings } };
}
