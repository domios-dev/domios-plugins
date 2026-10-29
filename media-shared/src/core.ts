import { bindingOf, clone, sameIntent, visible } from './contracts';
import type { Access, Amount, Artifact, Continuation, Decision, Job, JobStore, Observation, Partition, Quote, Request, Submission } from './contracts';
import { quoteState, validAmount, waitReason } from './cost';
import { canonical, consumeHostEntry, consumeHostNoEntry } from './host-entry';
import type { HostEntryProof, HostNoEntryProof } from './host-entry';

/** Synchronous admission/receipt facade. No transport, Promise runtime, host wrapper or UI authority. */
export class MediaCore {
  constructor(private readonly store: JobStore, private readonly now: () => number, private readonly maxHistory: number,
    private readonly kind: Submission['kind'], private readonly validate: (request: Request) => boolean) {
    if (!Number.isSafeInteger(maxHistory) || maxHistory < 1) throw new Error('invalid_bounds');
  }
  private transaction<T>(owner: string, workspace: string, edit: (d: Partition) => T): T {
    const result = this.store.transact(owner, workspace, edit);
    if (result && typeof (result as { then?: unknown }).then === 'function') throw new Error('synchronous_storage_required');
    return clone(result);
  }
  private authorize(access: Access) {
    if (access.current !== true || !access.scope.owner || !access.scope.workspace || !access.scope.actorId) throw new Error('stale_authority');
  }
  private owned(d: Partition, access: Access, id: string) {
    const job = d.jobs.find(j => j.id === id && visible(access.scope, j));
    if (!job) throw new Error('job_unavailable');
    return job;
  }
  private token(job: Job): Continuation {
    job.epoch = (job.epoch ?? 0) + 1;
    return { owner: job.scope.owner, workspace: job.scope.workspace, id: job.id, binding: job.binding, epoch: job.epoch };
  }
  private continued<T>(token: Continuation, edit: (d: Partition, job: Job) => T): T {
    return this.transaction(token.owner, token.workspace, d => {
      const job = d.jobs.find(j => j.id === token.id);
      if (!job || job.binding !== token.binding || job.epoch !== token.epoch) throw new Error('stale_continuation');
      const result = edit(d, job); job.updatedAt = this.now(); return result;
    });
  }
  private resumeAuthority(access: Access, token: Continuation, inputs = false) {
    // A host-retained continuation is not itself caller authority.
    if (access.scope.owner !== token.owner || access.scope.workspace !== token.workspace) throw new Error('job_unavailable');
    this.continued(token, (d) => { this.owned(d, access, token.id); return true; });
    if (access.current !== true || inputs && access.inputsAuthorized !== true) {
      this.releasePreflight(token);
      throw new Error(access.current !== true ? 'stale_authority' : 'input_unavailable');
    }
  }
  history(access: Access): Job[] {
    this.authorize(access);
    return this.transaction(access.scope.owner, access.scope.workspace, d => d.jobs.filter(j => visible(access.scope, j)).slice(-this.maxHistory));
  }
  intent(access: Access, id: string, request: Request): Job {
    this.authorize(access);
    if (!id || id.length > 255 || !['usd_micro', 'credit_milli', 'characters'].includes(request.unit) ||
        !Array.isArray(request.inputs) || request.inputs.some(ref => !['artifact', 'run-media'].includes(ref.kind))) throw new Error('invalid_request');
    if (request.inputs.length && access.inputsAuthorized !== true) throw new Error('input_unavailable');
    const immutable = clone(request);
    if (this.validate(immutable) !== true) throw new Error('invalid_request');
    const binding = bindingOf(immutable);
    return this.transaction(access.scope.owner, access.scope.workspace, d => {
      const prior = d.jobs.find(j => j.id === id);
      if (prior) {
        if (!sameIntent(access.scope, prior) || prior.binding !== binding) throw new Error('intent_conflict');
        return prior;
      }
      if (d.jobs.length >= this.maxHistory) throw new Error('history_capacity');
      const at = this.now();
      const job: Job = { id, scope: clone(access.scope), request: immutable, binding, at, updatedAt: at,
        state: 'waiting', waitReason: 'price_unavailable', outputs: [] };
      d.jobs.push(job); return job;
    });
  }
  beginEstimate(access: Access, id: string, available: boolean): Decision {
    this.authorize(access); if (!available) throw new Error('estimate_unavailable');
    return this.transaction(access.scope.owner, access.scope.workspace, d => {
      const job = this.owned(d, access, id);
      if (job.state !== 'waiting' || job.lease) throw new Error('intent_busy');
      job.lease = 'estimate'; job.quote = undefined; job.approval = undefined; job.ceilingException = undefined;
      job.waitReason = 'price_unavailable';
      return { job, continuation: this.token(job) };
    });
  }
  estimated(access: Access, token: Continuation, quote: Quote | null): Job {
    this.authorize(access);
    return this.continued(token, (d, job) => {
      this.owned(d, access, token.id);
      if (job.state !== 'waiting' || job.lease !== 'estimate' || bindingOf(job.request) !== token.binding) throw new Error('stale_estimate');
      job.quote = quote ? clone(quote) : undefined; job.lease = undefined;
      job.approval = undefined; job.ceilingException = undefined;
      job.waitReason = waitReason(d, job, this.now()); return job;
    });
  }
  estimateFailed(token: Continuation): Job {
    return this.continued(token, (_d, job) => {
      if (job.lease !== 'estimate') throw new Error('stale_continuation');
      job.lease = undefined; return job;
    });
  }
  approve(access: Access, id: string, maximum: Amount, ceilingException = false): Job {
    this.authorize(access);
    if (!access.scope.human || !validAmount(maximum)) throw new Error('owner_approval_required');
    return this.transaction(access.scope.owner, access.scope.workspace, d => {
      const job = this.owned(d, access, id);
      if (job.state !== 'waiting' || job.lease || quoteState(job.quote, job.binding, job.request.unit, this.now()) !== 'ready' ||
          maximum.unit !== job.quote!.unit || maximum.amount < job.quote!.amount) throw new Error('price_not_approvable');
      job.approval = clone(maximum); job.ceilingException = ceilingException;
      job.waitReason = waitReason(d, job, this.now()); return job;
    });
  }
  /** Backend-only setup from a host admission and real exact-input quote. No approval is fabricated. */
  prepareHost(access: Access, id: string, quote: Quote, admission: NonNullable<Job['hostAdmission']>): Job {
    this.authorize(access);
    return this.transaction(access.scope.owner, access.scope.workspace, d => {
      const job = this.owned(d, access, id);
      if (!sameIntent(access.scope, job) || job.state !== 'waiting' || job.lease || job.reservation ||
          job.hostAdmission || quoteState(quote, job.binding, job.request.unit, this.now()) !== 'ready' ||
          admission.deadlineMs <= this.now() || !/^[a-f0-9]{64}$/.test(admission.binding)) throw new Error('host_preparation_refused');
      job.quote = clone(quote); job.hostAdmission = clone(admission); job.waitReason = 'owner_confirmation';
      return job;
    });
  }
  /** Serialize and persist the full uncertainty BEFORE calling the synchronous host entry boundary. */
  beginHostEntry(access: Access, id: string): Continuation {
    this.authorize(access);
    return this.transaction(access.scope.owner, access.scope.workspace, d => {
      const job = this.owned(d, access, id), quote = job.quote;
      if (!sameIntent(access.scope, job) || job.state !== 'waiting' || job.lease || job.reservation || !job.hostAdmission ||
          job.hostAdmission.deadlineMs <= this.now() || quoteState(quote, job.binding, job.request.unit, this.now()) !== 'ready')
        throw new Error('host_entry_preflight_refused');
      const ceiling = d.ceilings[quote!.unit];
      const prior = d.jobs.reduce((sum, j) => sum + (j.reservation?.unit === quote!.unit ? j.reservation.amount : 0), 0);
      if (!Number.isSafeInteger(ceiling) || !Number.isSafeInteger(prior + quote!.amount) || prior + quote!.amount > ceiling!)
        throw new Error('aggregate_ceiling');
      job.reservation = { amount: quote!.amount, unit: quote!.unit }; job.accounting = 'unknown';
      job.state = 'starting'; job.phase = 'host_pending'; job.waitReason = undefined;
      return this.token(job);
    });
  }
  /** Only this attempt's post-enter definite non-entry evidence may release its pending marker. */
  hostEntryRefused(access: Access, token: Continuation, proof: HostNoEntryProof): Job {
    const receipt = consumeHostNoEntry(proof);
    this.authorize(access);
    return this.continued(token, (d, job) => {
      this.owned(d, access, token.id);
      if (!sameIntent(access.scope, job) || job.phase !== 'host_pending' || receipt.operation !== job.id ||
          receipt.scope.owner !== access.scope.owner || receipt.scope.workspace !== access.scope.workspace ||
          receipt.scope.plugin !== job.hostAdmission?.plugin || receipt.scope.team !== job.hostAdmission?.team ||
          canonical(receipt.origin) !== canonical(job.hostAdmission?.origin) || canonical(receipt.request) !== canonical(job.request) ||
          receipt.quote.binding !== job.hostAdmission?.binding || receipt.enteredAtMs !== null ||
          !['waiting_for_owner', 'approved_once', 'approved_budget', 'denied', 'expired_readmit_needed'].includes(receipt.state) ||
          receipt.quote.amount !== job.quote?.amount || receipt.quote.unit !== job.quote?.unit)
        throw new Error('host_nonentry_mismatch');
      return this.waiting(job);
    });
  }
  /** Only a fresh gate-issued host-enter return can cross this boundary. Saved/JSON receipts cannot. */
  enterHost(access: Access, id: string, proof: HostEntryProof): { job: Job; action: Submission } {
    const receipt = consumeHostEntry(proof);
    this.authorize(access);
    return this.transaction(access.scope.owner, access.scope.workspace, d => {
      const job = this.owned(d, access, id), admission = job.hostAdmission, quote = job.quote;
      const origin = receipt.origin;
      if (!sameIntent(access.scope, job) || job.state !== 'starting' || job.phase !== 'host_pending' || job.lease || !admission ||
          job.reservation?.amount !== quote?.amount || job.reservation?.unit !== quote?.unit || job.accounting !== 'unknown' ||
          receipt.state !== 'entered_unknown' || receipt.operation !== id || receipt.scope.plugin !== admission.plugin ||
          receipt.scope.team !== admission.team ||
          receipt.scope.owner !== access.scope.owner || receipt.scope.workspace !== access.scope.workspace ||
          origin.kind !== 'studio_agent' || origin.actor !== access.scope.actorId || canonical(origin) !== canonical(admission.origin) ||
          canonical(receipt.request) !== canonical(job.request) || receipt.quote.binding !== admission.binding ||
          quoteState(quote, job.binding, job.request.unit, this.now()) !== 'ready' ||
          receipt.quote.amount !== quote!.amount || receipt.quote.unit !== quote!.unit || receipt.quote.basis !== quote!.basis ||
          receipt.quote.tariffRevision !== quote!.tariffRevision || receipt.quote.issuedAt !== quote!.issuedAt ||
          receipt.quote.validUntilMs !== quote!.validUntilMs || admission.deadlineMs <= this.now() ||
          receipt.enteredAtMs === null || receipt.enteredAtMs < quote!.issuedAt || receipt.enteredAtMs > this.now())
        throw new Error('host_entry_mismatch');
      const ceiling = d.ceilings[quote!.unit];
      // Count every reservation, actor and run in this durable owner/workspace partition, across UTC days.
      const prior = d.jobs.reduce((sum, j) => sum + (j.reservation?.unit === quote!.unit ? j.reservation.amount : 0), 0);
      if (!Number.isSafeInteger(ceiling) || !Number.isSafeInteger(prior) || prior > ceiling!)
        throw new Error('aggregate_ceiling');
      job.reservation = { amount: quote!.amount, unit: quote!.unit }; job.accounting = 'unknown';
      job.state = 'starting'; job.phase = 'submitting'; job.waitReason = undefined;
      const continuation = this.token(job);
      return { job, action: { kind: this.kind, intentId: id, request: job.request, continuation } };
    });
  }
  beginStart(access: Access, id: string, outputAvailable: boolean): Decision {
    this.authorize(access);
    return this.transaction(access.scope.owner, access.scope.workspace, d => {
      const job = this.owned(d, access, id);
      if (job.state !== 'waiting') return { job };
      if (job.lease) throw new Error('intent_busy');
      job.waitReason = waitReason(d, job, this.now()); if (job.waitReason) return { job };
      if (!outputAvailable) throw new Error('output_storage_unavailable');
      job.state = 'starting'; job.phase = 'preflight'; job.lease = 'preflight';
      return { job, continuation: this.token(job) };
    });
  }
  reserve(access: Access, token: Continuation): Job {
    this.resumeAuthority(access, token, true);
    return this.continued(token, (d, job) => {
      if (job.phase !== 'preflight' || job.lease !== 'preflight' || bindingOf(job.request) !== token.binding) throw new Error('intent_conflict');
      job.waitReason = waitReason(d, job, this.now());
      if (job.waitReason) return this.waiting(job);
      job.reservation = { amount: job.quote!.amount, unit: job.quote!.unit }; job.accounting = 'reserved';
      job.phase = 'reserved'; job.lease = undefined; return job;
    });
  }
  /** Called synchronously at the host's last authorized boundary; returned action is dispatched without awaiting. */
  enter(access: Access, token: Continuation): { job: Job; action?: Submission } {
    this.resumeAuthority(access, token, true);
    return this.continued(token, (d, job) => {
      if (job.phase !== 'reserved' || bindingOf(job.request) !== token.binding) throw new Error('intent_conflict');
      job.waitReason = waitReason(d, job, this.now());
      if (job.waitReason) return { job: this.waiting(job) };
      job.phase = 'submitting'; if (this.kind === 'stream') job.state = 'generating';
      return { job, action: { kind: this.kind, intentId: job.id, request: job.request, continuation: token } };
    });
  }
  private waiting(job: Job): Job {
    job.state = 'waiting'; job.phase = undefined; job.lease = undefined; job.reservation = undefined; job.accounting = undefined; return job;
  }
  releasePreflight(token: Continuation): Job {
    return this.continued(token, (d, job) => {
      if (job.state === 'waiting' && !job.phase) return job;
      if (!['preflight', 'reserved'].includes(job.phase ?? '')) throw new Error('effect_already_entered');
      this.waiting(job); job.waitReason = waitReason(d, job, this.now()); return job;
    });
  }
  /** HOST receipt path: durable effect evidence must survive expiry of the initiating UI authority. */
  unknown(token: Continuation): Job {
    return this.continued(token, (_d, job) => {
      if (!['submitting', 'receipt'].includes(job.phase ?? '') && job.lease !== 'reconcile' && job.lease !== 'cancel') throw new Error('effect_not_entered');
      job.state = 'unknown'; job.accounting = 'unknown'; job.phase = undefined; job.lease = undefined; return job;
    });
  }
  observation(token: Continuation, receipt: Omit<Observation, 'outputs'>, deferFinish = false): { job: Job; saveOutputs: boolean } {
    return this.continued(token, (_d, job) => {
      if (job.phase !== 'submitting' && job.lease !== 'reconcile') throw new Error('effect_not_entered');
      if (!receipt.jobId || job.jobId && job.jobId !== receipt.jobId) {
        job.state = 'unknown'; job.accounting = 'unknown'; job.phase = undefined; job.lease = undefined;
        return { job, saveOutputs: false };
      }
      job.jobId = receipt.jobId; // Write once before output acquisition can fail.
      const { jobId: _id, ...header } = receipt;
      job.pendingReceipt = clone(header); job.phase = 'receipt';
      if (receipt.state !== 'generated' && !deferFinish) this.finish(job, []);
      return { job, saveOutputs: receipt.state === 'generated' };
    });
  }
  beginOutput(token: Continuation): Job {
    return this.continued(token, (_d, job) => {
      if (job.phase !== 'submitting' || this.kind === 'async') throw new Error('effect_not_entered');
      job.phase = 'receipt'; return job;
    });
  }
  complete(token: Continuation, artifacts: Artifact[]): Job {
    return this.continued(token, (_d, job) => {
      const outputsRequired = !job.pendingReceipt || job.pendingReceipt.state === 'generated';
      if (job.phase !== 'receipt' || outputsRequired && !artifacts.length || !outputsRequired && artifacts.length > 0 ||
          artifacts.length > 64 || artifacts.some(a => a.kind !== 'artifact' || !a.id || !a.contentType)) throw new Error('invalid_outputs');
      this.finish(job, artifacts); return job;
    });
  }
  private finish(job: Job, artifacts: Artifact[]) {
    const receipt = job.pendingReceipt;
    job.state = receipt?.state ?? 'generated'; job.outputs = clone(artifacts);
    job.providerState = receipt?.providerState;
    const progress = receipt?.progress;
    job.progress = typeof progress === 'number' && Number.isFinite(progress) && progress >= 0 && progress <= 1 ? progress : undefined;
    if (receipt?.charged && validAmount(receipt.charged) && receipt.charged.unit === job.request.unit) {
      job.reservation = clone(receipt.charged); job.accounting = 'spent';
    }
    job.phase = undefined; job.lease = undefined; job.pendingReceipt = undefined;
    if (['generated', 'failed', 'canceled'].includes(job.state)) job.cancelRequested = false;
  }
  beginReconcile(access: Access, id: string): Decision {
    this.authorize(access); if (this.kind !== 'async') throw new Error('reconcile_unavailable');
    return this.transaction(access.scope.owner, access.scope.workspace, d => {
      const job = this.owned(d, access, id);
      if (!job.jobId || job.lease || job.state === 'starting') throw new Error('reconcile_unavailable');
      job.lease = 'reconcile'; return { job, continuation: this.token(job) };
    });
  }
  beginCancel(access: Access, id: string, capabilities?: { queued: boolean; running: boolean }): Decision {
    this.authorize(access); if (this.kind !== 'async' || !capabilities) throw new Error('cancel_unavailable');
    return this.transaction(access.scope.owner, access.scope.workspace, d => {
      const job = this.owned(d, access, id);
      if (!job.jobId || job.lease || job.cancelRequested || !(job.state === 'queued' && capabilities.queued || job.state === 'generating' && capabilities.running)) throw new Error('cancel_unavailable');
      job.cancelRequested = true; job.lease = 'cancel'; return { job, continuation: this.token(job) };
    });
  }
  recover(access: Access): Job[] {
    this.authorize(access);
    return this.transaction(access.scope.owner, access.scope.workspace, d => {
      for (const job of d.jobs.filter(j => visible(access.scope, j))) {
        if (job.phase === 'preflight' || job.phase === 'reserved' || job.lease === 'preflight') {
          this.waiting(job); job.waitReason = waitReason(d, job, this.now()); job.epoch = (job.epoch ?? 0) + 1;
        } else if (job.phase || job.state === 'starting' || job.state === 'generating' && !job.jobId || job.lease === 'reconcile' || job.lease === 'cancel') {
          job.state = 'unknown'; job.accounting = 'unknown'; job.phase = undefined; job.pendingReceipt = undefined; job.epoch = (job.epoch ?? 0) + 1;
        }
        if (job.lease === 'estimate') job.epoch = (job.epoch ?? 0) + 1;
        job.lease = undefined;
      }
      return d.jobs.filter(j => visible(access.scope, j));
    });
  }
}
