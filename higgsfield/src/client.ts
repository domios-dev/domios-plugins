import { operations, model, validateParams, limitation } from './catalog';
import { matches, publicHttps } from './schema';
import type { Json, Request, Quote } from '../../media-shared/src/contracts';
import { quoteState } from '../../media-shared/src/cost';

export type Plan = { method: string; url: string; body?: string; headers: Record<string, string> };
export type Response = { status: number; url: string; redirected: boolean; contentType: string; body: string };
export type Pending = { kind: 'pending'; correlation: string };
export const jsonBytes = 262144;
export type TransportPolicy = { redirect: 'error'; retries: 0; maxBytes: number;
  credential: { secretName: 'higgsfield-api-key'; origin: 'https://api.higgsfield.ai'; scheme: 'Key' } };
/** Consumer ports ONLY. No host SDK implementation is claimed. Transport must disable redirects/retries,
 * enforce byte/time/DNS bounds before reading, and must never log credentials. */
export type ClientPorts = {
  /** Metadata only. The transport resolves credentials after its own pin/current-network-grant checks. */
  secret?: { pluginBucketVerified: boolean; available(name: 'higgsfield-api-key'): boolean };
  transport?: { send(plan: Plan, policy: TransportPolicy): Response | Pending };
};
const origin = 'https://api.higgsfield.ai';
const plans = new WeakSet<object>();
function issued(plan: Plan): Plan {
  Object.freeze(plan.headers); Object.freeze(plan); plans.add(plan); return plan;
}
export function apiUrl(url: string): boolean {
  // Catalog builders issue canonical ASCII paths/query pairs; no browser URL global exists in QuickJS.
  if (typeof url !== 'string' || url.length > 8192 || !url.startsWith(origin + '/')) return false;
  const tail = url.slice(origin.length + 1);
  const [path, query, extra] = tail.split('?');
  return extra === undefined && /^[A-Za-z0-9._/-]+$/.test(path) &&
    !path.split('/').some(segment => !segment || segment === '.' || segment === '..') &&
    (query === undefined || /^[A-Za-z0-9_.!~*'()%=&-]+$/.test(query) && !/%(?![a-f\d]{2})/i.test(query));
}
export function requestUrl(id: string, kind: 'status' | 'cancel'): string {
  if (typeof id !== 'string' || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)) throw new Error('invalid_provider_identity');
  return `${origin}/requests/${id}/${kind}`;
}
export function validateReturnedUrl(url: unknown, id: string, kind: 'status' | 'cancel'): string {
  if (typeof url !== 'string' || url !== requestUrl(id, kind)) throw new Error('invalid_provider_url');
  return url;
}
export function usdMicro(value: unknown): number | null {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,9})(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const result = Number(whole) * 1000000 + Number(fraction.padEnd(6, '0'));
  return Number.isSafeInteger(result) ? result : null;
}
export function parseJson(response: Response, expected: Plan): Json {
  let bytes = 0;
  for (const point of response.body) { const n = point.codePointAt(0)!; bytes += n < 128 ? 1 : n < 2048 ? 2 : n < 65536 ? 3 : 4; if (bytes > jsonBytes) break; }
  if (response.redirected || response.url !== expected.url || !apiUrl(response.url) || bytes > jsonBytes ||
      !/^application\/json(?:\s*;|$)/i.test(response.contentType)) throw new Error('invalid_response');
  if (response.status < 200 || response.status > 299) throw new Error(`provider_http_${response.status}`);
  try { return JSON.parse(response.body); } catch { throw new Error('invalid_json'); }
}
export function submitPlan(request: Request, intent: string): Plan {
  const row = model(request.operation);
  if (limitation(row.id) || !validateParams(row.id, request.params) || !/^[\x21-\x7e]{1,255}$/.test(intent)) throw new Error('invalid_submission');
  return issued({ method: 'POST', url: row.endpoint, body: JSON.stringify(request.params), headers: { 'Content-Type': 'application/json', 'Idempotency-Key': intent } });
}
export function metadataPlan(id: string, params: Json): Plan {
  const row = operations.find(o => o.id === id);
  if (!row || !row.schema || !matches(row.schema, params) || ['requests.status', 'requests.cancel', 'requests.delete'].includes(id)) throw new Error('operation_unavailable');
  let url = row.endpoint;
  const data = params as Record<string, Json>;
  if (id === 'references.get') url = url.replace('{id}', String(data.id));
  else if (row.method === 'GET' && Object.keys(data).length) {
    url += '?' + Object.entries(data).map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  }
  return issued({ method: row.method, url, headers: row.method === 'POST' ? { 'Content-Type': 'application/json' } : {},
    ...(row.method === 'POST' ? { body: JSON.stringify(params) } : {}) });
}
export function lifecyclePlan(jobId: string, action: 'status' | 'cancel'): Plan {
  return issued({ method: action === 'status' ? 'GET' : 'POST', url: requestUrl(jobId, action), headers: {} });
}
export class HiggsfieldClient {
  constructor(private readonly ports: ClientPorts = {}) {}
  /** Synchronous plain response or injected continuation correlation; never a Promise/host job ID. */
  prepareSend(plan: Plan): () => Response | Pending {
    if (!plans.has(plan) || !apiUrl(plan.url) || !['GET', 'POST', 'DELETE'].includes(plan.method) || Object.keys(plan.headers).some(k => /authorization|cookie|proxy/i.test(k))) throw new Error('invalid_request_plan');
    if (!this.ports.transport || !this.ports.secret?.pluginBucketVerified) throw new Error('host_transport_or_secret_scope_unavailable');
    try { if (this.ports.secret.available('higgsfield-api-key') !== true) throw new Error(); } catch { throw new Error('credential_unavailable'); }
    const transport = this.ports.transport;
    let used = false;
    return () => {
      if (used) throw new Error('dispatch_already_entered');
      used = true;
      try {
        const result = transport.send(plan, { redirect: 'error', retries: 0, maxBytes: jsonBytes,
          credential: { secretName: 'higgsfield-api-key', origin: 'https://api.higgsfield.ai', scheme: 'Key' } });
        if (!result || typeof (result as any).then === 'function') throw new Error();
        return result;
      } catch { throw new Error('transport_uncertain'); }
    };
  }
  send(plan: Plan): Response | Pending { return this.prepareSend(plan)(); }
}
/** Only a trusted independently verified account tariff/quote port may supply this evidence.
 * The public {usd} example has no revision/expiry guarantee and cannot self-authorize. */
export function boundedQuote(request: Request, binding: string, now: number, evidence: Quote | null): Quote | null {
  return quoteState(evidence, binding, request.unit, now) === 'ready' ? JSON.parse(JSON.stringify(evidence)) : null;
}
export function estimatePlan(request: Request): Plan {
  if (request.operation !== 'higgsfield-ai/soul/v2/standard' || !validateParams(request.operation, request.params)) throw new Error('estimate_not_established');
  return issued({ method: 'POST', url: `${origin}/estimate/${request.operation}`, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.params) });
}
export function outputUrl(value: unknown, allowed: (url: string) => boolean): string {
  if (typeof value !== 'string' || !publicHttps(value) || !allowed(value)) throw new Error('output_origin_unverified');
  return value;
}
