import type { Access, Amount, Job } from '../../media-shared/src/contracts';
import { validAmount } from '../../media-shared/src/cost';

/** Narrow injected Watt/host proof port. These fields are evidence references, not user approvals.
 * No aggregate ledger is manufactured or stored in the plugin. Core still enforces fresh quote,
 * exact owner approval and independent ceilings immediately before entry. */
export type EffectProof = { purpose: string; operation: string; binding: string; maximum: Amount;
  runCeiling: Amount; aggregateProof: string };
export type ProofPort = (access: Access, job: Job) => EffectProof | null;
export function proofRequired(job: Job): boolean { return job.state === 'waiting'; }
export function proofAllows(port: ProofPort | undefined, access: Access, job: Job): boolean {
  if (!proofRequired(job)) return true; // Existing effects cannot enter a fresh paid submission.
  const p = port?.(access, job);
  return !!p && !!p.purpose.trim() && !!p.aggregateProof && p.operation === job.id && p.binding === job.binding &&
    validAmount(p.maximum) && validAmount(p.runCeiling) && p.maximum.unit === job.request.unit && p.runCeiling.unit === job.request.unit &&
    !!job.quote && p.maximum.amount >= job.quote.amount;
}
