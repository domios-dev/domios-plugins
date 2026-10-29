import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fixture, soul } from './fixtures/commands';
import { HiggsfieldCommands } from '../src/commands';
import { fixtureTransport } from '../ui/dev/fixtures';
import { StudioController } from '../ui/src/controller';
import { bridgeTransport } from '../ui/src/transport';
import { frameMediaView } from '../ui/src/media';
import { App, MediaPreview } from '../ui/src/App';
import { Price, Studio, SchemaFields } from '../../media-shared/ui/src';
import { jobStatus, studioPrice } from '../../media-shared/src/presentation';
import type { UIDetails, UISnapshot } from '../src/ui';
import type { ViewContext } from '../src/commands';
import { models } from '../src/catalog';
const render = (component: React.ReactElement) => renderToStaticMarkup(component);
function setup() { const f = fixture(), c = new HiggsfieldCommands(f.service, f.ports), view = f.viewContext('A');
  const prepare = (prompt = 'Private authorized prompt') => c.viewCall('prepare', { operation: soul, params: { prompt } }, view) as { id: string };
  return { f, c, view, prepare, ui: (method: string, args = {}) => c.viewCall(method, args, view) as any }; }

test('document snapshot pagination is bounded and reads the same authorized service', () => {
  const { f, ui, prepare, view } = setup(); prepare(); prepare('Second');
  const page = ui('ui.snapshot', { limit: 1 }) as UISnapshot;
  assert.equal(page.items.length, 1); assert.equal(page.next, 1); assert.equal(page.total, 2); assert.equal(page.capacity, 64);
  assert.equal(f.service.history(f.contexts.get(view)!).length, page.total);
  assert.equal(ui('ui.snapshot', { offset: page.next, limit: 1 }).next, null);
  for (const args of [{ limit: 49 }, { limit: 0 }, { offset: -1 }, { offset: 10001 }, { limit: 1.5 }, { owner: 'A' }]) assert.deepEqual(ui('ui.snapshot', args), { error: 'document_ui_refused' });
});
test('details provide private params and actual bounded schema; public activity and receipts omit them', () => {
  const { c, ui, prepare, view } = setup(); const { id } = prepare();
  const details = ui('ui.details', { id }) as UIDetails;
  assert.equal(details.params.prompt, 'Private authorized prompt'); assert.equal(details.schema.properties?.prompt?.type, 'string');
  const schema = ui('ui.schema', { operation: soul }); assert.deepEqual(schema.schema, details.schema);
  assert.equal(JSON.stringify(ui('ui.snapshot').activity).includes('Private authorized prompt'), false);
  assert.equal(JSON.stringify(c.viewCall('history', {}, view)).includes('Private authorized prompt'), false);
  const serialized = JSON.stringify(details);
  for (const key of ['authRevision', 'workspace', 'binding', 'approval', 'statusUrl', 'cancelUrl', 'correlation', 'frame']) assert.equal(serialized.includes('"' + key + '"'), false, key);
});
test('foreign/forged frame, owner, run, ID, unknown keys and oversized arguments refuse', () => {
  const { f, c, view, prepare, ui } = setup(); const { id } = prepare();
  assert.deepEqual(c.viewCall('ui.details', { id }, f.viewContext('B')), { error: 'document_ui_refused' });
  for (const forged of [{ ...view }, { ...view, frame: 'foreign' }, { ...view, owner: 'B' }, { ...view, origin: 'remote_task' }]) assert.deepEqual(c.viewCall('ui.snapshot', {}, forged as ViewContext), { error: 'document_ui_refused' });
  const a = f.actor('A', 'run', 'one'); f.contexts.set(view, a); f.service.intent(a, 'run-private', soul, { prompt: 'Run one' });
  f.contexts.set(view, f.actor('A', 'run', 'two'));
  assert.deepEqual(ui('ui.details', { id: 'run-private' }), { error: 'document_ui_refused' });
  for (const args of [{ id: 'foreign' }, { id, frame: 'forged' }, { id, params: {} }, { id: 'x'.repeat(17000) }]) assert.deepEqual(ui('ui.details', args), { error: 'document_ui_refused' });
  assert.deepEqual(c.onSurfaceCall(f.surfaceContext('A'), 'ui.snapshot', []), '{"error":"command_refused"}');
});
test('expired current authorization refuses even an unchanged registered document', () => {
  const { f, ui, view } = setup(); f.contexts.get(view)!.current = false; assert.deepEqual(ui('ui.snapshot'), { error: 'document_ui_refused' });
});
test('UI schema projects each actual catalog schema including dotted model IDs', () => {
  const { ui } = setup();
  for (const row of models) {
    const result = ui('ui.schema', { operation: row.id });
    if (row.schema) assert.deepEqual(result.schema, row.schema, row.id);
    else assert.deepEqual(result, { error: 'document_ui_refused' });
  }
});
test('UI invalidation clears private details when owner visibility changes', async () => {
  const fixture = fixtureTransport(), c = new StudioController(fixture.transport); await c.mount(); await c.inspect('generated');
  assert.ok(c.state.details); fixture.setOwner('B'); await c.refresh(); assert.equal(c.state.details, undefined); assert.equal(c.state.snapshot?.items.length, 0); c.dispose();
});
test('controller estimates and submits exactly once through actual service despite rapid clicks and unknown/reload', async () => {
  let saved = '';
  const fixture = fixtureTransport({ load: () => saved, save: value => { saved = value; } });
  const c = new StudioController(fixture.transport); await c.mount(); c.edit('prompt', 'A quiet garden'); c.purpose('UI regression');
  await c.estimate(); assert.equal(c.price().gate.kind, 'ready');
  await Promise.all([c.generate(), c.generate(), c.generate()]); assert.equal(fixture.submissions(), 1);
  fixture.unknown(); await c.refresh(); await c.generate(); assert.equal(fixture.submissions(), 1);
  const reloaded = fixtureTransport({ load: () => saved }); const next = new StudioController(reloaded.transport); await next.mount();
  assert.equal(reloaded.submissions(), 1); await next.generate(); assert.equal(reloaded.submissions(), 1);
  assert.ok(next.state.snapshot?.items.some(i => i.state === 'unknown')); c.dispose(); next.dispose();
});
test('edited settings invalidate estimate; free reuse and schema-valid variations never submit', async () => {
  const fixture = fixtureTransport(), c = new StudioController(fixture.transport); await c.mount(); c.edit('prompt', 'Private fixture'); c.purpose('Fixture'); await c.estimate();
  c.edit('prompt', 'Changed'); assert.equal(c.price().gate.kind, 'stale'); await c.generate(); assert.equal(fixture.submissions(), 0);
  await c.inspect('generated'); await c.reuse(); assert.equal(c.state.values.prompt, 'Fixture generated: a quiet garden'); assert.equal(c.state.id, undefined);
  await c.inspect('generated'); await c.reuse(true); assert.equal(fixture.submissions(), 0); assert.equal(c.price().gate.kind === 'ready', false); c.dispose();
});
test('unknown transport cannot silently substitute fixtures or authorize generation', async () => {
  const c = new StudioController(bridgeTransport()); await c.mount(); assert.match(c.state.error!, /bridge unavailable/);
  assert.equal(c.price().capable, false); await c.generate(); assert.equal(c.state.id, undefined);
  const markup = render(React.createElement(App, { controller: c })); assert.match(markup, /bridge unavailable/); assert.match(markup, /disabled/);
});
test('shared rendered price uses foundation copy for safe, missing, stale and invalid count gates', () => {
  for (const gate of [{ kind: 'ready' as const, amount: 10, unit: 'usd_micro', text: '10 microdollars' }, { kind: 'unavailable' as const }, { kind: 'stale' as const }]) {
    const markup = render(React.createElement(Price, { view: { gate, count: 1, available: true, capable: true, busy: false }, onEstimate() {}, onGenerate() {} }));
    assert.ok(markup.includes(studioPrice(gate).primary)); assert.equal(markup.includes('cost unknown'), false);
    if (gate.kind !== 'ready') assert.match(markup, /disabled/);
  }
});
test('actual shared schema fields render constraints and required/advanced inputs', () => {
  const markup = render(React.createElement(SchemaFields, { schema: { type: 'object', required: ['prompt'], properties: {
    prompt: { type: 'string', maxLength: 100 }, amount: { type: 'integer', minimum: 1, maximum: 4 }, sound: { type: 'boolean' }, mode: { enum: ['a', 'b'] }, detail: { type: 'string' } } }, values: {}, onChange() {} }));
  assert.match(markup, /aria-label="Prompt"/); assert.match(markup, /maxLength="100"/i); assert.match(markup, /min="1"/); assert.match(markup, /More settings \(1\)/); assert.match(markup, /role="switch"/);
});
test('actual App renders service fixture lifecycle and shared grouping with attribution', async () => {
  const fixture = fixtureTransport(), c = new StudioController(fixture.transport); await c.mount();
  const markup = render(React.createElement(App, { controller: c, fixtureLabel: 'Fixture only' }));
  for (const state of ['queued', 'generating', 'generated', 'failed', 'canceled', 'unknown', 'starting', 'price_unavailable', 'price_stale', 'waiting_ok'] as const) assert.ok(markup.includes(jobStatus(state).label), state);
  assert.match(markup, /studio-composer/); assert.match(markup, /Show activity/); assert.match(markup, /<small>A<\/small>/); assert.match(markup, /Fixture only/); c.dispose();
});
test('pipeline fixture provides exactly 3 jobs/one failure, existing link and one-hop source without refresh approval', async () => {
  const fixture = fixtureTransport({ scenario: 'pipeline' }), c = new StudioController(fixture.transport); await c.mount();
  assert.equal(c.state.snapshot?.items.length, 3); assert.equal(c.state.snapshot?.items.filter(i => i.state === 'failed').length, 1);
  const markup = render(React.createElement(App, { controller: c })); assert.match(markup, /View run/); assert.match(markup, /From: run-one/); assert.doesNotMatch(markup, /Check price again/); c.dispose();
});
test('frame acquisition rejects remote/unapproved MIME, expires freely, remints on reopen, and reports refusal copy', async () => {
  let now = 0, acquisitions = 0, saves = 0, message = '', content_type = 'image/png', url: string | null = '/scoped';
  const port = frameMediaView({ now: () => now, saveAvailable: true, declared: ['saveAs'], availability: { saveAs: true, reveal: false, copyText: false }, safeFrameURL: u => u === '/scoped', report: m => { message = m; },
    acquire: async () => { acquisitions++; return { handle: 'a'.repeat(64), url, content_type, expires_in_seconds: 1 }; },
    save: async () => { saves++; return { ok: true }; } });
  await port.reopen!('asset'); const local = port.get('asset')!; assert.equal(local.kind, 'image'); local.save!(); assert.equal(saves, 1);
  now = 1001; assert.equal(port.get('asset'), null); local.save!(); assert.equal(saves, 1); assert.equal(message, 'File access expired. Reopen the result.');
  await port.reopen!('asset'); assert.equal(acquisitions, 2); content_type = 'image/svg+xml'; await port.reopen!('asset'); assert.equal(port.get('asset'), null);
  content_type = 'image/png'; url = 'https://remote.example/x.png'; await port.reopen!('asset'); assert.equal(port.get('asset'), null);
});
test('rendered local media starts paused and supplies native play/pause/seek controls with safe click export', () => {
  const audio = render(React.createElement(MediaPreview, { media: { kind: 'audio', url: '/fixtures/tone.wav', declared: ['saveAs'], availability: { saveAs: true, copyText: false, reveal: false }, save() {} } }));
  assert.match(audio, /controls=""/); assert.doesNotMatch(audio, /autoplay|loop/i); assert.match(audio, />Save as…</);
  const image = render(React.createElement(MediaPreview, { media: { kind: 'image', url: '/fixtures/checker.png' } })); assert.match(image, /loading="lazy"/); assert.match(image, /decoding="async"/);
});
test('production entry has no reachable development fixtures and common shell has no vendor logic', () => {
  const entry = readFileSync(new URL('../ui/src/main.tsx', import.meta.url), 'utf8'); assert.doesNotMatch(entry, /dev\/|fixture/);
  for (const file of ['Studio.tsx', 'types.ts', 'index.ts', 'studio.css']) {
    const source = readFileSync(new URL('../../media-shared/ui/src/' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /higgsfield|elevenlabs|api\.|soul\/|kling-/i);
  }
  const source = readFileSync(new URL('../ui/src/controller.ts', import.meta.url), 'utf8'); assert.doesNotMatch(source, /setInterval|setTimeout/);
});
