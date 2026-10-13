import path from 'node:path';
import { loadHyperlinterConfig } from './config';
import { collectHistory } from './history';
import { ProjectModel } from './project';
import { temporalRules, correlationDiagnostics, type ChronologyEvidence } from './temporal';
import type { HyperlintResult } from './runtime';

export async function analyzeChronolint(tsconfigPath?: string): Promise<HyperlintResult & { chronology: ChronologyEvidence }> {
  const project = ProjectModel.fromTsConfig(tsconfigPath);
  const options = loadHyperlinterConfig().chronolint;
  const history = collectHistory(project.getRootDir(), options.window);
  const files = project.getModules().flatMap(module => module.sourceFiles.map(file => ({
    path: path.relative(history.root, file.fileName).split(path.sep).join('/'), module: module.id,
    dependencies: project.getImports(module),
  })));
  const results = temporalRules.map(rule => rule.analyze(history, files, options));
  const findings = results.flatMap(result => result.findings);
  return { diagnostics: correlationDiagnostics(findings), metrics: project.getAllMetrics(),
    chronology: { revision: history.revision, algorithm: 'HL119-v1', options, coverage: history.coverage,
      filters: results[0].filters, findings } };
}
