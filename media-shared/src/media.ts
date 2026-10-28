import type { Artifact, Scope } from './contracts';
import { humanActions } from './presentation';
import type { HumanAction } from './presentation';

/** Transient frame data. Never put this in a job or Blueprint output. */
export type FrameMedia = { kind: 'frame'; handle: string; frame: string; expiresAt: number; url: string | null };
export type FrameContext = { scope: Scope; frame: string; shown: boolean; focused: boolean; activated: boolean };
export type ActionResult = { ok: true } | { ok: false; code: string; reason: string };
/** Consumer-side injection seam, not an assertion about an SDK method/signature. */
export interface MediaPorts {
  context(caller: unknown): Promise<FrameContext | null>;
  current(context: FrameContext): Promise<boolean>;
  /** Must enforce artifact ownership, confinement, MIME, bounds, revocation and exact document. Free. */
  acquire?: (context: FrameContext, artifact: Artifact) => Promise<FrameMedia | null>;
  availability?: (context: FrameContext) => Promise<Record<HumanAction, boolean>>;
  act?: (context: FrameContext, action: HumanAction, value: string) => Promise<ActionResult>;
  now(): number;
}
export async function reopen(ports: MediaPorts, caller: unknown, artifact: Artifact): Promise<FrameMedia | null> {
  const context = await ports.context(caller);
  if (!context || !ports.acquire || !await ports.current(context) || artifact.kind !== 'artifact') return null;
  const media = await ports.acquire(context, artifact);
  return media && media.frame === context.frame && /^[a-f0-9]{64}$/.test(media.handle) && media.expiresAt > ports.now() &&
    await ports.current(context) ? media : null;
}
export async function humanAction(ports: MediaPorts, caller: unknown, declared: string[], action: HumanAction, value: string, media?: FrameMedia): Promise<ActionResult> {
  const fail = (code: string): ActionResult => ({ ok: false, code, reason: '' });
  const context = await ports.context(caller);
  if (!context || !context.scope.human || !context.shown || !context.focused || !context.activated || !await ports.current(context)) return fail('stale');
  if (!ports.act || !ports.availability) return fail('unavailable');
  if (!humanActions(await ports.availability(context), declared).includes(action)) return fail('unavailable');
  if (!await ports.current(context)) return fail('stale');
  if (action !== 'copyText') {
    if (!media || media.frame !== context.frame || value !== media.handle || !/^[a-f0-9]{64}$/.test(media.handle)) return fail('media_foreign');
    if (!Number.isFinite(media.expiresAt) || media.expiresAt <= ports.now()) return fail('media_expired');
  }
  const result = await ports.act(context, action, value);
  return await ports.current(context) ? result : fail('stale');
}
