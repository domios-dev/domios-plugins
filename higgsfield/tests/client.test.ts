import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { models, operations, model, limitation, validateParams, prepare, variation, revision } from '../src/catalog';
import { matches, publicHttps } from '../src/schema';
import { HiggsfieldClient, apiUrl, metadataPlan, estimatePlan, submitPlan, parseJson, usdMicro, lifecyclePlan } from '../src/client';
import type { Plan, Response } from '../src/client';
import { HiggsfieldService, operationDisposition, limitations } from '../src/service';
import type { Effect } from '../src/service';
import { receipt, states } from '../src/response';
import { bindingOf, clone } from '../../media-shared/src/contracts';
import type { Access, JobStore, Partition, Quote, Request } from '../../media-shared/src/contracts';

const uuid = 'd7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff';
const otherUuid = 'a7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff';
const soul = 'higgsfield-ai/soul/v2/standard';
const audio = 'bytedance/seedance-2.5/reference-to-video';
const access: Access = { current: true, inputsAuthorized: true, scope: {
  owner: 'owner-a', workspace: 'workspace-a', actorId: 'human-a', actor: { kind: 'you' }, human: true, authRevision: 'r1' } };
function response(plan: Plan, value: unknown = { request_id: uuid, status: 'queued' }, status = 200): Response {
  return { status, url: plan.url, redirected: false, contentType: 'application/json', body: JSON.stringify(value) };
}
/** Independent schema witness fixture, not a transport or alternate service implementation. */
function witness(s: any, root = s, props = root.properties ?? {}): any {
  if (s.$ref) return witness(root.$defs[s.$ref.slice(8)], root);
  if ('const' in s) return s.const;
  if (s.anyOf) {
    const branch = s.anyOf[0];
    if (!s.type) return witness(branch, root);
  }
  if (s.enum) return s.enum[0];
  const type = Array.isArray(s.type) ? s.type[0] : s.type;
  if (type === 'null') return null;
  if (type === 'boolean') return false;
  if (type === 'number' || type === 'integer') return s.minimum ?? 0;
  if (type === 'string') {
    if (s.format === 'uuid') return uuid;
    if (s.format === 'uri' || s.pattern === '^https?://') return 'https://media.example.org/source.wav';
    if (s.pattern === '^#[0-9A-Fa-f]{6}$') return '#aabbcc';
    return 'fixture'.padEnd(s.minLength ?? 0, 'x');
  }
  if (type === 'array') return Array.from({ length: s.minItems ?? 0 }, () => witness(s.items, root));
  const result: Record<string, unknown> = {};
  const properties = { ...props, ...s.properties };
  const apply = (rule: any) => {
    if (!rule) return;
    for (const k of rule.required ?? []) result[k] = witness({ ...properties[k], ...rule.properties?.[k] }, root);
    for (const [k,v] of Object.entries(rule.properties ?? {})) if (k in result) result[k] = witness({ ...properties[k], ...(v as object) }, root);
    if (rule.if) apply(matches(rule.if, result, root, 0, false) ? rule.then : rule.else);
    for (const part of rule.allOf ?? []) apply(part);
    if (rule.anyOf && !rule.anyOf.some((part: any) => matches(part, result, root, 0, false))) apply(rule.anyOf[0]);
  };
  apply(s); return result;
}

