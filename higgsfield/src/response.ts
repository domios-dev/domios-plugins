import type { Observation } from '../../media-shared/src/contracts';
import { validateReturnedUrl, requestUrl, outputUrl } from './client';
export const states = ['queued', 'in_progress', 'completed', 'failed', 'nsfw', 'canceled'] as const;
export type Receipt = { observation: Observation; statusUrl: string; cancelUrl: string; expiresAt: string | null;
  assets: { url: string; kind: string; index?: number }[] };
/** Minimum normalized provider identity/state only. Auxiliary data must not discard this evidence. */
export function identity(value: unknown): Observation {
  if (!value || typeof value !== 'object') throw new Error('invalid_receipt');
  const v = value as any;
  requestUrl(v.request_id, 'status');
  if (!states.includes(v.status)) throw new Error('invalid_provider_state');
  const mapping: Record<string, Observation['state']> = { queued: 'queued', in_progress: 'generating', completed: 'generated', failed: 'failed', nsfw: 'failed', canceled: 'canceled' };
  return { jobId: v.request_id, state: mapping[v.status], providerState: v.status };
}
export function receipt(value: unknown, allowedAsset: (url: string) => boolean, includeAssets = true): Receipt {
  const observation = identity(value);
  const v = value as any;
  // Status examples omit these URLs: retain canonical exact-ID validated URLs, never accept other paths.
  const statusUrl = v.status_url === undefined ? requestUrl(v.request_id, 'status') : validateReturnedUrl(v.status_url, v.request_id, 'status');
  const cancelUrl = v.cancel_url === undefined ? requestUrl(v.request_id, 'cancel') : validateReturnedUrl(v.cancel_url, v.request_id, 'cancel');
  const assets: Receipt['assets'] = [];
  for (const field of includeAssets ? ['images', 'video', 'videos', 'audio', 'audios', 'zip', 'mov', 'jsx', 'fbx', 'ply'] : []) {
    if (v[field] === undefined || v[field] === null) continue;
    const entries = Array.isArray(v[field]) ? v[field] : [v[field]];
    for (const entry of entries) {
      if (assets.length >= 64 || !entry || typeof entry !== 'object') throw new Error('invalid_outputs');
      const url = outputUrl(entry.url, allowedAsset);
      if (!assets.some(a => a.url === url)) assets.push({ url, kind: field, ...(Number.isSafeInteger(entry.index) && entry.index >= 0 ? { index: entry.index } : {}) });
    }
  }
  if (v.expires_at !== undefined && v.expires_at !== null && (typeof v.expires_at !== 'string' || !Number.isFinite(Date.parse(v.expires_at)))) throw new Error('invalid_expiry');
  return { observation, statusUrl, cancelUrl,
    expiresAt: v.expires_at ?? null, assets };
}
