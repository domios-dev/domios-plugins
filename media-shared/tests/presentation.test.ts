import test from 'node:test';
import assert from 'node:assert/strict';
import { activityLine, actorLabel, cancelAction, groupHistory, humanActions, jobPrice, jobStatus, pipelinePrice, priceGate, refusalCopy, studioPrice, unknownAction } from '../src/presentation';
import type { JobState } from '../src/presentation';
import type { Actor } from '../src/contracts';
import { harness, request } from './fixtures/harness';
import { ticketFixture } from './fixtures/async-job';
import { MediaController } from '../src/controller';

const names = { one: 'character', other: 'characters' };
test('Iris state labels, tones, actual progress and elapsed time', () => {
  const expected = {
    starting: ['Starting…', 'muted'], queued: ['Queued', 'muted'], generating: ['Generating', 'accent'], generated: ['Generated', 'ok'],
    failed: ['Failed', 'error'], canceled: ['Canceled', 'muted'], unknown: ['Status unknown', 'warn'],
    price_unavailable: ['Price unavailable', 'warn'], price_stale: ['Price needs updating', 'warn'], waiting_ok: ['Waiting for your OK', 'warn'],
  };
  for (const [state, [label, tone]] of Object.entries(expected)) {
    const actual = jobStatus(state as JobState);
    assert.equal(actual.label, label); assert.equal(actual.tone, tone); assert.equal(actual.progress, undefined);
  }
  assert.equal(jobStatus('queued', { cancelRequested: true }).label, 'Canceling…');
  assert.equal(jobStatus('unknown', { cancelRequested: true }).label, 'Status unknown');
  assert.equal(jobStatus('generated', { cancelRequested: true }).label, 'Generated');
  assert.equal(jobStatus('generating', { elapsedMs: 12000, progress: .25 }).elapsed, '0:12');
  assert.equal(jobStatus('generating', { elapsedMs: 100000, progress: .25 }).elapsed, '1:40');
  assert.equal(jobStatus('generating', { progress: .25 }).progress, .25);
  for (const progress of [NaN, Infinity, -1, 1.1]) assert.equal(jobStatus('generating', { progress }).progress, undefined);
  assert.equal(jobStatus('queued', { progress: .5 }).progress, undefined);
});
test('Iris supported-cancel matrix and free unknown check without Retry', () => {
  for (const cancelQueued of [false, true]) for (const cancelRunning of [false, true]) {
    for (const state of ['starting', 'queued', 'generating', 'generated', 'failed', 'canceled', 'unknown', 'price_unavailable', 'price_stale', 'waiting_ok'] as JobState[]) {
      assert.deepEqual(cancelAction(state, { cancelQueued, cancelRunning }),
        state === 'queued' && cancelQueued || state === 'generating' && cancelRunning ? { label: 'Cancel' } : null);
    }
  }
  assert.equal(unknownAction(false), null); assert.deepEqual(unknownAction(true), { label: 'Check again' });
});
test('Iris price gate missing, unsafe, wrong unit, stale, explicit zero and provider unit naming', () => {
  for (const q of [null, { amount: -.1, unit: 'characters', validUntilMs: 100 }, { amount: 1.1, unit: 'characters', validUntilMs: 100 },
    { amount: Number.MAX_SAFE_INTEGER + 1, unit: 'characters', validUntilMs: 100 }, { amount: 1, unit: 'credit_milli', validUntilMs: 100 }]) {
    assert.equal(priceGate(q, 'characters', 10, names).kind, 'unavailable');
  }
  assert.equal(priceGate({ amount: 0, unit: 'characters', validUntilMs: 100 }, 'characters', 10, names).kind, 'ready');
  assert.deepEqual(priceGate({ amount: 1240, unit: 'characters', validUntilMs: 100 }, 'characters', 10, names),
    { kind: 'ready', amount: 1240, unit: 'characters', text: '1,240 characters' });
  assert.equal(priceGate({ amount: 1, unit: 'characters', validUntilMs: 100 }, 'characters', 10, names).kind, 'ready');
  assert.equal(priceGate({ amount: 1, unit: 'characters', validUntilMs: 100 }, 'characters', 100, names).kind, 'stale');
  const singular = priceGate({ amount: 1, unit: 'characters', validUntilMs: 100 }, 'characters', 10, names);
  assert.equal(singular.kind === 'ready' && singular.text, '1 character');
});
test('studio/pipeline copy blocks unavailable and stale prices and hides unavailable refresh transports', () => {
  for (const kind of ['unavailable', 'stale'] as const) {
    const studio = studioPrice({ kind }); const pipeline = pipelinePrice({ kind });
    const label = kind === 'stale' ? 'Price needs updating' : 'Price unavailable';
    assert.equal(studio.primary, label); assert.equal(studio.disabled, true);
    assert.equal(studio.helper, 'Generate stays off until a safe, fresh price is available.');
    assert.equal(studio.refresh, null); assert.equal(studioPrice({ kind }, 1, true).refresh, 'Check again');
    assert.equal(pipeline.label, label); assert.equal(pipeline.approve, null);
    assert.equal(pipeline.helper, 'This step stays paused until a safe, fresh price is available.');
    assert.equal(pipeline.refresh, null);
    assert.equal(pipelinePrice({ kind }, { refreshAvailable: true }).refresh, 'Check price again');
  }
  const gate = priceGate({ amount: 12, unit: 'credit_milli', validUntilMs: 100 }, 'credit_milli', 10, { one: 'millicredit', other: 'millicredits' });
  assert.equal(studioPrice(gate).primary, 'Generate for 12 millicredits');
  assert.equal(studioPrice(gate, 3).primary, 'Generate 3 for 12 millicredits');
  assert.equal(studioPrice(gate, 0).helper, 'Choose how many to generate.');
  assert.equal(pipelinePrice(gate).approve, 'Approve 12 millicredits for this step');
  assert.equal(pipelinePrice(gate).label, 'Waiting for your OK');
  assert.equal(pipelinePrice(gate, { overBudget: true }).budget, "Above this run's budget. Later steps still stop for approval.");
});
test('consumer jobPrice never exposes unverified adapter evidence', async () => {
  const h = harness(); const f = ticketFixture(h.now); const c = new MediaController(h.ports, f.adapter);
  await c.intent(h.agentCaller, 'one', request()); f.setPrice({ safe: false });
  const job = await c.estimate(h.agentCaller, 'one');
  assert.equal(jobPrice(job, h.now(), names).kind, 'unavailable');
  f.setPrice({}); const fresh = await c.estimate(h.agentCaller, 'one');
  assert.equal(jobPrice(fresh, h.now(), names).kind, 'ready');
  assert.equal(jobPrice(fresh, h.now() + 100, names).kind, 'stale');
});
test('host attribution and consecutive run groups preserve job order and distinct actors', () => {
  const now = new Date(2026, 9, 29, 12).getTime();
  const run: Actor = { kind: 'run', label: 'Daily covers run #12', runId: 'r1' };
  const you: Actor = { kind: 'you' }; const agent: Actor = { kind: 'agent', label: 'Rex' };
  assert.equal(actorLabel(you), 'You'); assert.equal(actorLabel(agent), 'Rex');
  const groups = groupHistory([{ at: now - 86400000, actor: you, id: 0 }, { at: now, actor: run, id: 1 },
    { at: now, actor: run, id: 2 }, { at: now, actor: run, id: 3 }, { at: now, actor: agent, id: 4 }, { at: now, actor: run, id: 5 }], now);
  assert.equal(groups[0].day, 'Yesterday'); assert.equal(groups[1].day, 'Today');
  assert.deepEqual(groups[1].runs.map(r => r.items.length), [3, 1, 1]);
  assert.equal(activityLine(run, 'submitted', '6 jobs', '72 credits'), 'Daily covers run #12 submitted 6 jobs for 72 credits');
  assert.equal(activityLine(agent, 'submitted', 'x'.repeat(49)), `Rex submitted ${'x'.repeat(48)}…`);
  const older = new Date(2026, 9, 27, 12);
  assert.equal(groupHistory([{ at: older.getTime(), actor: you }], now)[0].day,
    older.toLocaleDateString('en', { month: 'short', day: 'numeric' }));
});
test('Iris refusal copy sanitizes raw errors, stays silent for busy/stale and gates action ordering', () => {
  for (const reason of ['cancelled', 'busy', 'stale']) assert.equal(refusalCopy('denied', reason), null);
  assert.equal(refusalCopy('denied', 'media_expired'), 'File access expired. Reopen the result.');
  for (const reason of ['media_foreign', 'media_unknown']) assert.equal(refusalCopy('denied', reason), "This file isn't available in this view. Reopen the result.");
  assert.equal(refusalCopy('unavailable', 'clipboard'), "Copy isn't available here.");
  assert.equal(refusalCopy('error', 'Authorization: secret private path'), "Couldn't complete that.");
  assert.deepEqual(humanActions({ copyText: true, saveAs: true, reveal: true }, ['reveal', 'saveAs', 'copyText']), ['copyText', 'saveAs', 'reveal']);
  assert.deepEqual(humanActions({ copyText: false, saveAs: true, reveal: false }, ['copyText', 'reveal']), []);
});
