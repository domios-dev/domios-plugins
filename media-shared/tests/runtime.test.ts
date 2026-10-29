import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaCore } from '../src/core';
import type { Access, Continuation, JobStore, Observation } from '../src/contracts';
import { totals } from '../src/cost';
import { harness, request } from './fixtures/harness';

function plain<T>(value: T): T {
  assert.ok(!value || typeof (value as { then?: unknown }).then !== 'function');
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
  return value;
}
function setup(kind: 'async' | 'sync' | 'stream' = 'async') {
  const h = harness();
  const access: Access = { scope: h.run, current: true, inputsAuthorized: true };
  const owner: Access = { scope: h.human, current: true, inputsAuthorized: true };
  const core = () => new MediaCore(h.ports.store!, h.now, h.ports.maxHistory, kind, r => r.operation === 'render');
  const c = core(); plain(c.intent(access, 'one', request()));
  const estimate = plain(c.beginEstimate(access, 'one', true));
  plain(c.estimated(access, estimate.continuation!, { amount: 12, unit: 'usd_micro', binding: estimate.job.binding,
    safe: true, basis: 'exact account quote', tariffRevision: '1', issuedAt: h.now(), validUntilMs: 1100 }));
  plain(c.approve(owner, 'one', { amount: 12, unit: 'usd_micro' }));
  return { h, access, owner, core, c };
}

/** Per-call explicit callback fixture. Its marker shape is test-only, not an SDK marker implementation. */
function explicitHost() {
  let sequence = 0;
  const callbacks = new Map<number, (value: unknown) => unknown>();
  return {
    awaitJob(hostJobId: string, continuation: (value: unknown) => unknown) {
      assert.ok(hostJobId.startsWith('host-job-')); // A sanctioned host job, never a provider job id or Promise.
      const callback = ++sequence; callbacks.set(callback, continuation);
      return { fixtureHostJob: hostJobId, callback };
    },
    resume(marker: { callback: number }, value: unknown) {
      const callback = callbacks.get(marker.callback)!; callbacks.delete(marker.callback);
      return callback(value);
    },
  };
}

test('sync facade returns plain JSON and explicit callbacks resume the same persisted intent and same-job receipt', () => {
  const s = setup(); const host = explicitHost(); let submissions = 0; let providerId: string | undefined;
  const start = plain(s.c.beginStart(s.access, 'one', true));
  const retained: Continuation = JSON.parse(JSON.stringify(start.continuation));
  assert.equal(start.job.phase, 'preflight'); assert.equal(start.job.reservation, undefined);
  const preflightMarker = host.awaitJob('host-job-preflight', authority => {
    const access = authority as Access; const c = s.core(); // fresh callback/VM facade, same durable store
    plain(c.reserve(access, retained));
    const entered = plain(c.enter(access, retained));
    assert.equal(entered.action!.intentId, 'one'); assert.equal(entered.action!.continuation.binding, start.job.binding);
    submissions++;
    // An export AND a nested callback return the explicit marker; no arbitrary Promise pumping.
    return host.awaitJob('host-job-submit', value => plain(s.core().observation(retained, value as Observation)));
  });
  const submitMarker = plain(host.resume(preflightMarker, s.access)) as { fixtureHostJob: string; callback: number };
  assert.equal(submitMarker.fixtureHostJob, 'host-job-submit'); assert.equal(submissions, 1);
  const queued = plain(host.resume(submitMarker, { jobId: 'ticket-7', state: 'queued', providerState: 'pending' })) as { job: { jobId: string } };
  providerId = queued.job.jobId; assert.equal(providerId, 'ticket-7');
  const inspect = plain(s.core().beginReconcile(s.access, 'one'));
  assert.equal(inspect.job.jobId, providerId);
  const statusMarker = host.awaitJob('host-job-inspect', value => {
    const c = s.core(); const receipt = plain(c.observation(inspect.continuation!, value as Observation));
    assert.equal(receipt.saveOutputs, true); assert.equal(receipt.job.phase, 'receipt');
    return plain(c.complete(inspect.continuation!, [{ kind: 'artifact', id: 'saved-owned-output', contentType: 'image/png' }]));
  });
  const done = plain(host.resume(statusMarker, { jobId: providerId, state: 'generated', providerState: 'done', charged: { amount: 12, unit: 'usd_micro' } })) as { state: string; jobId: string };
  assert.equal(done.state, 'generated'); assert.equal(done.jobId, providerId); assert.equal(submissions, 1);
  assert.equal(plain(s.core().history(s.owner)).length, 1);
});

