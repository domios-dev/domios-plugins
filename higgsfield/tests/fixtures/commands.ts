import { HiggsfieldService } from '../../src/service';
import { HiggsfieldClient } from '../../src/client';
import { clone } from '../../../media-shared/src/contracts';
import type { Access, JobStore, Partition } from '../../../media-shared/src/contracts';
import type { SurfaceContext, ViewContext, CommandPorts } from '../../src/commands';
import type { Effect } from '../../src/service';
export const soul = 'higgsfield-ai/soul/v2/standard';
export const providerId = 'd7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff';
export function fixture(initialNow = 10, quoteValidityMs = 100) {
  if (!Number.isSafeInteger(quoteValidityMs) || quoteValidityMs < 1 || quoteValidityMs > 60000) throw new Error('invalid_fixture_quote_validity');
  const partitions = new Map<string, Partition>();
  const store: JobStore = { transact(owner, workspace, edit) {
    const key = owner + ':' + workspace;
    const p = clone(partitions.get(key) ?? { jobs: [], ceilings: { usd_micro: 100 } });
    const r = edit(p); partitions.set(key, p); return clone(r);
  } };
  let sends = 0, id = 0, now = initialNow;
  let effect: Effect | undefined;
  const contexts = new WeakMap<object, Access>();
  const invalidations: unknown[] = [], calls: unknown[] = [];
  const service = new HiggsfieldService({ store, now: () => now, maxHistory: 64,
    client: new HiggsfieldClient({ secret: { pluginBucketVerified: true, available: () => true },
      transport: { send: () => { sends++; return { kind: 'pending', correlation: 'fixture-only' }; } } }),
    attest: () => true,
    quote: (_a, _r, binding) => ({ amount: 10, unit: 'usd_micro', binding, safe: true, basis: 'synthetic-only', tariffRevision: 'fixture', issuedAt: now, validUntilMs: now + quoteValidityMs }),
    output: { allowed: u => u === 'https://media.example.org/fixture.png', save: () => [{ kind: 'artifact', id: 'fixture-media', contentType: 'image/png' }] },
  });
  const surface = { call(verb: string, argsJson: string) { calls.push({ verb, argsJson }); return JSON.stringify({ result: 'host-owned-child' }); },
    invalidate(identity: unknown) { invalidations.push(identity); return { ok: true as const }; } };
  const ports: CommandPorts = { surface, access: c => contexts.get(c) ?? null, identity: () => `intent_${++id}`, now: () => now };
  function actor(owner: string, kind: 'agent' | 'you' | 'run' = 'agent', runId = 'run-a'): Access {
    return { current: true, inputsAuthorized: true, scope: { owner, workspace: 'workspace', actorId: `${owner}-${kind}`, human: kind === 'you', authRevision: 'fixture',
      ...(kind === 'run' ? { runId } : {}), actor: kind === 'you' ? { kind } : kind === 'agent' ? { kind, label: owner } : { kind, label: runId, runId } } };
  }
  function surfaceContext(owner: string): SurfaceContext {
    const c = { surface: 'studio', instance: `instance-${owner}`, tab: `tab-${owner}`, owner, actor: owner, actorLabel: owner };
    contexts.set(c, actor(owner)); return c;
  }
  function viewContext(owner: string): ViewContext {
    const c: ViewContext = { plugin: 'higgsfield', origin: 'document', surface: 'studio', instance: `instance-${owner}`, tab: `tab-${owner}`, owner, actor: { kind: 'local' }, frame: 'host-fixture-frame' };
    contexts.set(c, actor(owner, 'you')); return c;
  }
  const admit: NonNullable<CommandPorts['admit']> = (s, a, id, action) => {
    if (action === 'submit') { const r = s.start(a, id); if ('token' in r) effect = r; }
    else effect = action === 'reconcile' ? s.inspect(a, id) : s.cancel(a, id);
    return s.history(a).find(j => j.id === id)!;
  };
  function receive(a: Access, status: string, extra: object = {}) {
    if (!effect) throw new Error('no_fixture_effect');
    return service.receive(a, effect, { url: effect.plan.url, redirected: false, status: effect.action === 'cancel' ? 202 : 200, contentType: 'application/json',
      body: effect.action === 'cancel' ? '' : JSON.stringify({ request_id: providerId, status, ...extra }) });
  }
  return { service, store, ports, contexts, surfaceContext, viewContext, actor, admit, receive, invalidations, calls,
    sends: () => sends, tick: () => { now += quoteValidityMs + 1; }, now: () => now, effect: () => effect };
}
