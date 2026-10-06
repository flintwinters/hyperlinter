import fs from 'node:fs';
import path from 'node:path';

import type { SemanticFunction } from './semanticFunctions';

export type EmbedFunctions = (inputs: readonly string[], model: string) => Promise<readonly number[][]>;
interface EmbeddingIndex {
  model: string;
  active: readonly SemanticFunction[];
  vectors: Record<string, number[]>;
}

/** Validate at the cache boundary so bad responses never replace a usable index. */
export function validateVectors(value: unknown, count: number): asserts value is number[][] {
  if (!Array.isArray(value) || value.length !== count || value.some((vector) =>
    !Array.isArray(vector) || vector.length === 0 || vector.length !== value[0].length
    || vector.some((coordinate: unknown) => typeof coordinate !== 'number' || !Number.isFinite(coordinate))
    || !Number.isFinite(Math.hypot(...vector)) || Math.hypot(...vector) === 0)) {
    throw new Error('Invalid embedding vectors: expected complete, finite, nonzero vectors of equal dimension.');
  }
}

export async function openRouterEmbeddings(inputs: readonly string[], model: string): Promise<number[][]> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new Error('OPENROUTER_API_KEY is required to build the semantic embedding index.');
  // OpenRouter's documented embeddings endpoint returns indexed float vectors.
  // https://openrouter.ai/docs/api/api-reference/embeddings/create-embeddings
  const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: inputs, encoding_format: 'float' }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`OpenRouter embeddings request failed (HTTP ${response.status}).`);
  const body = await response.json() as { data?: { index: number; embedding: number[] }[] };
  if (!Array.isArray(body.data)) throw new Error('OpenRouter returned no embedding data.');
  const rows = body.data.sort((left, right) => left.index - right.index);
  if (rows.some((row, index) => row.index !== index)) throw new Error('OpenRouter returned invalid embedding indices.');
  const vectors = rows.map((row) => row.embedding);
  validateVectors(vectors, inputs.length);
  return vectors;
}

function cachedVectors(
  functions: readonly SemanticFunction[], previous: EmbeddingIndex | undefined, model: string,
): { vectors: Record<string, number[]>; pending: Map<string, string> } {
  const vectors: Record<string, number[]> = Object.create(null);
  const pending = new Map<string, string>();
  for (const fn of functions) {
    const cached = previous?.model === model ? previous.vectors[fn.hash] : undefined;
    if (cached) { validateVectors([cached], 1); vectors[fn.hash] = cached; }
    else pending.set(fn.hash, fn.input);
  }
  return { vectors, pending };
}

export async function updateEmbeddingIndex(
  functions: readonly SemanticFunction[], model: string, file: string,
  embed: EmbedFunctions = openRouterEmbeddings,
): Promise<ReadonlyMap<string, readonly number[]>> {
  // A key is required even on a warm production build; tests inject a local provider.
  if (embed === openRouterEmbeddings && !process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error('OPENROUTER_API_KEY is required to build the semantic embedding index.');
  }
  let previous: EmbeddingIndex | undefined;
  if (fs.existsSync(file)) previous = JSON.parse(fs.readFileSync(file, 'utf8')) as EmbeddingIndex;
  const { vectors, pending } = cachedVectors(functions, previous, model);
  const entries = [...pending];
  for (let start = 0; start < entries.length; start += 16) {
    const batch = entries.slice(start, start + 16);
    const result = await embed(batch.map(([, input]) => input), model);
    validateVectors(result, batch.length);
    batch.forEach(([hash], index) => { vectors[hash] = result[index]; });
  }
  validateVectors(Object.values(vectors), Object.keys(vectors).length);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.new`;
  try {
    fs.writeFileSync(temporary, JSON.stringify({ model, active: functions, vectors } satisfies EmbeddingIndex));
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return new Map(functions.map((fn) => [fn.id, vectors[fn.hash]]));
}
