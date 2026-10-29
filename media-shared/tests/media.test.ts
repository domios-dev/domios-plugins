import test from 'node:test';
import assert from 'node:assert/strict';
import { humanAction, reopen } from '../src/media';
import type { ActionResult, FrameMedia, MediaPorts } from '../src/media';
import { harness } from './fixtures/harness';

function fixture() {
  const h = harness(); let mounted = true; let calls = 0; let acquires = 0;
  const media: FrameMedia = { kind: 'frame', handle: 'a'.repeat(64), expiresAt: 2000, url: 'fixture:playback' };
  let result: ActionResult = { ok: true };
  const ports: MediaPorts = { now: h.now, mounted: () => mounted,
    availability: async () => ({ copyText: true, saveAs: true, reveal: false }),
    acquire: async artifact => { acquires++; return artifact.id === 'A-saved' ? { ...media } : null; },
    act: async () => { calls++; return result; } };
  return { h, ports, media, stats: () => ({ calls, acquires }), unmount: () => { mounted = false; },
    result: (next: ActionResult) => { result = next; } };
}
test('missing delivery refuses; token expiry permits only free saved-asset reacquisition', async () => {
  const f = fixture(); const artifact = { kind: 'artifact' as const, id: 'A-saved', contentType: 'audio/mpeg' };
  assert.equal(await reopen({ ...f.ports, acquire: undefined }, artifact), null);
  assert.equal(await reopen(f.ports, { ...artifact, id: 'B-saved' }), null);
  const first = await reopen(f.ports, artifact); assert.equal(first!.kind, 'frame');
  f.h.tick(2000);
  assert.deepEqual(await humanAction(f.ports, ['saveAs'], 'saveAs', first!.handle, first!), { ok: false, code: 'denied', reason: 'media_expired' });
  f.media.expiresAt = 3000;
  const second = await reopen(f.ports, artifact); assert.equal(second!.expiresAt, 3000);
  assert.equal(f.stats().calls, 0);
  f.unmount(); assert.equal(await reopen(f.ports, artifact), null);
});
test('only actual availability and declaration expose actions; host alone decides frame/gesture authority', async () => {
  const f = fixture();
  assert.equal((await humanAction(f.ports, ['saveAs'], 'saveAs', f.media.handle, f.media)).ok, true);
  assert.deepEqual(await humanAction(f.ports, ['reveal'], 'reveal', f.media.handle, f.media), { ok: false, code: 'unavailable', reason: 'action' });
  assert.equal((await humanAction(f.ports, [], 'saveAs', f.media.handle, f.media)).ok, false);
  for (const reason of ['media_foreign', 'media_expired', 'busy', 'stale', 'cancelled', 'activation']) {
    const hostResult: ActionResult = { ok: false, code: 'denied', reason }; f.result(hostResult);
    assert.strictEqual(await humanAction(f.ports, ['saveAs'], 'saveAs', f.media.handle, f.media), hostResult);
  }
  f.result({ ok: false, code: 'unavailable', reason: 'clipboard' });
  assert.deepEqual(await humanAction(f.ports, ['copyText'], 'copyText', 'prompt'), { ok: false, code: 'unavailable', reason: 'clipboard' });
  assert.equal(f.stats().calls, 8);
});
test('unmounted-view availability race stops effects; completed host results pass through unchanged', async () => {
  const f = fixture();
  f.ports.availability = async () => { f.unmount(); return { copyText: true, saveAs: true, reveal: true }; };
  assert.deepEqual(await humanAction(f.ports, ['copyText'], 'copyText', 'prompt'), { ok: false, code: 'denied', reason: 'stale' });
  assert.equal(f.stats().calls, 0);
  const g = fixture(); const hostResult: ActionResult = { ok: false, code: 'denied', reason: 'busy' };
  g.ports.act = async () => { g.unmount(); return hostResult; };
  assert.strictEqual(await humanAction(g.ports, ['copyText'], 'copyText', 'prompt'), hostResult);
});
