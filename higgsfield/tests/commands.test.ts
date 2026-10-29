import test from 'node:test';
import assert from 'node:assert/strict';
import { HiggsfieldCommands, commandPayloadBytes, describe, publicJob, verbs } from '../src/commands';
import { models, operations } from '../src/catalog';
import { fixture, soul } from './fixtures/commands';
import { surfaceContribution } from '../src/contributions';

test('generic host surface call owns open/reuse/close; caller fields never forwarded', () => {
  const h = fixture(), c = new HiggsfieldCommands(h.service, h.ports);
  for (const verb of ['open', 'open', 'close']) assert.deepEqual(c.onAgentCommand({ verb, args: [], sessionId: 'must-not-forward' }), { result: 'host-owned-child' });
  assert.deepEqual(h.calls, ['open','open','close'].map(verb => ({ verb, argsJson: '[]' })));
  assert.equal(surfaceContribution.agentBound, true); assert.equal(surfaceContribution.stateInvalidation, true);
  assert.deepEqual(surfaceContribution.agentVerbs, [...verbs]); assert.ok(verbs.length <= 32);
  assert.equal(h.sends(), 0); // Stub asserts wiring only; actual child creation remains HIG-11.
});
test('every catalog model and protocol operation is discoverable with exact schema and dated docs', () => {
  for (const row of [...models, ...operations]) { const d = describe(row.id); assert.deepEqual(d.schema, row.schema); assert.deepEqual(d.source, row.source); }
  assert.throws(() => describe('https://evil.example.org'));
});
test('SDK structured body reaches prepare through exact host routing; argv JSON remains supported', () => {
  const h = fixture(), a = h.surfaceContext('a');
  const calls: { verb: string; argsJson: string }[] = [];
  let c: HiggsfieldCommands;
  c = new HiggsfieldCommands(h.service, { ...h.ports, surface: {
    ...h.ports.surface, call(verb, argsJson) {
      calls.push({ verb, argsJson });
      return JSON.stringify({ result: c.onSurfaceCall(a, verb, JSON.parse(argsJson)) });
    },
  } });
  const body = JSON.stringify({ operation: soul, params: { prompt: 'body € 🐈' } });
  const response = c.onAgentCommand({ verb: 'prepare', args: [], body, sessionId: 'never-forward' });
  assert.equal(JSON.parse((response as { result: string }).result).id, 'intent_1');
  assert.deepEqual(calls, [{ verb: 'prepare', argsJson: JSON.stringify([body]) }]);
  const argv = c.onAgentCommand({ verb: 'prepare', args: [body], sessionId: 'never-forward' });
  assert.equal(JSON.parse((argv as { result: string }).result).id, 'intent_2');
  assert.equal(h.sends(), 0);
});
test('body and argv enforce exact UTF8 payload bytes, not UTF16 character counts', () => {
  const h = fixture(), c = new HiggsfieldCommands(h.service, h.ports), a = h.surfaceContext('a');
  const envelope = JSON.stringify({ operation: soul, params: { prompt: '' } });
  const remaining = commandPayloadBytes - Buffer.byteLength(envelope, 'utf8');
  for (const character of ['a', '€', '🐈']) {
    const size = Buffer.byteLength(character, 'utf8');
    const exact = JSON.stringify({ operation: soul, params: { prompt: character.repeat(Math.floor(remaining / size)) + 'a'.repeat(remaining % size) } });
    assert.equal(Buffer.byteLength(exact, 'utf8'), commandPayloadBytes);
    const over = exact.replace('"prompt":"', '"prompt":"a');
    for (const body of [true, false]) {
      const ctx = (value: string) => ({ verb: 'prepare', sessionId: 'not-authority', args: body ? [] : [value], ...(body ? { body: value } : {}) });
      assert.deepEqual(c.onAgentCommand(ctx(exact)), { result: 'host-owned-child' });
      const count = h.calls.length;
      assert.deepEqual(c.onAgentCommand(ctx(over)), { error: 'invalid_command' });
      assert.equal(h.calls.length, count);
    }
    assert.equal(JSON.parse(c.onSurfaceCall(a, 'prepare', [exact])).state, 'waiting');
    assert.deepEqual(JSON.parse(c.onSurfaceCall(a, 'prepare', [over])), { error: 'command_refused' });
  }
  assert.equal(h.sends(), 0);
});
test('ambiguous args plus body and malformed/non-object bodies refuse before host lifecycle', () => {
  const h = fixture(), c = new HiggsfieldCommands(h.service, h.ports);
  for (const verb of ['prepare', 'open', 'close']) {
    for (const body of ['{}', '', 'null', '[]', '"text"', '{']) {
      assert.deepEqual(c.onAgentCommand({ verb, args: ['{}'], body, sessionId: 'x' }), { error: 'invalid_command' });
    }
    for (const body of ['', 'null', '[]', '"text"', '{']) {
      assert.deepEqual(c.onAgentCommand({ verb, args: [], body, sessionId: 'x' }), { error: 'invalid_command' });
    }
  }
  assert.equal(h.calls.length, 0);
});
test('open and close acknowledge only trusted surface dispatch; view lifecycle remains unavailable', () => {
  const h = fixture(), c = new HiggsfieldCommands(h.service, h.ports), a = h.surfaceContext('a'), view = h.viewContext('a');
  for (const verb of ['open', 'close']) {
    assert.deepEqual(c.viewCall(verb, {}, view), { error: 'surface_lifecycle_unavailable' });
    assert.deepEqual(JSON.parse(c.onSurfaceCall({ ...a }, verb, [])), { error: 'command_refused' });
    assert.deepEqual(JSON.parse(c.onSurfaceCall(a, verb, [])), { acknowledged: verb });
    assert.deepEqual(c.onAgentCommand({ verb, args: [], body: '{}', sessionId: 'not-a-tab-id' }), { result: 'host-owned-child' });
  }
  assert.deepEqual(h.calls, ['open', 'close'].map(verb => ({ verb, argsJson: '["{}"]' })));
  assert.equal(h.invalidations.length, 0); assert.equal(h.sends(), 0);
});
test('two owners and trusted local user share service, isolated jobs and one identity-only invalidation', () => {
  const h = fixture(), c = new HiggsfieldCommands(h.service, h.ports), a = h.surfaceContext('a'), b = h.surfaceContext('b'), user = h.viewContext('a');
  const result = JSON.parse(c.onSurfaceCall(a, 'prepare', [JSON.stringify({ operation: soul, params: { prompt: 'private-prompt' } })]));
  assert.equal(result.id, 'intent_1'); assert.equal(h.invalidations.length, 1);
  assert.deepEqual(h.invalidations[0], { surface: 'studio', instance: 'instance-a', tab: 'tab-a' });
  assert.deepEqual(c.viewCall('history', {}, user), [result]);
  assert.deepEqual(JSON.parse(c.onSurfaceCall(b, 'history', [])), []);
  assert.deepEqual(JSON.parse(c.onSurfaceCall(b, 'result', ['{"id":"intent_1"}'])), { error: 'command_refused' });
  assert.equal(JSON.stringify(result).includes('private-prompt'), false); assert.equal(JSON.stringify(result).includes('owner'), false);
  assert.equal(h.sends(), 0);
});
test('forged contexts and authority/job/URL fields refuse with no effect or raw activity', () => {
  const h = fixture(), c = new HiggsfieldCommands(h.service, h.ports), a = h.surfaceContext('a');
  assert.deepEqual(JSON.parse(c.onSurfaceCall({ ...a }, 'catalog', [])), { error: 'command_refused' });
  for (const key of ['owner', 'actor', 'runId', 'frame', 'budget', 'jobId', 'url', 'key', 'inputs']) {
    assert.deepEqual(JSON.parse(c.onSurfaceCall(a, 'prepare', [JSON.stringify({ operation: soul, params: { prompt: 'x' }, [key]: 'forged' })])), { error: 'command_refused' });
  }
  assert.deepEqual(JSON.parse(c.onSurfaceCall(a, 'approve', ['{}'])), { error: 'command_refused' });
  assert.equal(h.sends(), 0); assert.equal(h.invalidations.length, 0);
});
test('prepare/rerun are free schema-legal one-hop preparation; submit refuses missing durable port', () => {
  const h = fixture(), c = new HiggsfieldCommands(h.service, h.ports), a = h.surfaceContext('a');
  const invoke = (v: string, p: unknown) => JSON.parse(c.onSurfaceCall(a, v, [JSON.stringify(p)]));
  invoke('prepare', { operation: soul, params: { prompt: 'x' } });
  const r = invoke('rerun', { id: 'intent_1', changes: { seed: 5 } }); assert.equal(r.parent, 'intent_1'); assert.equal(r.job.id, 'intent_2');
  assert.equal(invoke('rerun', { id: 'intent_2', changes: { seed: 0 } }).error, 'command_refused');
  assert.equal(invoke('submit', { id: 'intent_1' }).error, 'durable_admission_unavailable');
  assert.equal(h.sends(), 0);
});
test('invalid and stale quotes are omitted from receipts; no backend fields leak', () => {
  const h = fixture(), a = h.actor('a'); h.service.intent(a, 'intent', soul, { prompt: 'secret' });
  const j = h.service.estimate(a, 'intent'); assert.deepEqual(publicJob(j, h.now()).price, { amount: 10, unit: 'usd_micro' });
  j.quote!.amount = NaN; assert.equal(publicJob(j, h.now()).price, null);
  j.quote!.amount = 10; h.tick(); assert.equal(publicJob(j, h.now()).price, null);
  assert.equal(JSON.stringify(publicJob(j, h.now())).includes('binding'), false);
});
test('metadata uses finite validated plans and safe artifact port, missing transport is explicit', () => {
  const h = fixture(), a = h.surfaceContext('a'), c = new HiggsfieldCommands(h.service, h.ports);
  const invoke = (p: unknown) => JSON.parse(c.onSurfaceCall(a, 'metadata', [JSON.stringify(p)]));
  assert.equal(invoke({ operation: 'styles.soul', params: {} }).error, 'metadata_artifact_transport_unavailable');
  for (const p of [{ operation: 'requests.delete', params: {} }, { operation: 'requests.status', params: {} },
    { operation: 'https://evil.example.org', params: {} }, { operation: 'styles.soul', params: { url: 'https://evil.example.org' } }]) {
    assert.equal(invoke(p).error, 'command_refused');
  }
  assert.equal(h.sends(), 0);
});
