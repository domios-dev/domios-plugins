import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaController } from '../src/controller';
import { totals, quoteState } from '../src/cost';
import { bindingOf } from '../src/contracts';
import type { Adapter, Amount, Quote } from '../src/contracts';
import { harness, request, deferred } from './fixtures/harness';
import { ticketFixture } from './fixtures/async-job';
import { byteFixture } from './fixtures/sync-stream';

async function ready(c: MediaController, h: ReturnType<typeof harness>, id = 'one', caller = h.agentCaller, maximum: Amount = { amount: 12, unit: 'usd_micro' }) {
  await c.intent(caller, id, request(maximum.unit));
  await c.estimate(caller, id);
  await c.approve(h.owner, id, maximum);
}

for (const transport of ['async', 'sync', 'stream'] as const) {
  test(`${transport}: actual common controller preserves lifecycle and idempotent intent`, async () => {
    const h = harness();
    const fixture = transport === 'async' ? ticketFixture(h.now) : byteFixture(h.now, transport === 'stream');
    const c = new MediaController(h.ports, fixture.adapter);
    await ready(c, h);
    const [a, b] = await Promise.all([c.start(h.agentCaller, 'one'), c.start(h.agentCaller, 'one')]);
    assert.equal(a.state, transport === 'async' ? 'queued' : 'generated');
    assert.ok(['starting', 'queued', 'generating', 'generated'].includes(b.state));
    await c.start(h.agentCaller, 'one');
    assert.equal(transport === 'async' ? (fixture as ReturnType<typeof ticketFixture>).stats().posts : (fixture as ReturnType<typeof byteFixture>).stats().calls, 1);
    const job = (await c.history(h.owner))[0];
    assert.equal(job.progress, undefined);
    if (transport === 'async') {
      assert.equal(job.jobId, 'ticket-7'); assert.deepEqual(job.outputs, []);
      const f = fixture as ReturnType<typeof ticketFixture>; f.phase('done', 12);
      const done = await c.reconcile(h.agentCaller, 'one');
      assert.equal(done.state, 'generated'); assert.equal(done.providerState, 'done');
      assert.equal(done.accounting, 'spent');
    } else {
      assert.equal(job.jobId, undefined);
      assert.deepEqual(Array.from(h.files.get(job.outputs[0].id)!.bytes), [255, 0, 195, 40, 128]);
      await assert.rejects(c.reconcile(h.agentCaller, 'one'), /reconcile_unavailable/);
      await assert.rejects(c.cancel(h.agentCaller, 'one'), /cancel_unavailable/);
    }
  });
  test(`${transport}: uncertainty never resumes a paid transport`, async () => {
    const h = harness();
    const f = transport === 'async' ? ticketFixture(h.now) : byteFixture(h.now, transport === 'stream');
    const c = new MediaController(h.ports, f.adapter);
    await ready(c, h);
    if (transport === 'async') (f as ReturnType<typeof ticketFixture>).fail(); else (f as ReturnType<typeof byteFixture>).break();
    const unknown = await c.start(h.agentCaller, 'one');
    assert.equal(unknown.state, 'unknown'); assert.equal(unknown.accounting, 'unknown'); assert.deepEqual(unknown.outputs, []);
    const restarted = new MediaController(h.ports, f.adapter);
    await restarted.recover(h.owner);
    await restarted.start(h.agentCaller, 'one');
    assert.equal(transport === 'async' ? (f as ReturnType<typeof ticketFixture>).stats().posts : (f as ReturnType<typeof byteFixture>).stats().calls, 1);
    assert.equal(totals(h.data().jobs, undefined).unknown, 1);
    await ready(c, h, 'two');
    assert.equal((await c.start(h.agentCaller, 'two')).waitReason, 'unknown_reservation');
  });
  test(`${transport}: independent fixture shares owner/run isolation and pending confirmation`, async () => {
    const h = harness(); const f = transport === 'async' ? ticketFixture(h.now) : byteFixture(h.now, transport === 'stream');
    const c = new MediaController(h.ports, f.adapter);
    await c.intent(h.runCaller, 'one', request());
    assert.equal((await c.estimate(h.runCaller, 'one')).waitReason, 'owner_confirmation');
    assert.equal((await c.start(h.runCaller, 'one')).state, 'waiting');
    for (const foreign of [h.caller({ ...h.human, owner: 'B' }), h.caller({ ...h.run, runId: 'run-2' }), h.agentCaller]) {
      assert.deepEqual(await c.history(foreign), []);
      await assert.rejects(c.start(foreign, 'one'), /job_unavailable/);
    }
    assert.equal((await c.history(h.owner)).length, 1);
  });
}

