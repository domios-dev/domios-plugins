import type { Amount, Job, Partition, Quote, Unit, WaitReason } from './contracts';

export function validAmount(value: Amount): boolean {
  return ['usd_micro', 'credit_milli', 'characters'].includes(value.unit) &&
    Number.isSafeInteger(value.amount) && value.amount >= 0;
}
export function quoteState(quote: Quote | null | undefined, binding: string, unit: Unit, now: number): 'ready' | 'unavailable' | 'stale' {
  if (!Number.isFinite(now) || !quote || !validAmount(quote) || quote.unit !== unit || quote.binding !== binding || quote.safe !== true ||
      !quote.basis || !quote.tariffRevision || !Number.isFinite(quote.issuedAt) || !Number.isFinite(quote.validUntilMs) ||
      quote.issuedAt > now || quote.validUntilMs <= quote.issuedAt) return 'unavailable';
  return now >= quote.validUntilMs ? 'stale' : 'ready';
}
export function totals(jobs: Job[], runId: string | undefined): { spent: Partial<Record<Unit, number>>; reserved: Partial<Record<Unit, number>>; unknown: number } {
  const result = { spent: {} as Partial<Record<Unit, number>>, reserved: {} as Partial<Record<Unit, number>>, unknown: 0 };
  for (const job of jobs.filter(j => j.scope.runId === runId)) {
    if (job.accounting === 'unknown') result.unknown++;
    if (!job.reservation || !job.accounting) continue;
    const bucket = job.accounting === 'spent' ? result.spent : result.reserved;
    const sum = (bucket[job.reservation.unit] ?? 0) + job.reservation.amount;
    if (!Number.isSafeInteger(sum)) throw new Error('unsafe_ledger');
    bucket[job.reservation.unit] = sum;
  }
  return result;
}
export function waitReason(data: Partition, job: Job, now: number): WaitReason | undefined {
  const state = quoteState(job.quote, job.binding, job.request.unit, now);
  if (state !== 'ready') return state === 'stale' ? 'price_stale' : 'price_unavailable';
  const ledger = totals(data.jobs.filter(j => j !== job), job.scope.runId);
  if (ledger.unknown) return 'unknown_reservation';
  const price = job.quote!;
  if (!job.approval || !validAmount(job.approval) || job.approval.unit !== price.unit || job.approval.amount < price.amount)
    return 'owner_confirmation';
  const ceiling = data.ceilings[price.unit];
  const projected = (ledger.spent[price.unit] ?? 0) + (ledger.reserved[price.unit] ?? 0) + price.amount;
  if (!Number.isSafeInteger(projected)) return 'ceiling';
  if (!job.ceilingException && (ceiling === undefined || !Number.isSafeInteger(ceiling) || ceiling < 0 || projected > ceiling)) return 'ceiling';
  return undefined;
}
