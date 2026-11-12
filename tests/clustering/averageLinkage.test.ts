import assert from 'node:assert/strict';
import test from 'node:test';
import { averageLinkage } from '../../src/clustering';

const matrix = [[0, 0.1, 0.2, 0.8], [0.1, 0, 0.4, 0.8], [0.2, 0.4, 0, 0.5], [0.8, 0.8, 0.5, 0]];
const names = ['a', 'b', 'c', 'd'];
function run(order: number[], cut = 0.68) {
  const keys = order.map(i => names[i]);
  const result = averageLinkage(keys, (a, b) => matrix[order[a]][order[b]], cut);
  return { merges: result.merges, clusters: result.clusters.map(cluster => cluster.map(i => keys[i])) };
}

test('average linkage builds the full weighted merge tree and cuts it separately', () => {
  const result = run([0, 1, 2, 3]);
  assert.deepEqual(result.clusters, [['d'], ['c', 'a', 'b']]);
  assert.equal(result.merges.length, 3);
  assert.ok(Math.abs(result.merges[1].distance - 0.3) < 1e-12);
  // The 2-member AB cluster must retain twice the weight of C: (0.8 + 0.8 + 0.5) / 3.
  assert.ok(Math.abs(result.merges[2].distance - 0.7) < 1e-12);
  assert.deepEqual(run([0, 1, 2, 3], 1).clusters, [['d', 'c', 'a', 'b']]);
});

test('input permutations preserve the hierarchy and cluster memberships', () => {
  const expected = run([0, 1, 2, 3]);
  for (const order of [[3, 2, 1, 0], [2, 0, 3, 1], [1, 3, 0, 2]]) assert.deepEqual(run(order), expected);
});

test('stable keys break exact ties and average linkage does not enforce a maximum diameter', () => {
  const distances = [[0, 0.1, 0.5], [0.1, 0, 0.1], [0.5, 0.1, 0]];
  const keys = ['a', 'b', 'c'];
  const result = averageLinkage(keys, (a, b) => distances[a][b], 0.31);
  assert.deepEqual(result.merges[0], { left: 0, right: 1, distance: 0.1, size: 2 });
  assert.equal(result.clusters.length, 1); // Diameter 0.5 is greater than the mean-link cut 0.31.
  const shuffled = ['c', 'b', 'a'];
  const other = averageLinkage(shuffled, (a, b) => distances[keys.indexOf(shuffled[a])][keys.indexOf(shuffled[b])], 0.31);
  assert.deepEqual(other.merges, result.merges);
});

test('empty and singleton corpora, inclusive cutoffs and invalid distances', () => {
  assert.deepEqual(averageLinkage([], () => 0, 0), { leaves: [], clusters: [], merges: [] });
  assert.deepEqual(averageLinkage(['a'], () => 0, 0).clusters, [[0]]);
  assert.equal(averageLinkage(['a', 'b'], () => 0.25, 0.25).clusters.length, 1);
  assert.throws(() => averageLinkage(['a', 'b'], () => NaN, 0.25), /finite/);
  assert.throws(() => averageLinkage(['a'], () => 0, NaN), /cut/);
});

test('the globally closest pair merges before a merely acceptable pair', () => {
  const distances = [[0, 0.2, 0.21], [0.2, 0, 0.1], [0.21, 0.1, 0]];
  const result = averageLinkage(['a', 'b', 'c'], (a, b) => distances[a][b], 0.2);
  assert.deepEqual(result.merges[0], { left: 1, right: 2, distance: 0.1, size: 2 });
  assert.deepEqual(result.clusters, [[0], [1, 2]]);
});
