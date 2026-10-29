import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHost, surface, document } from './runtime-fixture';
import { createRuntime } from '../src/runtime';
import { hostStore, documentAccess } from '../../media-shared/src/host-runtime';
import { MediaCore } from '../../media-shared/src/core';
import type { Access } from '../../media-shared/src/contracts';

test('Higgsfield discovery works without reading secrets or starting transport; paid entry refuses', () => {
  const runtime = createRuntime(fakeHost().host);
  const catalog = JSON.parse(runtime.onSurfaceCall(surface, 'catalog', []));
  assert.ok(catalog.models.length > 0);
  assert.equal(catalog.runtime.submission, false);
  assert.equal(JSON.parse(runtime.onSurfaceCall(surface, 'submit', [])).paid, false);
  assert.equal(JSON.parse(runtime.onSurfaceCall({ ...surface, actor: 'other' }, 'catalog', [])).error, 'request_refused');
  assert.equal(runtime.onAgentCommand({ verb: 'submit', args: ['owner=spoof'] } as any).error, 'invalid_arguments');
});
test('Higgsfield document history uses host document context; surface/foreign contexts refuse', () => {
  const runtime = createRuntime(fakeHost().host);
  assert.ok(Array.isArray((runtime.viewCall('ui.snapshot', {}, document) as any).items));
  assert.ok((runtime.viewCall('ui.snapshot', {}, surface) as any).error);
  assert.throws(() => documentAccess('higgsfield', { ...document, plugin: 'foreign' }));
  assert.equal(documentAccess('higgsfield', document).scope.human, false);
});
test('host-backed ledger preserves unknown across recreation and never enters that intent again', () => {
  const { host } = fakeHost();
  const access: Access = { current: true, inputsAuthorized: true, scope: { owner: 'owner', workspace: 'workspace', actorId: 'actor',
    actor: { kind: 'you' }, human: true, authRevision: 'test-only' } };
  const store = hostStore(host, 'higgsfield');
  const core = new MediaCore(store, () => 100, 10, 'sync', () => true);
  const job = core.intent(access, 'intent', { operation: 'fixture', revision: '1', params: {}, inputs: [], unit: 'usd_micro' });
  const estimating = core.beginEstimate(access, job.id, true);
  core.estimated(access, estimating.continuation!, { binding: job.binding, amount: 10, unit: 'usd_micro', safe: true,
    basis: 'synthetic boundary test only', tariffRevision: 'fixture', issuedAt: 1, validUntilMs: 200 });
  core.approve(access, job.id, { amount: 10, unit: 'usd_micro' });
  store.transact('owner', 'workspace', d => { d.ceilings.usd_micro = 100; });
  const starting = core.beginStart(access, job.id, true);
  core.reserve(access, starting.continuation!);
  assert.ok(core.enter(access, starting.continuation!).action);
  const recreated = new MediaCore(hostStore(host, 'higgsfield'), () => 101, 10, 'sync', () => true);
  recreated.recover(access);
  const recovered = recreated.history(access)[0];
  assert.equal(recovered.state, 'unknown');
  assert.equal(recovered.accounting, 'unknown');
  assert.equal(recovered.reservation?.amount, 10);
  assert.equal(recreated.beginStart(access, job.id, true).continuation, undefined);
});
test('locked and corrupt ledgers refuse without replacing persisted data', () => {
  const { host, files } = fakeHost();
  const store = hostStore(host, 'higgsfield');
  store.transact('owner', 'workspace', () => undefined);
  const path = [...files.keys()][0];
  files.set(path, '{broken');
  assert.throws(() => store.transact('owner', 'workspace', () => undefined));
  assert.equal(files.get(path), '{broken');
  host.fs.lockFile('held');
  assert.throws(() => store.transact('owner', 'workspace', () => undefined), /store_busy/);
});


import { deliveredHost } from './runtime-fixture';
import { HostEntryGate } from '../../media-shared/src/host-entry';

test('protected SOUL2 path quotes exact defaults, waits for host approval, persists once and downloads without credentials', () => {
  const f = deliveredHost(), runtime = createRuntime(f.host);
  const prepared = JSON.parse(runtime.onSurfaceCall(surface, 'prepare', [JSON.stringify({ prompt: 'Quiet cover' })]));
  assert.equal(prepared.state, 'waiting_for_owner');
  assert.equal(prepared.quote.amount, 94000); // Fixture amount only.
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.requests[0].body.value, { prompt: 'Quiet cover', resolution: '720p', aspect_ratio: '1:1', batch_size: 1, enhance_prompt: false, seed: 42 });
  assert.equal(f.requests[0].credential.name, 'higgsfield-api-key');
  assert.ok(JSON.parse(runtime.onSurfaceCall(surface, 'submit', [JSON.stringify({ id: prepared.id })])).error);
  assert.equal(f.requests.length, 1);
  f.approve(prepared.id);
  assert.equal(JSON.parse(runtime.onSurfaceCall(surface, 'submit', [JSON.stringify({ id: prepared.id })])).state, 'queued');
  assert.equal(f.requests[1].headers['Idempotency-Key'], prepared.id);
  const output = JSON.parse(runtime.onSurfaceCall(surface, 'reconcile', [JSON.stringify({ id: prepared.id })]));
  assert.equal(output.state, 'generated');
  assert.equal(f.requests[3].credential, undefined);
  assert.equal(runtime.mediaFile(output.media, document)?.path, 'receipt-cover.png');
  assert.equal(runtime.mediaFile(output.media, { ...document, owner: 'other' }), null);
  assert.equal(JSON.parse(runtime.onSurfaceCall(surface, 'result', [JSON.stringify({ id: prepared.id })])).reservation.amount, 94000);
  const count = f.requests.length;
  const restarted = createRuntime(f.host);
  f.advance(86400100);
  assert.ok(JSON.parse(restarted.onSurfaceCall(surface, 'submit', [JSON.stringify({ id: prepared.id })])).error);
  assert.equal(f.requests.length, count);
});

