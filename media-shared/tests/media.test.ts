import test from 'node:test';
import assert from 'node:assert/strict';
import { humanAction, reopen } from '../src/media';
import type { FrameContext, FrameMedia, MediaPorts } from '../src/media';
import { harness } from './fixtures/harness';

function fixture() {
  const h = harness(); let live = true; let calls = 0; let acquires = 0;
  let context: FrameContext = { scope: h.human, frame: 'frame-A', shown: true, focused: true, activated: true };
  let available = { copyText: true, saveAs: true, reveal: false };
  const media: FrameMedia = { kind: 'frame', frame: 'frame-A', handle: 'a'.repeat(64), expiresAt: 2000, url: 'fixture:playback' };
  const ports: MediaPorts = { now: h.now, context: async caller => caller === h.owner ? context : null, current: async () => live,
    availability: async () => available,
    acquire: async (ctx, artifact) => { acquires++; return artifact.id === 'A-saved' && ctx.scope.owner === 'A' ? { ...media } : null; },
    act: async () => { calls++; return { ok: true }; } };
  return { h, ports, media, stats: () => ({ calls, acquires }), revoke: () => { live = false; },
    context: (next: Partial<FrameContext>) => { context = { ...context, ...next }; },
    availability: (next: typeof available) => { available = next; } };
}
test('missing delivery refuses; frame expiry and revocation permit only free saved-asset reacquisition', async () => {
  const f = fixture(); const artifact = { kind: 'artifact' as const, id: 'A-saved', contentType: 'audio/mpeg' };
  assert.equal(await reopen({ ...f.ports, acquire: undefined }, f.h.owner, artifact), null);
  assert.equal(await reopen(f.ports, {}, artifact), null);
  assert.equal(await reopen(f.ports, f.h.owner, { ...artifact, id: 'B-saved' }), null);
  const first = await reopen(f.ports, f.h.owner, artifact); assert.equal(first!.kind, 'frame');
  f.h.tick(2000);
  assert.deepEqual(await humanAction(f.ports, f.h.owner, ['saveAs'], 'saveAs', first!.handle, first!), { ok: false, code: 'media_expired', reason: '' });
  f.media.expiresAt = 3000;
  const second = await reopen(f.ports, f.h.owner, artifact); assert.equal(second!.expiresAt, 3000);
  assert.equal(f.stats().calls, 0); // acquire cannot invoke any paid/job or gesture effect.
  f.revoke(); assert.equal(await reopen(f.ports, f.h.owner, artifact), null);
});
test('human actions require current human shown/focused activation, declaration, availability and exact frame', async () => {
  const f = fixture();
  assert.equal((await humanAction(f.ports, f.h.owner, ['saveAs'], 'saveAs', f.media.handle, f.media)).ok, true);
  assert.equal((await humanAction(f.ports, f.h.owner, ['reveal'], 'reveal', f.media.handle, f.media)).ok, false);
  assert.equal((await humanAction(f.ports, f.h.owner, [], 'saveAs', f.media.handle, f.media)).ok, false);
  assert.equal((await humanAction(f.ports, f.h.owner, ['saveAs'], 'saveAs', f.media.handle, { ...f.media, frame: 'B' })).ok, false);
  for (const next of [{ shown: false }, { shown: true, focused: false }, { focused: true, activated: false }, { activated: true, scope: f.h.agent }]) {
    f.context(next); assert.equal((await humanAction(f.ports, f.h.owner, ['copyText'], 'copyText', 'prompt')).ok, false);
  }
  assert.equal(f.stats().calls, 1);
});
test('stale completion and availability race stay silent with no automatic retry', async () => {
  const f = fixture();
  f.ports.availability = async () => { f.revoke(); return { copyText: true, saveAs: true, reveal: true }; };
  assert.equal((await humanAction(f.ports, f.h.owner, ['copyText'], 'copyText', 'prompt') as { code: string }).code, 'stale');
  assert.equal(f.stats().calls, 0);
  const g = fixture(); g.ports.act = async () => { g.revoke(); return { ok: true }; };
  assert.equal((await humanAction(g.ports, g.h.owner, ['copyText'], 'copyText', 'prompt') as { code: string }).code, 'stale');
});
