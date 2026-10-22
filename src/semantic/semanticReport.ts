/** Offline semantic evidence and PNG reporting, shared by every target project. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadHyperlinterConfig } from '../config';
import { readSemanticCache } from './semanticEmbeddings';
import { semanticClusterEvidence } from './semanticClustering';
import { projectStatePath } from '../runtime';

export function semanticReport(root: string, output: string, python: string) {
  const engine = fileURLToPath(new URL('../../', import.meta.url));
  const cachePath = projectStatePath(root, 'semantic-embeddings.json');
  if (!fs.existsSync(cachePath)) throw new Error('No semantic cache: run an authorized --build-embeddings first.');
  const cache = readSemanticCache(cachePath);
  if (!cache.functions.length) throw new Error('Semantic cache has no active functions; rebuild embeddings first.');
  const config = loadHyperlinterConfig(engine, root).semantic;
  const evidence = semanticClusterEvidence(cache.functions, cache.vectors, config);
  const records = evidence.map(item => {
    const members = cache.functions.filter(fn => fn.module === item.module);
    return {
      module: item.module, functions: item.functions, eligible: item.eligible,
      sizes: item.clusters.map(cluster => cluster.length).sort((a, b) => b - a),
      clusters: item.clusters.map(cluster => cluster.map(fn => fn.id)),
      largeClusters: item.largeClusters, bestSeparation: item.bestSeparation,
      leaves: item.tree.leaves.map(i => ({ file: members[i].file, line: members[i].line })),
      merges: item.tree.merges,
    };
  });
  const eligible = evidence.filter(item => item.eligible);
  const candidates = eligible.filter(item => item.largeClusters >= 2);
  const funnel = [evidence.length, eligible.length, candidates.length, candidates.filter(item => item.separated !== null).length];
  fs.mkdirSync(output, { recursive: true });
  const evidencePath = path.join(output, 'evidence.json');
  fs.writeFileSync(evidencePath, JSON.stringify({ algorithm: 'average-linkage', model: cache.model, config, records, funnel }));
  const result = spawnSync(python, [path.join(engine, 'scripts/semantic_report.py'), '--cache', cachePath,
    '--evidence', evidencePath, '--output', output, '--title', path.basename(root),
    '--engine-prefix', path.relative(root, engine).split(path.sep).join('/') || '.'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`Semantic PNG rendering failed: ${result.error?.message ?? result.stderr.trim()}. `
      + `Install reporting dependencies with your Python: -m pip install -r ${path.join(engine, 'scripts/requirements-report.txt')}; `
      + 'select that interpreter with --python.');
  }
  return { png: path.join(output, 'overview.png'), evidence: evidencePath,
    summary: path.join(output, 'summary.json'), model: cache.model, funnel };
}
