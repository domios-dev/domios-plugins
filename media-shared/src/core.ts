import { bindingOf, clone, sameIntent, visible } from './contracts';
import type { Access, Amount, Artifact, Continuation, Decision, Job, JobStore, Observation, Partition, Quote, Request, Submission } from './contracts';
import { quoteState, validAmount, waitReason } from './cost';

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
      job.state = 'unknown'; job.accounting = 'unknown'; job.phase = undefined; job.lease = undefined; job.cancelRequested = false; return job;
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
    if (job.state === 'canceled') job.cancelRequested = false;
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
