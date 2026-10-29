import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime';
import { fakeHost, surface, document } from '../../higgsfield/tests/runtime-fixture';

test('ElevenLabs default discovery works without credentials or network; generation stays unavailable', () => {
  const runtime = createRuntime(fakeHost().host);
  const catalog = JSON.parse(runtime.onSurfaceCall(surface, 'catalog', []));
  assert.ok(catalog.total > 0);
  assert.equal(JSON.parse(runtime.onSurfaceCall(surface, 'status', [])).submission, false);
  assert.equal(JSON.parse(runtime.onSurfaceCall(surface, 'generate', ['{"owner":"spoof","maximum":1}'])).paid, false);
  assert.equal(runtime.transcribeStatus().state, 'unavailable');
  assert.equal(runtime.mediaFile(), null);
});
test('ElevenLabs document history is available while estimate/submit/reconcile are false', () => {
  const runtime = createRuntime(fakeHost().host);
  const result = runtime.viewCall('ui.snapshot', {}, { ...document, plugin: 'elevenlabs' }) as any;
  assert.ok(Array.isArray(result.items));
  assert.deepEqual(result.capabilities, { estimate: false, submit: false, reconcile: false });
  assert.ok((runtime.viewCall('ui.snapshot', {}, { ...document, plugin: 'foreign' }) as any).error);
});