for (const outcome of ['expired', 'revoked', 'input-revoked'] as const) test(`explicit preflight continuation ${outcome} never emits a submission`, () => {
  const s = setup(); const host = explicitHost(); let submissions = 0;
  const start = plain(s.c.beginStart(s.access, 'one', true));
  const marker = host.awaitJob('host-job-preflight', value => {
    const access = value as Access; const c = s.core();
    const reserved = plain(c.reserve(access, start.continuation!));
    if (reserved.state === 'waiting') return reserved;
    const boundary = plain(c.enter(access, start.continuation!));
    if (boundary.action) submissions++;
    return boundary.job;
  });
  if (outcome === 'expired') {
    s.h.tick(1100); const result = plain(host.resume(marker, s.access)) as { waitReason: string };
    assert.equal(result.waitReason, 'price_stale');
  } else assert.throws(() => host.resume(marker, { ...s.access, current: outcome !== 'revoked', inputsAuthorized: outcome !== 'input-revoked' }),
    outcome === 'revoked' ? /stale_authority/ : /input_unavailable/);
  assert.equal(submissions, 0); assert.equal(s.h.data().jobs[0].state, 'waiting');
  assert.deepEqual(totals(s.h.data().jobs, 'run-1'), { spent: {}, reserved: {}, unknown: 0 });
});

for (const kind of ['async', 'sync', 'stream'] as const) test(`${kind}: synchronous submit/receipt phases survive recovery without paid replay`, () => {
  const s = setup(kind); const start = plain(s.c.beginStart(s.access, 'one', true));
  plain(s.c.reserve(s.access, start.continuation!));
  const enter = plain(s.c.enter(s.access, start.continuation!));
  assert.equal(enter.action!.kind, kind); assert.equal(s.h.data().jobs[0].phase, 'submitting');
  assert.throws(() => s.c.enter(s.access, start.continuation!), /intent_conflict/);
  assert.throws(() => s.c.releasePreflight(start.continuation!), /effect_already_entered/);
  if (kind === 'async') plain(s.c.observation(start.continuation!, { jobId: 'ticket-7', state: 'generated', providerState: 'done' }));
  else plain(s.c.beginOutput(start.continuation!));
  assert.equal(s.h.data().jobs[0].phase, 'receipt');
  const recovered = plain(s.core().recover(s.owner));
  assert.equal(recovered[0].state, 'unknown'); assert.equal(recovered[0].accounting, 'unknown');
  assert.equal(plain(s.core().beginStart(s.access, 'one', true)).continuation, undefined);
  assert.throws(() => s.core().complete(start.continuation!, [{ kind: 'artifact', id: 'late', contentType: 'audio/mpeg' }]), /stale_continuation/);
  if (kind === 'async') {
    const reconcile = plain(s.core().beginReconcile(s.access, 'one')); assert.equal(reconcile.job.jobId, 'ticket-7');
    const wrong = plain(s.core().observation(reconcile.continuation!, { jobId: 'other', state: 'queued', providerState: 'pending' }));
    assert.equal(wrong.job.state, 'unknown'); assert.equal(wrong.job.jobId, 'ticket-7');
  }
});

test('preflight recovery fences old callbacks while submitted recovery cannot release its hold', () => {
  const s = setup(); const first = plain(s.c.beginStart(s.access, 'one', true));
  plain(s.core().recover(s.owner));
  assert.equal(s.h.data().jobs[0].state, 'waiting'); assert.equal(s.h.data().jobs[0].reservation, undefined);
  const next = plain(s.core().beginStart(s.access, 'one', true));
  assert.notEqual(next.continuation!.epoch, first.continuation!.epoch);
  assert.throws(() => s.core().reserve(s.access, first.continuation!), /stale_continuation/);
  plain(s.core().reserve(s.access, next.continuation!)); plain(s.core().enter(s.access, next.continuation!));
  const unknown = plain(s.core().unknown(next.continuation!)); assert.equal(unknown.reservation!.amount, 12);
  assert.throws(() => s.core().releasePreflight(next.continuation!), /effect_already_entered/);
});

