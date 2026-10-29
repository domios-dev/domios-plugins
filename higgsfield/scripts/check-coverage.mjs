import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

const root = new URL('../', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name, root), 'utf8').replace(/^\uFEFF/, ''));
export function check(index = read('adapter-index.json'), contracts = read('adapter-contracts.json')) {
  const { models } = read('models.json'), protocol = read('contracts.json'), snapshot = read('capabilities.json');
  const expected = [...models.map(m => ({ ...m, type: 'model' })), ...protocol.operations.map(o => ({ ...o, type: 'operation' }))];
  assert.equal(expected.length, snapshot.coverage.length);
  assert.equal(index.rows.length, expected.length);
  assert.equal(new Set(index.rows.map(r => r.id)).size, expected.length);
  assert.ok(contracts.families.length > 0 && contracts.families.length <= 32);
  assert.equal(new Set(contracts.families.map(f => f.id)).size, contracts.families.length);
  assert.equal(contracts.status, 'source-only-registration-withheld');
  assert.equal(contracts.paramsType, 'closed-operation-schema-registry');
  assert.deepEqual(contracts.outcomes, ['done', 'waiting', 'submitting', 'queued', 'generating', 'failed', 'canceled', 'unknown']);
  for (const f of contracts.families) {
    assert.match(f.id, /^higgsfield\.[a-z-]+$/);
    assert.ok(['image','video','reference','operation'].includes(f.category));
    assert.equal(f.output, ['reference','operation'].includes(f.category) ? 'json' : f.category);
  }
  for (const row of expected) {
    const r = index.rows.find(r => r.id === row.id), original = snapshot.coverage.find(r => r.id === row.id);
    assert.ok(r && original, `missing ${row.id}`);
    assert.equal(r.type, row.type);
    assert.equal(r.command, row.type === 'model' ? 'prepare' : 'describe');
    assert.equal(r.node, row.type === 'model' ? `higgsfield.generate-${row.category}` : 'higgsfield.metadata');
    assert.ok(contracts.families.some(f => f.id === r.node));
    assert.equal(r.schemaRef, `${row.type === 'model' ? 'models' : 'contracts'}.json#${row.id}`);
    assert.equal(r.docs, row.source.url);
    assert.equal(r.sourceDate, row.source.retrievedDate);
    assert.equal(r.productionReady, false);
    assert.equal(r.status, 'source-discovery-with-external-limitations');
    assert.ok(isDeepStrictEqual(original.source, row.source));
  }
  assert.deepEqual(index.aliases, snapshot.uiAliases.map(a => ({ id: a.id, target: a.target, source: a.source.url })));
  assert.deepEqual(index.consoleControls, protocol.consoleControls.map(c => ({ id: c.id, source: c.source, disposition: c.commandDisposition })));
  assert.deepEqual(index.notDocumented, snapshot.notDocumented);
  assert.equal(index.guide, 'COMMANDS.md');
  assert.ok(readFileSync(new URL(index.guide, root), 'utf8').includes('registration withheld'));
  return expected.length;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const count = check(); let negatives = 0;
  for (const mutate of [
    (i, c) => i.rows.pop(),
    (i, c) => { c.families[0].output = 'text'; },
    (i, c) => { c.outcomes.push('paid-retry'); },
    (i, c) => { i.rows[0].productionReady = true; },
  ]) {
    const i = read('adapter-index.json'), c = read('adapter-contracts.json'); mutate(i, c);
    assert.throws(() => check(i, c)); negatives++;
  }
  console.log(`PASS ${count} source rows; aliases/console/absence declarations; ${negatives} negative mutations rejected. Registration/live proof withheld.`);
}