for (const row of models) test(`catalog ${row.id}: exact dated schema or explicit limitation`, () => {
  assert.equal(row.source.retrievedDate, '2026-10-29');
  const bytes = readFileSync(new URL(`../${row.source.snapshot}`, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), row.source.sha256);
  if (!row.schema) {
    assert.equal(validateParams(row.id, {}), false);
    assert.ok(limitation(row.id)?.source); assert.throws(() => prepare(row.id, {})); return;
  }
  const params = witness(row.schema);
  assert.equal(validateParams(row.id, params), true, JSON.stringify(params));
  assert.equal(validateParams(row.id, { ...params, undocumented_control: true }), false);
  for (const key of row.schema.required ?? []) {
    const missing = { ...params }; delete missing[key];
    assert.equal(validateParams(row.id, missing), false, `required ${key}`);
  }
  for (const [key, schema] of Object.entries(row.schema.properties ?? {}) as [string, any][]) {
    assert.equal(validateParams(row.id, { ...params, [key]: ['wrong', { shape: true }] }), false, `wrong type ${key}`);
    if (typeof schema.maximum === 'number') assert.equal(validateParams(row.id, { ...params, [key]: schema.maximum + 1 }), false);
    if (typeof schema.minimum === 'number') assert.equal(validateParams(row.id, { ...params, [key]: schema.minimum - 1 }), false);
    if (schema.enum) assert.equal(validateParams(row.id, { ...params, [key]: 'not-a-provider-enum' }), false);
  }
  if (limitation(row.id)) assert.throws(() => prepare(row.id, params));
  else {
    const req = prepare(row.id, params);
    assert.equal(submitPlan(req, 'stable-intent').url, row.endpoint);
    assert.equal(submitPlan(req, 'stable-intent').body, JSON.stringify(params));
  }
});

for (const op of operations) test(`operation ${op.id}: closed behavior or sourced refusal`, () => {
  const disposition = operationDisposition(op.id);
  assert.equal(disposition.source, op.source.url);
  if (!disposition.available) {
    assert.ok(disposition.detail); return;
  }
  if (op.id.startsWith('requests.')) {
    assert.equal(lifecyclePlan(uuid, op.id === 'requests.status' ? 'status' : 'cancel').url, op.endpoint.replace('{request_id}', uuid));
    return;
  }
  const params = op.id === 'files.upload-url' ? { content_type: 'audio/wav' } : witness(op.schema);
  const plan = metadataPlan(op.id, params);
  assert.equal(plan.method, op.method);
  assert.equal(plan.url, op.endpoint.replace('{id}', uuid));
  assert.throws(() => metadataPlan(op.id, { ...params, url: 'https://evil.example.org' }));
});

class Store implements JobStore {
  partitions = new Map<string, Partition>();
  transact<T>(owner: string, workspace: string, edit: (data: Partition) => T): T {
    const key = `${owner}/${workspace}`;
    const data = clone(this.partitions.get(key) ?? { jobs: [], ceilings: { usd_micro: 1000000 } });
    const result = edit(data); this.partitions.set(key, clone(data)); return result === undefined ? result : clone(result);
  }
}
function harness(options: { maxHistory?: number; throwSend?: boolean; secret?: boolean; attest?: boolean } = {}) {
  const store = new Store(); let now = 1000; let sends = 0; let reads = 0;
  const sent: Plan[] = []; const saved: unknown[] = []; const facts: unknown[] = [];
  const client = new HiggsfieldClient({ secret: { pluginBucketVerified: options.secret !== false,
    available: name => { assert.equal(name, 'higgsfield-api-key'); return true; } },
    transport: { send: (plan, policy) => {
      assert.deepEqual(policy, { redirect: 'error', retries: 0, maxBytes: 262144,
        credential: { secretName: 'higgsfield-api-key', origin: 'https://api.higgsfield.ai', scheme: 'Key' } });
      // Synthetic host transport owns resolution, after origin/grant checks. Backend never reads a key.
      assert.ok(plan.url.startsWith(policy.credential.origin + '/')); reads++; sends++;
      sent.push({ ...plan, headers: { ...plan.headers, Authorization: 'Key synthetic-id:synthetic-secret' } });
      if (options.throwSend) throw new Error('synthetic-id:synthetic-secret private upstream error');
      return { kind: 'pending', correlation: 'transport-only-not-provider-id' };
    } } });
  const ports = { store, now: () => now, maxHistory: options.maxHistory ?? 20, client,
    attest: () => options.attest !== false,
    quote: (_access: Access, request: Request, binding: string): Quote => ({ amount: 94000, unit: 'usd_micro',
      binding, safe: true, basis: 'synthetic independently verified account quote', tariffRevision: 'test-tariff', issuedAt: 1000, validUntilMs: 2000 }),
    facts: { save: (_token: unknown, value: unknown) => { facts.push(clone(value)); } },
    output: { allowed: (url: string) => url.startsWith('https://media.example.org/'),
      save: (_access: Access, id: string, assets: any[]) => { saved.push(clone(assets)); return assets.map((a,i) => ({ kind: 'artifact' as const, id: `${id}-${i}`, contentType: a.kind.startsWith('audio') ? 'audio/wav' : 'video/mp4' })); } },
  };
  let service = new HiggsfieldService(ports);
  const ready = (id = 'intent', who = access) => { service.intent(who, id, soul, { prompt: 'fixture', seed: 3 }); service.estimate(who, id); service.approve(access, id, { amount: 94000, unit: 'usd_micro' }); };
  return { ports, store, client, sent, saved, facts, ready, service: () => service, reload: () => service = new HiggsfieldService(ports),
    tick: (value: number) => { now = value; }, sends: () => sends, reads: () => reads };
}
function start(h: ReturnType<typeof harness>, id = 'intent', who = access) {
  const effect = h.service().start(who, id); assert.ok('token' in effect); return effect;
}