test('owner, workspace, agent and run authorization rejects forged and foreign identities', async () => {
  const h = harness(); const f = ticketFixture(h.now); const c = new MediaController(h.ports, f.adapter);
  await c.intent(h.agentCaller, 'one', request()); await c.intent(h.runCaller, 'run-job', request());
  const b = h.caller({ ...h.human, owner: 'B' });
  const w = h.caller({ ...h.human, workspace: 'other' });
  const otherAgent = h.caller({ ...h.agent, actorId: 'agent-2' });
  const otherRun = h.caller({ ...h.run, runId: 'run-2' });
  assert.equal((await c.history(h.owner)).length, 2);
  for (const caller of [b, w, otherAgent, otherRun]) {
    assert.deepEqual(await c.history(caller), []);
    await assert.rejects(c.estimate(caller, 'one'), /job_unavailable/);
  }
  assert.equal((await c.history(h.agentCaller)).length, 1);
  assert.equal((await c.history(h.runCaller)).length, 1);
  await assert.rejects(c.history({ ...h.human }), /authority_unavailable/);
  await assert.rejects(c.approve(h.agentCaller, 'one', { amount: 12, unit: 'usd_micro' }), /owner_approval_required/);
  await assert.rejects(c.intent(otherAgent, 'one', request()), /intent_conflict/);
  h.revoke(); await assert.rejects(c.start(h.agentCaller, 'one'), /authority_unavailable/);
  assert.equal(f.stats().posts, 0);
});

test('missing injected authority/storage/output/input capabilities refuse actual routes', async () => {
  const h = harness(); const f = ticketFixture(h.now);
  await assert.rejects(new MediaController({ ...h.ports, authority: undefined }, f.adapter).history(h.owner), /authority_unavailable/);
  await assert.rejects(new MediaController({ ...h.ports, store: undefined }, f.adapter).history(h.owner), /storage_unavailable/);
  const c = new MediaController({ ...h.ports, outputs: undefined }, f.adapter);
  await ready(c, h); await assert.rejects(c.start(h.agentCaller, 'one'), /output_storage_unavailable/);
  await assert.rejects(c.intent(h.agentCaller, 'input', { ...request(), inputs: [{ kind: 'artifact', id: 'B-file', contentType: 'audio/mpeg' }] }), /input_unavailable/);
  await assert.rejects(c.intent(h.agentCaller, 'frame', { ...request(), inputs: [{ kind: 'frame', handle: 'a'.repeat(64) } as never] }), /invalid_request/);
  assert.equal(f.stats().posts, 0);
});

test('exact request binding preserves omission, null, ordered inputs and revision; edits require a new quote', async () => {
  const h = harness(); const f = ticketFixture(h.now); const c = new MediaController(h.ports, f.adapter);
  const r = request(); await c.intent(h.agentCaller, 'one', r);
  (r.params as Record<string, string>).prompt = 'edited after persistence';
  assert.equal((await c.history(h.owner))[0].binding, bindingOf(request()));
  for (const changed of [{ ...request(), revision: '2' }, { ...request(), params: { prompt: null } }, { ...request(), params: {} }]) {
    await assert.rejects(c.intent(h.agentCaller, 'one', changed), /intent_conflict/);
  }
  await c.estimate(h.agentCaller, 'one');
  assert.equal((await c.intent(h.agentCaller, 'two', { ...request(), params: { prompt: 'new' } })).quote, undefined);
  assert.notEqual(bindingOf({ ...request(), params: [1, 2] }), bindingOf({ ...request(), params: [2, 1] }));
});

