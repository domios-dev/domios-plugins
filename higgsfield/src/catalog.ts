import snapshot from '../models.json';
import protocol from '../contracts.json';
import { matches, publicHttps } from './schema';
import type { Json, Request } from '../../media-shared/src/contracts';

export const revision = 'higgsfield-public-2026-10-29';
export const models = snapshot.models;
export const operations = protocol.operations;
export type Limitation = { available: false; code: string; source: string; detail: string };
export function model(id: string) {
  const row = models.find(m => m.id === id);
  if (!row) throw new Error('unknown_model');
  return row;
}
export function limitation(id: string): Limitation | null {
  const row = model(id);
  if (id === 'soul-id') return { available: false, code: 'separate_authority_required', source: row.source.url, detail: 'Training creates a reference; separate owner authority, safe price and reference lifecycle required.' };
  if (!row.schema) return { available: false, code: 'schema_auth_unavailable', source: row.source.url, detail: row.limitations.join(' ') };
  if (id === 'higgsfield/ai-influencer') return { available: false, code: 'live_options_required', source: row.source.url, detail: 'Current category tier/max/slot/exclusive validation and private override catalogs unavailable.' };
  if (id === 'kling-video/omni/video-reference') return { available: false, code: 'source_schema_conflict', source: row.source.url, detail: 'Source nests mode inside duration; vendor clarification required.' };
  return null;
}
export function validateParams(id: string, params: unknown): boolean {
  const row = model(id);
  if (!row.schema || !matches(row.schema, params)) return false;
  // Media URLs, including schemas using only a pattern, must satisfy the consumer HTTPS policy.
  const walk = (v: unknown, key = ''): boolean => {
    if (typeof v === 'string' && /(?:^|_)urls?$/.test(key)) return publicHttps(v);
    if (Array.isArray(v)) return v.every(x => walk(x, key));
    if (v && typeof v === 'object') return Object.entries(v).every(([k, x]) => walk(x, k));
    return true;
  };
  return walk(params);
}
export function validateRequest(request: Request): boolean {
  try {
    return request.revision === revision && request.unit === 'usd_micro' && !limitation(request.operation) &&
      JSON.stringify(request).length <= 131072 && validateParams(request.operation, request.params);
  } catch { return false; }
}
export function prepare(id: string, params: Json, inputs: Request['inputs'] = []): Request {
  const request: Request = { operation: id, revision, params, inputs, unit: 'usd_micro' };
  if (!validateRequest(request)) throw new Error('invalid_or_unavailable_model');
  return JSON.parse(JSON.stringify(request));
}
/** Local preparation only. Seed/count must already be legal for the selected schema. */
export function variation(request: Request, changes: { seed?: number; batch_size?: number }): Request {
  if (Object.keys(changes).some(k => !['seed', 'batch_size'].includes(k))) throw new Error('invalid_variation');
  return prepare(request.operation, { ...(request.params as object), ...changes }, request.inputs);
}
export const unavailable = [
  ['speech', 'No standalone speech/voice/music/SFX/lip-sync/dubbing API established.'],
  ['upscale', 'No separate upscale endpoint established; model resolution controls remain model-specific.'],
  ['webhooks', 'No delivered authenticated generic webhook ingress. Poll exact known request identity.'],
  ['stream', 'SDK subscribe is polling; no native progress/previews/media stream contract. WSS unsupported.'],
  ['usage', 'No callable usage/quota endpoint established; remaining balance/capacity unknown.'],
  ['admin', 'Console-only billing/key/settings mutations are outside authority.'],
].map(([id, detail]) => ({ id, available: false, detail, source: 'https://docs.higgsfield.ai/docs/llms.txt' }));
