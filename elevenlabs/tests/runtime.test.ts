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


import { deliveredHost } from '../../higgsfield/tests/runtime-fixture';
test('ElevenLabs protected free reads project metadata and refuse input-supplied USD pricing/approval', () => {
  const f = deliveredHost();
  const requests: any[] = [];
  f.host.transfer.async = (request: any, then: any) => {
    requests.push(request);
    return then({ kind: 'json', status: 200, data: request.url.includes('/voices') ? { voices: [{ voice_id: 'saved', name: 'Rollo', category: 'cloned', settings: { private: true } }] } : { tier: 'creator', character_count: 10, character_limit: 100, can_extend_character_limit: false, max_credit_limit_extension: 0, secret: 'must-not-escape' } });
  };
  const runtime = createRuntime(f.host);
  const voices = runtime.onAgentCommand({ verb: 'voices', args: [] } as any) as any;
  assert.equal(JSON.parse(voices.result).voices[0].name, 'Rollo');
  assert.equal(JSON.parse(voices.result).voices[0].settings, undefined);
  const account = runtime.onAgentCommand({ verb: 'account', args: [] } as any) as any;
  assert.equal(JSON.parse(account.result).safeUsdTariff, false);
  assert.equal(JSON.parse(account.result).secret, undefined);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(r => r.method === 'GET' && r.credential.kind === 'secret' && r.credential.header === 'xi-api-key'));
  assert.equal(JSON.parse(runtime.onSurfaceCall(surface, 'prepare', ['{"voice":"saved","text":"Calm hello"}'])).error, 'safe_pricing_unavailable');
  assert.equal(JSON.parse(runtime.onSurfaceCall(surface, 'prepare', ['{"voice":"saved","text":"Hello","usd":0.001,"approved":true}'])).error, 'invalid_arguments');
  assert.equal(requests.length, 2);
});
