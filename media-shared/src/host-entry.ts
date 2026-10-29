import type { HostJobs, JobSpendReceipt } from '../../../codeterm/codeterm-worktrees/next-integ/packages/plugin-sdk/src/pluginJobs';
/** Type-only contract pinned to next-integ 550cb1c. No SDK runtime import. */
export type { JobQuote, JobOriginReceipt, JobSpendReceipt, JobStatus, JobContext } from '../../../codeterm/codeterm-worktrees/next-integ/packages/plugin-sdk/src/pluginJobs';
export type HostEntryProof = { readonly freshHostEntry: true };
const fresh = new WeakMap<object, JobSpendReceipt>();
/** This backend-only gate owns the real HostJobs port. Never exposed to command/body parsing. */
export class HostEntryGate {
  constructor(private readonly jobs: HostJobs) {}
  enter(operation: string, request: Record<string, unknown>): HostEntryProof | { state: string } {
    const receipt = this.jobs.enter(operation, request);
    if ('error' in receipt) throw new Error('host_entry_refused');
    if (receipt.state !== 'entered_unknown') return { state: receipt.state };
    const proof: HostEntryProof = Object.freeze({ freshHostEntry: true });
    fresh.set(proof, JSON.parse(JSON.stringify(receipt)));
    return proof;
  }
}
/** Destructive consume: JSON copies, persisted receipts and duplicate uses are never authority. */
export function consumeHostEntry(proof: HostEntryProof): JobSpendReceipt {
  const receipt = proof && fresh.get(proof);
  if (!receipt) throw new Error('fresh_host_entry_required');
  fresh.delete(proof);
  return receipt;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as any)[k])).join(',') + '}';
  return JSON.stringify(value);
}

