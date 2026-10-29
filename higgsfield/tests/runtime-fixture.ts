import { createHash } from 'node:crypto';
import type { Host } from '@codeterm/plugin-sdk';
export function fakeHost() {
  const files = new Map<string, string>();
  let locked = false;
  const forbidden = () => { throw new Error('network_or_secret_must_not_be_used'); };
  const host = { dataDir: () => '/isolated', unixNowMs: () => 100,
    md5: (s: string) => createHash('md5').update(s).digest('hex'),
    secretGet: forbidden, fetch: forbidden, transfer: { start: forbidden },
    surface: { dispatch: (verb: string, args: string[]) => ({ result: JSON.stringify({ verb, args }) }), invalidate: () => ({ ok: true }) },
    fs: { makeDirs: () => true, fileExists: (p: string) => files.has(p), readFileHead: (p: string) => files.get(p) ?? null,
      writeFileAtomic: (p: string, s: string) => { files.set(p, s); return true; },
      lockFile: () => { if (locked) return null; locked = true; return 'lock'; }, unlockFile: () => { locked = false; return true; } },
  } as unknown as Host;
  return { host, files };
}
export const surface = { surface: 'studio', instance: 'instance', tab: 'child', owner: 'owner', actor: 'owner', actorLabel: 'Owner' };
export const document = { plugin: 'higgsfield', origin: 'document', ...surface, workspace: 'workspace', frame: 'frame', actor: { kind: 'local' } };



/** Contract fixture only: no external effects, secrets, real prices or runtime delivery proof. */
export function deliveredHost() {
  const base = fakeHost();
  let now = 100, sequence = 0;
  const records = new Map<string, any>();
  const requests: any[] = [];
  let mutation: ((value: any) => any) | null = null;
  const origin = { kind: 'studio_agent', surface: surface.surface, instance: surface.instance, tab: surface.tab, actor: surface.actor };
  const scope = { plugin: 'higgsfield', workspace: 'workspace', owner: surface.owner, team: null };
  const host = base.host as any;
  host.unixNowMs = () => now;
  host.jobs = {
    admit: () => {
      const operation = (++sequence).toString(16).padStart(64, '0');
      const r = { operation, scope: { ...scope }, origin: { ...origin }, authorization: 'observation_only', deadlineMs: now + 300000 };
      records.set(operation, { ...r, job: null, spend: null, monitor: null }); return r;
    },
    requestBinding: (request: any) => ({ binding: createHash('sha256').update(JSON.stringify(request)).digest('hex') }),
    status: (operation: string) => JSON.parse(JSON.stringify(records.get(operation) ?? { error: 'plugin_job_request_refused' })),
    prepare: (operation: string, request: any, quote: any) => {
      const r = records.get(operation);
      const spend = { operation, scope: r.scope, origin: r.origin, request, quote, state: 'waiting_for_owner', enteredAtMs: null, dailyAllowance: quote.amount * 10 };
      r.spend = spend; return JSON.parse(JSON.stringify(spend));
    },
    enter: (operation: string) => {
      const s = records.get(operation)?.spend;
      if (!s || s.state !== 'approved_once') return { error: 'plugin_job_request_refused' };
      if (s.quote.validUntilMs <= now) return { ...s, state: 'expired_readmit_needed' };
      s.state = 'entered_unknown'; s.enteredAtMs = now;
      return mutation ? mutation(JSON.parse(JSON.stringify(s))) : JSON.parse(JSON.stringify(s));
    },
  };
  host.transfer = { async: (request: any, then: any) => {
    requests.push(request);
    if (request.url.includes('/estimate/')) return then({ kind: 'json', status: 200, data: { usd: '0.094' }, size: 15, sha256: 'a'.repeat(64) });
    if (request.url.includes('/requests/')) return then({ kind: 'json', status: 200, data: { request_id: '12345678-1234-1234-1234-123456789abc', status: 'completed', images: [{ url: 'https://output.vendor.example/cover.png' }] }, size: 100, sha256: 'b'.repeat(64) });
    if (request.method === 'POST') return then({ kind: 'json', status: 202, data: { request_id: '12345678-1234-1234-1234-123456789abc', status: 'queued' }, size: 100, sha256: 'b'.repeat(64) });
    return then({ kind: 'file', status: 200, file: { path: 'receipt-cover.png', fileName: 'cover.png', contentType: 'image/png', size: 100, sha256: 'c'.repeat(64) } });
  } };
  return { ...base, host, records, requests, advance: (value: number) => { now = value; },
    approve: (id: string) => { records.get(id).spend.state = 'approved_once'; },
    mutateEntry: (fn: (value: any) => any) => { mutation = fn; } };
}
