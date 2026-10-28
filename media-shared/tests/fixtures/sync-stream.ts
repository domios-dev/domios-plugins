import type { Adapter, Quote, StreamEvent } from '../../src/contracts';

/** Direct binary response and incremental byte protocol, independently shaped from ticket polling. */
export function byteFixture(now: () => number, streaming: boolean) {
  let calls = 0; let estimates = 0; let broken = false; let overflow = false;
  const pieces = () => [new Uint8Array([255, 0]), new Uint8Array([195, 40, 128])];
  const preflight = {
    validate: (r: { operation: string }) => r.operation === 'render',
    async estimate(request: { unit: Quote['unit'] }, binding: string): Promise<Quote> {
      estimates++;
      return { amount: 4, unit: request.unit, safe: true, binding, basis: 'verified bounded tariff and exact input',
        tariffRevision: 'byte-tariff-3', issuedAt: now(), validUntilMs: now() + 100 };
    },
  };
  const adapter: Adapter = streaming ? {
    ...preflight, kind: 'stream',
    async *stream(): AsyncIterable<StreamEvent> {
      calls++;
      for (const bytes of pieces()) yield { kind: 'bytes', bytes };
      if (broken) throw Error('stream disconnected with private details');
      if (overflow) yield { kind: 'bytes', bytes: new Uint8Array(20) };
      yield { kind: 'complete', contentType: 'audio/mpeg' };
    },
  } : {
    ...preflight, kind: 'sync',
    async execute() { calls++; if (broken) throw Error('direct response lost');
      return [{ bytes: new Uint8Array([255, 0, 195, 40, 128]), contentType: 'audio/mpeg' }]; },
  };
  return { adapter, stats: () => ({ calls, estimates }), break: () => { broken = true; }, overflow: () => { overflow = true; } };
}
