import type { MediaViewPort, LocalMedia } from './App';
import { refusalCopy, humanActions } from '../../../media-shared/src/presentation';
import type { HumanAction } from '../../../media-shared/src/presentation';
/** Consumer injection contract, not a declaration that the SDK/host feature is released. */
export type AcquiredMedia = { handle: string; url: string | null; content_type: string; file_name?: string; expires_in_seconds: number };
export type MediaAcquisitionPort = {
  acquire(id: string): Promise<AcquiredMedia | null>;
  /** Exact same-frame route validation belongs to the delivered host adapter. */
  safeFrameURL(url: string, handle: string): boolean;
  saveAvailable: boolean;
  declared?: string[];
  availability?: Record<HumanAction, boolean>;
  save(handle: string, name: string): Promise<{ ok: boolean; reason?: string }>;
  reveal?(handle: string): Promise<{ ok: boolean; reason?: string }>;
  copyText?(text: string): Promise<{ ok: boolean; reason?: string }>;
  now(): number;
  report(message: string): void;
};
/** Frame data is transient, discarded/reacquired on reopen. Never touches job storage. */
export function frameMediaView(port: MediaAcquisitionPort): MediaViewPort {
  const cache = new Map<string, { value: LocalMedia; expires: number }>();
  const availability = port.availability ?? { copyText: false, saveAs: false, reveal: false };
  const declared = port.declared ?? [];
  const actions = humanActions(availability, declared);
  const reportResult = (r: { ok: boolean; reason?: string }) => { if (!r.ok) { const copy = refusalCopy('', r.reason ?? 'unavailable'); if (copy) port.report(copy); } };
  return { declared, availability, copyPrompt: actions.includes('copyText') && port.copyText ? text => { void port.copyText!(text).then(reportResult); } : undefined,
    get(id) { const v = cache.get(id); return v && port.now() < v.expires ? v.value : null; },
    async reopen(id) {
      cache.delete(id);
      const m = await port.acquire(id);
      if (!m || !/^[a-f0-9]{64}$/.test(m.handle) || !Number.isFinite(m.expires_in_seconds) || m.expires_in_seconds <= 0) return;
      const image = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(m.content_type);
      const kind = image ? 'image' : ['video/mp4', 'video/webm'].includes(m.content_type) ? 'video' : ['audio/wav', 'audio/mpeg', 'audio/ogg'].includes(m.content_type) ? 'audio' : null;
      if (!kind || m.url !== null && !port.safeFrameURL(m.url, m.handle)) return;
      const expires = port.now() + Math.min(m.expires_in_seconds, 600) * 1000;
      cache.set(id, { expires, value: { kind, url: m.url, fileName: m.file_name?.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120), declared, availability,
        reveal: actions.includes('reveal') && port.reveal ? () => {
          if (port.now() >= expires) { port.report(refusalCopy('', 'media_expired')!); return; }
          void port.reveal!(m.handle).then(reportResult);
        } : undefined,
        save: port.saveAvailable && actions.includes('saveAs') ? () => {
        if (port.now() >= expires) { port.report(refusalCopy('', 'media_expired')!); return; }
        // Called directly by the actual click handler. Availability grants no authority.
        void port.save(m.handle, (m.file_name ?? 'result').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)).then(reportResult);
      } : undefined } });
    } };
}
