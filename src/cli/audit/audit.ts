import { analyze, analyzeChronolint } from '../../analysis';
import { RuntimeStore } from '../../runtime';
import { applyRequestedFixes } from '../../fixes';
import { readBaseline, writeBaseline, filterDiagnostics } from '../baseline';
import { printHistory, printChronology, printMetrics, formatDiagnostic } from '../output';

export async function runAudit(arguments_: readonly string[], json: boolean, chronolint: boolean): Promise<void> {
  const runtime = new RuntimeStore();

  if (arguments_.includes('--history')) {
    const history = runtime.history().map(run => ({ ...run, chronology: runtime.chronology(run.id) }));
    if (json) process.stdout.write(`${JSON.stringify({ runs: history }, null, 2)}\n`);
    else {
      printHistory(history);
      for (const run of history) if (run.chronology) printChronology(run.chronology);
    }
    runtime.close();
    process.exit();
  }

  const startedAt = Date.now();
  const buildEmbeddings = arguments_.includes('--build-embeddings');
  let result;
  try {
    result = chronolint ? await analyzeChronolint() : await analyze(undefined, buildEmbeddings);
  } catch (error) {
    runtime.close();
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
  const { fixes, sourceChanged } = applyRequestedFixes(arguments_);
  if (sourceChanged) result = await analyze(undefined, buildEmbeddings);
  const baseline = readBaseline();
  const diagnostics = filterDiagnostics(result, baseline, chronolint);
  const run = runtime.record({ ...result, diagnostics }, Date.now() - startedAt, startedAt);
  runtime.close();

  if (arguments_.includes('--write-baseline')) {
    const metrics = Object.fromEntries(result.metrics.map((metric) => [
      metric.module,
      { publicSurface: metric.publicSurface },
    ]));
    writeBaseline({ ...baseline, metrics });
  }

  if (json) {
    process.stdout.write(`${JSON.stringify({ run, diagnostics, metrics: result.metrics, fixes,
        ...(result.chronology ? { chronology: result.chronology } : {}) }, null, 2)}\n`);
  } else {
    if (fixes.length > 0)
      process.stdout.write(`Privatized ${fixes.length} unused export${fixes.length === 1 ? '' : 's'}.\n`);
    if (result.chronology) printChronology(result.chronology);
    if (!chronolint) printMetrics(result.metrics);
    for (const diagnostic of diagnostics) process.stdout.write(`${formatDiagnostic(diagnostic)}\n`);
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) process.exitCode = 1;
}