test('safe fresh exact-unit quote then separate owner approval; refresh has no paid effects', async () => {
  const h = harness(); const f = ticketFixture(h.now); const c = new MediaController(h.ports, f.adapter);
  await c.intent(h.runCaller, 'one', request());
  await assert.rejects(c.approve(h.owner, 'one', { amount: 100, unit: 'usd_micro' }), /price_not_approvable/);
  assert.equal((await c.start(h.runCaller, 'one')).waitReason, 'price_unavailable');
  assert.equal((await c.estimate(h.runCaller, 'one')).waitReason, 'owner_confirmation');
  assert.equal((await c.start(h.runCaller, 'one')).waitReason, 'owner_confirmation');
  await assert.rejects(c.approve(h.owner, 'one', { amount: 100, unit: 'characters' }), /price_not_approvable/);
  await c.approve(h.owner, 'one', { amount: 12, unit: 'usd_micro' });
  h.tick(1100);
  assert.equal((await c.start(h.runCaller, 'one')).waitReason, 'price_stale');
  const refreshed = await c.estimate(h.runCaller, 'one');
  assert.equal(refreshed.waitReason, 'owner_confirmation'); assert.equal(refreshed.approval, undefined);
  assert.equal(refreshed.accounting, undefined); assert.deepEqual(refreshed.outputs, []);
  assert.deepEqual(f.stats(), { posts: 0, polls: 0, cancels: 0, estimates: 2 });
  await c.approve(h.owner, 'one', { amount: 12, unit: 'usd_micro' });
  assert.equal((await c.start(h.runCaller, 'one')).state, 'queued');
});

test('invalid quote or absent effect-free estimator cannot be approved or posted', async () => {
  const h = harness(); const f = ticketFixture(h.now); const c = new MediaController(h.ports, f.adapter);
  await c.intent(h.agentCaller, 'one', request());
  const cases: (Partial<Quote> | null)[] = [null, { safe: false }, { amount: -1 }, { amount: 1.1 }, { amount: Number.MAX_SAFE_INTEGER + 1 },
    { unit: 'characters' }, { unit: 'credits' as never }, { binding: 'other' }, { basis: '' }, { tariffRevision: '' },
    { issuedAt: 2000 }, { validUntilMs: NaN }];
  for (const quote of cases) {
    f.setPrice(quote); await c.estimate(h.agentCaller, 'one');
    await assert.rejects(c.approve(h.owner, 'one', { amount: 100, unit: 'usd_micro' }, true), /price_not_approvable/);
    assert.equal((await c.start(h.agentCaller, 'one')).waitReason, 'price_unavailable');
  }
  const absent = new MediaController(h.ports, { ...f.adapter, estimate: undefined });
  await assert.rejects(absent.estimate(h.agentCaller, 'one'), /estimate_unavailable/);
  assert.equal(f.stats().posts, 0);
});

test('exact atomic zero, credits and characters use independent ceilings; exception is one intent only', async () => {
  const h = harness(); const f = ticketFixture(h.now); const c = new MediaController(h.ports, f.adapter);
  h.data().ceilings.usd_micro = 10;
  await ready(c, h, 'over', h.runCaller);
  assert.equal((await c.start(h.runCaller, 'over')).waitReason, 'ceiling');
  await c.approve(h.owner, 'over', { amount: 12, unit: 'usd_micro' }, true);
  assert.equal((await c.start(h.runCaller, 'over')).state, 'queued');
  await ready(c, h, 'later', h.runCaller);
  assert.equal((await c.start(h.runCaller, 'later')).waitReason, 'ceiling');
  await ready(c, h, 'credit', h.runCaller, { amount: 12, unit: 'credit_milli' });
  await c.start(h.runCaller, 'credit');
  await ready(c, h, 'chars', h.runCaller, { amount: 12, unit: 'characters' });
  await c.start(h.runCaller, 'chars');
  f.setPrice({ amount: 0 }); await ready(c, h, 'zero', h.agentCaller, { amount: 0, unit: 'usd_micro' });
  assert.equal((await c.start(h.agentCaller, 'zero')).reservation!.amount, 0);
  assert.deepEqual(totals(h.data().jobs, 'run-1').reserved, { usd_micro: 12, credit_milli: 12, characters: 12 });
});

