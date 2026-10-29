import { HiggsfieldCommands } from '../../src/commands';
import { fixture, soul } from '../../tests/fixtures/commands';
import type { Job } from '../../../media-shared/src/contracts';
import type { UITransport, Methods } from '../src/transport';
import type { UISnapshot } from '../../src/ui';
import type { MediaViewPort } from '../src/App';

/** Dev entry only. All state here is synthetic, no account/host/Courier proof. */
export function fixtureTransport(options: { scenario?: string; load?: () => string | null; save?: (value: string) => void } = {}) {
  const f = fixture(), listeners = new Set<() => void>();
  const original = f.store.transact.bind(f.store);
  let submissions = 0, sequence = 0, owner = 'A';
  try { const saved = JSON.parse(options.load?.() ?? 'null'); if (saved?.partition && Number.isSafeInteger(saved.submissions)) {
    original('A', 'workspace', p => { Object.assign(p, saved.partition); return null; }); submissions = saved.submissions; sequence = saved.sequence;
  } } catch { /* Invalid local fixture storage is discarded; no production fallback. */ }
  f.store.transact = (o, w, edit) => {
    const result = original(o, w, edit);
    if (o === 'A') options.save?.(JSON.stringify({ partition: original('A', 'workspace', p => p), submissions, sequence }));
    return result;
  };
  const context = f.viewContext('A');
  f.ports.identity = () => `ui_${++sequence}`;
  f.ports.proof = (_a, j) => j.quote ? { purpose: 'Synthetic fixture only', operation: j.id, binding: j.binding,
    maximum: j.quote, runCeiling: { amount: 100, unit: 'usd_micro' }, aggregateProof: 'fixture-only-not-approval' } : null;
  f.ports.admit = (service, access, id, action) => {
    if (action === 'submit') { const before = service.history(access).find(j => j.id === id)!;
      if (before.state === 'waiting') service.approve(access, id, { amount: 10, unit: 'usd_micro' });
      const result = f.admit(service, access, id, action);
      if (f.sends() > 0 && before.state === 'waiting' && result.state !== 'waiting') submissions++;
      options.save?.(JSON.stringify({ partition: original('A', 'workspace', p => p), submissions, sequence }));
      return result;
    }
    return f.admit(service, access, id, action);
  };
  const commands = new HiggsfieldCommands(f.service, f.ports);
  const humanA = f.contexts.get(context)!;
  const seed = (id: string, state: Job['state'], actor: 'you' | 'agent' | 'run', extra: Partial<Job> = {}) => {
    const a = actor === 'you' ? humanA : f.actor('A', actor);
    try { f.service.intent(a, id, soul, { prompt: `Fixture ${id}: a quiet garden` });
      original('A', 'workspace', p => { const j = p.jobs.find(j => j.id === id)!; Object.assign(j, { state, ...extra }); return null; });
    } catch { /* Existing persisted fixtures are retained. */ }
  };
  if (original('A', 'workspace', p => p.jobs.length) === 0) {
    if (options.scenario === 'pipeline') {
      seed('run-one', 'generated', 'run', { outputs: [{ kind: 'artifact', id: 'fixture-image', contentType: 'image/png' }] });
      seed('run-two', 'failed', 'run'); seed('run-three', 'waiting', 'run', { waitReason: 'owner_confirmation' });
    } else {
      seed('queued', 'queued', 'agent'); seed('generating', 'generating', 'agent');
      seed('generated', 'generated', 'you', { outputs: [{ kind: 'artifact', id: 'fixture-image', contentType: 'image/png' }, { kind: 'artifact', id: 'fixture-audio', contentType: 'audio/wav' }] });
      seed('failed', 'failed', 'agent'); seed('canceled', 'canceled', 'you'); seed('unknown', 'unknown', 'agent');
      seed('starting', 'starting', 'you'); seed('price-missing', 'waiting', 'you', { waitReason: 'price_unavailable' });
      seed('price-stale', 'waiting', 'you', { waitReason: 'price_stale' }); seed('waiting-ok', 'waiting', 'run', { waitReason: 'owner_confirmation' });
      seed('expired', 'generated', 'you');
    }
  }
  const notify = () => listeners.forEach(fn => fn());
  const invalidate = f.ports.surface.invalidate;
  f.ports.surface.invalidate = identity => { const result = invalidate(identity); notify(); return result; };
  const transport: UITransport = {
    async call<K extends keyof Methods>(method: K, args: Methods[K]['args']): Promise<Methods[K]['result']> {
      // Exact same commands, authorized document DTO and service as production.
      const result = commands.viewCall(method, args, context) as any;
      if (result?.error) throw new Error(result.error);
      if (result?.kind === 'unavailable') return result;
      if (method === 'estimate') original('A', 'workspace', p => { const j = p.jobs.find(j => j.id === (args as { id: string }).id); if (j?.quote) j.quote.validUntilMs = f.now() + 600000; return null; });
      if (method === 'ui.snapshot' && options.scenario === 'pipeline') {
        for (const i of (result as UISnapshot).items) { i.runLink = '#fixture-existing-run'; if (i.id === 'run-two') i.from = 'run-one'; }
      }
      if (method === 'ui.snapshot') for (const i of (result as UISnapshot).items) if (i.id === 'expired') i.notice = 'Expired · Synthetic file loss; settings remain.';
      return result;
    }, subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }
  };
  function setOwner(view: 'A' | 'B' | 'user') {
    owner = view;
    f.contexts.set(context, view === 'user' ? humanA : f.actor(view)); notify();
  }
  function unknown() { f.store.transact('A', 'workspace', p => { const j = p.jobs.find(j => j.id.startsWith('ui_')); if (j) j.state = 'unknown'; return null; }); notify(); }
  function complete() {
    const job = f.service.history(humanA).find(j => j.id.startsWith('ui_') && ['starting', 'queued', 'generating'].includes(j.state));
    if (job) f.receive(humanA, 'completed', { status_url: `https://api.higgsfield.ai/requests/d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff/status`, cancel_url: `https://api.higgsfield.ai/requests/d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff/cancel`, images: [{ url: 'https://media.example.org/fixture.png' }] });
    notify();
  }
  return { transport, f, commands, context, notify, complete, unknown, setOwner, submissions: () => submissions, owner: () => owner };
}
export const fixtureMedia: MediaViewPort = { get(id) {
  const kind = id === 'fixture-audio' ? 'audio' : 'image';
  const url = kind === 'audio' ? '/fixtures/tone.wav' : '/fixtures/checker.png';
  return { kind, url, declared: ['saveAs'], availability: { saveAs: true, copyText: false, reveal: false }, save() { const a = document.createElement('a'); a.href = url; a.download = kind === 'audio' ? 'fixture-tone.wav' : 'fixture-checker.png'; a.click(); } };
} };