test('reserved recovery releases known non-entry and fences the old submission continuation', () => {
  const s = setup();
  const start = plain(s.c.beginStart(s.access, 'one', true));
  plain(s.c.reserve(s.access, start.continuation!));
  assert.equal(s.h.data().jobs[0].phase, 'reserved');
  const recovered = plain(s.core().recover(s.owner));
  assert.equal(recovered[0].state, 'waiting');
  assert.equal(recovered[0].reservation, undefined);
  assert.equal(recovered[0].accounting, undefined);
  assert.deepEqual(totals(s.h.data().jobs, 'run-1'), { spent: {}, reserved: {}, unknown: 0 });
  assert.throws(() => s.core().enter(s.access, start.continuation!), /stale_continuation/);
});

for (const state of ['queued', 'failed', 'canceled'] as const) test(`deferred ${state} receipt preserves identity through auxiliary validation`, () => {
  const s = setup();
  const start = plain(s.c.beginStart(s.access, 'one', true));
  plain(s.c.reserve(s.access, start.continuation!));
  plain(s.c.enter(s.access, start.continuation!));
  const received = plain(s.c.observation(start.continuation!, { jobId: 'ticket-7', state, providerState: state }, true));
  assert.equal(received.job.phase, 'receipt');
  assert.equal(received.job.jobId, 'ticket-7');
  assert.equal(received.saveOutputs, false);
  const unknown = plain(s.c.unknown(start.continuation!));
  assert.equal(unknown.state, 'unknown');
  assert.equal(unknown.jobId, 'ticket-7');
  const check = plain(s.c.beginReconcile(s.access, 'one'));
  plain(s.c.observation(check.continuation!, { jobId: 'ticket-7', state, providerState: state }, true));
  const finalized = plain(s.c.complete(check.continuation!, []));
  assert.equal(finalized.state, state);
  assert.equal(finalized.jobId, 'ticket-7');
  assert.equal(finalized.phase, undefined);
});

test('deferred completed receipt still requires saved outputs', () => {
  const s = setup();
  const start = plain(s.c.beginStart(s.access, 'one', true));
  plain(s.c.reserve(s.access, start.continuation!));
  plain(s.c.enter(s.access, start.continuation!));
  plain(s.c.observation(start.continuation!, { jobId: 'ticket-7', state: 'generated', providerState: 'completed' }, true));
  assert.throws(() => s.c.complete(start.continuation!, []), /invalid_outputs/);
  assert.equal(s.h.data().jobs[0].jobId, 'ticket-7');
});

for (const state of ['generated', 'failed', 'canceled'] as const) test(`uncertain cancellation remains requested until exact-job ${state}`, () => {
  const s = setup();
  const start = plain(s.c.beginStart(s.access, 'one', true));
  plain(s.c.reserve(s.access, start.continuation!));
  plain(s.c.enter(s.access, start.continuation!));
  plain(s.c.observation(start.continuation!, { jobId: 'ticket-7', state: 'queued', providerState: 'queued' }));
  const cancel = plain(s.c.beginCancel(s.access, 'one', { queued: true, running: false }));
  const unknown = plain(s.c.unknown(cancel.continuation!));
  assert.equal(unknown.cancelRequested, true);
  assert.equal(unknown.state, 'unknown');
  assert.equal(unknown.jobId, 'ticket-7');
  const check = plain(s.c.beginReconcile(s.access, 'one'));
  const observed = plain(s.c.observation(check.continuation!, { jobId: 'ticket-7', state, providerState: state }));
  const done = observed.saveOutputs ? plain(s.c.complete(check.continuation!, [{ kind: 'artifact', id: 'saved', contentType: 'audio/mpeg' }])) : observed.job;
  assert.equal(done.cancelRequested, false);
  assert.equal(done.jobId, 'ticket-7');
  assert.equal(done.state, state);
});

test('sync facade rejects a thenable store result and a Promise-valued schema validator', () => {
  const s = setup();
  const bad = { transact: () => Promise.resolve([]) } as unknown as JobStore;
  assert.throws(() => new MediaCore(bad, s.h.now, 32, 'async', () => true).history(s.owner), /synchronous_storage_required/);
  const validator = (() => Promise.resolve(true)) as unknown as (r: ReturnType<typeof request>) => boolean;
  assert.throws(() => new MediaCore(s.h.ports.store!, s.h.now, 32, 'async', validator).intent(s.access, 'bad', request()), /invalid_request/);
});