test('all inventory counts, operation classes and unavailable native/web features are retained', () => {
  assert.equal(models.length, 92); assert.equal(operations.length, 13); assert.equal(new Set(models.map(m => m.id)).size, 92);
  assert.ok(limitations.some(x => x.id === 'speech')); assert.ok(limitations.some(x => x.id === 'stream'));
  assert.ok(limitations.some(x => x.id === 'admin')); assert.equal(operationDisposition('arbitrary-http').available, false);
  assert.throws(() => model('https://evil.example.org')); assert.throws(() => metadataPlan('files.put', {}));
  assert.throws(() => metadataPlan('requests.delete', { request_id: uuid }));
});
test('native audio-only conditioning, independent limits, sound and nested controls retain exact schemas', () => {
  assert.equal(validateParams(audio, { audio_urls: ['https://media.example.org/audio.wav'], generate_audio: true, duration: 30 }), true);
  assert.equal(validateParams(audio, { audio_urls: [] }), false);
  assert.equal(validateParams(audio, { audio_urls: Array(11).fill('https://media.example.org/a.wav') }), false);
  assert.equal(validateParams(audio, { audio_urls: ['asset://a'] }), false);
  assert.equal(validateParams('kling-video/v3.0/pro/text-to-video', { sound: 'on', cfg_scale: 0.51, multi_prompt: [{ prompt: 'a', duration: 3 }] }), true);
  assert.equal(validateParams('kling-video/v3.0/pro/text-to-video', { cfg_scale: 0.515 }), false);
  assert.equal(validateParams('kling-video/v3.0/pro/text-to-video', { multi_prompt: [{ duration: 99 }] }), false);
});
test('conditional image enhancement and thinking constraints are enforced', () => {
  assert.equal(validateParams('marketing-studio/image', { prompt: 'x', enhance_prompt: true }), false);
  assert.equal(validateParams('alibaba/qwen-image-3/text-to-image', { prompt: 'x', enable_thinking: true, prompt_extend: false }), false);
  assert.equal(validateParams('alibaba/qwen-image-3/text-to-image', { prompt: 'x', enable_thinking: true, prompt_extend: true }), true);
});
test('free local variation never creates vendor endpoint, account effect or default substitution', () => {
  const h = harness(); const req = prepare(soul, { prompt: 'x' });
  assert.deepEqual(variation(req, { seed: 5, batch_size: 4 }).params, { prompt: 'x', seed: 5, batch_size: 4 });
  assert.throws(() => variation(req, { seed: 0 })); assert.throws(() => variation(req, { batch_size: 2 }));
  assert.equal(h.sends(), 0); assert.equal(h.reads(), 0); assert.equal('seed' in (req.params as object), false);
});
test('money uses exact decimal USD atomic units and rejects malformed/rounded/marketing amounts', () => {
  for (const [usd,micro] of [['0',0], ['0.094',94000], ['1.000001',1000001]] as const) assert.equal(usdMicro(usd), micro);
  for (const value of ['-1', 'NaN', '1e3', '0.0000001', 'from 0.1', 0.1, '1.23456789', '9999999999999999']) assert.equal(usdMicro(value), null);
});
test('estimates bind exact revision, input references, ordered arrays and omitted/null fields', () => {
  const a = prepare(audio, { audio_urls: ['https://media.example.org/a.wav', 'https://media.example.org/b.wav'] });
  const b = prepare(audio, { audio_urls: ['https://media.example.org/b.wav', 'https://media.example.org/a.wav'] });
  assert.notEqual(bindingOf(a), bindingOf(b)); assert.notEqual(bindingOf(a), bindingOf({ ...a, revision: 'r2' }));
  assert.notEqual(bindingOf(a), bindingOf({ ...a, inputs: [{ kind: 'artifact', id: 'input', contentType: 'audio/wav' }] }));
  assert.throws(() => prepare(soul, { prompt: 'x', seed: null }));
  assert.equal(estimatePlan(prepare(soul, { prompt: 'x' })).url, 'https://api.higgsfield.ai/estimate/higgsfield-ai/soul/v2/standard');
  assert.throws(() => estimatePlan(a));
});
for (const url of ['http://media.example.org/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://localhost/a', 'https://host.internal/a', 'https://user:pass@media.example.org/a', 'file:///a'])
  test(`foreign/private/media URL refuses ${url}`, () => { assert.equal(publicHttps(url), false); assert.equal(validateParams(audio, { audio_urls: [url] }), false); });