test('concurrent run intents reserve atomically against the same ceiling', async () => {
  const h = harness(); h.data().ceilings.usd_micro = 20;
  const f = ticketFixture(h.now); const c = new MediaController(h.ports, f.adapter);
  await ready(c, h, 'one', h.runCaller); await ready(c, h, 'two', h.runCaller);
  const results = await Promise.all([c.start(h.runCaller, 'one'), new MediaController(h.ports, f.adapter).start(h.runCaller, 'two')]);
  assert.equal(results.filter(j => j.state === 'queued').length, 1);
  assert.equal(results.filter(j => j.waitReason === 'ceiling').length, 1);
  assert.equal(f.stats().posts, 1);
});

test('bounded journal refuses capacity rather than discarding identity or spend', async () => {
  const h = harness(2); const f = ticketFixture(h.now); const c = new MediaController(h.ports, f.adapter);
  await ready(c, h, 'one'); await c.start(h.agentCaller, 'one'); await c.intent(h.agentCaller, 'two', request());
  await assert.rejects(c.intent(h.agentCaller, 'three', request()), /history_capacity/);
  assert.equal((await c.history(h.owner)).length, 2);
  await c.start(h.agentCaller, 'one'); assert.equal(f.stats().posts, 1);
});

test('write-once job identity refuses foreign status and never replaces persisted job id', async () => {
  const h = harness(); const f = ticketFixture(h.now); const c = new MediaController(h.ports, f.adapter);
  await ready(c, h); await c.start(h.agentCaller, 'one'); f.replaceId();
  const result = await c.reconcile(h.agentCaller, 'one');
  assert.equal(result.state, 'unknown'); assert.equal(result.jobId, 'ticket-7'); assert.equal(result.accounting, 'unknown');
  await c.start(h.agentCaller, 'one'); assert.equal(f.stats().posts, 1);
});

test('queued cancel stays Canceling until request returns, then unknown until exact confirmation; no inferred refund', async () => {
  const h = harness(); const f = ticketFixture(h.now); const gate = deferred<void>();
  const adapter = f.adapter as Extract<Adapter, { kind: 'async' }>;
  adapter.cancel!.request = async () => gate.promise;
  const c = new MediaController(h.ports, adapter);
  await ready(c, h); await c.start(h.agentCaller, 'one');
  const pending = c.cancel(h.agentCaller, 'one');
  // Await an explicit observable journal flag, not a timer or a guessed transport completion.
  for (let i = 0; i < 12 && !h.data().jobs[0].cancelRequested; i++) await Promise.resolve();
  assert.equal(h.data().jobs[0].cancelRequested, true);
  await assert.rejects(c.reconcile(h.agentCaller, 'one'), /reconcile_unavailable/);
  gate.resolve(); const unknown = await pending;
  assert.equal(unknown.state, 'unknown'); assert.equal(unknown.reservation!.amount, 12);
  f.phase('stopped', 0); const canceled = await c.reconcile(h.agentCaller, 'one');
  assert.equal(canceled.state, 'canceled'); assert.equal(canceled.reservation!.amount, 0);
});

