import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fixture, soul } from './fixtures/commands';
import { HiggsfieldCommands } from '../src/commands';
import { fixtureTransport, fixtureMedia, selectFixtureOwner } from '../ui/dev/fixtures';
import { StudioController } from '../ui/src/controller';
import { bridgeTransport } from '../ui/src/transport';
import { frameMediaView } from '../ui/src/media';
import { App, MediaPreview } from '../ui/src/App';
import { Price, Studio, SchemaFields } from '../../media-shared/ui/src';
import { FinishedFeed } from '../../media-shared/ui/src/Studio';
import type { StudioItem } from '../../media-shared/ui/src';
import { jobStatus, studioPrice, groupHistory } from '../../media-shared/src/presentation';
import type { UIDetails, UISnapshot } from '../src/ui';
import type { ViewContext } from '../src/commands';
import { models } from '../src/catalog';
import { uiJSONBytes, validateUIArgs, uiBounds, displayUSD, displayModel } from '../src/ui';
import type { UITransport, Methods } from '../ui/src/transport';
import { matches } from '../src/schema';
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
  for (const args of [{ limit: 51 }, { limit: 0 }, { offset: -1 }, { offset: 10001 }, { limit: 1.5 }, { owner: 'A' }]) assert.deepEqual(ui('ui.snapshot', args), { error: 'document_ui_refused' });
  assert.equal(ui('ui.snapshot', { limit: 50 }).items.length, 2);
  for (let n = 0; n < 20; n++) prepare('Default page ' + n);
  assert.equal(ui('ui.snapshot').items.length, 20);
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
    else assert.equal(result.code, 'ui_schema_unsupported');
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
  const markup = render(React.createElement(App, { controller: c, fixtureLibrary: true })); assert.match(markup, /bridge unavailable/); assert.doesNotMatch(markup, /Generate for/);
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
    prompt: { type: 'string', maxLength: 100 }, amount: { type: 'integer', minimum: 1, maximum: 4 }, sound: { type: 'boolean' }, mode: { enum: ['a', 'b'] }, detail: { type: 'string' } } }, keyFields: ['amount', 'sound', 'mode'], values: {}, onChange() {} }));
  assert.match(markup, /aria-label="Prompt"/); assert.match(markup, /maxLength="100"/i); assert.match(markup, /min="1"/); assert.match(markup, /More settings \(1\)/); assert.match(markup, /role="switch"/);
});
test('actual App renders service fixture lifecycle and shared grouping with attribution', async () => {
  const fixture = fixtureTransport(), c = new StudioController(fixture.transport); await c.mount();
  const markup = render(React.createElement(App, { controller: c, fixtureLibrary: true }));
  for (const state of ['queued', 'generating', 'generated', 'failed', 'canceled', 'unknown', 'starting', 'price_unavailable'] as const) assert.ok(markup.includes(jobStatus(state).label), state);
  assert.doesNotMatch(markup, /Waiting for your OK|Price needs updating/); // Missing fixture quotes cannot inherit a stale/approval label from a stored wait reason.
  assert.doesNotMatch(markup, /studio-composer/); assert.match(markup, /studio-activity/); assert.match(markup, /<small>A<\/small>/); assert.doesNotMatch(markup, /<small>Fixture<\/small>/); c.dispose();
});
test('pipeline fixture provides exactly 3 jobs/one failure, existing link and one-hop source without refresh approval', async () => {
  const fixture = fixtureTransport({ scenario: 'pipeline' }), c = new StudioController(fixture.transport); await c.mount();
  assert.equal(c.state.snapshot?.items.length, 3); assert.equal(c.state.snapshot?.items.filter(i => i.state === 'failed').length, 1);
  const markup = render(React.createElement(App, { controller: c, fixtureLibrary: true })); assert.match(markup, /View run/); assert.match(markup, /From:.*A quiet garden cover/); assert.doesNotMatch(markup, /From: run-one|Check price again/); c.dispose();
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

test('UI arguments count exact serialized UTF-8 bytes including non-ASCII and lone-surrogate escapes', () => {
  const overhead = Buffer.byteLength(JSON.stringify({ id: '' }));
  const room = 4096 - overhead;
  const exact = { id: 'é'.repeat(Math.floor(room / 2)) + 'a'.repeat(room % 2) };
  assert.equal(Buffer.byteLength(JSON.stringify(exact)), 4096);
  assert.equal(uiJSONBytes(exact, 4096), 4096); validateUIArgs(exact, ['id']);
  assert.throws(() => validateUIArgs({ id: exact.id + 'a' }, ['id']));
  assert.throws(() => validateUIArgs({ id: '€'.repeat(1366) }, ['id']));
  const escaped = { id: '\ud800' }; assert.equal(uiJSONBytes(escaped), Buffer.byteLength(JSON.stringify(escaped)));
});

test('total details response is accepted at exactly 64KiB UTF-8 and refused one byte above without partial settings', () => {
  const { ui, prepare } = setup(); const { id } = prepare();
  const schema = models.find(m => m.id === soul)!.schema as any;
  const description = schema.description;
  try {
    schema.description = '';
    const baseline = Buffer.byteLength(JSON.stringify(ui('ui.details', { id })));
    const room = 65536 - baseline;
    schema.description = 'é'.repeat(Math.floor(room / 2)) + 'a'.repeat(room % 2);
    const details = ui('ui.details', { id });
    assert.equal(Buffer.byteLength(JSON.stringify(details)), 65536); assert.equal(details.params.prompt, 'Private authorized prompt');
    schema.description += 'a'; const refused = ui('ui.details', { id });
    assert.equal(refused.kind, 'unavailable'); assert.equal(refused.code, 'ui_details_too_large'); assert.equal(refused.params, undefined); assert.equal(refused.schema, undefined);
  } finally { if (description === undefined) delete schema.description; else schema.description = description; }
});

test('total snapshot and schema response UTF-8 limits include their entire envelopes', () => {
  const { ui } = setup(); const row = models.find(m => m.id === soul)!;
  const title = row.title, schema = row.schema as any, description = schema.description;
  try {
    row.title = 'x'; const baseline = Buffer.byteLength(JSON.stringify(ui('ui.snapshot')));
    const room = 262144 - baseline;
    row.title = 'x' + 'é'.repeat(Math.floor(room / 2)) + 'a'.repeat(room % 2);
    assert.equal(Buffer.byteLength(JSON.stringify(ui('ui.snapshot'))), 262144);
    row.title += 'a'; assert.equal(ui('ui.snapshot').code, 'ui_snapshot_too_large');
    row.title = title;
    schema.description = ''; const schemaBaseline = Buffer.byteLength(JSON.stringify(ui('ui.schema', { operation: soul })));
    const schemaRoom = 131072 - schemaBaseline;
    schema.description = 'é'.repeat(Math.floor(schemaRoom / 2)) + 'a'.repeat(schemaRoom % 2);
    assert.equal(Buffer.byteLength(JSON.stringify(ui('ui.schema', { operation: soul }))), 131072);
    schema.description += 'a'; assert.equal(ui('ui.schema', { operation: soul }).code, 'ui_schema_too_large');
    schema.description += '€'.repeat(1000); assert.equal(ui('ui.schema', { operation: soul }).code, 'ui_schema_too_large');
  } finally { row.title = title; if (description === undefined) delete schema.description; else schema.description = description; }
});

test('schema projection honors depth12/fields128 boundaries and refuses unsupported projections', () => {
  const { ui } = setup(); const row = models.find(m => m.id === soul)!; const saved = row.schema;
  try {
    row.schema = { type: 'object', properties: Object.fromEntries(Array.from({ length: 128 }, (_, n) => ['field' + n, { type: 'string' }])) } as any;
    assert.equal(Object.keys(ui('ui.schema', { operation: soul }).schema.properties).length, 128);
    (row.schema as any).properties.extra = { type: 'string' };
    assert.equal(ui('ui.schema', { operation: soul }).code, 'ui_schema_unsupported');
    let nested: any = { type: 'string' };
    for (let n = 0; n < 11; n++) nested = { type: 'array', items: nested };
    row.schema = { type: 'object', properties: { input: nested } } as any; assert.deepEqual(ui('ui.schema', { operation: soul }).schema, row.schema);
    row.schema = { type: 'object', properties: { input: { type: 'array', items: nested } } } as any;
    assert.equal(ui('ui.schema', { operation: soul }).code, 'ui_schema_unsupported');
    for (const unsupported of [{ type: 'object', properties: { mode: { oneOf: [{ type: 'string' }, { type: 'number' }] } } },
      { type: 'object', properties: { input: { $ref: 'https://untrusted.example/schema' } } }, { type: 'object', properties: { input: { $ref: '#/$defs/loop' } }, $defs: { loop: { $ref: '#/$defs/loop' } } }, { type: 'array', items: { type: 'string' } }]) {
      row.schema = unsupported as any;
      const result = ui('ui.schema', { operation: soul }); assert.equal(result.kind, 'unavailable'); assert.equal(result.schema, undefined);
    }
  } finally { row.schema = saved; }
});

test('unsupported persisted settings are unavailable instead of being silently truncated for reuse', () => {
  const { f, ui, prepare } = setup(); const { id } = prepare();
  f.store.transact('A', 'workspace', p => { (p.jobs.find(j => j.id === id)!.request.params as any).unknownKey = 'private'; return null; });
  const result = ui('ui.details', { id }); assert.equal(result.code, 'ui_details_unsupported'); assert.equal(result.params, undefined);
});

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function deferredFixture() {
  const f = fixtureTransport(), blocked = new Set<keyof Methods>();
  const pending: { method: keyof Methods; args: unknown; response: ReturnType<typeof deferred<any>> }[] = [];
  const transport: UITransport = { subscribe: f.transport.subscribe,
    call(method, args) { if (!blocked.has(method)) return f.transport.call(method, args) as any;
      const response = deferred<any>(); pending.push({ method, args, response }); return response.promise; } };
  return { f, blocked, pending, c: new StudioController(transport) };
}
test('late private inspect after Back or invalidation cannot resurrect details', async () => {
  const { f, c, blocked, pending } = deferredFixture(); await c.mount();
  const details = await f.transport.call('ui.details', { id: 'generated' });
  blocked.add('ui.details'); const late = c.inspect('generated'); c.back(); pending.shift()!.response.resolve(details); await late;
  assert.equal(c.state.details, undefined);
  const second = c.inspect('generated'); blocked.add('ui.snapshot'); f.notify();
  assert.equal(c.state.details, undefined);
  const detailRequest = pending.find(p => p.method === 'ui.details')!, snapshotRequest = pending.find(p => p.method === 'ui.snapshot')!;
  snapshotRequest.response.resolve(await f.transport.call('ui.snapshot', {})); await Promise.resolve();
  detailRequest.response.resolve(details); await second; assert.equal(c.state.details, undefined); c.dispose();
});
test('refresh clears retained details immediately and never restores them from same-ID presence', async () => {
  const { f, c, blocked, pending } = deferredFixture(); await c.mount(); await c.inspect('generated'); assert.ok(c.state.details);
  const snapshot = await f.transport.call('ui.snapshot', {}); blocked.add('ui.snapshot'); const refresh = c.refresh();
  assert.equal(c.state.details, undefined); pending[0].response.resolve(snapshot); await refresh; assert.equal(c.state.details, undefined); c.dispose();
});
test('out-of-order snapshot and inspect replies cannot restore earlier private visibility', async () => {
  const { f, c, blocked, pending } = deferredFixture(); await c.mount();
  const old = await f.transport.call('ui.snapshot', {}); blocked.add('ui.snapshot'); const first = c.refresh(), second = c.refresh();
  const empty = { ...(old as UISnapshot), items: [], total: 0, next: null, activity: [] };
  pending[1].response.resolve(empty); await second; pending[0].response.resolve(old); await first;
  assert.equal(c.state.snapshot?.items.length, 0);
  pending.length = 0; const afterBack = c.refresh(); c.back(); pending[0].response.resolve(old); await afterBack;
  assert.equal(c.state.snapshot?.items.length, (old as UISnapshot).items.length); assert.equal(c.state.details, undefined); // Back cannot cancel a required, independently authorized visibility refresh.
  blocked.delete('ui.snapshot'); pending.length = 0; blocked.add('ui.details');
  const firstInspect = c.inspect('generated'), secondInspect = c.inspect('failed');
  pending[1].response.resolve(await f.transport.call('ui.details', { id: 'failed' })); await secondInspect;
  pending[0].response.resolve(await f.transport.call('ui.details', { id: 'generated' })); await firstInspect;
  assert.equal(c.state.details?.item.id, 'failed'); c.dispose();
});
test('stale model schema responses cannot restore a selection after Back, refresh or a newer selection', async () => {
  const { f, c, blocked, pending } = deferredFixture(); await c.mount(); const schema = await f.transport.call('ui.schema', { operation: soul });
  blocked.add('ui.schema'); const first = c.selectModel(soul); c.back(); pending.shift()!.response.resolve(schema); await first; assert.equal(c.state.schema, undefined);
  const second = c.selectModel(soul); await c.refresh(); pending.shift()!.response.resolve(schema); await second; assert.equal(c.state.schema, undefined);
  const third = c.selectModel(soul), fourth = c.selectModel(soul);
  pending[1].response.resolve(schema); await fourth; const accepted = c.state.schema;
  pending[0].response.resolve({ ...(schema as any), schema: { type: 'string' } }); await third; assert.equal(c.state.schema, accepted); c.dispose();
});

test('Iris field placement keeps only marked keys and required inputs prominent, with required-overflow exception', () => {
  const schema = { type: 'object', required: ['prompt', 'required_one', 'defaulted'], properties: {
    prompt: { type: 'string' }, required_one: { type: 'string' }, defaulted: { type: 'integer', default: 2, minimum: 1 },
    aspect: { type: 'string' }, count: { type: 'integer' }, extra: { type: 'string' }, other: { type: 'string' } } };
  const props = { schema, values: { defaulted: 2 }, keyFields: ['aspect', 'count', 'extra'], defaultValid: (_k: string, s: any) => s.default !== undefined && matches(s, s.default), onChange() {} };
  const markup = render(React.createElement(SchemaFields, props)); const [front, collapsed] = markup.split('<details>');
  for (const label of ['Prompt', 'Required one', 'Aspect', 'Count']) assert.ok(front.includes('aria-label="' + label + '"'));
  assert.doesNotMatch(front, /aria-label="Extra"|aria-label="Other"|aria-label="Defaulted"/);
  assert.match(collapsed, /More settings \(3\)/); assert.match(collapsed, /aria-label="Defaulted"/); assert.match(markup, /aria-required="true"/); assert.match(markup, /studio-sr-only/); assert.match(markup, /aria-hidden="true">Required</);
  const overflow = { ...schema, required: ['prompt', 'required_one', 'defaulted', 'aspect', 'count', 'extra'], properties: { ...schema.properties, defaulted: { type: 'integer', default: 0, minimum: 1 } } };
  const [requiredFront, remaining] = render(React.createElement(SchemaFields, { ...props, schema: overflow })).split('<details>');
  for (const label of ['Required one', 'Defaulted', 'Aspect', 'Count', 'Extra']) assert.ok(requiredFront.includes('aria-label="' + label + '"'));
  assert.match(remaining, /More settings \(1\)/); assert.match(remaining, /Other/);
});
test('More settings changed count and Reset restore validated defaults through free edits and invalidate price', async () => {
  const f = fixtureTransport(), c = new StudioController(f.transport); await c.mount(); c.edit('prompt', 'Reset proof'); await c.estimate();
  const schema = c.state.schema!; c.edit('resolution', '1080p'); c.edit('seed', 24);
  const props = { schema, values: c.state.values, defaultValid: (_k: string, s: any) => s.default !== undefined && matches(s, s.default, schema, 0, false), onChange: (k: string, v: any) => c.edit(k, v) };
  const tree = SchemaFields(props), markup = render(tree); assert.match(markup, /2 changed/); assert.match(markup, />Reset</);
  function find(element: any): any { if (!element || typeof element !== 'object') return;
    if (element.type === 'button' && element.props.children === 'Reset') return element;
    for (const child of React.Children.toArray(element.props?.children)) { const result = find(child); if (result) return result; } }
  find(tree).props.onClick(); assert.equal(c.state.values.resolution, '720p'); assert.equal(c.state.values.seed, undefined);
  assert.equal(c.price().gate.kind, 'stale'); assert.equal(f.submissions(), 0); c.dispose();
});
test('free reuse replaces structured editor selection and its rendered value without retaining the earlier draft', async () => {
  const f = fixtureTransport(), c = new StudioController(f.transport); await c.mount();
  c.edit('custom_reference_id', null); const before = c.state.formRevision;
  const access = f.f.contexts.get(f.context)!;
  const uuid = 'd7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff';
  f.f.service.intent(access, 'structured-reuse', soul, { prompt: 'Structured reference', custom_reference_id: uuid });
  await c.refresh(); await c.inspect('structured-reuse'); await c.reuse();
  assert.ok(c.state.formRevision! > before!); assert.equal(c.state.values.custom_reference_id, uuid);
  const markup = render(React.createElement(SchemaFields, { schema: c.state.schema!, values: c.state.values, onChange() {} })); assert.ok(markup.includes(uuid));
  c.dispose();
});

test('actual owner-button handler clears A immediately and model selection cannot cancel B visibility refresh', async () => {
  const { f, c, blocked, pending } = deferredFixture(); await c.mount();
  c.edit('prompt', 'Private A draft'); c.purpose('Private A note'); await c.inspect('generated');
  const oldSnapshot = await f.transport.call('ui.snapshot', {}), oldDetails = await f.transport.call('ui.details', { id: 'generated' });
  blocked.add('ui.snapshot'); const oldRefresh = c.refresh();
  // Current mounted handler does resetContext -> setOwner (invalidation/refresh) -> immediate selectModel.
  const switchOwner = selectFixtureOwner(f, c, 'B');
  assert.equal(c.state.snapshot, undefined); assert.equal(c.state.details, undefined); assert.equal(c.state.values.prompt, undefined); assert.equal(c.state.purpose, '');
  await switchOwner; assert.equal(c.price().capable, false); // B refresh is still required, not canceled by selection.
  const current = await f.transport.call('ui.snapshot', {});
  pending[1].response.resolve(current); await Promise.resolve(); await Promise.resolve();
  assert.equal(c.state.snapshot?.items.length, 0); assert.equal(c.state.values.prompt, undefined);
  pending[0].response.resolve(oldSnapshot); await oldRefresh;
  assert.equal(c.state.snapshot?.items.length, 0); assert.equal(c.state.details, undefined);
  assert.doesNotMatch(JSON.stringify(c.state), /Private A draft|Private A note|Fixture generated/);
  const markup = render(React.createElement(App, { controller: c, fixtureLibrary: true })); assert.doesNotMatch(markup, /Fixture generated|Private A/);
  // A detail request from before a separate context switch cannot later restore the inspector.
  blocked.delete('ui.snapshot'); await selectFixtureOwner(f, c, 'user'); blocked.add('ui.details'); pending.length = 0;
  const inspect = c.inspect('generated'); await selectFixtureOwner(f, c, 'B'); pending[0].response.resolve(oldDetails); await inspect;
  assert.equal(c.state.details, undefined); assert.equal(c.state.snapshot?.items.length, 0); c.dispose();
});

test('exact USD formatting and recorded inspector cost never change atomic quote values or invent settlement', async () => {
  for (const [atomic, text] of [[0, '$0.00'], [1, '$0.000001'], [10, '$0.00001'], [10000, '$0.01'], [2500000, '$2.50']] as const) assert.equal(displayUSD(atomic), text);
  assert.throws(() => displayUSD(-1)); assert.throws(() => displayUSD(0.5)); assert.equal(displayModel(soul), 'Soul V2');
  const f = fixtureTransport(), c = new StudioController(f.transport); await c.mount(); c.edit('prompt', 'Exact money'); await c.estimate();
  const gate = c.price().gate; assert.equal(gate.kind, 'ready'); if (gate.kind !== 'ready') throw Error('missing gate');
  assert.equal(gate.amount, 10); assert.equal(gate.unit, 'usd_micro'); assert.equal(gate.text, '$0.00001');
  const price = render(React.createElement(Price, { view: c.price(), onEstimate() {}, onGenerate() {} }));
  assert.match(price, /Generate for \$0\.00001/); assert.match(price, /title="10 usd_micro"/); assert.doesNotMatch(price, />Estimate<|>Get price<|>Check again</);
  const id = c.state.id!; await c.inspect(id); assert.equal(c.state.details?.item.recordedCost?.kind, 'quoted');
  assert.match(render(React.createElement(App, { controller: c, fixtureLibrary: true })).replace(/<[^>]*>/g,''), /\$0\.00001 \(quoted\)/);
  c.back(); f.f.store.transact('A', 'workspace', p => { p.jobs.find(j => j.id === id)!.quote!.validUntilMs = f.f.now() + 1; return null; });
  f.f.tick(); await c.refresh(); assert.equal(c.price().gate.kind, 'stale'); await c.inspect(id); assert.equal(c.state.details?.item.recordedCost?.text, '$0.00001');
  c.dispose();
});

test('private document activity uses truthful preparation and display names while public commands omit prompts', () => {
  const { f, c, ui } = setup(); const a = f.actor('A'); f.service.intent(a, 'private-activity', soul, { prompt: 'A quiet garden' });
  const activity = ui('ui.snapshot').activity.join(' ');
  assert.match(activity, /A prepared 'A quiet garden'/); assert.match(activity, /Soul V2/); assert.doesNotMatch(activity, /higgsfield-ai|\/soul\/|submitted|https:/);
  const surface = f.surfaceContext('A'); const publicHistory = c.onSurfaceCall(surface, 'history', []);
  assert.doesNotMatch(publicHistory, /A quiet garden/); assert.equal(f.sends(), 0);
});

test('price footer gives one field-specific helper, hides invalid refresh and hides redundant fresh estimation', async () => {
  const f = fixtureTransport(), c = new StudioController(f.transport); await c.mount();
  const footer = () => render(React.createElement(Price, { view: c.price(), onEstimate() {}, onGenerate() {} }));
  let markup = footer(); assert.match(markup, /Add a prompt to get a price/); assert.match(markup, />Add a prompt<\/button>/);
  assert.doesNotMatch(markup, /Generate stays off|Price unavailable|>Check again<|>Get price</);
  c.edit('prompt', 'Ready inputs'); markup = footer(); assert.match(markup, />Get price<\/button>/);
  await c.estimate(); markup = footer(); assert.match(markup, /Generate for \$0\.00001/); assert.doesNotMatch(markup, />Get price<|>Estimate<|>Check again</);
  c.edit('prompt', 'Changed inputs'); markup = footer(); assert.match(markup, /Price needs updating/); assert.match(markup, />Check again<\/button>/); c.dispose();
});

test('rendered rows and inspector use human model/cost/defaults/navigation instead of raw identifiers and status-as-cost', async () => {
  const f = fixtureTransport(), c = new StudioController(f.transport); await c.mount();
  let markup = render(React.createElement(App, { controller: c, fixtureLibrary: true }));
  assert.match(markup, /higgs-tile higgs-row/); assert.match(markup, /higgs-actions/); assert.match(markup, /higgs-metadata/);
  assert.doesNotMatch(markup, />SOUL V2<|<small>higgsfield-ai/);
  assert.doesNotMatch(markup, /Price unavailable · 0:00|Price needs updating · 0:00|Waiting for your OK · 0:00/);
  await c.inspect('generated'); markup = render(React.createElement(App, { controller: c, fixtureLibrary: true }));
  assert.match(markup, /class="studio-prompt"/); assert.match(markup, /Model defaults/); assert.match(markup, /Previous result/); assert.match(markup, /Next result/); assert.match(markup, /class="studio-mono">\d+ \/ \d+<\/span>/);
  assert.doesNotMatch(markup, /<h3>Cost<\/h3><p>Generated<\/p>/); c.dispose();
});

test('dev width harness uses a real constrained iframe and reports actual viewport metrics without production fixture imports', () => {
  const dev = readFileSync(new URL('../ui/dev/main.tsx', import.meta.url), 'utf8');
  assert.match(dev, /<iframe/); assert.match(dev, /width=\{width\}/); assert.match(dev, /window\.innerWidth/); assert.match(dev, /document\.documentElement\.clientWidth/); assert.match(dev, /document\.documentElement\.scrollWidth/);
  assert.match(dev, /selectFixtureOwner\(fixture, controller, owner\)/); assert.doesNotMatch(dev, /document\.body\.style\.width/);
  const production = readFileSync(new URL('../ui/src/main.tsx', import.meta.url), 'utf8'); assert.doesNotMatch(production, /dev\/|fixture|postMessage/);
});

test('recent fixture clock integrates English Today/Yesterday/older grouping with six extra finished examples', async () => {
  const now = new Date(2026, 9, 29, 12, 0, 0).getTime();
  const f = fixtureTransport({ now }); const snapshot = await f.transport.call('ui.snapshot', { limit: 50 });
  if ('kind' in snapshot) throw Error(snapshot.code);
  const finished = snapshot.items.filter(i => ['generated', 'failed', 'canceled'].includes(i.state));
  assert.ok(finished.length >= 10); assert.ok(finished.every(i => i.at > new Date(2020, 0, 1).getTime() && i.at <= now));
  for (const id of ['image-study', 'video-study', 'image-yesterday', 'video-yesterday', 'failed-yesterday', 'image-older']) assert.ok(finished.some(i => i.id === id), id);
  assert.ok(finished.filter(i => i.state === 'failed').length >= 2);
  const original = Date.prototype.toLocaleDateString, locales: unknown[] = [];
  Date.prototype.toLocaleDateString = function(locale, options) { locales.push(locale); return original.call(this, locale ?? 'ru', options); };
  try {
    const days = groupHistory(finished, now).map(g => g.day);
    assert.deepEqual(days, ['Today', 'Yesterday', 'Oct 26']);
    const markup = render(React.createElement(Studio, { title: 'Fixture', items: finished, now, capacity: 64, activity: [],
      initialLibrary: true, renderItem: i => React.createElement('span', null, i.title), onSelect() {}, onBack() {} }));
    assert.match(markup, /Today/); assert.match(markup, /Yesterday/); assert.match(markup, /Oct 26/); assert.doesNotMatch(markup, /1970/);
    assert.ok(locales.length > 0 && locales.every(locale => locale === 'en'));
  } finally { Date.prototype.toLocaleDateString = original; }
  const videos = finished.filter(i => i.outputs.some(o => o.contentType === 'video/mp4'));
  assert.equal(videos.length, 2); assert.ok(videos.every(i => i.notice?.includes('Playback not supplied')));
  assert.equal(fixtureMedia.get('fixture-video-metadata'), null); assert.equal(fixtureMedia.get('unknown-file'), null);
  assert.equal(f.f.sends(), 0);
});

test('legacy synthetic epoch-clock migration retains unknown intent identity and submission count without replay', () => {
  const now = new Date(2026, 9, 29, 12, 0).getTime(); let saved = '';
  const f = fixtureTransport({ now, save: value => { saved = value; } });
  const access = f.f.contexts.get(f.context)!;
  f.f.service.intent(access, 'ui_legacy', soul, { prompt: 'Legacy synthetic intent' });
  f.f.store.transact('A', 'workspace', p => { for (const j of p.jobs) { j.at = 10; j.updatedAt = 10; if (j.id === 'ui_legacy') j.state = 'unknown'; } return null; });
  const persisted = JSON.parse(saved); persisted.submissions = 1;
  const restored = fixtureTransport({ now, load: () => JSON.stringify(persisted) });
  const jobs = restored.f.service.history(restored.f.contexts.get(restored.context)!);
  assert.equal(restored.submissions(), 1); assert.equal(jobs.find(j => j.id === 'ui_legacy')?.state, 'unknown');
  assert.ok(jobs.every(j => j.at > new Date(2020, 0, 1).getTime())); assert.equal(restored.f.sends(), 0);
});

test('run display projection preserves stored identity and uses host labels or Pipeline run, never raw run IDs', async () => {
  const { f, ui } = setup(); const rawId = 'opaque-run-private';
  for (const [n, label] of ['', rawId, ' ' + rawId + ' ', 'Daily covers run #12'].entries()) {
    const access = f.actor('A', 'run', rawId); if (access.scope.actor.kind !== 'run') throw Error('bad fixture'); access.scope.actor.label = label;
    const id = 'display-run-' + n; f.service.intent(access, id, soul, { prompt: 'Pipeline cover' });
    const item = (ui('ui.snapshot') as UISnapshot).items.find(i => i.id === id)!;
    assert.equal(item.actor.kind, 'run'); if (item.actor.kind !== 'run') throw Error('missing actor');
    assert.equal(item.actor.runId, rawId); assert.equal(item.actor.label, n === 3 ? label : 'Pipeline run');
    assert.equal(item.startedBy, n === 3 ? label : 'Pipeline run'); assert.equal(item.activity.includes(rawId), false);
    const stored = f.service.history(access).find(j => j.id === id)!;
    assert.equal(stored.scope.runId, rawId); assert.deepEqual(stored.scope.actor, access.scope.actor);
  }
  const pipeline = fixtureTransport({ scenario: 'pipeline' }), c = new StudioController(pipeline.transport); await c.mount();
  assert.ok(c.state.snapshot?.items.every(i => i.startedBy === 'Daily covers run #12'));
  const markup = render(React.createElement(App, { controller: c, fixtureLibrary: true })); assert.match(markup, /Daily covers run #12/); assert.doesNotMatch(markup, />run-a</); c.dispose();
});

test('contact sheet status/actions and optional helper stay separate from prompt and factual metadata', async () => {
  const f = fixtureTransport({ scenario: 'pipeline' }), c = new StudioController(f.transport); await c.mount();
  const markup = render(React.createElement(App, { controller: c, fixtureLibrary: true }));
  assert.match(markup, /<div class="higgs-row-end"><span class="studio-status"/);
  assert.match(markup, /<p class="ct-meta higgs-row-note" title="[^"]+">/); assert.doesNotMatch(markup, /<small class="higgs-row-note"/);
  const css = readFileSync(new URL('../ui/src/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.higgs-metadata\{display:flex;flex-wrap:wrap/);
  assert.match(css, /\.higgs-row-end\{display:flex;gap:6px;flex-wrap:wrap/);
  assert.match(css, /\.higgs-row-note,\.higgs-tile>p\{font-size:12px/); c.dispose();
});

function hostElements(node: React.ReactNode): React.ReactElement<any>[] {
  const result: React.ReactElement<any>[] = [];
  React.Children.forEach(node, child => { if (React.isValidElement(child)) { const element = child as React.ReactElement<any>; result.push(element); result.push(...hostElements(element.props.children)); } });
  return result;
}
test('ordinary study fixtures render as sibling articles in one actual day grid, preserving vendor slots', async () => {
  const now = new Date(2026, 9, 29, 12).getTime(), f = fixtureTransport({ now });
  const snapshot = await f.transport.call('ui.snapshot', { limit: 50 }); if ('kind' in snapshot) throw Error(snapshot.code);
  const items = snapshot.items.filter(i => i.title.includes('study'));
  assert.equal(items.length, 2);
  const slot = (item: StudioItem) => React.createElement('button', { 'data-vendor-card': item.id }, item.title);
  const tree = FinishedFeed({ items, now, renderItem: slot });
  const grids = hostElements(tree).filter(n => n.props.className === 'studio-feed');
  assert.equal(grids.length, 1);
  const siblings = React.Children.toArray(grids[0].props.children) as React.ReactElement<any>[];
  assert.equal(siblings.length, 2); assert.ok(siblings.every(n => n.type === 'article'));
  assert.deepEqual(siblings.map(n => n.props.children.props['data-vendor-card']), items.map(i => i.id));
  const markup = render(React.createElement(Studio, { title: 'Gallery', items, now, capacity: 64, activity: [], initialLibrary: true, renderItem: slot, onSelect() {}, onBack() {} }));
  assert.equal((markup.match(/class="studio-feed"/g) ?? []).length, 1);
  assert.match(markup, /data-vendor-card="image-study"/); assert.match(markup, /data-vendor-card="video-study"/);
});
test('ordinary sibling grids stop at actual consecutive run groups without merging separated pipeline buckets', async () => {
  const now = new Date(2026, 9, 29, 12).getTime(), f = fixtureTransport({ now });
  const snapshot = await f.transport.call('ui.snapshot', {}); if ('kind' in snapshot) throw Error(snapshot.code);
  const base = snapshot.items.find(i => i.id === 'generated')!;
  const you = { kind: 'you' as const }, agent = { kind: 'agent' as const, label: 'Rex' };
  const run = { kind: 'run' as const, label: 'Daily covers run #12', runId: 'run-private-a' }, secondRun = { kind: 'run' as const, label: 'Product covers run #3', runId: 'run-private-b' };
  const sequence = [['u1', you], ['a1', agent], ['r1a', run], ['r1b', run], ['u2', you], ['a2', agent], ['r2a', secondRun], ['u3', you], ['r1c', run]] as const;
  const items: StudioItem[] = sequence.map(([id, actor], n) => ({ ...base, id, actor, title: id, at: now - n * 1000,
    state: id === 'a2' ? 'failed' : 'generated', status: jobStatus(id === 'a2' ? 'failed' : 'generated') }));
  const tree = FinishedFeed({ items, now, renderItem: item => React.createElement('div', { className: 'higgs-tile', 'data-state': item.state }, item.title) });
  const nodes = hostElements(tree), grids = nodes.filter(n => n.props.className === 'studio-feed');
  assert.deepEqual(grids.map(grid => (React.Children.toArray(grid.props.children) as React.ReactElement<any>[]).map(article => article.props.children.props.children)),
    [['u1', 'a1'], ['r1a', 'r1b'], ['u2', 'a2'], ['r2a'], ['u3'], ['r1c']]);
  assert.equal(nodes.filter(n => n.props.className === 'studio-run').length, 3);
  assert.match(render(tree), /class="higgs-tile" data-state="failed">a2/);
  assert.equal(items.length, 9); assert.deepEqual(items.map(i => i.id), sequence.map(([id]) => id));
});
test('one authorized three-job run has a collapsed preparation aggregate and three individual activity entries', async () => {
  const f = fixtureTransport({ scenario: 'pipeline' }), c = new StudioController(f.transport); await c.mount();
  assert.equal(c.state.snapshot?.activitySummary, 'Daily covers run #12 prepared 3 jobs'); assert.equal(c.state.snapshot?.activity.length, 3);
  const markup = render(React.createElement(App, { controller: c, fixtureLibrary: true }));
  const strip = markup.match(/<div class="studio-activity">([\s\S]*?)<\/div>/)?.[1]; assert.ok(strip);
  assert.match(strip, /Daily covers run #12 prepared 3 jobs/);
  assert.doesNotMatch(strip, /submitted|spent|charged|\$|usd_micro/);
  assert.equal(f.f.sends(), 0); c.dispose();
});
test('mixed actors or an activity expansion truncated at8 do not claim a complete single-run aggregate or cost total', async () => {
  const f = fixtureTransport({ scenario: 'pipeline' }); f.f.service.intent(f.f.actor('A'), 'other-agent-job', soul, { prompt: 'Other authorized activity' });
  const mixed = await f.transport.call('ui.snapshot', {}); if ('kind' in mixed) throw Error(mixed.code);
  assert.equal(mixed.activitySummary, undefined); assert.equal(mixed.activity.length, 4);
  const { f: serviceFixture, ui } = setup(); const actor = serviceFixture.actor('A', 'run', 'bounded-run');
  if (actor.scope.actor.kind === 'run') actor.scope.actor.label = 'Daily covers run #12';
  for (let n = 0; n < 9; n++) serviceFixture.service.intent(actor, 'bounded-activity-' + n, soul, { prompt: 'Bounded activity' });
  const bounded = ui('ui.snapshot') as UISnapshot; assert.equal(bounded.activity.length, 8); assert.equal(bounded.activitySummary, undefined);
});
test('fixture one-hop source reference has a bounded human label and source lookup obeys current owner authorization', async () => {
  const f = fixtureTransport({ scenario: 'pipeline' }), c = new StudioController(f.transport); await c.mount();
  const child = c.state.snapshot!.items.find(i => i.id === 'run-two')!;
  assert.equal(child.source?.id, 'run-one'); assert.ok(child.source!.label.length <= 96); assert.match(child.source!.label, /A quiet garden cover.*Soul V2/); assert.doesNotMatch(child.source!.label, /run-one|run-a|https:|workspace/);
  await c.inspect(child.id); const source = c.state.details!.item.source!; assert.equal(source.id, 'run-one');
  const childMarkup = render(React.createElement(App, { controller: c, fixtureLibrary: true })); assert.match(childMarkup, /higgs-lineage/); assert.doesNotMatch(childMarkup, /From: run-one/);
  await c.inspect(source.id); assert.equal(c.state.details?.params.prompt, 'A quiet garden cover'); assert.equal(c.state.details?.item.source, undefined);
  await selectFixtureOwner(f, c, 'B'); await c.inspect(source.id); assert.equal(c.state.details, undefined); assert.equal(c.state.snapshot?.items.length, 0);
  const production = setup(), prepared = production.prepare(); assert.equal(production.ui('ui.details', { id: prepared.id }).item.source, undefined); c.dispose();
});
test('only run-attributed fixture jobs with the authorized run link render foreground underlined View run', async () => {
  const f = fixtureTransport({ scenario: 'pipeline' }); const access = f.f.contexts.get(f.context)!;
  f.f.service.intent(access, 'user-saved-job', soul, { prompt: 'User history beside the run' });
  f.f.service.intent(f.f.actor('A'), 'agent-saved-job', soul, { prompt: 'Agent history beside the run' });
  const c = new StudioController(f.transport); await c.mount();
  const nonRun = c.state.snapshot!.items.filter(i => i.actor.kind !== 'run'); assert.equal(nonRun.length, 2); assert.ok(nonRun.every(i => i.runLink === undefined));
  nonRun.forEach(i => { i.runLink = '#must-not-render'; });
  const markup = render(React.createElement(App, { controller: c, fixtureLibrary: true })); assert.equal((markup.match(/>View run<\/a>/g) ?? []).length, 3); assert.doesNotMatch(markup, /href="#must-not-render"/);
  const css = readFileSync(new URL('../ui/src/style.css', import.meta.url), 'utf8'); assert.match(css, /\.higgs-lineage\{[^}]*text-decoration:underline/); c.dispose();
});
test('contact sheet controls use one accent keyboard ring without a second card focus ring', async () => {
  const f = fixtureTransport(), c = new StudioController(f.transport); await c.mount();
  const markup = render(React.createElement(App, { controller: c, fixtureLibrary: true })); assert.match(markup, /higgs-tile higgs-row/); assert.match(markup, /<button class="higgs-select"/);
  const css = readFileSync(new URL('../ui/src/style.css', import.meta.url), 'utf8');
  const shared = readFileSync(new URL('../../media-shared/ui/src/studio.css', import.meta.url), 'utf8');
  assert.match(shared, /:focus-visible\{outline:2px solid var\(--ct-accent\);outline-offset:2px/); assert.doesNotMatch(css, /outline:none|:has\(:focus-visible\)|:focus-within/); c.dispose();
});
test('waiting labels and helpers share the actual missing/fresh/stale pipeline price gate without changing durable wait authority', async () => {
  const f = fixtureTransport({ scenario: 'pipeline' }), c = new StudioController(f.transport); await c.mount();
  let markup = render(React.createElement(App, { controller: c, fixtureLibrary: true }));
  assert.match(markup, /Price unavailable/); assert.match(markup, /This step stays paused until a safe, fresh price is available/); assert.doesNotMatch(markup, /Waiting for your OK|Approve in the run view/);
  const actor = f.f.actor('A', 'run'); const before = f.f.service.history(actor).find(j => j.id === 'run-three')!;
  assert.equal(before.waitReason, 'owner_confirmation'); assert.equal(before.quote, undefined);
  f.f.service.estimate(actor, 'run-three'); await c.refresh(); // Actual injected free estimator, never a hand-fabricated quote or paid effect.
  markup = render(React.createElement(App, { controller: c, fixtureLibrary: true })); assert.match(markup, /Waiting for your OK/); assert.match(markup, /Approve in the run view/); assert.doesNotMatch(markup, /This step stays paused/);
  f.f.tick(); await c.refresh(); markup = render(React.createElement(App, { controller: c, fixtureLibrary: true }));
  assert.match(markup, /Price needs updating/); assert.match(markup, /This step stays paused until a safe, fresh price is available/); assert.doesNotMatch(markup, /Waiting for your OK|Approve in the run view/);
  assert.equal(f.f.service.history(actor).find(j => j.id === 'run-three')?.waitReason, 'owner_confirmation'); assert.equal(f.f.sends(), 0); c.dispose();
});

test('local selection geometry rejects letterboxing and invalid ranges', async () => {
  const { containPoint, region, timeRange } = await import('../../media-shared/ui/src/selection');
  assert.equal(containPoint(500, 100, 1000, 1000, 1000, 500), null);
  assert.deepEqual(containPoint(500, 500, 1000, 1000, 1000, 500), {x:.5,y:.5});
  assert.equal(containPoint(NaN, 500, 1000, 1000, 1000, 500), null);
  const r = region({x:.1,y:.2},{x:.4,y:.6}); assert.ok(r); assert.ok(Math.abs(r.w-.3)<1e-12 && Math.abs(r.h-.4)<1e-12);
  assert.equal(region({x:.1,y:.2},{x:.1,y:.6}), null);
  assert.deepEqual(timeRange(1000,2000,4000), {t0_ms:1000,t1_ms:2000});
  assert.equal(timeRange(2000,1000,4000), null);
  assert.equal(timeRange(0,Infinity,4000), null);
});


test('image selection handler maps the rendered image and refuses letterbox gestures', async () => {
  const { imageGesture } = await import('../../media-shared/ui/dev/FixtureSelection');
  const image = { naturalWidth:1000, naturalHeight:500, getBoundingClientRect:()=>({left:10,top:20,width:1000,height:1000}) } as any;
  assert.deepEqual(imageGesture(image,{x:510,y:520},{x:510,y:520}),{kind:'point',point:{x:.5,y:.5}});
  assert.equal(imageGesture(image,{x:510,y:120},{x:510,y:520}),null);
  assert.equal(imageGesture(image,{x:510,y:520},{x:510,y:920}),null);
});


test('fixture pointer handlers retain a selection only for a valid media gesture', async () => {
  const {handleFixturePointer} = await import('../../media-shared/ui/dev/FixtureSelection');
  const image = {naturalWidth:1000,naturalHeight:500,getBoundingClientRect:()=>({left:0,top:0,width:1000,height:1000})};
  const currentTarget={querySelector:()=>image}; const down={current:null as {x:number;y:number}|null}; const selections:any[]=[];
  const event=(x:number,y:number)=>({clientX:x,clientY:y,currentTarget} as any);
  handleFixturePointer(event(500,100),false,down,a=>selections.push(a)); handleFixturePointer(event(500,500),true,down,a=>selections.push(a)); assert.equal(selections.length,0);
  handleFixturePointer(event(500,500),false,down,a=>selections.push(a)); handleFixturePointer(event(500,500),true,down,a=>selections.push(a)); assert.deepEqual(selections,[{kind:'point',point:{x:.5,y:.5}}]);
});


test('actual image inspector only exposes the explicitly injected synthetic selection surface', async () => {
  const f=fixtureTransport(), c=new StudioController(f.transport); await c.mount(); await c.inspect('generated');
  const ordinary=render(React.createElement(App,{controller:c,media:fixtureMedia}));
  assert.doesNotMatch(ordinary, /Fixture: not sent|>Comment<|Send \(fixture\)/);
  const fixture=render(React.createElement(App,{controller:c,media:fixtureMedia,selection:(_item,children)=>React.createElement('div',{'data-fixture-slot':true},children)}));
  assert.match(fixture,/data-fixture-slot/); assert.doesNotMatch(fixture,/>Sent<|>Seen<|Addressed in v3/); assert.equal(f.submissions(),0); c.dispose();
});


test('fixture comment gesture preserves exact words and cannot assert delivery', async () => {
  const {submitFixture} = await import('../../media-shared/ui/dev/FixtureSelection'); const attempts:any[]=[];
  const target={kind:'image' as const,revision:'synthetic:image',refuse:(p:any)=>attempts.push(p)};
  const anchor={kind:'point' as const,point:{x:.5,y:.5}}; const text='Change this';
  assert.equal(submitFixture(target,anchor,text,'change'),true); assert.equal(attempts[0].text,text); assert.equal(attempts[0].revision,target.revision);
  assert.equal(submitFixture({...target,revision:'untrusted'},anchor,text,'change'),false); assert.equal(attempts.length,1);
});


test('fixture gesture treats a sub-percent drag as a point and keeps the production slot neutral', async () => {
  const {imageGesture}=await import('../../media-shared/ui/dev/FixtureSelection');
  const image={naturalWidth:1000,naturalHeight:500,getBoundingClientRect:()=>({left:0,top:0,width:1000,height:500})} as any;
  assert.equal(imageGesture(image,{x:500,y:250},{x:505,y:251})?.kind,'point');
  for(const path of ['../ui/src/App.tsx','../../elevenlabs/ui/src/App.tsx'])assert.doesNotMatch(readFileSync(new URL(path,import.meta.url),'utf8'),/FixtureSelection|fixtureTarget/);
});

test('stage rail groups available file actions before details and preview leaves them out', async () => {
  const f=fixtureTransport(), c=new StudioController(f.transport); await c.mount(); await c.inspect('generated');
  const markup=render(React.createElement(App,{controller:c,media:fixtureMedia}));
  assert.equal((markup.match(/>Save as…<\/button>/g)??[]).length,1);
  assert.ok(markup.indexOf('studio-rail-actions')<markup.indexOf('<summary>Details</summary>')); assert.doesNotMatch(markup,/<h2>Prompt<\/h2>|<h3>Model<\/h3>|Started by/);
  assert.doesNotMatch(render(React.createElement(MediaPreview,{media:fixtureMedia.get('fixture-image'),actions:false})),/Save as/);
  assert.equal(f.submissions(),0);c.dispose();
});
test('strip does not look up media during server rendering', () => {
  let calls=0;const item={id:'image',title:'Image',at:1,operation:'x',actor:{kind:'you'},startedBy:'You',state:'generated',status:jobStatus('generated'),price:{kind:'unavailable'},outputs:[{kind:'artifact',id:'local',contentType:'image/png'}],activity:''} as StudioItem;
  render(React.createElement(Studio,{title:'Test',items:[item],now:2,capacity:null,activity:[],thumbnail:()=>{calls++;return '/local';},renderItem:()=>null,onSelect(){},onBack(){}}));
  assert.equal(calls,0);
});

test('region latch requires two finite corners and rejects empty regions', async () => {
  const {regionCorner}=await import('../../media-shared/ui/dev/FixtureSelection');
  assert.deepEqual(regionCorner(null,{x:.2,y:.3}),{kind:'first',point:{x:.2,y:.3}});
  const done=regionCorner({x:.2,y:.3},{x:.5,y:.7});assert.equal(done.kind,'complete');
  assert.deepEqual(regionCorner({x:.2,y:.3},{x:.2,y:.3}),{kind:'invalid'});
  assert.deepEqual(regionCorner(null,{x:NaN,y:.3}),{kind:'invalid'});
});


test('light table stages only authorized existing items and retains the current item when new work arrives', async () => {
  const {stageCandidate}=await import('../../media-shared/ui/src/Studio');
  const f=fixtureTransport(),c=new StudioController(f.transport);await c.mount();const items=c.state.snapshot!.items;
  const first=stageCandidate(items)!;assert.ok(items.some(i=>i.id===first&&['starting','queued','generating'].includes(i.state)));
  const generated=items.find(i=>i.state==='generated')!;
  assert.equal(stageCandidate(items,generated.id),generated.id);
  assert.equal(stageCandidate([],generated.id),undefined);
  assert.notEqual(stageCandidate(items,'foreign-owner-id'),'foreign-owner-id');
  assert.equal(f.submissions(),0);c.dispose();
});

test('light table session is newest first with day headings and prompt-accessible thumbnails, no inferred turn labels', async () => {
  const f=fixtureTransport(),c=new StudioController(f.transport);await c.mount();const items=c.state.snapshot!.items;
  const markup=render(React.createElement(Studio,{title:'Gallery',items,now:Date.now(),capacity:null,activity:[],renderItem:()=>null,onSelect(){},onBack(){}}));
  const session=markup.slice(markup.indexOf('aria-label="Results and activity"'),markup.indexOf('<div class="studio-stage-content">'));
  assert.match(session,/>Today<\/h2>/);assert.match(session,/>Yesterday<\/h2>/);assert.match(session,/aria-label="Fixture generated: a quiet garden" title="Fixture generated: a quiet garden"/);
  const newest=[...items].sort((a,b)=>b.at-a.at)[0];assert.ok(session.indexOf('aria-label="'+newest.title+'"')<session.indexOf('aria-label="Fixture image-older: a quiet garden"'));
  assert.doesNotMatch(session,/Turn [0-9]|2 of 3/);c.dispose();
});

test('empty production views have resting dot media and do not invent an agent identity or offer paid controls', async () => {
  const f=fixtureTransport({scenario:'empty'}),c=new StudioController(f.transport);await c.mount();assert.equal(c.state.snapshot!.items.length,0);
  const markup=render(React.createElement(App,{controller:c}));assert.match(markup,/studio-developing/);assert.match(markup,/Your agent will put results here/);assert.doesNotMatch(markup,/Select a result|studio-develop-ring|Generate for|>Comment<|Rex|studio-live-line|Agent media workspace/);c.dispose();
});



test('Iris source R1-R6 retain a populated stage, numeric-only mono, quiet header and nonredundant Details',async()=>{
  const f=fixtureTransport(),c=new StudioController(f.transport);await c.mount();await c.inspect('generated');
  const {handleStageKey}=await import('../../media-shared/ui/src/Studio');let closed=0,prevented=0;const event={key:'Escape',target:{},preventDefault(){prevented++;}} as any;handleStageKey(event,false,()=>closed++);assert.equal(c.state.details?.item.id,'generated');assert.equal(closed,0);assert.equal(prevented,0);handleStageKey(event,true,()=>closed++);assert.equal(closed,1);assert.equal(prevented,1);assert.equal(c.state.details?.item.id,'generated');
  const markup=render(React.createElement(App,{controller:c}));
  assert.match(markup,/class="studio-facts"><span>Soul V2<\/span>/);assert.doesNotMatch(markup,/Agent media workspace|<h2>Prompt<\/h2>|<h3>Model<\/h3>|Started by/);
  assert.match(markup,/<details class="studio-inspector-rail"/);assert.doesNotMatch(markup,/<details[^>]* open/);
  c.back();const pending=render(React.createElement(App,{controller:c}));assert.match(pending,/studio-stage-pending/);assert.doesNotMatch(pending,/studio-stage-empty|will put results here/);
  const source=readFileSync(new URL('../../media-shared/ui/src/Studio.tsx',import.meta.url),'utf8');assert.doesNotMatch(source,/event.key === 'Escape' && p.selected/);
  const css=readFileSync(new URL('../../media-shared/ui/src/studio.css',import.meta.url),'utf8');assert.match(css,/0 8px 24px rgb\(0 0 0 \/ .16\)/);assert.match(css,/studio-pin,\.studio-region\{border-color:var\(--ct-fg\)/);assert.doesNotMatch(css,/\.studio-mono,\.studio-facts/);c.dispose();
});


test('render L1-L3 typed session tiles reserve dots for actual developing and use SVG for unavailable or failed media',async()=>{
  const {Thumbnail}=await import('../../media-shared/ui/src/Studio');
  const f=fixtureTransport(),c=new StudioController(f.transport);await c.mount();
  const items=c.state.snapshot!.items;
  for(const id of ['generating','queued','starting']){const item=items.find(i=>i.id===id)!;const markup=render(React.createElement(Thumbnail,{item}));assert.match(markup,/studio-develop-ring/);assert.doesNotMatch(markup,/data-icon=/);}
  for(const [id,kind] of [['video-study','video'],['audio-result','audio'],['image-study','image'],['failed','error']] as const){const item=items.find(i=>i.id===id)!;const markup=render(React.createElement(Thumbnail,{item}));assert.match(markup,new RegExp('data-icon="'+kind+'"'));assert.match(markup,/stroke="currentColor"/);assert.match(markup,/data-wide="false"/);assert.doesNotMatch(markup,/studio-developing|studio-dot-row|studio-develop-ring|▷|♪|▧/);}
  assert.equal(f.submissions(),0);c.dispose();
});

test('render L2 pending developing uses result navigation, factual caption and existing Cancel gate',async()=>{
  const f=fixtureTransport(),c=new StudioController(f.transport);await c.mount();
  const queued=c.state.snapshot!.items.find(i=>i.id==='queued')!,snapshot=c.state.snapshot!;snapshot.items=[queued];
  let markup=render(React.createElement(App,{controller:c}));
  assert.match(markup,/Result inspector/);assert.match(markup,/aria-label="Previous result"/);assert.match(markup,/aria-label="Next result"/);assert.match(markup,/class="studio-mono">1 \/ 1<\/span>/);assert.match(markup,/class="studio-facts"><span>Soul V2/);assert.ok(markup.includes('by '+queued.startedBy));
  const enabled=snapshot.capabilities.cancelQueued;assert.equal(markup.includes('>Cancel</button>'),enabled);
  snapshot.capabilities.cancelQueued=false;markup=render(React.createElement(App,{controller:c}));assert.doesNotMatch(markup,/>Cancel<\/button>/);
  const {Developing,requestAspect}=await import('../../media-shared/ui/src/Studio');assert.equal(requestAspect('16:9'),'16 / 9');assert.equal(requestAspect('0:1'),undefined);assert.equal(requestAspect('auto'),undefined);
  const exact=render(React.createElement(Developing,{state:'generating',aspect:'9:16'}));assert.match(exact,/aspect-ratio:9 \/ 16/);assert.match(exact,/data-aspect-source="request"/);assert.match(exact,/studio-develop-ring/);
  const neutral=render(React.createElement(Developing,{state:'generating'}));assert.match(neutral,/aspect-ratio:4 \/ 3/);assert.match(neutral,/data-aspect-source="neutral"/);
  assert.equal(f.submissions(),0);c.dispose();
});


test('D4 elapsed hour boundary retains m:ss below an hour and renders through actual H stage Library and session',async()=>{
  for(const [ms,want] of [[0,'0:00'],[59999,'0:59'],[3599999,'59:59'],[3600000,'1:00:00'],[3723000,'1:02:03'],[36000000,'10:00:00']] as const)assert.equal(jobStatus('generating',{elapsedMs:ms}).elapsed,want);
  for(const ms of [-1,NaN,Infinity])assert.equal(jobStatus('generating',{elapsedMs:ms}).elapsed,undefined);
  const f=fixtureTransport({scenario:'hour'}),c=new StudioController(f.transport);await c.mount();await c.inspect('generating');
  let markup=render(React.createElement(App,{controller:c}));assert.match(markup,/studio-session-elapsed studio-mono">1:02:03/);assert.match(markup,/Generating<span class="studio-mono">1:02:03/);
  c.back();markup=render(React.createElement(App,{controller:c,fixtureLibrary:true}));assert.match(markup,/aria-label="Library"/);assert.match(markup,/Generating · 1:02:03/);assert.equal(f.submissions(),0);c.dispose();
});

test('D3 actual H failed caption falls back safely and metadata-only expired never invents Reopen',async()=>{
  const f=fixtureTransport(),c=new StudioController(f.transport);await c.mount();await c.inspect('failed');
  let markup=render(React.createElement(App,{controller:c}));assert.match(markup,/studio-caption-helper" data-tone="error">This generation failed. No retry was made./);assert.doesNotMatch(markup,/>Retry</);
  await c.inspect('expired');markup=render(React.createElement(App,{controller:c,media:fixtureMedia}));assert.match(markup,/studio-no-preview/);assert.match(markup,/File access expired. This result can&#x27;t be reopened here./);assert.doesNotMatch(markup,/>Reopen result</);
  const {failureCopy,StateHelper}=await import('../../media-shared/ui/src/Studio');
  assert.equal(failureCopy('A safe provider refusal.'),'A safe provider refusal.');
  for(const message of [undefined,'','https://provider.example/error?token=private','C:\\private\\file','api_key=private','x'.repeat(301)])assert.equal(failureCopy(message),'This generation failed. No retry was made.');
  assert.match(render(React.createElement(StateHelper,{state:'generated',expired:true,reopenable:true})),/File access expired. Reopen the result./);
  assert.equal(f.submissions(),0);c.dispose();
});

test('D1 D2 D5 D6 actual developing DOM and source distinguish motion selection focus and equal Library grids',async()=>{
  const {Developing}=await import('../../media-shared/ui/src/Studio');
  const h=render(React.createElement(Developing,{state:'generating'}));assert.match(h,/studio-develop-ring/);assert.doesNotMatch(h,/studio-audio-sweep/);
  const e=render(React.createElement(Developing,{state:'generating',audio:true}));assert.doesNotMatch(e,/studio-develop-ring/);const sweep=e.slice(e.indexOf('<g class="studio-audio-sweep"'));assert.equal([...sweep.matchAll(/<circle /g)].length,12);
  const css=readFileSync(new URL('../../media-shared/ui/src/studio.css',import.meta.url),'utf8');
  assert.match(css,/\.studio-strip-thumb \.studio-developing:is/);assert.doesNotMatch(css,/(?:^|\n)\.studio-developing:is/);assert.match(css,/studio-audio-sweep 2.6s linear/);assert.match(css,/\.studio-develop-ring,\.studio-audio-sweep\{display:none/);
  assert.match(css,/\.studio-strip-result\[aria-current=true\]\{border-color:var\(--ct-accent\);background:color-mix\(in srgb,var\(--ct-accent\) 10%,transparent\)/);assert.doesNotMatch(css,/\[aria-current=true\]\{outline:/);assert.match(css,/focus-visible\{outline:2px solid var\(--ct-accent\);outline-offset:2px/);
  assert.match(css,/studio-results \.studio-active\{display:grid;grid-template-columns:repeat\(4/);assert.match(css,/@media\(min-width:1400px\)\{\.studio-results \.studio-feed,\.studio-results \.studio-active\{grid-template-columns:repeat\(5/);assert.match(css,/studio-results \.studio-feed,\.studio-results \.studio-active\{grid-template-columns:repeat\(2/);assert.match(css,/-webkit-line-clamp:2/);
});

test('DEV App bounds metrics remain numeric passive and excluded from both production entries',()=>{
  const source=readFileSync(new URL('../../media-shared/ui/dev/SyntheticAppMetrics.tsx',import.meta.url),'utf8');assert.match(source,/ResizeObserver/);assert.match(source,/MutationObserver/);assert.match(source,/if\(!frame\)frame=requestAnimationFrame/);assert.match(source,/window.innerWidth/);assert.match(source,/node.clientWidth,scrollWidth:node.scrollWidth/);assert.doesNotMatch(source,/textContent|innerText|innerHTML|setInterval|setTimeout|dispatchEvent|\.focus\(/);
  for(const vendor of ['higgsfield','elevenlabs']){const dev=readFileSync(new URL('../../'+vendor+'/ui/dev/main.tsx',import.meta.url),'utf8');assert.match(dev,/<\/FixtureProvider><SyntheticAppMetrics\/>/);const entry=readFileSync(new URL('../../'+vendor+'/ui/src/main.tsx',import.meta.url),'utf8');assert.doesNotMatch(entry,/SyntheticAppMetrics|ui\/dev/);}
});


test('E1 E2 H selected thumbnail is distinct from another focusable session item and Library rejects session sizing',async()=>{
  const f=fixtureTransport(),c=new StudioController(f.transport);await c.mount();await c.inspect('generated');
  const markup=render(React.createElement(App,{controller:c}));const session=markup.slice(markup.indexOf('aria-label="Results and activity"'),markup.indexOf('<div class="studio-stage-content">'));
  const buttons=[...session.matchAll(/<button[^>]*class="studio-strip-result"[^>]*>/g)].map(match=>match[0]);
  assert.equal(buttons.filter(button=>button.includes('aria-current="true"')).length,1);assert.ok(buttons.some(button=>button.includes('aria-label="Fixture generated:')&&button.includes('aria-current="true"')));assert.ok(buttons.some(button=>button.includes('aria-label="Fixture queued:')&&!button.includes('aria-current=')));assert.ok(buttons.every(button=>!button.includes('disabled')&&!button.includes('tabindex="-1"')));
  const css=readFileSync(new URL('../../media-shared/ui/src/studio.css',import.meta.url),'utf8');
  assert.match(css,/\.studio-strip \.studio-strip-result\[data-session-kind=visual\]\[aria-current=true\]>\.studio-strip-thumb\{border:1px solid var\(--ct-accent\)/);
  assert.match(css,/\.studio-strip-result:focus-visible\{outline:2px solid var\(--ct-accent\);outline-offset:2px/);
  assert.match(css,/\.studio-strip \.studio-strip-thumb\{height:56px;width:56px;aspect-ratio:1\}/);assert.doesNotMatch(css,/(?:^|[},])\.studio-strip-thumb(?:,|\{height:56px)/);
  assert.match(css,/\.studio-results \.studio-strip-thumb\{width:100%;height:auto;aspect-ratio:1!important\}/);
  assert.equal(f.submissions(),0);c.dispose();
});