test('credentials remain confined to catalog-issued immutable API plans and never reach asset hosts', () => {
  const h = harness(); const plan = metadataPlan('styles.soul', {});
  assert.equal(Object.isFrozen(plan), true); h.client.send(plan); assert.equal(h.sent[0].headers.Authorization, 'Key synthetic-id:synthetic-secret');
  for (const url of ['https://evil.example.org/x', 'https://api.higgsfield.ai/admin', 'https://api.higgsfield.ai@evil.example.org/x'])
    assert.throws(() => h.client.send({ method: 'GET', url, headers: {} }));
  assert.equal(h.reads(), 1); assert.equal(h.sends(), 1); assert.equal(JSON.stringify(plan).includes('synthetic-secret'), false);
});
test('missing production/secret-scope/attestation ports refuse before submission and release holds', () => {
  for (const opts of [{ secret: false }, { attest: false }]) {
    const h = harness(opts); h.ready(); assert.throws(() => start(h), /preflight_refused/);
    assert.equal(h.sends(), 0); assert.equal(h.service().history(access)[0].state, 'waiting');
    assert.equal(h.service().history(access)[0].reservation, undefined);
  }
  assert.throws(() => new HiggsfieldClient().send(metadataPlan('styles.soul', {})), /unavailable/);
});
test('deliberate approved intent enters once across concurrent callers and reload', () => {
  const h = harness(); h.ready(); assert.equal(h.sends(), 0);
  const effect = start(h); h.service().start(access, 'intent'); assert.equal(h.sends(), 1);
  assert.ok('kind' in effect.result); assert.equal(effect.result.kind, 'pending'); assert.equal(h.service().history(access)[0].jobId, undefined);
  h.reload(); h.service().recover(access); h.service().start(access, 'intent'); assert.equal(h.sends(), 1);
  const job = h.service().history(access)[0]; assert.equal(job.state, 'unknown'); assert.equal(job.reservation?.amount, 94000);
});
test('timeout retains unknown reservation, sanitizes errors and never replays with a fresh key', () => {
  const h = harness({ throwSend: true }); h.ready(); assert.throws(() => start(h), /^Error: submission_unknown$/);
  h.reload(); h.service().recover(access); h.service().start(access, 'intent'); assert.equal(h.sends(), 1);
  assert.equal(h.service().usage(access).ledger.unknown, 1); assert.equal(h.service().usage(access).remaining, null);
  assert.equal(h.service().usage(access).ledger.reserved.usd_micro, 94000);
});
for (const status of [401, 429, 500, 503]) test(`HTTP ${status} cannot replay paid work or leak body`, () => {
  const h = harness(); h.ready(); const e = start(h);
  assert.throws(() => h.service().receive(access, e, response(e.plan, { error: 'synthetic-secret' }, status)), /^Error: receipt_unknown$/);
  assert.equal(h.service().history(access)[0].state, 'unknown'); h.service().start(access, 'intent'); assert.equal(h.sends(), 1);
});
for (const mutation of ['redirect', 'url', 'mime', 'truncation', 'oversize']) test(`bounded response rejects ${mutation}`, () => {
  const h = harness(); h.ready(); const e = start(h), r = response(e.plan);
  if (mutation === 'redirect') r.redirected = true;
  if (mutation === 'url') r.url = 'https://evil.example.org';
  if (mutation === 'mime') r.contentType = 'text/html';
  if (mutation === 'truncation') r.body = '{';
  if (mutation === 'oversize') r.body = 'x'.repeat(1048577);
  assert.throws(() => h.service().receive(access, e, r), /receipt_unknown/); assert.equal(h.sends(), 1);
});
for (const state of states) test(`six provider states preserve ${state} without invented progress/cost`, () => {
  const parsed = receipt({ request_id: uuid, status: state }, () => false);
  assert.equal(parsed.observation.providerState, state); assert.equal(parsed.observation.progress, undefined); assert.equal(parsed.observation.charged, undefined);
});
test('write-once provider ID is durable before bad outputs and replacement IDs become unknown', () => {
  const h = harness(); h.ready(); const e = start(h);
  assert.throws(() => h.service().receive(access, e, response(e.plan, { request_id: uuid, status: 'completed', video: { url: 'https://evil.example.org/a' } })), /receipt_unknown/);
  assert.equal(h.service().history(access)[0].jobId, uuid); assert.equal(h.saved.length, 0);
  const inspect = h.service().inspect(access, 'intent');
  h.service().receive(access, inspect, response(inspect.plan, { request_id: otherUuid, status: 'queued' }));
  assert.equal(h.service().history(access)[0].jobId, uuid); assert.equal(h.service().history(access)[0].state, 'unknown');
});
test('completed audio/video artifacts and exact vendor expiry use shared history with one paid dispatch', () => {
  const h = harness(); h.ready(); const e = start(h);
  const job = h.service().receive(access, e, response(e.plan, { request_id: uuid, status: 'completed', expires_at: '2026-10-31T12:00:00Z',
    video: { url: 'https://media.example.org/v.mp4' }, audios: [{ url: 'https://media.example.org/a.wav' }] }));
  assert.equal(job.state, 'generated'); assert.equal(job.outputs.length, 2); assert.equal(job.jobId, uuid);
  assert.equal((h.facts[0] as any).expiresAt, '2026-10-31T12:00:00Z'); assert.equal(h.sends(), 1);
  assert.equal(JSON.stringify(job).includes('https://media.example.org'), false);
  assert.equal(h.service().history(access)[0].outputs[1].contentType, 'audio/wav');
});
test('queued-only cancel acknowledgement makes no refund/status claim; reconcile exact ID confirms state', () => {
  const h = harness(); h.ready(); const e = start(h); h.service().receive(access, e, response(e.plan));
  const cancel = h.service().cancel(access, 'intent'); assert.equal(cancel.plan.url, `https://api.higgsfield.ai/requests/${uuid}/cancel`);
  h.service().receive(access, cancel, { ...response(cancel.plan), status: 202, body: '', contentType: '' });
  assert.equal(h.service().history(access)[0].state, 'unknown'); assert.equal(h.service().usage(access).ledger.reserved.usd_micro, 94000);
  const inspect = h.service().inspect(access, 'intent'); h.service().receive(access, inspect, response(inspect.plan, { request_id: uuid, status: 'canceled' }));
  assert.equal(h.service().history(access)[0].state, 'canceled'); assert.equal(h.service().usage(access).ledger.reserved.usd_micro, 94000);
});
test('running job cancellation refuses with no extra vendor effect', () => {
  const h = harness(); h.ready(); const e = start(h); h.service().receive(access, e, response(e.plan, { request_id: uuid, status: 'in_progress' }));
  assert.throws(() => h.service().cancel(access, 'intent'), /cancel_unavailable/); assert.equal(h.sends(), 1);
});
test('owner/workspace/actor/run isolation, human review, bounded history and immutable identities', () => {
  const h = harness({ maxHistory: 2 });
  const agent = { ...access, scope: { ...access.scope, human: false, actorId: 'agent-a', runId: 'run-a', actor: { kind: 'agent' as const, label: 'A' } } };
  h.ready('intent', agent);
  for (const change of [{ owner: 'owner-b' }, { workspace: 'workspace-b' }, { actorId: 'agent-b' }, { runId: 'run-b' }]) {
    const foreign = { ...agent, scope: { ...agent.scope, ...change } };
    assert.equal(h.service().history(foreign).length, 0); assert.throws(() => h.service().start(foreign, 'intent'), /job_unavailable/);
  }
  assert.equal(h.service().history(access).length, 1);
  assert.throws(() => h.service().approve(agent, 'intent', { amount: 94000, unit: 'usd_micro' }), /owner_approval_required/);
  assert.throws(() => h.service().intent(agent, 'intent', soul, { prompt: 'changed' }), /intent_conflict/);
  h.service().intent(access, 'two', soul, { prompt: 'x' }); assert.throws(() => h.service().intent(access, 'three', soul, { prompt: 'x' }), /history_capacity/);
  assert.throws(() => h.service().intent(access, 'frame', soul, { prompt: 'x' }, [{ kind: 'frame', handle: 'a'.repeat(64) }] as any));
});
test('fresh safe quotes and separate exact-unit approval are mandatory; stale or changed quote never dispatches', () => {
  for (const fault of ['missing', 'unsafe', 'binding', 'unit', 'amount', 'stale', 'basis', 'revision']) {
    const h = harness(); const source = h.ports.quote;
    h.ports.quote = (a,r,b) => {
      const q = source(a,r,b); if (fault === 'missing') return null as any;
      return { ...q, ...(fault === 'unsafe' ? { safe: false } : fault === 'binding' ? { binding: 'different' } : fault === 'unit' ? { unit: 'credit_milli' } :
        fault === 'amount' ? { amount: 0.1 } : fault === 'stale' ? { validUntilMs: 1000 } : fault === 'basis' ? { basis: '' } : { tariffRevision: '' }) } as Quote;
    };
    h.service().intent(access, 'intent', soul, { prompt: 'x' }); h.service().estimate(access, 'intent');
    assert.throws(() => h.service().approve(access, 'intent', { amount: 94000, unit: 'usd_micro' }));
    h.service().start(access, 'intent'); assert.equal(h.sends(), 0, fault);
  }
  const h = harness(); h.ready(); h.tick(2000); h.service().start(access, 'intent'); assert.equal(h.sends(), 0);
});
test('late authority/input revocation refuses; plain service exports and actual shared source are exercised', () => {
  const h = harness(); h.ready(); assert.throws(() => h.service().start({ ...access, current: false }, 'intent'), /stale_authority/);
  assert.throws(() => h.service().start({ ...access, inputsAuthorized: false }, 'intent')); assert.equal(h.sends(), 0);
  assert.equal((h.service().history(access) as any).then, undefined);
  const source = readFileSync(new URL('../src/service.ts', import.meta.url), 'utf8');
  assert.match(source, /import \{ MediaCore \} from '..\/..\/media-shared\/src\/core'/);
  assert.doesNotMatch(source, /MediaController|\basync\s+\w|new Promise|host\./);
});
test('new instance concurrency, ceiling and unknown reservation cannot self-authorize later spend', () => {
  const h = harness(); h.ready(); const second = new HiggsfieldService(h.ports);
  start(h); second.start(access, 'intent'); assert.equal(h.sends(), 1);
  h.service().recover(access); h.ready('later'); h.service().start(access, 'later'); assert.equal(h.sends(), 1);
  assert.equal(h.service().history(access)[1].waitReason, 'unknown_reservation');
  const other = harness(); other.store.transact(access.scope.owner, access.scope.workspace, d => { d.ceilings.usd_micro = 1; });
  other.ready(); other.service().start(access, 'intent'); assert.equal(other.sends(), 0);
  assert.equal(other.service().history(access)[0].waitReason, 'ceiling');
});
test('persisted params and unsafe approval edits cannot enter; price expiry during attestation releases hold', () => {
  const h = harness(); h.ready();
  h.store.transact(access.scope.owner, access.scope.workspace, d => { (d.jobs[0].request.params as any).seed = 4; });
  assert.throws(() => start(h)); assert.equal(h.sends(), 0);
  const later = harness(); later.ready(); later.ports.attest = () => { later.tick(2000); return true; };
  const waiting = later.service().start(access, 'intent'); assert.ok('job' in waiting);
  assert.equal(waiting.job.state, 'waiting'); assert.equal(waiting.job.waitReason, 'price_stale');
  assert.equal(later.sends(), 0); assert.equal(later.service().history(access)[0].reservation, undefined);
});
test('untrusted receipt URLs and invented provider states/percentages never enter history', () => {
  for (const extra of [{ status: 'deleted' }, { status_url: 'https://evil.example.org/status' }, { cancel_url: `https://api.higgsfield.ai/requests/${otherUuid}/cancel` }]) {
    assert.throws(() => receipt({ request_id: uuid, status: 'queued', ...extra }, () => false));
  }
  assert.equal(receipt({ request_id: uuid, status: 'in_progress', progress: 0.5 }, () => false).observation.progress, undefined);
});
test('provider identity cannot be coerced from a non-string JSON value', () => {
  const h = harness(); h.ready(); const effect = start(h);
  assert.throws(() => h.service().receive(access, effect, response(effect.plan, { request_id: [uuid], status: 'queued' })), /receipt_unknown/);
  assert.equal(h.service().history(access)[0].jobId, undefined);
  h.service().start(access, 'intent'); assert.equal(h.sends(), 1);
});

