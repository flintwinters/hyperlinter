import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const Database = createRequire(import.meta.url)(process.argv[2]);
const file = process.argv[3];
for (let round = 0; round < 12; round++) {
  const database = new Database(file);
  database.exec('CREATE TABLE IF NOT EXISTS evidence (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  database.prepare('INSERT INTO evidence (value) VALUES (?)').run(`run-${round}`);
  // Short-lived statements become unreachable before V8's asynchronous GC,
  // reproducing cleanup without an active JS context on affected Node builds.
  for (let index = 0; index < 100; index++) database.prepare('SELECT count(*) AS count FROM evidence').get();
  database.close();
  console.log(`Closed round ${round}; collecting statements.`);
  await global.gc({ execution: 'async' });
}
const reopened = new Database(file);
assert.equal(reopened.prepare('SELECT count(*) AS count FROM evidence').get().count, 12);
reopened.close();
await global.gc({ execution: 'async' });
console.log('SQLite statements collected and persistent evidence reopened successfully.');
