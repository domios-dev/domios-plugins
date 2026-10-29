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

