import type { Artifact } from './contracts';
import { humanActions } from './presentation';
import type { HumanAction } from './presentation';

/** Transient view data. Derive expiresAt from acquisition time + returned TTL; never persist in jobs. */
export type FrameMedia = { kind: 'frame'; handle: string; expiresAt: number; url: string | null };
export type ActionResult = { ok: true } | { ok: false; code: 'denied' | 'unavailable' | 'invalid'; reason: string };
/** UI-only injection seam. Host alone observes frame ownership, focus and activation. */
export interface MediaPorts {
  mounted(): boolean;
  /** Free acquisition of an already-produced authorized artifact; no job effects. */
  acquire?: (artifact: Artifact) => Promise<FrameMedia | null>;
  availability?: () => Promise<Record<HumanAction, boolean>>;
  /** Invoke from the actual click handler. Host enforces authority, bounds and gesture fencing. */
  act?: (action: HumanAction, value: string) => Promise<ActionResult>;
  now(): number;
}
export async function reopen(ports: MediaPorts, artifact: Artifact): Promise<FrameMedia | null> {
  if (!ports.mounted() || !ports.acquire || artifact.kind !== 'artifact') return null;
  const media = await ports.acquire(artifact);
  return media && /^[a-f0-9]{64}$/.test(media.handle) && Number.isFinite(media.expiresAt) && media.expiresAt > ports.now() &&
    ports.mounted() ? media : null;
}
export async function humanAction(ports: MediaPorts, declared: string[], action: HumanAction, value: string, media?: FrameMedia): Promise<ActionResult> {
  const fail = (reason: string, code: 'denied' | 'unavailable' | 'invalid' = 'denied'): ActionResult => ({ ok: false, code, reason });
  if (!ports.mounted()) return fail('stale');
  if (!ports.act || !ports.availability) return fail('action', 'unavailable');
  if (!humanActions(await ports.availability(), declared).includes(action)) return fail('action', 'unavailable');
  if (!ports.mounted()) return fail('stale');
  if (action !== 'copyText') {
    if (!media || !Number.isFinite(media.expiresAt) || media.expiresAt <= ports.now()) return fail('media_expired');
    if (value !== media.handle || !/^[a-f0-9]{64}$/.test(media.handle)) return fail('media_unknown', 'invalid');
  }
  return ports.act(action, value);
}
