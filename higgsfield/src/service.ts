import { MediaCore } from '../../media-shared/src/core';
import { clone, visible } from '../../media-shared/src/contracts';
import type { Access, Amount, Artifact, Continuation, Job, JobStore, Json, Quote, Request, Scope } from '../../media-shared/src/contracts';
import { totals } from '../../media-shared/src/cost';
import { validateRequest, prepare, operations, unavailable } from './catalog';
import { HiggsfieldClient, boundedQuote, lifecyclePlan, metadataPlan, parseJson, submitPlan } from './client';
import type { Plan, Response, Pending } from './client';
import { identity, receipt } from './response';

/** Trusted injected consumer contracts, NOT host API signatures. Missing production ports refuse.
 * Attestation verifies exact durable input bytes, model prose/media constraints, account access and
 * source conflicts for this binding. Access is resolved by the host, never from frame arguments. */
export type ServicePorts = {
  store: JobStore; now(): number; maxHistory: number; client: HiggsfieldClient;
  attest?: (access: Access, request: Request) => boolean;
  quote?: (access: Access, request: Request, binding: string) => Quote | null;
  quoteSupported?: (operation: string) => boolean;
  /** Vendor receipt facts only, atomically scoped by owner/workspace/intent and write-once provider ID.
   * No job state, history or cost machine belongs here. */
  facts?: { save(token: Continuation, facts: { requestId: string; statusUrl: string; cancelUrl: string; expiresAt: string | null }): void };
  output?: { allowed(url: string): boolean; save(access: Access, id: string, assets: ReturnType<typeof receipt>['assets']): Artifact[] };
};
export type Effect = { token: Continuation; scope: Scope; plan: Plan; result: Response | Pending; action: 'submit' | 'status' | 'cancel' };
export class HiggsfieldService {
  readonly core: MediaCore;
  constructor(private readonly ports: ServicePorts) {
    this.core = new MediaCore(ports.store, ports.now, ports.maxHistory, 'async', validateRequest);
  }
  intent(access: Access, id: string, operation: string, params: Json, inputs: Request['inputs'] = []) {
    return this.core.intent(access, id, prepare(operation, params, inputs));
  }
  estimate(access: Access, id: string) {
    const d = this.core.beginEstimate(access, id, !!this.ports.quote);
    try {
      const quote = this.ports.quote!(access, clone(d.job.request), d.job.binding);
      return this.core.estimated(access, d.continuation!, boundedQuote(d.job.request, d.job.binding, this.ports.now(), quote));
    } catch { this.core.estimateFailed(d.continuation!); throw new Error('estimate_unavailable'); }
  }
  approve(access: Access, id: string, maximum: Amount) { return this.core.approve(access, id, maximum); }
  start(access: Access, id: string): Effect | { job: ReturnType<MediaCore['intent']> } {
    const d = this.core.beginStart(access, id, !!this.ports.output);
    if (!d.continuation) return { job: d.job };
    const token = d.continuation;
    let plan: Plan;
    let send: () => Response | Pending;
    try {
      if (!this.ports.attest || this.ports.attest(access, clone(d.job.request)) !== true) throw new Error('input_account_schema_unverified');
      plan = submitPlan(d.job.request, d.job.id);
      send = this.ports.client.prepareSend(plan);
      const reserved = this.core.reserve(access, token);
      if (reserved.state === 'waiting') return { job: reserved };
    } catch { this.core.releasePreflight(token); throw new Error('submission_preflight_refused'); }
    const entered = this.core.enter(access, token);
    if (!entered.action) return { job: entered.job };
    try { return { token, scope: d.job.scope, plan, action: 'submit', result: send() }; }
    catch { this.core.unknown(token); throw new Error('submission_unknown'); }
  }
  /** Trusted host callback only. Commit exact vendor identity before parsing/acquiring any outputs. */
  receive(access: Access, effect: Effect, response: Response) {
    // Retained host scope permits durable receipt after UI expiry, never another owner's/agent's result.
    if (!visible(access.scope, { scope: effect.scope } as Job)) throw new Error('receipt_scope_unavailable');
    try {
      if (effect.action === 'cancel') {
        if (response.status !== 202 || response.body !== '' || response.redirected || response.url !== effect.plan.url) throw new Error('cancel_not_confirmed');
        // 202 is acknowledgement, not status or accounting evidence. Poll before claiming canceled/refund.
        return this.core.unknown(effect.token);
      }
      const value = parseJson(response, effect.plan);
      const normalized = identity(value);
      const observed = this.core.observation(effect.token, normalized, true);
      if (observed.job.jobId !== normalized.jobId) return observed.job;
      const head = receipt(value, () => false, false);
      this.ports.facts?.save(effect.token, { requestId: head.observation.jobId, statusUrl: head.statusUrl, cancelUrl: head.cancelUrl, expiresAt: head.expiresAt });
      if (!observed.saveOutputs) return this.core.complete(effect.token, []);
      if (!this.ports.output || !access.current || access.scope.owner !== effect.token.owner || access.scope.workspace !== effect.token.workspace ||
          !this.core.history(access).some(j => j.id === effect.token.id)) throw new Error('output_unavailable');
      const body = receipt(value, u => this.ports.output!.allowed(u));
      return this.core.complete(effect.token, this.ports.output.save(access, effect.token.id, body.assets));
    } catch {
      // Invalid/uncertain delivery never causes a second paid submission, nor leaks provider bodies.
      try { this.core.unknown(effect.token); } catch { /* A stale/settled receipt cannot replace durable evidence. */ }
      throw new Error('receipt_unknown');
    }
  }
  inspect(access: Access, id: string): Effect {
    const d = this.core.beginReconcile(access, id);
    const plan = lifecyclePlan(d.job.jobId!, 'status');
    try { return { token: d.continuation!, scope: d.job.scope, plan, action: 'status', result: this.ports.client.send(plan) }; }
    catch { this.core.unknown(d.continuation!); throw new Error('reconciliation_unknown'); }
  }
  cancel(access: Access, id: string): Effect {
    const d = this.core.beginCancel(access, id, { queued: true, running: false });
    const plan = lifecyclePlan(d.job.jobId!, 'cancel');
    try { return { token: d.continuation!, scope: d.job.scope, plan, action: 'cancel', result: this.ports.client.send(plan) }; }
    catch { this.core.unknown(d.continuation!); throw new Error('cancellation_unknown'); }
  }
  metadata(access: Access, id: string, params: Json) {
    this.core.history(access); // Authorize trusted owner/workspace/actor before credential access.
    const plan = metadataPlan(id, params);
    const result = this.ports.client.send(plan);
    if ('kind' in result) return result;
    return parseJson(result, plan);
  }
  history(access: Access) { return this.core.history(access); }
  historyCapacity() { return this.ports.maxHistory; }
  canEstimate(operation?: string) { return !!this.ports.quote && (operation === undefined ||
    (this.ports.quoteSupported ? this.ports.quoteSupported(operation) === true : operation === 'higgsfield-ai/soul/v2/standard')); }
  recover(access: Access) { return this.core.recover(access); }
  usage(access: Access) { return { ledger: totals(this.core.history(access), access.scope.runId), remaining: null, accountUsage: null, unit: 'usd_micro' }; }
}
export function operationDisposition(id: string) {
  const row = operations.find(o => o.id === id);
  if (!row) return { available: false, code: 'unknown_operation' };
  const refused = { 'requests.delete': 'Destructive deletion requires separate owner authorization; unavailable here.',
    'files.put': 'Bounded lossless binary upload and verified storage origins unavailable; never forward API secrets.',
    'estimate.model': 'Only Soul 2 estimate path established; safe account basis/expiry still required.' } as Record<string,string>;
  return { id, source: row.source.url, available: !refused[id], detail: refused[id] ?? row.notes };
}
export const limitations = unavailable;
