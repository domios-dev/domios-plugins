import { bindingOf, clone, sameIntent, visible } from './contracts';
import type { Adapter, Amount, Job, Observation, Output, Partition, Ports, Request, Scope } from './contracts';
import { quoteState, validAmount, waitReason } from './cost';

/** A single effect journal for three distinct transports. No production routes are installed here. */
export class MediaController {
  constructor(private readonly ports: Ports, private readonly adapter: Adapter) {
    if (!Number.isSafeInteger(ports.maxHistory) || ports.maxHistory < 1 ||
        !Number.isSafeInteger(ports.maxOutputBytes) || ports.maxOutputBytes < 1) throw new Error('invalid_bounds');
  }
  private async scope(caller: unknown): Promise<Scope> {
    const scope = await this.ports.authority?.resolve(caller);
    if (!scope || !scope.owner || !scope.workspace || !scope.actorId || !await this.ports.authority!.current(scope))
      throw new Error('authority_unavailable');
    if (!this.ports.store) throw new Error('storage_unavailable');
    return clone(scope);
  }
  private async tx<T>(scope: Scope, edit: (data: Partition) => T): Promise<T> {
    if (!await this.ports.authority!.current(scope)) throw new Error('stale_authority');
    return this.ports.store!.transact(scope.owner, scope.workspace, edit);
  }
  private owned(data: Partition, scope: Scope, id: string): Job {
    const job = data.jobs.find(j => j.id === id && visible(scope, j));
    if (!job) throw new Error('job_unavailable');
    return job;
  }
  async history(caller: unknown): Promise<Job[]> {
    const scope = await this.scope(caller);
    return this.tx(scope, d => clone(d.jobs.filter(j => visible(scope, j)).slice(-this.ports.maxHistory)));
  }
  async intent(caller: unknown, id: string, request: Request): Promise<Job> {
    const scope = await this.scope(caller);
    const immutable = clone(request);
    if (!id || id.length > 255 || !['usd_micro', 'credit_milli', 'characters'].includes(immutable.unit) ||
        !Array.isArray(immutable.inputs) || immutable.inputs.some(ref => !['artifact', 'run-media'].includes(ref.kind)) ||
        !this.adapter.validate(immutable)) throw new Error('invalid_request');
    if (immutable.inputs.length && (!this.ports.inputs || !await this.ports.inputs.authorize(scope, immutable.inputs)))
      throw new Error('input_unavailable');
    const binding = bindingOf(immutable);
    return this.tx(scope, data => {
      const prior = data.jobs.find(j => j.id === id);
      if (prior) {
        if (!sameIntent(scope, prior) || prior.binding !== binding) throw new Error('intent_conflict');
        return clone(prior);
      }
      // Never evict an idempotency tombstone, reservation or run spend to make room.
      if (data.jobs.length >= this.ports.maxHistory) throw new Error('history_capacity');
      const at = this.ports.now();
      const job: Job = { id, scope, request: immutable, binding, at, updatedAt: at,
        state: 'waiting', waitReason: 'price_unavailable', outputs: [] };
      data.jobs.push(job);
      return clone(job);
    });
  }
  /** Free estimator only. A refresh never reserves, submits, reconciles or produces outputs. */
  async estimate(caller: unknown, id: string): Promise<Job> {
    const scope = await this.scope(caller);
    if (!this.adapter.estimate) throw new Error('estimate_unavailable');
    const job = await this.tx(scope, d => {
      const job = this.owned(d, scope, id);
      if (job.state !== 'waiting' || job.lease) throw new Error('intent_busy');
      job.lease = 'estimate';
      job.quote = undefined;
      job.approval = undefined;
      job.ceilingException = undefined;
      job.waitReason = 'price_unavailable';
      return clone(job);
    });
    let quote;
    try { quote = await this.adapter.estimate(clone(job.request), job.binding); }
    catch {
      await this.update(scope, id, j => { j.lease = undefined; });
      throw new Error('estimate_unavailable');
    }
    return this.tx(scope, d => {
      const current = this.owned(d, scope, id);
      if (current.state !== 'waiting' || current.binding !== job.binding) throw new Error('stale_estimate');
      current.quote = quote ? clone(quote) : undefined;
      current.lease = undefined;
      // Every new quote requires a separate owner action, even within the run ceiling.
      current.approval = undefined;
      current.ceilingException = undefined;
      current.waitReason = waitReason(d, current, this.ports.now());
      current.updatedAt = this.ports.now();
      return clone(current);
    });
  }
  async approve(caller: unknown, id: string, maximum: Amount, ceilingException = false): Promise<Job> {
    const scope = await this.scope(caller);
    if (!scope.human || !validAmount(maximum)) throw new Error('owner_approval_required');
    return this.tx(scope, d => {
      const job = this.owned(d, scope, id);
      if (job.state !== 'waiting' || job.lease || quoteState(job.quote, job.binding, job.request.unit, this.ports.now()) !== 'ready' ||
          maximum.unit !== job.quote!.unit || maximum.amount < job.quote!.amount) throw new Error('price_not_approvable');
      job.approval = clone(maximum);
      job.ceilingException = ceilingException;
      job.waitReason = waitReason(d, job, this.ports.now());
      return clone(job);
    });
  }
  async start(caller: unknown, id: string): Promise<Job> {
    const scope = await this.scope(caller);
    const claim = await this.tx(scope, d => {
      const job = this.owned(d, scope, id);
      if (job.state !== 'waiting') return { job: clone(job), execute: false };
      if (job.lease) throw new Error('intent_busy');
      job.waitReason = waitReason(d, job, this.ports.now());
      if (job.waitReason) return { job: clone(job), execute: false };
      if (!this.ports.outputs) throw new Error('output_storage_unavailable');
      job.state = 'starting';
      job.lease = 'preflight';
      job.updatedAt = this.ports.now();
      return { job: clone(job), execute: true };
    });
    if (!claim.execute) return claim.job;
    let job = claim.job;
    let entered = false;
    try {
      if (job.request.inputs.length && (!this.ports.inputs || !await this.ports.inputs.authorize(job.scope, job.request.inputs)))
        throw new Error('input_unavailable');
      const final = await this.tx(scope, d => {
        const current = this.owned(d, scope, id);
        if (current.state !== 'starting' || current.lease !== 'preflight' || current.binding !== job.binding ||
            bindingOf(current.request) !== job.binding) throw new Error('intent_conflict');
        current.waitReason = waitReason(d, current, this.ports.now());
        if (current.waitReason) {
          current.state = 'waiting'; current.lease = undefined;
          return { job: clone(current), execute: false };
        }
        current.reservation = { amount: current.quote!.amount, unit: current.quote!.unit };
        current.accounting = 'reserved';
        current.lease = undefined;
        if (this.adapter.kind === 'stream') current.state = 'generating';
        return { job: clone(current), execute: true };
      });
      if (!final.execute) return final.job;
      job = final.job;
      const effectRequest = clone(job.request);
      // Last awaited host preflight: no more awaits before the first paid adapter invocation.
      if (!await this.ports.authority!.current(scope)) throw new Error('stale_authority');
      if (bindingOf(effectRequest) !== job.binding || !job.approval || !validAmount(job.approval) ||
          job.approval.unit !== job.request.unit || job.approval.amount < job.quote!.amount) throw new Error('intent_conflict');
      if (quoteState(job.quote, job.binding, job.request.unit, this.ports.now()) !== 'ready')
        return this.releasePreflight(scope, id);
      // From here even a synchronous throw may mean an effect crossed the boundary. Never release it.
      entered = true;
      if (this.adapter.kind === 'async') {
        return await this.observe(scope, job, await this.adapter.submit(effectRequest, job.id));
      }
      let outputs: Output[];
      if (this.adapter.kind === 'sync') outputs = await this.adapter.execute(effectRequest, job.id);
      else {
        const chunks: Uint8Array[] = [];
        let size = 0;
        let contentType: string | undefined;
        for await (const event of this.adapter.stream(effectRequest, job.id)) {
          if (contentType) throw new Error('stream_after_completion');
          if (event.kind === 'complete') contentType = event.contentType;
          else {
            size += event.bytes.byteLength;
            if (size > this.ports.maxOutputBytes) throw new Error('output_too_large');
            chunks.push(event.bytes.slice());
          }
        }
        if (!contentType || !size) throw new Error('incomplete_stream');
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        outputs = [{ bytes, contentType }];
      }
      const saved = await this.save(scope, job, outputs);
      return await this.update(scope, id, j => { j.state = 'generated'; j.outputs = saved; });
      // Successful delivery alone does not prove billed amount; reservation remains until billing evidence.
    } catch (error) {
      if (!entered) {
        await this.releasePreflight(scope, id);
        throw error;
      }
      return this.update(scope, id, j => { j.state = 'unknown'; j.accounting = 'unknown'; });
    }
  }
  private async releasePreflight(scope: Scope, id: string): Promise<Job> {
    // Known non-entry: cleanup must survive revoked authority, without claiming a paid uncertainty.
    return this.ports.store!.transact(scope.owner, scope.workspace, d => {
      const job = this.owned(d, scope, id);
      job.state = 'waiting'; job.lease = undefined; job.reservation = undefined; job.accounting = undefined;
      job.waitReason = waitReason(d, job, this.ports.now()); job.updatedAt = this.ports.now();
      return clone(job);
    });
  }
  private async save(scope: Scope, job: Job, outputs: Output[]) {
    if (!outputs.length || outputs.length > 64) throw new Error('invalid_outputs');
    let bytes = 0;
    const saved = [];
    for (const output of outputs) {
      if ('bytes' in output) {
        bytes += output.bytes.byteLength;
        if (!output.bytes.byteLength || bytes > this.ports.maxOutputBytes) throw new Error('output_too_large');
      }
      saved.push(await this.ports.outputs!.save(job.scope, job.id, output));
    }
    return saved;
  }
  private async update(scope: Scope, id: string, apply: (job: Job) => void): Promise<Job> {
    // Effect receipts must persist even if the initiating frame/credential expires in flight.
    return this.ports.store!.transact(scope.owner, scope.workspace, d => {
      const job = this.owned(d, scope, id);
      apply(job); job.updatedAt = this.ports.now(); return clone(job);
    });
  }
  private async observe(scope: Scope, job: Job, receipt: Observation): Promise<Job> {
    if (!receipt.jobId || (job.jobId && job.jobId !== receipt.jobId))
      return this.update(scope, job.id, j => { j.state = 'unknown'; j.accounting = 'unknown'; });
    // Persist write-once identity before output acquisition can fail.
    const current = await this.update(scope, job.id, j => {
      if (j.jobId && j.jobId !== receipt.jobId) { j.state = 'unknown'; j.accounting = 'unknown'; return; }
      j.jobId = receipt.jobId;
    });
    if (current.jobId !== receipt.jobId) return current;
    const saved = receipt.state === 'generated' ? await this.save(scope, job, receipt.outputs ?? []) : [];
    return this.update(scope, job.id, j => {
      j.state = receipt.state; j.providerState = receipt.providerState; j.outputs = saved;
      j.progress = typeof receipt.progress === 'number' && Number.isFinite(receipt.progress) && receipt.progress >= 0 && receipt.progress <= 1
        ? receipt.progress : undefined;
      if (receipt.state === 'canceled') j.cancelRequested = false;
      if (receipt.charged && validAmount(receipt.charged) && receipt.charged.unit === j.request.unit) {
        j.reservation = clone(receipt.charged); j.accounting = 'spent';
      }
    });
  }
  /** Reconcile never invokes submit. A foreign/replaced job identity never becomes success. */
  async reconcile(caller: unknown, id: string): Promise<Job> {
    const scope = await this.scope(caller);
    if (this.adapter.kind !== 'async') throw new Error('reconcile_unavailable');
    const job = await this.tx(scope, d => {
      const j = this.owned(d, scope, id);
      if (!j.jobId || j.lease || j.state === 'starting') throw new Error('reconcile_unavailable');
      j.lease = 'reconcile'; return clone(j);
    });
    try {
      await this.observe(scope, job, await this.adapter.inspect(job.jobId!));
      return await this.update(scope, id, j => { j.lease = undefined; });
    } catch { return this.update(scope, id, j => { j.lease = undefined; j.state = 'unknown'; j.accounting = 'unknown'; }); }
  }
  async cancel(caller: unknown, id: string): Promise<Job> {
    const scope = await this.scope(caller);
    const cancellation = this.adapter.kind === 'async' ? this.adapter.cancel : undefined;
    if (!cancellation) throw new Error('cancel_unavailable');
    const job = await this.tx(scope, d => {
      const j = this.owned(d, scope, id);
      if (!j.jobId || j.lease || j.cancelRequested || !((j.state === 'queued' && cancellation.queued) || (j.state === 'generating' && cancellation.running)))
        throw new Error('cancel_unavailable');
      j.cancelRequested = true;
      j.lease = 'cancel';
      return clone(j);
    });
    try { await cancellation.request(job.jobId!); } catch { /* A transport error proves no cancellation. */ }
    return this.update(scope, id, j => { j.lease = undefined; j.state = 'unknown'; j.accounting = 'unknown'; j.cancelRequested = false; });
  }
  /** Host scheduler invokes after restart only; never resumes a paid transport. */
  async recover(caller: unknown): Promise<Job[]> {
    const scope = await this.scope(caller);
    return this.tx(scope, d => {
      for (const job of d.jobs.filter(j => visible(scope, j))) {
        if (job.lease === 'preflight') {
          job.state = 'waiting'; job.reservation = undefined; job.accounting = undefined;
          job.waitReason = waitReason(d, job, this.ports.now());
        } else if (job.state === 'starting' || job.state === 'generating' && !job.jobId || job.lease === 'cancel' || job.lease === 'reconcile') {
          job.state = 'unknown'; job.accounting = 'unknown';
        }
        job.lease = undefined;
      }
      return clone(d.jobs.filter(j => visible(scope, j)));
    });
  }
}
