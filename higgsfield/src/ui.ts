import type { Access, Job, Json } from '../../media-shared/src/contracts';
import { clone } from '../../media-shared/src/contracts';
import { jobPrice, jobStatus, actorLabel, activityLine } from '../../media-shared/src/presentation';
import { models, revision, limitation, validateParams } from './catalog';
import type { HiggsfieldService } from './service';
import type { StudioItem, InputSchema } from '../../media-shared/ui/src/types';
export type UISnapshot = { items: StudioItem[]; next: number | null; total: number; capacity: number;
  catalog: { id: string; label: string; category: string; unavailable: string | null }[];
  activity: string[]; capabilities: { estimate: boolean; submit: boolean; reconcile: boolean; cancelQueued: boolean } };
export type UIDetails = { item: StudioItem; params: Record<string, Json>; schema: InputSchema; inputs: { id: string; contentType: string }[] };
export const unitNames = { one: 'microdollar', other: 'microdollars' };
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_./-]{1,255}$/.test(v);
function args(value: unknown, allowed: string[]): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 16000 ||
    Object.keys(value).some(k => !allowed.includes(k))) throw new Error('ui_refused');
}
/** Private document DTO only: no scope, binding, approval, credentials, provider URLs or host paths. */
export function uiItem(job: Job, now: number): StudioItem {
  const state = job.state === 'waiting' ? job.waitReason === 'price_stale' ? 'price_stale' :
    job.waitReason === 'price_unavailable' ? 'price_unavailable' : 'waiting_ok' : job.state;
  const params = job.request.params as Record<string, Json>;
  return { id: job.id, operation: job.request.operation, title: typeof params.prompt === 'string' ? params.prompt.slice(0, 240) : 'Generation',
    at: job.at, actor: clone(job.scope.actor), status: jobStatus(state, { cancelRequested: job.cancelRequested, progress: job.progress,
      elapsedMs: ['starting', 'queued', 'generating'].includes(state) ? Math.max(0, now - job.at) : undefined }),
    state, price: jobPrice(job, now, unitNames), priceTTL: job.quote ? Math.max(0, job.quote.validUntilMs - now) : undefined, outputs: clone(job.outputs),
    activity: activityLine(job.scope.actor, 'updated', job.request.operation), startedBy: actorLabel(job.scope.actor) };
}
export function uiSchema(operation: unknown): InputSchema {
  if (!id(operation)) throw new Error('ui_refused');
  const row = models.find(m => m.id === operation);
  if (!row?.schema || JSON.stringify(row.schema).length > 131072) throw new Error('ui_schema_unavailable');
  return clone(row.schema) as InputSchema;
}
export function documentUI(service: HiggsfieldService, access: Access, method: string, value: unknown, now: number,
  capabilities: UISnapshot['capabilities']): UISnapshot | UIDetails | { revision: string; schema: InputSchema; unavailable: string | null } {
  const history = service.history(access);
  if (method === 'ui.snapshot') {
    args(value, ['offset', 'limit']);
    const offset = value.offset ?? 0, limit = value.limit ?? 24;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 48) throw new Error('ui_refused');
    const sorted = [...history].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
    return { items: sorted.slice(offset, offset + limit).map(j => uiItem(j, now)), total: sorted.length,
      next: offset + limit < sorted.length ? offset + limit : null, capacity: service.historyCapacity(),
      catalog: models.map(m => ({ id: m.id, label: m.title.split(' — ')[0].replace(/ API$/, ''), category: m.category.charAt(0).toUpperCase() + m.category.slice(1),
        unavailable: limitation(m.id)?.detail ?? (!service.canEstimate(m.id) ? 'no pricing from provider' : null) })),
      activity: sorted.filter(j => j.scope.actor.kind !== 'you').slice(0, 8).map(j => activityLine(j.scope.actor, 'updated', j.request.operation)), capabilities };
  }
  if (method === 'ui.schema') {
    args(value, ['operation']);
    return { revision, schema: uiSchema(value.operation), unavailable: limitation(value.operation)?.detail ?? null };
  }
  args(value, ['id']);
  if (method !== 'ui.details' || !id(value.id)) throw new Error('ui_refused');
  const job = history.find(j => j.id === value.id);
  if (!job || JSON.stringify(job.request.params).length > 131072 || !validateParams(job.request.operation, job.request.params)) throw new Error('ui_refused');
  return { item: uiItem(job, now), params: clone(job.request.params) as Record<string, Json>, schema: uiSchema(job.request.operation),
    inputs: job.request.inputs.filter(i => i.kind === 'artifact').map(i => ({ id: i.id, contentType: i.contentType })) };
}
