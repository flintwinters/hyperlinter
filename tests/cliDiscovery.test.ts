import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { hyperlinterUpdateNotice } from '../src/commands';

function invokeCli(root: string, ...args: string[]) {
  return spawnSync(process.execPath,
    ['--import', path.resolve('node_modules/tsx/dist/loader.mjs'), path.resolve('src/cli.ts'), ...args],
    { cwd: root, encoding: 'utf8' });
}

test('discovery works without a project and never audits or mutates the target', t => {
  mkdirSync('artifacts', { recursive: true });
  const root = mkdtempSync(path.resolve('artifacts/cli-discovery-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // Deliberately invalid policy must not affect static discovery.
  writeFileSync(path.join(root, 'hyperlinter.config.json'), 'not JSON');
  const invoke = (...args: string[]) => {
    const result = invokeCli(root, ...args);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    return result.stdout;
  };
  const discovery = JSON.parse(invoke('--discover', '--fix'));
  assert.equal(discovery.schemaVersion, 1);
  assert.equal(discovery.defaultFormat, 'json');
  assert.deepEqual(JSON.parse(invoke('--help')), discovery);
  assert.deepEqual(JSON.parse(invoke('-h')), discovery);
  assert.deepEqual(JSON.parse(invoke('--help', '--format', 'json')), discovery);
  assert.ok(discovery.commands.some((command: { flag: string | null }) => command.flag === null));
  const commands = new Map<string, { json: boolean; writes: string[]; network: boolean }>(
    discovery.commands.map((command: { flag: string }) => [command.flag, command]));
  assert.deepEqual(commands.get('--check-colors')?.writes, []);
  assert.ok(commands.get('--fix')?.writes.includes('source'));
  assert.ok(commands.get('--write-baseline')?.writes.includes('baseline'));
  assert.equal(commands.get('--build-embeddings')?.network, true);
  assert.equal(commands.get('--source-budget')?.json, true);
  const help = invoke('--help', '--format=text');
  assert.equal(invoke('-h', '--format', 'text'), help);
  assert.equal(invoke('--discover', '--format=text'), help);
  for (const flag of commands.keys()) if (flag) assert.ok(help.includes(flag), flag);
  assert.match(help, /elevated Git access/);
  assert.deepEqual(readdirSync(root), ['hyperlinter.config.json']);
  assert.equal(readFileSync(path.join(root, 'hyperlinter.config.json'), 'utf8'), 'not JSON');
});

test('every discovered chronology exclusion is rejected before accessing the project', t => {
  mkdirSync('artifacts', { recursive: true });
  const root = mkdtempSync(path.resolve('artifacts/cli-conflicts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const invoke = invokeCli.bind(undefined, root);
  const discoveryResult = invoke('--discover', '--format=json');
  assert.equal(discoveryResult.status, 0, discoveryResult.stderr);
  const discovery = JSON.parse(discoveryResult.stdout);
  assert.ok(discovery.constraints.chronolintExcludes.length > 0);
  for (const flag of discovery.constraints.chronolintExcludes) {
    const result = invoke('--chronolint', flag);
    assert.equal(result.status, 1, flag);
    assert.match(result.stderr, /Chronolint must run separately/);
    assert.equal(result.stdout, '');
  }
  // Early-return modes previously ignored other commands silently.
  for (const flags of [['--check-colors', '--fix'], ['--history', '--check-agents']]) {
    const result = invoke(...flags);
    assert.equal(result.status, 1, flags.join(' '));
    assert.match(result.stderr, /Use one command per invocation/);
    assert.equal(result.stdout, '');
  }
  assert.deepEqual(readdirSync(root), []);
});

test('budget and baseline operations default to JSON and invalid formats fail before writes', t => {
  mkdirSync('artifacts', { recursive: true });
  const root = mkdtempSync(path.resolve('artifacts/cli-reports-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, '.git'));
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src/index.ts'), 'export const value = 1;\n');
  writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ include: ['src/**/*.ts'] }));
  writeFileSync(path.join(root, 'source-line-budget.json'), JSON.stringify({
    version: 1, sourceDirectories: ['src'], extensions: ['.ts'], growthIncrement: 100,
    requiredRefactorReduction: 10, checkpoints: [{ threshold: 100 }],
  }));
  const invoke = invokeCli.bind(undefined, root);
  for (const format of ['--format=xml', '--format=', '--format']) {
    const rejected = invoke('--write-inline-style-baseline', format);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /Invalid output format/);
    assert.equal(rejected.stdout, '');
    assert.deepEqual(readdirSync(path.join(root, '.git')), []);
  }
  const budget = invoke('--source-budget', 'check');
  assert.equal(budget.status, 0, budget.stderr);
  const report = JSON.parse(budget.stdout);
  assert.equal(report.total, 1);
  assert.equal(report.threshold, 200);
  const readable = invoke('--source-budget', 'check', '--format=text');
  assert.equal(readable.status, 0, readable.stderr);
  assert.equal(readable.stdout, `${report.message}\n`);
  const pending = invoke('--source-budget', 'advance-if-pending');
  assert.equal(pending.status, 0, pending.stderr);
  assert.equal(JSON.parse(pending.stdout).pending, false);
  const baseline = invoke('--write-inline-style-baseline');
  assert.equal(baseline.status, 0, baseline.stderr);
  const written = JSON.parse(baseline.stdout);
  assert.equal(written.baselinePath, path.join(root, '.git/hyperlinter/baseline.json'));
  assert.deepEqual(written.baseline, JSON.parse(readFileSync(written.baselinePath, 'utf8')));
});

test('update checks inspect the installed checkout and offer executable, non-destructive instructions', t => {
  mkdirSync('artifacts', { recursive: true });
  const root = mkdtempSync(path.resolve('artifacts/update-notice-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const upstream = path.join(root, 'upstream');
  const installed = path.join(root, "installed tool's checkout");
  mkdirSync(upstream);
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  git(upstream, 'init', '-b', 'main');
  git(upstream, 'config', 'user.email', 'test@example.com');
  git(upstream, 'config', 'user.name', 'Test');
  const commit = (value: string) => {
    writeFileSync(path.join(upstream, 'value'), value);
    git(upstream, 'add', 'value');
    git(upstream, 'commit', '-m', value);
  };
  commit('initial');
  git(root, 'clone', upstream, installed);
  assert.equal(hyperlinterUpdateNotice(installed), undefined);
  commit('update');
  const before = git(installed, 'rev-parse', 'HEAD');
  const notice = hyperlinterUpdateNotice(installed);
  assert.equal(notice?.severity, 'info');
  assert.equal(notice?.code, 'HYPERLINTER_UPDATE_AVAILABLE');
  assert.match(notice!.message, /submodule pointer/);
  assert.equal(git(installed, 'rev-parse', 'HEAD'), before);
  assert.deepEqual(notice!.commands[0], ['git', '-C', installed, 'fetch', 'origin', 'refs/heads/main']);
  for (const command of notice!.commands.slice(0, 2)) {
    execFileSync(command[0], command.slice(1), { stdio: 'pipe' });
  }
  assert.equal(hyperlinterUpdateNotice(installed), undefined);
  // A local development checkout ahead of upstream must not prompt for a downgrade.
  git(installed, '-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '--allow-empty', '-m', 'ahead');
  assert.equal(hyperlinterUpdateNotice(installed), undefined);
  git(installed, 'remote', 'set-url', 'origin', path.join(root, 'unavailable'));
  assert.equal(hyperlinterUpdateNotice(installed), undefined);
  git(installed, 'remote', 'remove', 'origin');
  assert.equal(hyperlinterUpdateNotice(installed), undefined);
  const unpacked = path.join(installed, 'unpacked');
  mkdirSync(unpacked);
  assert.equal(hyperlinterUpdateNotice(unpacked), undefined);
});
