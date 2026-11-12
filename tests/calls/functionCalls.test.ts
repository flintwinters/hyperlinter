import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadHyperlinterConfig } from '../../src/config';
import { ProjectModel } from '../../src/project';
import { functionCallGraph, functionGenerations, moduleGenerationGaps, isTestFile } from '../../src/project/calls';
import { functionCyclesRule, functionGenerationGapRule } from '../../src/rules/functionCalls';
import { cycleWitness, stronglyConnectedComponents } from '../../src/graphs';

const config = loadHyperlinterConfig();
const fixtures = JSON.parse(fs.readFileSync('tests/fixtures/function-calls.fixture', 'utf8')) as Record<string, Record<string, string>>;

function withProject(name: string, action: (project: ProjectModel) => void) {
  fs.mkdirSync('artifacts', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('artifacts/function-calls-'));
  try {
    fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'esnext', moduleResolution: 'bundler', strict: true }, include: ['**/*.ts'],
    }));
    for (const [file, source] of Object.entries(fixtures[name])) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), source);
    }
    action(ProjectModel.fromTsConfig(path.join(root, 'tsconfig.json')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('cycles include self-recursion and cross-module imported aliases with real witnesses', () => {
  withProject('cycles', project => {
    const findings = functionCyclesRule.analyze(project, config);
    assert.equal(findings.length, 2);
    assert.ok(findings.every(finding => finding.rule === 'HL120' && finding.severity === 'error' && finding.line === 1));
    assert.ok(findings.some(finding => /self .* -> self /.test(finding.message)));
    assert.ok(findings.some(finding => /2 functions/.test(finding.message) && /first/.test(finding.message) && /second/.test(finding.message)));
    const graph = functionCallGraph(project);
    const first = [...graph.functions].find(([, entry]) => entry.name === 'first')![0];
    assert.equal(functionGenerations(graph).get(first), undefined);
    assert.equal(functionGenerations(graph, 'module').get(first)?.depth, 1);
  });
});

test('longest leaf distance exposes shortcuts and enforces the inclusive configured bound', () => {
  withProject('generations', project => {
    const graph = functionCallGraph(project);
    const generations = functionGenerations(graph);
    assert.deepEqual(Object.fromEntries([...graph.functions].map(([node, entry]) => [entry.name, generations.get(node)?.depth])),
      { three: 3, two: 2, one: 1, leaf: 0 });
    const findings = functionGenerationGapRule.analyze(project, { ...config, functionCalls: { ...config.functionCalls, sourceMaximumGenerationGap: 2 } });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, 'HL121');
    assert.equal(findings[0].line, 1);
    assert.match(findings[0].message, /three -> leaf.*3 generations.*maximum 2/);
    assert.match(findings[0].message, /Longest caller chain: three .* -> two .* -> one .* -> leaf /);
    assert.equal(functionGenerationGapRule.analyze(project, { ...config, functionCalls: { ...config.functionCalls, sourceMaximumGenerationGap: 1 } }).length, 2);
    assert.equal(functionGenerationGapRule.analyze(project, { ...config, functionCalls: { ...config.functionCalls, sourceMaximumGenerationGap: 3 } }).length, 0);
  });
});

test('overloads, arrows, constructors, instance and object methods resolve to implementations', () => {
  withProject('implementations', project => {
    const findings = functionCyclesRule.analyze(project, config);
    assert.equal(findings.length, 6);
    for (const name of ['overloaded', 'arrow', 'constructor', 'method', 'run']) {
      assert.ok(findings.some(finding => finding.message.includes(`${name} (`)), name);
    }
  });
});

test('nested bodies belong to their own functions; passing or returning a function is not an invocation', () => {
  withProject('ownership', project => {
    assert.deepEqual(functionCyclesRule.analyze(project, config), []);
    const graph = functionCallGraph(project);
    const outer = [...graph.functions].find(([, entry]) => entry.name === 'outer')![0];
    assert.equal(graph.edges.get(outer)!.size, 0);
    const inner = [...graph.functions].find(([, entry]) => entry.name === 'inner')![0];
    assert.ok(graph.edges.get(inner)!.has(outer));
  });
});

test('cycles and every caller reaching them have undefined generations', () => {
  withProject('cycleAncestors', project => {
    assert.equal(functionCyclesRule.analyze(project, config).length, 1);
    assert.deepEqual(functionGenerationGapRule.analyze(project, config), []);
    const graph = functionCallGraph(project);
    assert.equal(functionGenerations(graph).size, 1);
  });
});

test('directory reexports preserve cross-module generation edges', () => {
  withProject('reexports', project => {
    const findings = functionGenerationGapRule.analyze(project, { ...config, functionCalls: { ...config.functionCalls, sourceMaximumGenerationGap: 1 } });
    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /top -> leaf/);
    assert.equal(findings[0].module, 'b');
  });
});

