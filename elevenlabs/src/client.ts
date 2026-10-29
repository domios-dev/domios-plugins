import { MediaCore } from '../../media-shared/src/core';
import { quoteState, totals } from '../../media-shared/src/cost';
import { bindingOf, clone } from '../../media-shared/src/contracts';
import { reopen, humanAction } from '../../media-shared/src/media';
import type { Access, Artifact, Continuation, JobStore, Quote, Request, Scope, Submission } from '../../media-shared/src/contracts';
import type { MediaPorts } from '../../media-shared/src/media';
import { operation, disposition, validateRequest, validateResponse, schemaFor, catalog, modelCatalog } from './catalog';
import type { Parameters } from './catalog';

export { catalog, modelCatalog, reopen, humanAction };
export type WireRequest = {
  url: string; method: string; params: Parameters; inputs: Request['inputs'];
  body?: {kind:'json'; data:unknown} | {kind:'multipart'; parts:({kind:'text';name:string;value:string}|{kind:'file';name:string;input:number})[]};
  response: {kind:'json';maxBytes:number;statuses:number[]} | {kind:'file';contentType:string;maxBytes:number;statuses:number[]};
  credential: { plugin: 'elevenlabs'; name: 'elevenlabs-api-key' };
  redirect: 'error'; retry: 0; maxBytes: number; timeoutMs: number;
};
export function utf8Size(text: string): number {
  let bytes = 0;
  for (const ch of text) { const cp = ch.codePointAt(0)!; bytes += cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4; }
  return bytes;
}
export type Reply = { status: number; contentType: string; json?: unknown; bytes?: Uint8Array };
export type Chunk = { kind: 'bytes'; bytes: Uint8Array } | { kind: 'complete'; status: number; contentType: string };
/** Injection contracts, NOT declarations of available host SDK APIs. No defaults to network/shell/global storage. */
export interface ServicePorts {
  store: JobStore;
  now(): number;
  access(caller: unknown, request?: Request): Access;
  /** Must check account entitlement, input grants and exact operation; no caller-supplied scope.
   * Every input ID must bind immutable content identity (size/SHA) in the host grant. Revocable paths are insufficient.
   */
  permitted(access: Access, request: Request): boolean;
  quote?: (scope: Scope, request: Request, binding: string) => Quote | null;
  /** Host resolves the named plugin secret internally; its value never enters service/job/UI memory. */
  http?: (request: WireRequest) => Reply;
  stream?: (request: WireRequest) => Iterable<Chunk>;
  save?: (scope: Scope, intent: string, output: { bytes: Uint8Array; contentType: string } | { json: unknown }) => Artifact;
  maxHistory: number; maxBytes: number;
}
function synchronous<T>(value: T): T {
  if (value && typeof (value as any).then === 'function') throw new Error('explicit_host_continuation_required');
  return value;
}
function clean(value: any, depth = 0): any {
  if (depth > 30) throw new Error('response_too_deep');
  if (typeof value === 'string') return /https?:\/\/|bearer\s|xi-api-key/i.test(value) ? '[redacted]' : value;
  if (Array.isArray(value)) return value.map(v => clean(v, depth + 1));
  if (value && typeof value === 'object') {
    const result: Record<string, any> = {};
    for (const [key,v] of Object.entries(value)) if (!/secret|token|api.?key|authorization|password|url|__proto__|constructor|prototype/i.test(key)) result[key] = clean(v, depth + 1);
    return result;
  }
  return value;
}
export class ElevenLabsService {
  private readonly direct: MediaCore;
  private readonly streamed: MediaCore;
  constructor(private readonly ports: ServicePorts) {
    if (!Number.isSafeInteger(ports.maxBytes) || ports.maxBytes < 1 || ports.maxBytes > 256 * 1024 * 1024) throw new Error('invalid_bounds');
    this.direct = new MediaCore(ports.store, ports.now, ports.maxHistory, 'sync', validateRequest);
    this.streamed = new MediaCore(ports.store, ports.now, ports.maxHistory, 'stream', validateRequest);
  }
  private access(caller: unknown, request?: Request) {
    const access = synchronous(this.ports.access(caller, request));
    if (!access.current || !access.scope.owner || !access.scope.workspace || !access.scope.actorId) throw new Error('authority_unavailable');
    if (request && !synchronous(this.ports.permitted(access, request))) throw new Error('operation_denied');
    return access;
  }
  private core(request: Request) { return operation(request.operation).transport.kind === 'http-stream' ? this.streamed : this.direct; }
  private job(caller: unknown, id: string) {
    const access = this.access(caller);
    const job = this.direct.history(access).find(j => j.id === id);
    if (!job) throw new Error('job_unavailable');
    return { access: this.access(caller, job.request), job, core: this.core(job.request) };
  }
  intent(caller: unknown, id: string, request: Request) {
    if (!validateRequest(request)) throw new Error('invalid_request');
    const row = operation(request.operation), policy = disposition(row);
    if (row.method === 'GET') throw new Error('use_read');
    if (policy.limitation) throw new Error(row.family === 'voices' ? 'protected_voice' : 'operation_unavailable');
    return this.core(request).intent(this.access(caller, request), id, request);
  }
  history(caller: unknown) { return this.direct.history(this.access(caller)); }
  ledger(caller: unknown, runId?: string) { return totals(this.history(caller), runId); }
  recover(caller: unknown) { return this.direct.recover(this.access(caller)); }
  estimate(caller: unknown, id: string) {
    const {access, job, core} = this.job(caller, id);
    const decision = core.beginEstimate(access, id, true), token = decision.continuation!;
    try {
      const quote = synchronous(this.ports.quote?.(clone(job.scope), clone(job.request), job.binding) ?? null);
      // The common core/cost module owns freshness, exact binding, units and independent approval.
      return core.estimated(this.access(caller, job.request), token,
        quoteState(quote, bindingOf(job.request), job.request.unit, this.ports.now()) === 'ready' ? quote : null);
    } catch { core.estimateFailed(token); throw new Error('estimate_unavailable'); }
  }
  approve(caller: unknown, id: string, maximum: { amount: number; unit: Request['unit'] }) {
    const {access, core} = this.job(caller, id); return core.approve(access, id, maximum);
  }
  /** Synchronous transition boundary for a future reviewed durable host transport wrapper. */
  enter(caller: unknown, id: string): { job: ReturnType<MediaCore['history']>[number]; action?: Submission } {
    const {access, job, core} = this.job(caller, id);
    const claim = core.beginStart(access, id, !!this.ports.save);
    if (!claim.continuation) return { job: claim.job };
    const token = claim.continuation;
    try {
      const reserved = core.reserve(this.access(caller, job.request), token);
      if (reserved.state === 'waiting') return { job: reserved };
      return core.enter(this.access(caller, job.request), token);
    } catch { core.releasePreflight(token); throw new Error('preflight_denied'); }
  }
  /** Fixture/host driver. All methods return synchronously; no arbitrary Promise export. */
  start(caller: unknown, id: string) {
    const {job} = this.job(caller, id), stream = operation(job.request.operation).transport.kind === 'http-stream';
    if (stream ? !this.ports.stream : !this.ports.http) throw new Error('transport_unavailable');
    const wire = this.wire(job.request); // Pure preflight; unsupported serialization cannot enter a paid effect.
    const boundary = this.enter(caller, id);
    if (!boundary.action) return boundary.job;
    const action = boundary.action;
    try {
      let reply: Reply;
      if (stream) {
        const chunks: Uint8Array[] = []; let size = 0, completed: Reply | undefined;
        for (const event of this.ports.stream!(wire)) {
          if (completed) throw new Error('stream_after_completion');
          if (event.kind === 'complete') completed = { status:event.status, contentType:event.contentType };
          else {
            if (!(event.bytes instanceof Uint8Array) || (size += event.bytes.length) > this.ports.maxBytes) throw new Error('invalid_stream');
            chunks.push(event.bytes.slice());
          }
        }
        if (!completed || !size) throw new Error('truncated_stream');
        const bytes = new Uint8Array(size); let at = 0;
        for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
        reply = { ...completed, bytes };
      } else reply = synchronous(this.ports.http!(wire));
      return this.receipt(action, reply);
    } catch { return this.core(action.request).unknown(action.continuation); }
  }
  private wire(request: Request): WireRequest {
    const row = operation(request.operation);
    if (!validateRequest(request) || disposition(row).limitation) throw new Error('invalid_request');
    const params = clone(request.params) as Parameters;
    let path = row.path;
    for (const [key,value] of Object.entries(params.path ?? {})) path = path.replace('{' + key + '}', encodeURIComponent(String(value)));
    const query: string[] = [];
    for (const [key,value] of Object.entries(params.query ?? {})) {
      // OpenAPI array query serialization is not guessed.
      if (Array.isArray(value) || value && typeof value === 'object') throw new Error('query_serialization_unavailable');
      if (value !== null) query.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    }
    if (!path.startsWith('/v1/') && !path.startsWith('/v2/') || /[{}]/.test(path)) throw new Error('invalid_path');
    const schema = schemaFor(row), content = schema.requestBody?.content ?? {};
    let body: WireRequest['body'];
    if (params.body !== undefined) {
      if (content['application/json']) body = {kind:'json',data:clone(params.body)};
      else if (content['multipart/form-data']) {
        const parts: Extract<NonNullable<WireRequest['body']>,{kind:'multipart'}>['parts'] = [];
        for (const [name,value] of Object.entries(params.body)) {
          if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && 'input' in value)
            parts.push({kind:'file',name,input:(value as {input:number}).input});
          else if (['string','boolean','number'].includes(typeof value)) parts.push({kind:'text',name,value:String(value)});
          else throw new Error('multipart_serialization_unavailable');
        }
        if (parts.length > 16) throw new Error('multipart_part_limit');
        body = {kind:'multipart',parts};
      } else throw new Error('body_serialization_unavailable');
    }
    const statuses = Object.keys(schema.responses).map(Number).filter(n=>Number.isInteger(n)&&n>=200&&n<300);
    if (!statuses.length || statuses.length > 8) throw new Error('response_descriptor_unavailable');
    const responseTypes = Object.keys(schema.responses[String(statuses[0])]?.content ?? {});
    const media = responseTypes.find(mime=>['audio/mpeg','audio/wav','audio/pcm','video/mp4','image/png','image/jpeg'].includes(mime)) ??
      (responseTypes.includes('audio/*') && /^mp3_/.test(String(params.query?.output_format ?? '')) ? 'audio/mpeg' : undefined);
    const response: WireRequest['response'] = media ? {kind:'file',contentType:media,maxBytes:this.ports.maxBytes,statuses} :
      {kind:'json',maxBytes:Math.min(this.ports.maxBytes,256*1024),statuses};
    if (!media && !responseTypes.includes('application/json')) throw new Error('response_descriptor_unavailable');
    return { url:'https://api.elevenlabs.io' + path + (query.length ? '?' + query.join('&') : ''),
      method: row.method, params, body, response, inputs:clone(request.inputs), credential:{plugin:'elevenlabs',name:'elevenlabs-api-key'},
      redirect:'error', retry:0, maxBytes:this.ports.maxBytes, timeoutMs:120000 };
  }
  private checked(reply: Reply, request: Request) {
    if (!Number.isInteger(reply.status) || reply.status < 200 || reply.status >= 300) throw new Error('provider_request_failed');
    const expected = schemaFor(operation(request.operation)).responses[String(reply.status)]?.content ?? {};
    const wildcardMp3 = expected['audio/*'] && reply.contentType === 'audio/mpeg' &&
      /^mp3_/.test(String((request.params as Parameters).query?.output_format ?? ''));
    if (!Object.prototype.hasOwnProperty.call(expected, reply.contentType) && !wildcardMp3) throw new Error('unexpected_content_type');
    if (reply.bytes) {
      if (!(reply.bytes instanceof Uint8Array) || !reply.bytes.length || reply.bytes.length > this.ports.maxBytes || reply.contentType === 'application/json') throw new Error('invalid_media');
      return { bytes:reply.bytes, contentType:reply.contentType };
    }
    if (reply.contentType !== 'application/json' || reply.json === undefined || utf8Size(JSON.stringify(reply.json)) > Math.min(this.ports.maxBytes, 256 * 1024) ||
      !validateResponse(operation(request.operation), reply.status, reply.contentType, reply.json)) throw new Error('invalid_response');
    // Timestamp JSON/base64 needs a reviewed media decoder, not persistence of a remote URL as media.
    if (request.operation === 'speech_to_text' && (typeof (reply.json as any)?.text !== 'string' || !(reply.json as any).text.trim())) throw new Error('empty_transcript');
    return { json:clean(reply.json) };
  }
  receipt(action: Submission, reply: Reply) {
    if (bindingOf(action.request) !== action.continuation.binding) throw new Error('intent_conflict');
    const core = this.core(action.request), token = action.continuation;
    const output = this.checked(reply, action.request);
    core.beginOutput(token);
    const artifact = synchronous(this.ports.save!(this.jobScope(token), token.id, output));
    return core.complete(token, [artifact]);
  }
  private jobScope(token: Continuation): Scope {
    return this.ports.store.transact(token.owner, token.workspace, d => {
      const job = d.jobs.find(j => j.id === token.id && j.binding === token.binding && j.epoch === token.epoch);
      if (!job) throw new Error('stale_continuation');
      return clone(job.scope);
    });
  }
  read(caller: unknown, request: Request) {
    if (!validateRequest(request) || operation(request.operation).method !== 'GET') throw new Error('invalid_read');
    this.access(caller, request);
    if (!this.ports.http) throw new Error('transport_unavailable');
    try { return this.checked(synchronous(this.ports.http(this.wire(request))), request); }
    catch { throw new Error('read_unavailable'); }
  }
  /** Free saved-file reacquisition, sharing the common media authority checks. */
  reopen(caller: unknown, id: string, artifactId: string, media: MediaPorts) {
    const {job} = this.job(caller, id), artifact = job.outputs.find(a => a.id === artifactId);
    if (!artifact) throw new Error('media_unavailable');
    return reopen(media, artifact);
  }
}