test('running cancellation absent, real progress absent, and restart never submits a persisted starting intent', async () => {
  const h = harness(); const f = ticketFixture(h.now); const c = new MediaController(h.ports, f.adapter);
  await ready(c, h); await c.start(h.agentCaller, 'one'); f.phase('working');
  const running = await c.reconcile(h.agentCaller, 'one'); assert.equal(running.progress, undefined);
  await assert.rejects(c.cancel(h.agentCaller, 'one'), /cancel_unavailable/);
  h.data().jobs[0].state = 'starting';
  const recovered = await new MediaController(h.ports, f.adapter).recover(h.owner);
  assert.equal(recovered[0].state, 'unknown'); await c.start(h.agentCaller, 'one'); assert.equal(f.stats().posts, 1);
});

test('refresh operation lease prevents stale quote races or submission while estimator is active', async () => {
  const h = harness(); const f = ticketFixture(h.now); const gate = deferred<Quote | null>();
  f.adapter.estimate = () => gate.promise;
  const c = new MediaController(h.ports, f.adapter); await c.intent(h.agentCaller, 'one', request());
  const pending = c.estimate(h.agentCaller, 'one');
  for (let i = 0; i < 12 && !h.data().jobs[0].lease; i++) await Promise.resolve();
  await assert.rejects(c.estimate(h.agentCaller, 'one'), /intent_busy/);
  await assert.rejects(c.start(h.agentCaller, 'one'), /intent_busy/);
  gate.resolve(null); await pending; assert.equal(h.data().jobs[0].lease, undefined); assert.equal(f.stats().posts, 0);
});

test('stream overflow never yields a durable result or successful completion', async () => {
  const h = harness(); const f = byteFixture(h.now, true); f.overflow();
  const c = new MediaController(h.ports, f.adapter); await ready(c, h);
  assert.equal((await c.start(h.agentCaller, 'one')).state, 'unknown'); assert.equal(h.files.size, 0);
});

test('failed re-estimate clears prior owner approval and cannot resurrect its old quote', async () => {
  const h = harness(); const f = ticketFixture(h.now); const c = new MediaController(h.ports, f.adapter);
  await ready(c, h);
  f.adapter.estimate = async () => { throw Error('estimator unavailable'); };
  await assert.rejects(c.estimate(h.agentCaller, 'one'), /estimate_unavailable/);
  assert.equal((await c.start(h.agentCaller, 'one')).waitReason, 'price_unavailable');
  assert.equal(h.data().jobs[0].approval, undefined); assert.equal(f.stats().posts, 0);
});

test('owner-triggered start preserves original run output lineage and rechecks revoked inputs', async () => {
  const h = harness(); const f = byteFixture(h.now, false); const c = new MediaController(h.ports, f.adapter);
  await ready(c, h, 'one', h.runCaller);
  const done = await c.start(h.owner, 'one');
  assert.equal(h.files.get(done.outputs[0].id)!.scope.runId, 'run-1');
  h.ports.inputs = { authorize: async () => true };
  await c.intent(h.agentCaller, 'two', { ...request(), inputs: [{ kind: 'artifact', id: 'owned-input', contentType: 'audio/mpeg' }] });
  await c.estimate(h.agentCaller, 'two'); await c.approve(h.owner, 'two', { amount: 12, unit: 'usd_micro' });
  h.ports.inputs = { authorize: async () => false };
  assert.equal((await c.start(h.agentCaller, 'two')).state, 'unknown');
  assert.equal(f.stats().calls, 1);
});

test('quote evidence checks guard nonfinite clock, timestamps and exact binding', () => {
  const q: Quote = { amount: 1, unit: 'usd_micro', binding: 'one', safe: true, basis: 'actual quote', tariffRevision: '1', issuedAt: 1, validUntilMs: 3 };
  assert.equal(quoteState(q, 'one', 'usd_micro', 2), 'ready');
  assert.equal(quoteState(q, 'two', 'usd_micro', 2), 'unavailable');
  assert.equal(quoteState(q, 'one', 'usd_micro', 3), 'stale');
  assert.equal(quoteState(q, 'one', 'usd_micro', NaN), 'unavailable');
});