test('implementation depth behind a module interface does not change caller gap findings', () => {
  const evidence: { findings: unknown; depth: number | undefined }[] = [];
  for (const name of ['boundaryShallow', 'boundaryDeep']) {
    withProject(name, project => {
      const graph = functionCallGraph(project);
      const caller = [...graph.functions].find(([, entry]) => entry.name === 'top')![0];
      const findings = functionGenerationGapRule.analyze(project, {
        ...config, functionCalls: { ...config.functionCalls, sourceMaximumGenerationGap: 1 },
      });
      assert.equal(findings.length, 2);
      assert.ok(findings.every(finding => finding.module === 'consumer'));
      assert.ok(findings.some(finding => /top -> leaf/.test(finding.message)));
      assert.ok(findings.some(finding => /top -> api/.test(finding.message)));
      const scoped = moduleGenerationGaps(graph);
      assert.equal(scoped.generations.get(caller)?.depth, 2);
      const directInterface = scoped.edges.find(edge => edge.caller === caller && graph.functions.get(edge.target)!.name === 'api');
      assert.equal(directInterface?.to, 0);
      assert.equal(directInterface?.gap, 2);
      evidence.push({ findings, depth: functionGenerations(graph).get(caller)?.depth });
    });
  }
  assert.deepEqual(evidence[0].findings, evidence[1].findings);
  assert.ok(evidence[1].depth! > evidence[0].depth!, 'global call-depth evidence remains available');
});

test('graph algorithms handle long chains and produce actual directed witness edges', () => {
  const graph = new Map(Array.from({ length: 15000 }, (_, i) => [i, new Set(i ? [i - 1] : [])]));
  assert.equal(stronglyConnectedComponents(graph).length, graph.size);
  graph.get(0)!.add(14999);
  const groups = stronglyConnectedComponents(graph);
  assert.equal(groups.length, 1);
  const witness = cycleWitness(graph, groups[0]);
  assert.equal(witness[0], witness.at(-1));
  assert.equal(witness.length, graph.size + 1);
  for (let i = 1; i < witness.length; i++) assert.ok(graph.get(witness[i - 1])!.has(witness[i]));
});

test('source and test limits validate independently and accept false as disabled', () => {
  fs.mkdirSync('artifacts', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('artifacts/call-config-'));
  try {
    for (const key of ['sourceMaximumGenerationGap', 'testMaximumGenerationGap']) {
      for (const invalid of [0, -1, 1.5, '2', true, null, undefined]) {
        fs.writeFileSync(path.join(root, 'hyperlinter.config.json'), JSON.stringify({
          ...config, functionCalls: { ...config.functionCalls, [key]: invalid },
        }));
        assert.throws(() => loadHyperlinterConfig(root), new RegExp(`functionCalls.${key}`));
      }
      for (const valid of [false, 1, 4]) {
        fs.writeFileSync(path.join(root, 'hyperlinter.config.json'), JSON.stringify({
          ...config, functionCalls: { ...config.functionCalls, [key]: valid },
        }));
        assert.equal(loadHyperlinterConfig(root).functionCalls[key as keyof typeof config.functionCalls], valid);
      }
    }
    assert.deepEqual(config.functionCalls, { sourceMaximumGenerationGap: 4, testMaximumGenerationGap: false });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('test classification covers test directories and colocated test/spec files without matching source names', () => {
  for (const file of ['tests/helper.ts', 'test/index.ts', 'src/__tests__/helper.ts', 'src/unit.test.ts',
    'src/unit.spec.tsx', 'packages/a/test/helper.ts', 'src/check.test.mts', 'src/check.spec.cts', 'tests\\helper.ts']) {
    assert.equal(isTestFile(file), true, file);
  }
  for (const file of ['src/contest.ts', 'src/testsHelper.ts', 'src/test.ts', 'src/latest.ts', 'src/index.ts']) {
    assert.equal(isTestFile(file), false, file);
  }
});

test('caller classification applies independent limits; disabled tests still contribute graph evidence', () => {
  withProject('policies', project => {
    const analyze = (source: number | false, tests: number | false) => functionGenerationGapRule.analyze(project, {
      ...config, functionCalls: { sourceMaximumGenerationGap: source, testMaximumGenerationGap: tests },
    });
    const defaults = functionGenerationGapRule.analyze(project, config);
    assert.equal(defaults.length, 1);
    assert.equal(defaults[0].file, 'src/index.ts');
    assert.match(defaults[0].message, /5 generations.*maximum 4/);
    const all = analyze(4, 4);
    assert.equal(all.length, 2);
    assert.equal(all.filter(finding => isTestFile(finding.file!)).length, 1);
    const testsOnly = analyze(false, 5);
    assert.equal(testsOnly.length, 1);
    assert.ok(testsOnly.every(finding => isTestFile(finding.file!)));
    // All test callers remain in global evidence. Only the colocated test shares
    // the source module's private chain; other modules call interface leaves.
    const graph = functionCallGraph(project);
    const global = functionGenerations(graph);
    const exercises = [...graph.functions].filter(([, entry]) => entry.name === 'exercise');
    assert.equal(exercises.length, 4);
    assert.ok(exercises.every(([node]) => global.get(node)?.depth === 6));
    assert.deepEqual(analyze(false, false), []);
    assert.deepEqual(analyze(5, 6), []);
    assert.deepEqual(analyze(4, false), defaults);
  });
  withProject('cycles', project => {
    const disabled = { ...config, functionCalls: { sourceMaximumGenerationGap: false as const, testMaximumGenerationGap: false as const } };
    assert.deepEqual(functionGenerationGapRule.analyze(project, disabled), []);
    assert.equal(functionCyclesRule.analyze(project, disabled).length, 2);
  });
});
