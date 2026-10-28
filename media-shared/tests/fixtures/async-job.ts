import type { Adapter, Observation, Quote } from '../../src/contracts';

/** Independent ticket/status protocol; no binary streaming or synchronous completion facade. */
export function ticketFixture(now: () => number) {
  let posts = 0; let polls = 0; let cancels = 0; let estimates = 0;
  let failSubmit = false; let foreign = false;
  let remote: { ticket: string; phase: 'pending' | 'working' | 'done' | 'stopped'; billed?: number } = { ticket: 'ticket-7', phase: 'pending' };
  let price: Partial<Quote> | null = {};
  let hold: Promise<void> | undefined;
  const map = (): Observation => ({ jobId: foreign ? 'other-ticket' : remote.ticket,
    state: ({ pending: 'queued', working: 'generating', done: 'generated', stopped: 'canceled' } as const)[remote.phase],
    providerState: remote.phase,
    outputs: remote.phase === 'done' ? [{ bytes: new Uint8Array([137, 80, 78]), contentType: 'image/png' }] : undefined,
    charged: remote.billed === undefined ? undefined : { amount: remote.billed, unit: 'usd_micro' } });
  const adapter: Adapter = {
    kind: 'async', validate: r => r.operation === 'render',
    async estimate(request, binding) {
      estimates++;
      return price === null ? null : { amount: 12, unit: request.unit, safe: true, binding, basis: 'authenticated exact-input quote',
        tariffRevision: 'ticket-tariff-1', issuedAt: now(), validUntilMs: now() + 100, ...price };
    },
    async submit() { posts++; if (hold) await hold; if (failSubmit) throw Error('secret raw vendor failure'); return map(); },
    async inspect(id) { polls++; if (id !== 'ticket-7') throw Error('foreign ticket'); return map(); },
    cancel: { queued: true, running: false, async request(id) { if (id !== 'ticket-7') throw Error('foreign ticket'); cancels++; } },
  };
  return { adapter, stats: () => ({ posts, polls, cancels, estimates }), setPrice: (q: Partial<Quote> | null) => { price = q; },
    fail: () => { failSubmit = true; }, replaceId: () => { foreign = true; },
    phase: (phase: typeof remote.phase, billed?: number) => { remote = { ticket: remote.ticket, phase, billed }; },
    hold: (promise: Promise<void>) => { hold = promise; } };
}
