import type { Access, Job, Json } from '../../media-shared/src/contracts';
import { clone } from '../../media-shared/src/contracts';
import { jobPrice, jobStatus, actorLabel, activityLine } from '../../media-shared/src/presentation';
import { quoteState } from '../../media-shared/src/cost';
import { models, revision, limitation, validateParams } from './catalog';
import type { HiggsfieldService } from './service';
import type { StudioItem, InputSchema } from '../../media-shared/ui/src/types';
export type UISnapshot = { items: StudioItem[]; next: number | null; total: number; capacity: number;
  catalog: { id: string; label: string; category: string; unavailable: string | null }[];
  activity: string[]; capabilities: { estimate: boolean; submit: boolean; reconcile: boolean; cancelQueued: boolean } };
export type UIDetails = { item: StudioItem; params: Record<string, Json>; schema: InputSchema; inputs: { id: string; contentType: string }[] };
export type UIUnavailable = { kind: 'unavailable'; code: 'ui_snapshot_too_large' | 'ui_schema_too_large' | 'ui_schema_unsupported' | 'ui_details_too_large' | 'ui_details_unsupported'; message: string };
export type UISchema = { revision: string; schema: InputSchema; unavailable: string | null };
export const uiBounds = { args: 4096, snapshot: 256 * 1024, details: 64 * 1024, schema: 128 * 1024, depth: 12, fields: 128 } as const;
/** QuickJS-safe UTF-8 count over the exact serialized response, including escapes/keys. */
export function uiJSONBytes(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('ui_encoding_refused');
  let bytes = 0;
  for (const point of encoded) {
    const cp = point.codePointAt(0)!;
    bytes += cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4;
    if (bytes > maximum) throw new Error('ui_size_refused');
  }
  return bytes;
}
const unavailable = (code: UIUnavailable['code']): UIUnavailable => ({ kind: 'unavailable', code, message: 'This information cannot be safely displayed in this studio.' });
function boundedResponse<T>(value: T, maximum: number, code: UIUnavailable['code']): T | UIUnavailable {
  try { uiJSONBytes(value, maximum); return value; } catch { return unavailable(code); }
}
/** Preserve the entire schema or refuse. Depth counts schema edges; fields count declared properties. */
export function schemaSupported(schema: InputSchema): boolean {
  let fields = 0;
  const counted = new Set<object>();
  const complete = new Map<object, Set<number>>();
  const walk = (s: InputSchema, depth: number, ancestors: Set<object>): boolean => {
    if (!s || typeof s !== 'object' || Array.isArray(s) || depth > uiBounds.depth || ancestors.has(s)) return false;
    if (complete.get(s)?.has(depth)) return true;
    if (['oneOf', 'not', 'patternProperties', 'dependentSchemas', 'unevaluatedProperties', 'prefixItems', 'contains'].some(k => k in s)) return false;
    const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
    if (types.some(t => !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(t))) return false;
    if (!counted.has(s)) { fields += Object.keys(s.properties ?? {}).length; counted.add(s); }
    if (fields > uiBounds.fields) return false;
    const next = new Set(ancestors); next.add(s);
    if (s.$ref) {
      if (!/^#\/\$defs\/[A-Za-z0-9_]+$/.test(s.$ref)) return false;
      const ref = schema.$defs?.[s.$ref.slice(8)];
      if (!ref || !walk(ref, depth + 1, next)) return false;
    }
    const children = [...Object.values(s.properties ?? {}), ...Object.values(s.$defs ?? {})];
    if (s.items) children.push(s.items);
    for (const key of ['allOf', 'anyOf'] as const) {
      const branches = s[key]; if (branches !== undefined) { if (!Array.isArray(branches)) return false; children.push(...branches); }
    }
    for (const key of ['if', 'then', 'else', 'additionalProperties'] as const) if (s[key] && typeof s[key] === 'object') children.push(s[key] as InputSchema);
    if (!children.every(child => walk(child, depth + 1, next))) return false;
    const depths = complete.get(s) ?? new Set<number>(); depths.add(depth); complete.set(s, depths);
    return true;
  };
  return !!schema.properties && !Array.isArray(schema.properties) && (schema.type === undefined || schema.type === 'object') && walk(schema, 0, new Set());
}
export const unitNames = { one: 'microdollar', other: 'microdollars' };
/** Exact decimal display only; atomic quote/binding/accounting remain unchanged. */
export function displayUSD(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('invalid_display_amount');
  const whole = Math.floor(amount / 1000000), remainder = amount % 1000000;
  const fraction = String(remainder).padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  return `$${whole}.${fraction}`;
}
export function displayModel(operation: string): string {
  const title = models.find(m => m.id === operation)?.title;
  return title ? title.split(' — ')[0].replace(/ API$/, '').replace(/\b[A-Z]{3,}\b/g, word => word[0] + word.slice(1).toLowerCase()) : 'Model unavailable';
}
function privateActivity(job: Job): string {
  const prompt = (job.request.params as Record<string, Json>).prompt;
  const subject = typeof prompt === 'string' ? prompt.replace(/[\r\n\t]+/g, ' ').slice(0, 24) + (prompt.length > 24 ? '…' : '') : 'generation';
  // Durable intent preparation is recorded. No submission/event ledger is inferred.
  return activityLine(job.scope.actor, 'prepared', `'${subject}' · ${displayModel(job.request.operation)}`);
}
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_./-]{1,255}$/.test(v);
export function validateUIArgs(value: unknown, allowed: string[]): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).some(k => !allowed.includes(k))) throw new Error('ui_refused');
  uiJSONBytes(value, uiBounds.args);
}
/** Private document DTO only: no scope, binding, approval, credentials, provider URLs or host paths. */
export function uiItem(job: Job, now: number): StudioItem {
  const state = job.state === 'waiting' ? job.waitReason === 'price_stale' ? 'price_stale' :
    job.waitReason === 'price_unavailable' ? 'price_unavailable' : 'waiting_ok' : job.state;
  const params = job.request.params as Record<string, Json>;
  const gate = jobPrice(job, now, unitNames);
  const price = gate.kind === 'ready' ? { ...gate, text: displayUSD(gate.amount) } : gate;
  const charged = job.accounting === 'spent' && job.reservation?.unit === 'usd_micro' ? job.reservation : undefined;
  const quoted = job.quote && quoteState(job.quote, job.binding, job.request.unit, job.quote.issuedAt) === 'ready' ? job.quote : undefined;
  const cost = charged ?? quoted;
  return { id: job.id, operation: job.request.operation, title: typeof params.prompt === 'string' ? params.prompt.slice(0, 240) : 'Generation',
    at: job.at, actor: clone(job.scope.actor), status: jobStatus(state, { cancelRequested: job.cancelRequested, progress: job.progress,
      elapsedMs: ['starting', 'queued', 'generating'].includes(state) ? Math.max(0, now - job.at) : undefined }),
    state, price, priceTTL: job.quote ? Math.max(0, job.quote.validUntilMs - now) : undefined, outputs: clone(job.outputs), modelLabel: displayModel(job.request.operation),
    recordedCost: cost ? { amount: cost.amount, unit: cost.unit, text: displayUSD(cost.amount), kind: charged ? 'charged' : 'quoted' } : undefined,
    activity: privateActivity(job), startedBy: actorLabel(job.scope.actor) };
}
export function uiSchema(operation: unknown): InputSchema | UIUnavailable {
  if (!id(operation)) throw new Error('ui_refused');
  const row = models.find(m => m.id === operation);
  if (!row?.schema) return unavailable('ui_schema_unsupported');
  try { uiJSONBytes(row.schema, uiBounds.schema); } catch { return unavailable('ui_schema_too_large'); }
  if (!schemaSupported(row.schema as InputSchema)) return unavailable('ui_schema_unsupported');
  return clone(row.schema) as InputSchema;
}
export function documentUI(service: HiggsfieldService, access: Access, method: string, value: unknown, now: number,
  capabilities: UISnapshot['capabilities']): UISnapshot | UIDetails | UISchema | UIUnavailable {
  const history = service.history(access);
  if (method === 'ui.snapshot') {
    validateUIArgs(value, ['offset', 'limit']);
    const offset = value.offset ?? 0, limit = value.limit ?? 20;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('ui_refused');
    const sorted = [...history].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
    return boundedResponse({ items: sorted.slice(offset, offset + limit).map(j => uiItem(j, now)), total: sorted.length,
      next: offset + limit < sorted.length ? offset + limit : null, capacity: service.historyCapacity(),
      catalog: models.map(m => ({ id: m.id, label: displayModel(m.id), category: m.category.charAt(0).toUpperCase() + m.category.slice(1),
        unavailable: limitation(m.id)?.detail ?? (!service.canEstimate(m.id) ? 'no pricing from provider' : null) })),
      activity: sorted.filter(j => j.scope.actor.kind !== 'you').slice(0, 8).map(privateActivity), capabilities }, uiBounds.snapshot, 'ui_snapshot_too_large');
  }
  if (method === 'ui.schema') {
    validateUIArgs(value, ['operation']);
    const schema = uiSchema(value.operation);
    if ('kind' in schema) return schema as UIUnavailable;
    return boundedResponse({ revision, schema, unavailable: limitation(value.operation)?.detail ?? null }, uiBounds.schema, 'ui_schema_too_large');
  }
  validateUIArgs(value, ['id']);
  if (method !== 'ui.details' || !id(value.id)) throw new Error('ui_refused');
  const job = history.find(j => j.id === value.id);
  if (!job) throw new Error('ui_refused');
  if (!validateParams(job.request.operation, job.request.params)) return unavailable('ui_details_unsupported');
  const schema = uiSchema(job.request.operation);
  if ('kind' in schema) return schema as UIUnavailable;
  return boundedResponse({ item: uiItem(job, now), params: clone(job.request.params) as Record<string, Json>, schema,
    inputs: job.request.inputs.filter(i => i.kind === 'artifact').map(i => ({ id: i.id, contentType: i.contentType })) }, uiBounds.details, 'ui_details_too_large');
}
