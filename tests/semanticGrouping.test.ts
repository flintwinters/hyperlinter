import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { semanticConfig, semanticDefaults } from '../src/config';
import { loadHyperlinterConfig } from '../src/config';
import { ProjectModel } from '../src/project';
import { semanticFunctions, type SemanticFunction } from '../src/project';
import { openRouterEmbeddings, updateEmbeddingIndex } from '../src/project';
import { semanticGrouping } from '../src/project';
import { analyze } from '../src';
import { moduleScoreDiagnostics } from '../src/scoring';

function functions(count: number, module = 'service'): SemanticFunction[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${module}:${index}`, hash: `${module}:${index}`, input: `function f${index}(){}`,
    module, file: `${module}/index.ts`, line: index + 1,
  }));
}

async function fixture(action: (root: string) => Promise<void>) {
  const root = path.resolve(`runtime/semantic-tests-${process.pid}`);
  fs.mkdirSync(root, { recursive: true });
  try { await action(root); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('lax grouping requires both large groups and substantial separation; warnings never block', () => {
  const members = functions(16);
  const vectors = new Map(members.map((fn, index) => [fn.id, index < 8 ? [1, 0] : [0, 1]]));
  const warnings = semanticGrouping(members, vectors, semanticDefaults);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].severity, 'warning');
  assert.match(warnings[0].message, /probably adjust semantic.minimumClusterFunctions/);
  assert.match(warnings[0].message, /not a hard architectural rule/);
  assert.deepEqual(moduleScoreDiagnostics(warnings, loadHyperlinterConfig()), []);
  assert.deepEqual(semanticGrouping(members.slice(1), vectors, semanticDefaults), []);
  assert.deepEqual(semanticGrouping(members, vectors, { ...semanticDefaults, minimumClusterDistance: 1.01 }), []);
  assert.equal(semanticGrouping(members, vectors, { ...semanticDefaults, minimumClusterDistance: 1 }).length, 1);
  const similar = new Map(members.map((fn, index) => [fn.id, index < 8 ? [1, 0] : [1, 1]]));
  assert.deepEqual(semanticGrouping(members, similar, semanticDefaults), []);
  const differentModules = members.map((fn, index) => ({ ...fn, module: index < 8 ? 'one' : 'two' }));
  assert.deepEqual(semanticGrouping(differentModules, vectors, semanticDefaults), []);
});

test('inventory includes nested/private/anonymous implementations and excludes declaration-only signatures', async () => {
  await fixture(async (root) => {
    fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ include: ['*.ts'] }));
    const file = path.join(root, 'index.ts');
    fs.writeFileSync(file, `declare function signature(): void;
export function outer() { return () => 1; }
const callback = function () { return 2; };
class C { constructor() {} private method() {} get value() { return 1; } set value(v: number) {} }
const object = { method() {} };`);
    const read = () => semanticFunctions(ProjectModel.fromTsConfig(path.join(root, 'tsconfig.json')));
    const original = read();
    assert.equal(original.length, 8);
    assert.equal(new Set(original.map((fn) => fn.id)).size, 8);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('return () => 1', 'return () => 3'));
    const changed = read();
    assert.notEqual(changed[0].hash, original[0].hash);
    assert.notEqual(changed[1].hash, original[1].hash);
    assert.equal(changed[2].hash, original[2].hash);
  });
});

test('index reuses content, refreshes changes and models, prunes removals, and preserves good state on failure', async () => {
  await fixture(async (root) => {
    const file = path.join(root, 'index.json');
    const members = functions(3);
    const calls: string[][] = [];
    const embed = async (inputs: readonly string[]) => { calls.push([...inputs]); return inputs.map(() => [1, 0]); };
    await updateEmbeddingIndex(members, 'model', file, embed);
    await updateEmbeddingIndex(members, 'model', file, embed);
    assert.equal(calls.length, 1);
    const changed = [{ ...members[0], hash: 'changed', input: 'updated source' }, members[1]];
    await updateEmbeddingIndex(changed, 'model', file, embed);
    assert.deepEqual(calls[1], ['updated source']);
    const cache = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(cache.active.length, 2);
    assert.equal(cache.vectors[members[2].hash], undefined);
    const saved = fs.readFileSync(file, 'utf8');
    await assert.rejects(updateEmbeddingIndex(changed, 'new-model', file, async () => [[0, 0], [1, 0]]), /Invalid embedding/);
    assert.equal(fs.readFileSync(file, 'utf8'), saved);
    await updateEmbeddingIndex(changed, 'new-model', file, embed);
    assert.equal(calls[2].length, 2);
    await updateEmbeddingIndex([], 'new-model', file, embed);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).active, []);
  });
});

test('OpenRouter validates indexed responses and requires an environment key even for warm builds', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  try {
    delete process.env.OPENROUTER_API_KEY;
    await assert.rejects(openRouterEmbeddings(['source'], 'model'), /OPENROUTER_API_KEY/);
    await fixture(async (root) => {
      const cache = path.join(root, 'index.json');
      await updateEmbeddingIndex(functions(1), 'model', cache, async () => [[1, 0]]);
      await assert.rejects(updateEmbeddingIndex(functions(1), 'model', cache), /OPENROUTER_API_KEY/);
    });
    process.env.OPENROUTER_API_KEY = 'test-only-key';
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://openrouter.ai/api/v1/embeddings');
      assert.deepEqual(JSON.parse(options!.body as string), { model: 'model', input: ['a', 'b'], encoding_format: 'float' });
      return Response.json({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] });
    };
    assert.deepEqual(await openRouterEmbeddings(['a', 'b'], 'model'), [[1, 0], [0, 1]]);
    for (const data of [
      [{ index: 0, embedding: [1, 0] }, { index: 0, embedding: [0, 1] }],
      [{ index: 0, embedding: [0, 0] }, { index: 1, embedding: [0, 1] }],
      [{ index: 0, embedding: [1] }, { index: 1, embedding: [0, 1] }],
      [{ index: 0, embedding: [1, 0] }],
    ]) {
      globalThis.fetch = async () => Response.json({ data });
      await assert.rejects(openRouterEmbeddings(['a', 'b'], 'model'), /Invalid embedding|invalid embedding/);
    }
    globalThis.fetch = async () => new Response('secret provider error', { status: 401 });
    await assert.rejects(openRouterEmbeddings(['a', 'b'], 'model'), /HTTP 401/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  }
});

test('semantic configuration rejects invalid thresholds and remains opt-in', () => {
  assert.equal(semanticConfig(undefined).enabled, false);
  for (const value of [
    { minimumClusterFunctions: 1 }, { minimumClusterFunctions: 2.5 },
    { minimumClusterDistance: 3 }, { minimumClusterDistance: NaN },
    { maximumWithinClusterDistance: -1 }, { maximumWithinClusterDistance: 0.9 },
    { model: '' }, { enabled: 'true' },
  ]) assert.throws(() => semanticConfig(value), /semantic\./);
});


test('runner keeps disabled checks offline, optional failure advisory, and explicit builds strict', async () => {
  await fixture(async (root) => {
    const originalDirectory = process.cwd();
    const originalKey = process.env.OPENROUTER_API_KEY;
    const config = loadHyperlinterConfig();
    fs.mkdirSync(path.join(root, '.git'));
    fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ include: ['index.ts'] }));
    fs.writeFileSync(path.join(root, 'index.ts'), 'export function identity(value: number) { return value; }');
    const configure = (enabled: boolean) => fs.writeFileSync(path.join(root, 'hyperlinter.config.json'),
      JSON.stringify({ ...config, semantic: { ...config.semantic, enabled } }));
    try {
      delete process.env.OPENROUTER_API_KEY;
      process.chdir(root);
      configure(false);
      assert.ok(!(await analyze()).diagnostics.some((diagnostic) => diagnostic.rule === 'HL116'));
      await assert.rejects(analyze(undefined, true), /OPENROUTER_API_KEY/);
      configure(true);
      const result = await analyze();
      const warnings = result.diagnostics.filter((diagnostic) => diagnostic.rule === 'HL116');
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0].severity, 'warning');
      assert.match(warnings[0].message, /No semantic conclusions were drawn/);
      assert.ok(!fs.existsSync(path.join(root, '.git/hyperlinter/semantic-embeddings.json')));
    } finally {
      process.chdir(originalDirectory);
      if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = originalKey;
    }
  });
});