test('candidate JSON bound counts UTF8 bytes and callback result stays in retained owner/run scope', () => {
  const plan = metadataPlan('styles.soul', {});
  assert.throws(() => parseJson(response(plan, '€'.repeat(90000)), plan), /invalid_response/);
  const h = harness(); h.ready(); const effect = start(h);
  const foreign = { ...access, scope: { ...access.scope, owner: 'owner-b' } };
  assert.throws(() => h.service().receive(foreign, effect, response(effect.plan)), /receipt_scope_unavailable/);
  assert.equal(h.service().history(access)[0].jobId, undefined);
  const job = h.service().receive({ ...access, current: false }, effect, response(effect.plan));
  assert.equal(job.jobId, uuid); assert.equal(job.state, 'queued');
});
test('backend plans, dispatch and media validation work with URL/URLSearchParams absent', () => {
  const originalUrl = globalThis.URL, originalQuery = globalThis.URLSearchParams;
  try {
    globalThis.URL = undefined as any; globalThis.URLSearchParams = undefined as any;
    assert.equal(publicHttps('https://media.example.org/a.wav?part=1'), true);
    assert.equal(validateParams(audio, { audio_urls: ['https://media.example.org/a.wav'] }), true);
    for (const row of models) if (row.schema && !limitation(row.id)) {
      const request = prepare(row.id, witness(row.schema));
      assert.equal(apiUrl(submitPlan(request, 'url-absent').url), true);
    }
    assert.equal(apiUrl(metadataPlan('presets.marketing', { search: 'a & b', cursor: 2 }).url), true);
    const h = harness(); h.ready(); const effect = start(h);
    assert.equal(h.sends(), 1);
    const result = h.service().receive(access, effect, response(effect.plan, { request_id: uuid, status: 'completed', video: { url: 'https://media.example.org/v.mp4' } }));
    assert.equal(result.state, 'generated');
    for (const url of ['https://api.higgsfield.ai.evil.org/a', 'https://api.higgsfield.ai@evil.org/a', 'https://api.higgsfield.ai:443/a',
      'https://api.higgsfield.ai/a/../admin', 'https://api.higgsfield.ai/%2e%2e/admin', 'https://api.higgsfield.ai/a\\b',
      'https://api.higgsfield.ai/a#secret', 'https://api.higgsfield.ai//evil', 'https://api.higgsfield.ai/a?x=%ZZ']) assert.equal(apiUrl(url), false, url);
    for (const url of ['https://media.example.org@evil.org/a', 'https://media.example.org:444/a', 'https://0x7f.0.0.1/a',
      'https://media.example.org/a\\b', 'https://media.example.org/a#fragment', 'https://media.example.org/a%ZZ',
      'https://media.example.org/\nsecret', 'https://media..example.org/a']) assert.equal(publicHttps(url), false, url);
  } finally { globalThis.URL = originalUrl; globalThis.URLSearchParams = originalQuery; }
  for (const file of ['client', 'schema', 'response', 'service', 'catalog']) {
    const source = readFileSync(new URL(`../src/${file}.ts`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /new\s+(?:URL|URLSearchParams)\b|host\.url\b/);
  }
});
test('queued nullable expiry succeeds and preserves exact provider identity', () => {
  const h = harness(); h.ready(); const effect = start(h);
  const job = h.service().receive(access, effect, response(effect.plan, { request_id: uuid, status: 'queued', expires_at: null }));
  assert.equal(job.jobId, uuid); assert.equal(job.state, 'queued'); assert.equal((h.facts[0] as any).expiresAt, null);
  assert.equal(h.sends(), 1);
});
for (const state of ['queued', 'completed', 'failed']) for (const auxiliary of [
  { expires_at: 42 }, { expires_at: 'not-a-date' }, { status_url: 'https://evil.example.org/status' },
  { cancel_url: `https://api.higgsfield.ai/requests/${otherUuid}/cancel` },
]) test(`valid ${state} identity survives bad auxiliary ${JSON.stringify(auxiliary)}`, () => {
  const h = harness(); h.ready(); const effect = start(h);
  assert.throws(() => h.service().receive(access, effect, response(effect.plan, { request_id: uuid, status: state, ...auxiliary })), /receipt_unknown/);
  const unknown = h.service().history(access)[0];
  assert.equal(unknown.jobId, uuid); assert.equal(unknown.state, 'unknown'); assert.equal(unknown.reservation?.amount, 94000);
  assert.equal(h.facts.length, 0); assert.equal(h.saved.length, 0);
  h.service().start(access, 'intent'); assert.equal(h.sends(), 1);
  const inspect = h.service().inspect(access, 'intent');
  assert.equal(inspect.plan.url, `https://api.higgsfield.ai/requests/${uuid}/status`);
  const reconciled = h.service().receive(access, inspect, response(inspect.plan, { request_id: uuid, status: 'queued', expires_at: null }));
  assert.equal(reconciled.jobId, uuid); assert.equal(reconciled.state, 'queued');
  assert.equal(h.sent.filter(p => p.headers['Idempotency-Key']).length, 1);
});
for (const fields of [{ request_id: 'bad-id', status: 'queued' }, { request_id: uuid, status: 'deleted' }])
  test(`minimum receipt identity/state fails closed ${JSON.stringify(fields)}`, () => {
    const h = harness(); h.ready(); const effect = start(h);
    assert.throws(() => h.service().receive(access, effect, response(effect.plan, fields)), /receipt_unknown/);
    const job = h.service().history(access)[0]; assert.equal(job.jobId, undefined); assert.equal(job.state, 'unknown');
    assert.equal(h.sends(), 1);
  });
