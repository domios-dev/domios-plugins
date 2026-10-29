import { clone } from './contracts';
import type { Access, Adapter, Continuation, Job, Observation, Output, Ports, Request, Scope, Amount } from './contracts';
import { MediaCore } from './core';

/** Async fixture/UI driver only. QuickJS services import MediaCore and wire reviewed explicit continuations. */
export class MediaController {
  private readonly state?: MediaCore;
  constructor(private readonly ports: Ports, private readonly adapter: Adapter) {
    if (!Number.isSafeInteger(ports.maxHistory) || ports.maxHistory < 1 ||
        !Number.isSafeInteger(ports.maxOutputBytes) || ports.maxOutputBytes < 1) throw new Error('invalid_bounds');
    if (ports.store) this.state = new MediaCore(ports.store, ports.now, ports.maxHistory, adapter.kind, r => adapter.validate(r));
  }
  private async scope(caller: unknown): Promise<Scope> {
    const scope = await this.ports.authority?.resolve(caller);
    if (!scope || !scope.owner || !scope.workspace || !scope.actorId || !await this.ports.authority!.current(scope))
      throw new Error('authority_unavailable');
    if (!this.state) throw new Error('storage_unavailable');
    return clone(scope);
  }
  private async access(scope: Scope, inputsAuthorized = true): Promise<Access> {
    return { scope, current: await this.ports.authority!.current(scope), inputsAuthorized };
  }
  async history(caller: unknown): Promise<Job[]> {
    const scope = await this.scope(caller); return this.state!.history(await this.access(scope));
  }
  async intent(caller: unknown, id: string, request: Request): Promise<Job> {
    const scope = await this.scope(caller);
    const immutable = clone(request);
    if (!Array.isArray(immutable.inputs) || immutable.inputs.some(ref => !['artifact', 'run-media'].includes(ref.kind)) ||
        !this.adapter.validate(immutable)) throw new Error('invalid_request');
    const inputs = !immutable.inputs.length || !!this.ports.inputs && await this.ports.inputs.authorize(scope, immutable.inputs);
    return this.state!.intent(await this.access(scope, inputs), id, immutable);
  }
  async estimate(caller: unknown, id: string): Promise<Job> {
    const scope = await this.scope(caller);
    const decision = this.state!.beginEstimate(await this.access(scope), id, !!this.adapter.estimate);
    const token = decision.continuation!;
    try {
      const quote = await this.adapter.estimate!(clone(decision.job.request), decision.job.binding);
      return this.state!.estimated(await this.access(scope), token, quote);
    } catch {
      this.state!.estimateFailed(token); throw new Error('estimate_unavailable');
    }
  }
  async approve(caller: unknown, id: string, maximum: Amount, ceilingException = false): Promise<Job> {
    const scope = await this.scope(caller);
    return this.state!.approve(await this.access(scope), id, maximum, ceilingException);
  }
  async start(caller: unknown, id: string): Promise<Job> {
    const scope = await this.scope(caller);
    const claim = this.state!.beginStart(await this.access(scope), id, !!this.ports.outputs);
    if (!claim.continuation) return claim.job;
    const token = claim.continuation;
    let entered = false;
    try {
      const inputs = !claim.job.request.inputs.length || !!this.ports.inputs && await this.ports.inputs.authorize(claim.job.scope, claim.job.request.inputs);
      const reserved = this.state!.reserve(await this.access(scope, inputs), token);
      if (reserved.state === 'waiting') return reserved;
      // enter() synchronously rechecks the last host-resolved authority and freshness, then emits one action.
      const boundary = this.state!.enter(await this.access(scope, inputs), token);
      if (!boundary.action) return boundary.job;
      entered = true;
      const action = boundary.action;
      if (this.adapter.kind === 'async') return await this.observe(token, boundary.job, await this.adapter.submit(action.request, action.intentId));
      let outputs: Output[];
      if (this.adapter.kind === 'sync') outputs = await this.adapter.execute(action.request, action.intentId);
      else {
        const chunks: Uint8Array[] = []; let size = 0; let contentType: string | undefined;
        for await (const event of this.adapter.stream(action.request, action.intentId)) {
          if (contentType) throw new Error('stream_after_completion');
          if (event.kind === 'complete') contentType = event.contentType;
          else {
            size += event.bytes.byteLength;
            if (size > this.ports.maxOutputBytes) throw new Error('output_too_large');
            chunks.push(event.bytes.slice());
          }
        }
        if (!contentType || !size) throw new Error('incomplete_stream');
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        outputs = [{ bytes, contentType }];
      }
      this.state!.beginOutput(token);
      return this.state!.complete(token, await this.save(boundary.job, outputs));
    } catch (error) {
      if (entered) return this.state!.unknown(token);
      // Core cleanup is idempotent for refused preflight and refuses any submitted effect.
      this.state!.releasePreflight(token);
      throw error;
    }
  }
  private async save(job: Job, outputs: Output[]) {
    if (!outputs.length || outputs.length > 64) throw new Error('invalid_outputs');
    let bytes = 0; const saved = [];
    for (const output of outputs) {
      if ('bytes' in output) {
        bytes += output.bytes.byteLength;
        if (!output.bytes.byteLength || bytes > this.ports.maxOutputBytes) throw new Error('output_too_large');
      }
      saved.push(await this.ports.outputs!.save(job.scope, job.id, output));
    }
    return saved;
  }
  private async observe(token: Continuation, job: Job, receipt: Observation): Promise<Job> {
    const { outputs, ...header } = receipt;
    const decision = this.state!.observation(token, header);
    return decision.saveOutputs ? this.state!.complete(token, await this.save(job, outputs ?? [])) : decision.job;
  }
  async reconcile(caller: unknown, id: string): Promise<Job> {
    const scope = await this.scope(caller);
    const decision = this.state!.beginReconcile(await this.access(scope), id);
    const token = decision.continuation!;
    try {
      if (this.adapter.kind !== 'async') throw new Error('reconcile_unavailable');
      return await this.observe(token, decision.job, await this.adapter.inspect(decision.job.jobId!));
    } catch { return this.state!.unknown(token); }
  }
  async cancel(caller: unknown, id: string): Promise<Job> {
    const scope = await this.scope(caller);
    const cancellation = this.adapter.kind === 'async' ? this.adapter.cancel : undefined;
    const decision = this.state!.beginCancel(await this.access(scope), id, cancellation);
    try { await cancellation!.request(decision.job.jobId!); } catch { /* Request success is not confirmed cancellation. */ }
    return this.state!.unknown(decision.continuation!);
  }
  async recover(caller: unknown): Promise<Job[]> {
    const scope = await this.scope(caller); return this.state!.recover(await this.access(scope));
  }
}
