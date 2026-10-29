import type { Actor, Job } from './contracts';
import { quoteState } from './cost';
export type JobState = 'starting' | 'queued' | 'generating' | 'generated' | 'failed' | 'canceled' | 'unknown' | 'price_unavailable' | 'price_stale' | 'waiting_ok';
export type Tone = 'muted' | 'accent' | 'ok' | 'error' | 'warn';
const states: Record<JobState, [string, Tone]> = {
  starting: ['Starting…', 'muted'], queued: ['Queued', 'muted'], generating: ['Generating', 'accent'],
  generated: ['Generated', 'ok'], failed: ['Failed', 'error'], canceled: ['Canceled', 'muted'],
  unknown: ['Status unknown', 'warn'], price_unavailable: ['Price unavailable', 'warn'],
  price_stale: ['Price needs updating', 'warn'], waiting_ok: ['Waiting for your OK', 'warn'],
};
export function jobStatus(state: JobState, o: { cancelRequested?: boolean; elapsedMs?: number; progress?: number } = {}) {
  let [label, tone] = states[state];
  if (o.cancelRequested && !['generated', 'failed', 'canceled', 'unknown'].includes(state)) [label, tone] = ['Canceling…', 'muted'];
  const seconds = o.elapsedMs !== undefined && Number.isFinite(o.elapsedMs) && o.elapsedMs >= 0 ? Math.floor(o.elapsedMs / 1000) : undefined;
  return { label, tone,
    elapsed: seconds === undefined ? undefined : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
    progress: state === 'generating' && typeof o.progress === 'number' && Number.isFinite(o.progress) && o.progress >= 0 && o.progress <= 1 ? o.progress : undefined };
}
export function cancelAction(state: JobState, provider: { cancelQueued: boolean; cancelRunning: boolean }): { label: 'Cancel' } | null {
  return state === 'queued' && provider.cancelQueued || state === 'generating' && provider.cancelRunning ? { label: 'Cancel' } : null;
}
export function unknownAction(reconcileAvailable: boolean): { label: 'Check again' } | null {
  return reconcileAvailable ? { label: 'Check again' } : null;
}
export type DisplayQuote = { amount: number; unit: string; validUntilMs: number } | null;
export type PriceGate = { kind: 'ready'; amount: number; unit: string; text: string } | { kind: 'unavailable' } | { kind: 'stale' };
/** Call only with a quote already verified by quoteState against binding, tariff and safe flag. */
export function priceGate(quote: DisplayQuote, expectedUnit: string, nowMs: number, names: { one: string; other: string }): PriceGate {
  if (!quote || !Number.isSafeInteger(quote.amount) || quote.amount < 0 || quote.unit !== expectedUnit ||
      !Number.isFinite(nowMs) || !Number.isFinite(quote.validUntilMs)) return { kind: 'unavailable' };
  if (nowMs >= quote.validUntilMs) return { kind: 'stale' };
  return { kind: 'ready', amount: quote.amount, unit: quote.unit,
    text: `${quote.amount.toLocaleString('en-US')} ${quote.amount === 1 ? names.one : names.other}` };
}
/** Consumer entry point: never display a raw adapter quote as an approvable price. */
export function jobPrice(job: Job, now: number, names: { one: string; other: string }): PriceGate {
  const state = quoteState(job.quote, job.binding, job.request.unit, now);
  return state === 'ready' ? priceGate(job.quote!, job.request.unit, now, names) : { kind: state };
}
/** The quote is the total for the entire immutable request, never a per-item price. */
export function studioPrice(gate: PriceGate, count = 1, estimateAvailable = false) {
  const ready = gate.kind === 'ready';
  const validCount = Number.isSafeInteger(count) && count > 0;
  return { primary: ready ? count > 1 ? `Generate ${count} for ${gate.text}` : `Generate for ${gate.text}` :
    gate.kind === 'stale' ? 'Price needs updating' : 'Price unavailable', disabled: !ready || !validCount,
    helper: !validCount ? 'Choose how many to generate.' : ready ? null : 'Generate stays off until a safe, fresh price is available.',
    refresh: !ready && estimateAvailable ? 'Check again' : null };
}
export function pipelinePrice(gate: PriceGate, o: { refreshAvailable?: boolean; overBudget?: boolean } = {}) {
  return { label: gate.kind === 'ready' ? 'Waiting for your OK' : gate.kind === 'stale' ? 'Price needs updating' : 'Price unavailable',
    helper: gate.kind === 'ready' ? null : 'This step stays paused until a safe, fresh price is available.',
    approve: gate.kind === 'ready' ? `Approve ${gate.text} for this step` : null,
    refresh: gate.kind !== 'ready' && o.refreshAvailable === true ? 'Check price again' : null,
    budget: o.overBudget ? "Above this run's budget. Later steps still stop for approval." : null };
}
export function actorLabel(actor: Actor): string { return actor.kind === 'you' ? 'You' : actor.label; }
export function groupHistory<T extends { at: number; actor: Actor }>(items: T[], now: number) {
  const dayKey = (at: number) => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const today = dayKey(now); const yesterdayDate = new Date(now); yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = dayKey(yesterdayDate.getTime());
  const days: { day: string; runs: { actor: Actor; items: T[] }[] }[] = [];
  for (const item of items) {
    const key = dayKey(item.at); const date = new Date(item.at);
    const day = key === today ? 'Today' : key === yesterday ? 'Yesterday' : date.toLocaleDateString('en',
      { month: 'short', day: 'numeric', ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' as const } : {}) });
    let bucket = days[days.length - 1];
    if (!bucket || bucket.day !== day) { bucket = { day, runs: [] }; days.push(bucket); }
    const last = bucket.runs[bucket.runs.length - 1];
    if (last && item.actor.kind === 'run' && last.actor.kind === 'run' && item.actor.runId === last.actor.runId) last.items.push(item);
    else bucket.runs.push({ actor: item.actor, items: [item] });
  }
  return days;
}
export function activityLine(actor: Actor, verb: string, subject: string, amountText?: string): string {
  const bounded = Array.from(subject).slice(0, 48).join('') + (Array.from(subject).length > 48 ? '…' : '');
  return `${actorLabel(actor)} ${verb} ${bounded}${amountText ? ` for ${amountText}` : ''}`;
}
export function refusalCopy(code: string, reason: string): string | null {
  if (['cancelled', 'busy', 'stale'].includes(reason)) return null;
  if (reason === 'media_expired') return 'File access expired. Reopen the result.';
  if (reason === 'media_unknown' || reason === 'media_foreign') return "This file isn't available in this view. Reopen the result.";
  if (reason === 'clipboard') return "Copy isn't available here.";
  return "Couldn't complete that.";
}
export type HumanAction = 'copyText' | 'saveAs' | 'reveal';
export function humanActions(available: Record<HumanAction, boolean>, declared: string[]): HumanAction[] {
  return (['copyText', 'saveAs', 'reveal'] as HumanAction[]).filter(action => declared.includes(action) && available[action]);
}
