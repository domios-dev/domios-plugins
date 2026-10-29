import { HiggsfieldCommands } from '../../src/commands';
import { fixture, soul } from '../../tests/fixtures/commands';
import type { Job } from '../../../media-shared/src/contracts';
import type { UITransport, Methods } from '../src/transport';
import { uiItem } from '../../src/ui';
import type { UISnapshot, UIDetails } from '../../src/ui';
import type { MediaViewPort } from '../src/App';
import type { StudioController } from '../src/controller';

/** Dev entry only. All state here is synthetic, no account/host/Courier proof. */
export function fixtureTransport(options: { scenario?: string; now?: number; load?: () => string | null; save?: (value: string) => void } = {}) {
  const now = options.now ?? Date.now();
  const ready = options.scenario === 'pipeline-ready', pipeline = options.scenario === 'pipeline' || ready;
  const persistence: Pick<typeof options, 'load' | 'save'> = ready || options.scenario==='empty' ? {} : options;
  const f = fixture(now, 60000), listeners = new Set<() => void>();
  const original = f.store.transact.bind(f.store);
  let submissions = 0, sequence = 0, owner = 'A';
  try { const saved = JSON.parse(persistence.load?.() ?? 'null'); if (saved?.partition && Number.isSafeInteger(saved.submissions)) {
    original('A', 'workspace', p => {
      Object.assign(p, saved.partition);
      // Migrate only the obsolete synthetic epoch clock; preserve IDs, states and submission count.
      for (const job of p.jobs) if (job.at < new Date(2000, 0, 1).getTime()) { job.at = now - 5 * 60000; job.updatedAt = job.at; }
      return null;
    }); submissions = saved.submissions; sequence = saved.sequence;
  } } catch { /* Invalid local fixture storage is discarded; no production fallback. */ }
  f.store.transact = (o, w, edit) => {
    const result = original(o, w, edit);
    if (o === 'A') persistence.save?.(JSON.stringify({ partition: original('A', 'workspace', p => p), submissions, sequence }));
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
      persistence.save?.(JSON.stringify({ partition: original('A', 'workspace', p => p), submissions, sequence }));
      return result;
    }
    return f.admit(service, access, id, action);
  };
  if (ready) { f.ports.admit = undefined; f.ports.proof = undefined; }
  const commands = new HiggsfieldCommands(f.service, f.ports);
  const humanA = f.contexts.get(context)!;
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const today = Math.floor(now - Math.min((now - midnight.getTime()) / 2, 2 * 3600000));
  const previousDay = (days: number) => { const day = new Date(now); day.setDate(day.getDate() - days); day.setHours(15, 0, 0, 0); return day.getTime(); };
  const pipelinePrompts: Record<string, string> = { 'run-one': 'A quiet garden cover', 'run-two': 'A matching garden variation', 'run-three': 'A final garden cover' };
  const seed = (id: string, state: Job['state'], actor: 'you' | 'agent' | 'run', extra: Partial<Job> = {}, at = now - 60000) => {
    const a = actor === 'you' ? humanA : f.actor('A', actor);
    if (a.scope.actor.kind === 'run') a.scope.actor = { ...a.scope.actor, label: 'Daily covers run #12' };
    const existing = original('A', 'workspace', p => p.jobs.find(j => j.id === id) ?? null);
    if (existing) {
      original('A', 'workspace', p => { const j = p.jobs.find(j => j.id === id)!; j.at = at; j.updatedAt = at; if (j.scope.actor.kind === 'run') j.scope.actor.label = 'Daily covers run #12'; return null; });
      return;
    }
    try { f.service.intent(a, id, soul, { prompt: pipelinePrompts[id] ?? `Fixture ${id}: a quiet garden` });
      original('A', 'workspace', p => { const j = p.jobs.find(j => j.id === id)!; Object.assign(j, { state, ...extra, at, updatedAt: at }); return null; });
    } catch { /* Existing persisted fixtures are retained. */ }
  };
  {
    if (pipeline) {
      seed('run-one', 'generated', 'run', { outputs: [{ kind: 'artifact', id: 'fixture-image', contentType: 'image/png' }] });
      seed('run-two', 'failed', 'run'); seed('run-three', 'waiting', 'run', { waitReason: 'owner_confirmation' });
    } else if(options.scenario!=='empty') {
      seed('queued', 'queued', 'agent'); seed('generating', 'generating', 'agent');
      seed('generated', 'generated', 'you', { outputs: [{ kind: 'artifact', id: 'fixture-image', contentType: 'image/png' }, { kind: 'artifact', id: 'fixture-audio', contentType: 'audio/wav' }] }, today);
      seed('failed', 'failed', 'agent', {}, today); seed('canceled', 'canceled', 'you', {}, previousDay(1)); seed('unknown', 'unknown', 'agent');
      seed('starting', 'starting', 'you'); seed('price-missing', 'waiting', 'you', { waitReason: 'price_unavailable' });
      seed('price-stale', 'waiting', 'you', { waitReason: 'price_stale' }); seed('waiting-ok', 'waiting', 'run', { waitReason: 'owner_confirmation' });
      seed('expired', 'generated', 'you', {}, previousDay(3));
      const image = { outputs: [{ kind: 'artifact' as const, id: 'fixture-image', contentType: 'image/png' }] };
      const video = { outputs: [{ kind: 'artifact' as const, id: 'fixture-video-metadata', contentType: 'video/mp4' }] };
      seed('audio-result', 'generated', 'you', { outputs: [{kind:'artifact',id:'fixture-audio',contentType:'audio/wav'}] }, today - 4000);
      seed('image-study', 'generated', 'you', image, today - 1000);
      seed('video-study', 'generated', 'you', video, today - 2000);
      seed('synthetic-video', 'generated', 'you', { outputs: [{ kind: 'artifact', id: 'fixture-synthetic-video', contentType: 'video/webm' }] }, today - 3000);
      seed('image-yesterday', 'generated', 'you', image, previousDay(1));
      seed('video-yesterday', 'generated', 'you', video, previousDay(1) - 1000);
      seed('failed-yesterday', 'failed', 'agent', {}, previousDay(1) - 2000);
      seed('image-older', 'generated', 'you', image, previousDay(3) - 1000);
    }
  }
  if (ready) f.service.estimate(f.actor('A', 'run'), 'run-three'); // Actual free injected estimator; no approval/submission.
  const notify = () => listeners.forEach(fn => fn());
  const invalidate = f.ports.surface.invalidate;
  f.ports.surface.invalidate = identity => { const result = invalidate(identity); notify(); return result; };
  const transport: UITransport = {
    async call<K extends keyof Methods>(method: K, args: Methods[K]['args']): Promise<Methods[K]['result']> {
      if (ready && ['prepare', 'submit'].includes(method)) throw new Error('ready_fixture_read_only');
      // Exact same commands, authorized document DTO and service as production.
      const result = commands.viewCall(method, args, context) as any;
      if (result?.error) throw new Error(result.error);
      if (result?.kind === 'unavailable') return result;
      if (['ui.snapshot', 'ui.details'].includes(method) && pipeline) {
        const access = f.contexts.get(context)!;
        const sourceJob = f.service.history(access).find(j => j.id === 'run-one' && j.scope.actor.kind === 'run');
        const source = sourceJob ? uiItem(sourceJob, f.now()) : undefined;
        const items = method === 'ui.snapshot' ? (result as UISnapshot).items : [(result as UIDetails).item];
        for (const item of items) if (source?.actor.kind === 'run' && item.actor.kind === 'run' && item.actor.runId === source.actor.runId) {
          item.runLink = '#fixture-existing-run';
          if (item.id === 'run-two') {
            const subject = Array.from(source.title.replace(/^Fixture [A-Za-z0-9_-]+: /, '')).slice(0, 32).join('');
            item.source = { id: source.id, label: Array.from(`'${subject}' · ${source.modelLabel ?? 'Model unavailable'}`).slice(0, 96).join('') };
          }
        }
      }
      if (method === 'ui.snapshot') for (const i of (result as UISnapshot).items) if (i.id === 'synthetic-video') i.notice = 'Synthetic local test-pattern video · not vendor media.';
      if (method === 'ui.snapshot') for (const i of (result as UISnapshot).items) if (i.id === 'expired') i.notice = 'Expired · Synthetic file loss; settings remain.';
      if (method === 'ui.snapshot') for (const i of (result as UISnapshot).items) if (i.outputs.some(output => output.id === 'fixture-video-metadata')) i.notice = 'Synthetic video metadata · Playback not supplied.';
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
/** The actual dev owner-button handler, shared with the deterministic race regression. */
export function selectFixtureOwner(fixture: Pick<ReturnType<typeof fixtureTransport>, 'setOwner'>, controller: StudioController, owner: 'A' | 'B' | 'user') {
  controller.resetContext();
  fixture.setOwner(owner); // Emits the required visibility refresh before model selection.
  return controller.selectModel(soul); // Must never cancel that independent visibility refresh.
}
export const fixtureMedia: MediaViewPort = { get(id) {
  if (!['fixture-audio', 'fixture-image', 'fixture-media', 'fixture-synthetic-video'].includes(id)) return null;
  const kind = id === 'fixture-audio' ? 'audio' : id === 'fixture-synthetic-video' ? 'video' : 'image';
  const url = kind === 'audio' ? '/fixtures/tone.wav' : kind === 'video' ? '/fixtures/synthetic-selection-4s.webm' : '/fixtures/checker.png';
  return { kind, url, declared: ['saveAs'], availability: { saveAs: true, copyText: false, reveal: false }, save() { const a = document.createElement('a'); a.href = url; a.download = kind === 'audio' ? 'fixture-tone.wav' : kind === 'video' ? 'synthetic-selection-4s.webm' : 'fixture-checker.png'; a.click(); } };
} };
