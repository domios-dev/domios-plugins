import test from 'node:test';
import assert from 'node:assert/strict';
import { HiggsfieldBlueprint, blueprintContracts, outcomes, stepContracts } from '../src/blueprint';
import { createHiggsfieldAdapters } from '../src/adapters';
import { revision, models } from '../src/catalog';
import { fixture, soul, providerId } from './fixtures/commands';
import { check } from '../scripts/check-coverage.mjs';
import type { RunCall, RunPorts } from '../src/blueprint';

function runFixture() {
  const h = fixture(), context = Object.freeze({ hostFixture: true }), access = h.actor('a', 'run');
  let inputs: any[] = [], operation = 'host_operation';
  const ports: RunPorts = { resolve: c => c === context ? { access, operation } : null,
    inputs: () => inputs, now: h.now, admit: h.admit,
    proof: (_a, job) => ({ purpose: 'zero-spend injected fixture', operation: job.id, binding: job.binding,
      maximum: { amount: 10, unit: 'usd_micro' }, runCeiling: { amount: 100, unit: 'usd_micro' }, aggregateProof: 'fixture-only-no-money' }) };
  const b = new HiggsfieldBlueprint(h.service, ports);
  const call: RunCall = { nodeType: 'higgsfield.generate-image', revision, params: { operation: soul, controls: { prompt: 'fixture' } } };
  const approve = (id = operation, exception = false) => h.service.core.approve(h.actor('a', 'you'), id, { amount: 10, unit: 'usd_micro' }, exception);
  return { ...h, b, call, context, access, ports, approve, inputs: (v: any[]) => { inputs = v; }, operation: (v: string) => { operation = v; } };
}
test('full documented snapshot maps to bounded source contracts; exact schemas retained, registration withheld', () => {
  assert.equal(check(), 105); assert.ok(blueprintContracts.length <= 32);
  for (const m of models) {
    const family = stepContracts.find(s => s.id === `higgsfield.generate-${m.category}`)!;
    assert.deepEqual(family.params.variants.find(v => v.operation === m.id)!.schema, m.schema);
    assert.ok(family.registration.startsWith('withheld'));
    assert.deepEqual([...family.outcomes], [...outcomes]);
  }
});
test('commands/view/Blueprint consume the identical accepted service instance', () => {
  const h = runFixture(), adapters = createHiggsfieldAdapters(h.service, h.ports as any, h.ports);
  assert.equal(adapters.commands.service, h.service); assert.equal(adapters.blueprint.service, h.service);
});
test('trusted run context is distinct from caller params and local document authority', () => {
  const h = runFixture();
  assert.throws(() => h.b.estimate(h.call, { ...h.context }));
  for (const key of ['owner', 'actor', 'runId', 'job', 'operation', 'budget', 'frame']) {
    assert.throws(() => h.b.dispatch({ ...h.call, [key]: 'forged' } as any, h.context, 'submit'));
  }
  assert.throws(() => h.b.dispatch({ ...h.call, nodeType: 'higgsfield.generate-video' }, h.context, 'submit'));
  assert.throws(() => h.b.dispatch({ ...h.call, revision: 'old' }, h.context, 'submit'));
  const a = h.access; a.scope.human = true; assert.throws(() => h.b.estimate(h.call, h.context)); assert.equal(h.sends(), 0);
});
test('no port means explicit waiting, never a fabricated host job or paid pipeline', () => {
  const h = runFixture(), b = new HiggsfieldBlueprint(h.service, { ...h.ports, admit: undefined });
  const r = b.dispatch(h.call, h.context, 'submit'); assert.equal(r.outcome, 'waiting'); assert.equal((r as any).reason, 'durable_admission_unavailable');
  assert.equal(h.sends(), 0);
});
test('purpose and aggregate proof port cannot be replaced by caller approval fields', () => {
  const h = runFixture(); h.b.estimate(h.call, h.context); h.approve();
  for (const proof of [undefined, () => null, (_a: any, j: any) => ({ purpose: 'x', operation: 'different', binding: j.binding,
    maximum: { amount: 10, unit: 'usd_micro' }, runCeiling: { amount: 100, unit: 'usd_micro' }, aggregateProof: 'fake' })]) {
    const b = new HiggsfieldBlueprint(h.service, { ...h.ports, proof });
    assert.equal((b.dispatch(h.call, h.context, 'submit') as any).reason, 'aggregate_approval_unavailable');
  }
  assert.equal(h.sends(), 0);
});
test('fixture waiting resume submits once; restart uncertainty retains identity and never replays', () => {
  const h = runFixture();
  assert.equal(h.b.dispatch(h.call, h.context, 'submit').outcome, 'waiting');
  h.b.estimate(h.call, h.context); assert.equal(h.b.dispatch(h.call, h.context, 'submit').outcome, 'waiting');
  h.approve(); assert.equal(h.b.dispatch(h.call, h.context, 'submit').outcome, 'submitting');
  assert.equal(h.sends(), 1); h.receive(h.access, 'queued');
  assert.equal(h.b.dispatch(h.call, h.context, 'submit').outcome, 'queued'); assert.equal(h.sends(), 1);
  // Exact-known-ID status acquisition then auxiliary error retains ID and Unknown.
  h.b.dispatch(h.call, h.context, 'reconcile');
  assert.throws(() => h.receive(h.access, 'completed', { images: [{ url: 'https://evil.example.org/private' }] }));
  const j = h.service.history(h.access)[0]; assert.equal(j.state, 'unknown'); assert.equal(j.jobId, providerId);
  h.service.recover(h.access); h.b.dispatch(h.call, h.context, 'submit'); assert.equal(h.sends(), 2); // One submit + one status, no new paid effect.
});
test('stale pricing and one-operation ceiling exception cannot authorize a later node', () => {
  const h = runFixture(); h.b.estimate(h.call, h.context); h.approve(); h.tick();
  assert.equal(h.b.dispatch(h.call, h.context, 'submit').outcome, 'waiting'); assert.equal(h.sends(), 0);
  h.store.transact('a', 'workspace', d => { d.ceilings.usd_micro = 0; return true; });
  h.b.estimate(h.call, h.context); h.approve();
  assert.equal(h.b.dispatch(h.call, h.context, 'submit').job.waitReason, 'ceiling');
  h.approve('host_operation', true); h.b.dispatch(h.call, h.context, 'submit'); h.receive(h.access, 'queued');
  h.operation('later_operation'); h.b.estimate(h.call, h.context);
  assert.equal(h.b.dispatch(h.call, h.context, 'submit').job.waitReason, 'owner_confirmation');
  h.approve('later_operation'); assert.equal(h.b.dispatch(h.call, h.context, 'submit').job.waitReason, 'ceiling'); assert.equal(h.sends(), 1);
});
test('queued cancellation acknowledges Unknown then exact-job failure reconciliation; no paid retry', () => {
  const h = runFixture(); h.b.estimate(h.call, h.context); h.approve(); h.b.dispatch(h.call, h.context, 'submit'); h.receive(h.access, 'queued');
  h.b.dispatch(h.call, h.context, 'cancel'); h.receive(h.access, 'queued');
  assert.equal(h.service.history(h.access)[0].state, 'unknown'); assert.equal(h.service.history(h.access)[0].jobId, providerId);
  h.b.dispatch(h.call, h.context, 'reconcile'); h.receive(h.access, 'failed');
  assert.equal(h.b.dispatch(h.call, h.context, 'submit').outcome, 'failed'); assert.equal(h.sends(), 3);
});
test('durable fake-media handoff is bound; ephemeral handles/path-shaped objects are refused', () => {
  const h = runFixture();
  for (const input of [{ kind: 'artifact', id: '/private/file.png', contentType: 'image/png' }, { kind: 'run-media', reference: 'a'.repeat(64) }, { kind: 'run-media', reference: 'x', path: '/private' }]) {
    h.inputs([input]); assert.throws(() => h.b.estimate(h.call, h.context));
  }
  h.inputs([{ kind: 'run-media', reference: 'fixture-scoped-media-1' }]); h.b.estimate(h.call, h.context);
  assert.deepEqual(h.service.history(h.access)[0].request.inputs, [{ kind: 'run-media', reference: 'fixture-scoped-media-1' }]);
  h.inputs([{ kind: 'run-media', reference: 'fixture-scoped-media-2' }]); assert.throws(() => h.b.estimate(h.call, h.context), /intent_conflict/);
  assert.equal(h.sends(), 0);
});
test('synthetic saved media reaches bounded fixture reviewer; it is NOT real host review', () => {
  const h = runFixture(); h.b.estimate(h.call, h.context); h.approve(); h.b.dispatch(h.call, h.context, 'submit');
  h.receive(h.access, 'completed', { images: [{ url: 'https://media.example.org/fixture.png' }] });
  const result = h.b.dispatch(h.call, h.context, 'submit'); assert.equal(result.outcome, 'done');
  const review = (artifacts: typeof result.job.outputs, bounds: { maxTurns: number; maxTokens: number }) => {
    assert.deepEqual(bounds, { maxTurns: 1, maxTokens: 64 }); assert.equal(artifacts[0].contentType, 'image/png');
    return { fixtureStub: true, actualMediaConsumption: false, verdict: 'not-acceptance-evidence' };
  };
  assert.equal(review(result.job.outputs, { maxTurns: 1, maxTokens: 64 }).actualMediaConsumption, false);
  assert.equal(h.sends(), 1);
});