test('fresh host boundary refuses foreign, altered, expired and JSON-reconstructed entry receipts', () => {
  for (const change of [
    (r: any) => { r.scope.owner = 'foreign'; },
    (r: any) => { r.scope.workspace = 'foreign'; },
    (r: any) => { r.origin.actor = 'foreign'; },
    (r: any) => { r.quote.binding = 'f'.repeat(64); },
    (r: any) => { r.quote.amount++; },
    (r: any) => { r.quote.unit = 'characters'; },
    (r: any) => { r.request.params.prompt = 'changed'; },
    (r: any) => { r.enteredAtMs = 999999; },
  ]) {
    const f = deliveredHost(), runtime = createRuntime(f.host);
    const q = JSON.parse(runtime.onSurfaceCall(surface, 'prepare', ['{"prompt":"Boundary"}']));
    f.approve(q.id); f.mutateEntry(r => { change(r); return r; });
    assert.ok(JSON.parse(runtime.onSurfaceCall(surface, 'submit', [JSON.stringify({ id: q.id })])).error);
    assert.equal(f.requests.length, 1, 'only free estimate, no paid transfer');
  }
  const f = deliveredHost(), store = hostStore(f.host, 'higgsfield');
  const core = new MediaCore(store, () => 100, 100, 'sync', () => true);
  assert.throws(() => core.enterHost({ current: true, scope: { owner: 'owner', workspace: 'workspace', actorId: 'owner', human: false, actor: { kind: 'you' }, authRevision: 'fixture' } }, 'id', JSON.parse('{"freshHostEntry":true}')), /fresh_host_entry_required/);
  const runtime = createRuntime(f.host), q = JSON.parse(runtime.onSurfaceCall(surface, 'prepare', ['{"prompt":"Expiry"}']));
  f.approve(q.id); f.advance(121000);
  assert.equal(JSON.parse(runtime.onSurfaceCall(surface, 'submit', [JSON.stringify({ id: q.id })])).state, 'expired_readmit_needed');
  assert.equal(f.requests.length, 1);
});

test('crash between host entry and plugin persistence remains unknown after restart; stored status never dispatches', () => {
  const f = deliveredHost(), runtime = createRuntime(f.host);
  const q = JSON.parse(runtime.onSurfaceCall(surface, 'prepare', ['{"prompt":"Crash gap"}']));
  f.approve(q.id);
  assert.ok('freshHostEntry' in new HostEntryGate(f.host.jobs).enter(q.id, f.records.get(q.id).spend.request));
  const restarted = createRuntime(f.host), state = JSON.parse(restarted.onSurfaceCall(surface, 'status', [JSON.stringify({ id: q.id })]));
  assert.equal(state.state, 'unknown'); assert.equal(state.reservation.amount, 94000);
  assert.ok(JSON.parse(restarted.onSurfaceCall(surface, 'submit', [JSON.stringify({ id: q.id })])).error);
  assert.equal(f.requests.length, 1);
});

test('host entry proof is consumed exactly once; JSON copies and expiry during entry cannot dispatch', () => {
  const f = deliveredHost(), runtime = createRuntime(f.host);
  const q = JSON.parse(runtime.onSurfaceCall(surface, 'prepare', ['{"prompt":"One proof"}']));
  f.approve(q.id);
  const core = new MediaCore(hostStore(f.host, 'higgsfield'), () => f.host.unixNowMs(), 100, 'async', () => true);
  const access = { current: true, inputsAuthorized: true, scope: { owner: 'owner', workspace: 'workspace', actorId: 'owner', human: false, actor: { kind: 'agent' as const, label: 'Owner' }, authRevision: q.id } };
  const proof = new HostEntryGate(f.host.jobs).enter(q.id, f.records.get(q.id).spend.request) as any;
  assert.throws(() => core.enterHost(access, q.id, JSON.parse(JSON.stringify(proof))), /fresh_host_entry_required/);
  assert.ok(core.enterHost(access, q.id, proof).action);
  assert.throws(() => core.enterHost(access, q.id, proof), /fresh_host_entry_required/);
  assert.equal(core.history(access)[0].accounting, 'unknown');
  const late = deliveredHost(), other = createRuntime(late.host);
  const p = JSON.parse(other.onSurfaceCall(surface, 'prepare', ['{"prompt":"Entry deadline"}']));
  late.approve(p.id); late.mutateEntry(r => { late.advance(121000); return r; });
  assert.ok(JSON.parse(other.onSurfaceCall(surface, 'submit', [JSON.stringify({ id: p.id })])).error);
  assert.equal(late.requests.length, 1);
});
