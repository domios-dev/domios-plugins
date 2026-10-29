import { models, operations, revision, limitation, variation } from './catalog';
import { HiggsfieldService, operationDisposition, limitations } from './service';
import type { Access, Job, Json } from '../../media-shared/src/contracts';
import { quoteState } from '../../media-shared/src/cost';
import { proofAllows } from './admission';
import type { ProofPort } from './admission';
import { metadataPlan } from './client';
import type { AgentCommandCtx } from '@codeterm/plugin-sdk';

// Mirrors the captured A source contract. These are host arguments, never parsed from payloads.
export type SurfaceContext = { surface: string; instance: string; tab: string; owner: string; actor: string; actorLabel: string };
export type ViewContext = { plugin: string; origin: 'document' | 'remote_task' | 'recording_setup'; surface?: string;
  instance?: string; tab?: string; owner?: string; workspace?: string; team?: string; actor: { kind: 'local' }; frame?: string };
export const verbs = ['open', 'close', 'catalog', 'describe', 'prepare', 'rerun', 'estimate', 'usage', 'history', 'result', 'cancel', 'reconcile', 'submit', 'metadata'] as const;
export type Verb = typeof verbs[number];
export type CommandPorts = {
  surface: { call(verb: string, argsJson: string): string; invalidate(identity: { surface: string; instance: string; tab: string }): unknown };
  // Resolve against current host registration/authorization, including cross-owner delegation.
  // local does NOT mean human; trusted owner approval is a separate missing port.
  access(context: SurfaceContext | ViewContext, origin: 'surface' | 'view'): Access | null;
  identity(access: Access): string;
  now(): number;
  proof?: ProofPort;
  // Durable host admission only. Missing port refuses; a VM-local scheduler is insufficient.
  admit?: (service: HiggsfieldService, access: Access, id: string, action: 'submit' | 'cancel' | 'reconcile') => Job;
  // Bounded synchronous/continuation artifact projection, not raw provider activity.
  metadata?: (service: HiggsfieldService, access: Access, operation: string, params: Json) => { artifact: string };
};
const boundedId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,255}$/.test(v);
export const commandPayloadBytes = 16000;
const surfaceCallBytes = 32768;
// QuickJS has no TextEncoder global. Count UTF-8 bytes, including replacement of lone surrogates.
function withinUtf8(value: string, maximum: number): boolean {
  let bytes = 0;
  for (const point of value) {
    const n = point.codePointAt(0)!;
    bytes += n < 128 ? 1 : n < 2048 ? 2 : n < 65536 ? 3 : 4;
    if (bytes > maximum) return false;
  }
  return true;
}
function commandArgs(args: string[]): string[] {
  if (!Array.isArray(args) || args.length > 1 || args.some(a => typeof a !== 'string' || !withinUtf8(a, commandPayloadBytes)) ||
    !withinUtf8(JSON.stringify(args), surfaceCallBytes)) throw new Error('invalid_command');
  if (args.length) {
    const payload = JSON.parse(args[0]);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid_command');
  }
  return args;
}
function object(v: unknown, keys: string[], required: string[] = []): asserts v is Record<string, any> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k)) || required.some(k => !(k in v))) throw new Error('invalid_arguments');
}
export function publicJob(job: Job, now: number) {
  const price = quoteState(job.quote, job.binding, job.request.unit, now) === 'ready'
    ? { amount: job.quote!.amount, unit: job.quote!.unit } : null;
  // No provider body/URL, scope/frame/auth metadata, prompt, raw error, transport correlation or token.
  return { id: job.id, operation: job.request.operation, state: job.state, waitReason: job.waitReason ?? null,
    price, outputs: job.outputs.map(a => ({ kind: a.kind, id: a.id, contentType: a.contentType })) };
}
export function describe(id: string) {
  const row = models.find(m => m.id === id);
  if (row) return { id, revision, schema: row.schema, source: row.source, limitation: limitation(id), docs: row.source.url };
  const op = operations.find(o => o.id === id);
  if (op) return { id, revision, schema: op.schema, source: op.source, disposition: operationDisposition(id), docs: op.source.url };
  throw new Error('unknown_operation');
}
export class HiggsfieldCommands {
  constructor(readonly service: HiggsfieldService, private readonly ports: CommandPorts) {}
  onAgentCommand(ctx: AgentCommandCtx) {
    let args: string[];
    try {
      if (!verbs.includes(ctx.verb as Verb) || !Array.isArray(ctx.args) ||
        ctx.body !== undefined && (typeof ctx.body !== 'string' || ctx.args.length > 0)) throw new Error();
      args = commandArgs(ctx.body === undefined ? ctx.args : [ctx.body]);
    } catch { return { error: 'invalid_command' }; }
    // Host stamps caller; never forward sessionId, owner, actor, run or budget as arguments.
    try { const reply = JSON.parse(this.ports.surface.call(ctx.verb, JSON.stringify(args)));
      return typeof reply.result === 'string' ? { result: reply.result } : { error: 'surface_unavailable' };
    } catch { return { error: 'surface_unavailable' }; }
  }
  onSurfaceCall(context: SurfaceContext, verb: string, args: string[]): string {
    try {
      commandArgs(args);
      return JSON.stringify(this.execute(context, 'surface', verb, args.length ? JSON.parse(args[0]) : {}));
    } catch { return JSON.stringify({ error: 'command_refused' }); }
  }
  viewCall(method: string, args: unknown, context: ViewContext): unknown {
    try { return this.execute(context, 'view', method, args ?? {}); }
    catch { return { error: 'command_refused' }; }
  }
  private execute(context: SurfaceContext | ViewContext, origin: 'surface' | 'view', verb: string, args: unknown): unknown {
    if (!verbs.includes(verb as Verb)) throw new Error();
    const access = this.ports.access(context, origin);
    if (!access || !access.current) throw new Error();
    this.service.history(access); // All reads share the same service authorization.
    let changed = false, result: unknown;
    const job = (id: unknown) => {
      if (!boundedId(id)) throw new Error();
      const j = this.service.history(access).find(j => j.id === id); if (!j) throw new Error(); return j;
    };
    switch (verb) {
      case 'open': case 'close':
        object(args, []);
        if (origin !== 'surface') return { error: 'surface_lifecycle_unavailable' };
        return { acknowledged: verb }; // Authenticated host surface dispatch only; viewCall performs no lifecycle.
      case 'catalog': object(args, []); return { revision, models: models.map(m => ({ id: m.id, category: m.category, limitation: limitation(m.id) })),
        operations: operations.map(o => operationDisposition(o.id)), limitations };
      case 'describe': object(args, ['operation'], ['operation']); return describe(args.operation);
      case 'metadata': {
        object(args, ['operation', 'params'], ['operation', 'params']);
        const disposition = operationDisposition(args.operation);
        if (!disposition.available || ['requests.status', 'requests.cancel', 'estimate.model'].includes(args.operation)) throw new Error();
        metadataPlan(args.operation, args.params); // Validate finite route and exact schema before any injected dispatch.
        if (!this.ports.metadata) return { error: 'metadata_artifact_transport_unavailable', source: disposition.source };
        const result = this.ports.metadata(this.service, access, args.operation, args.params);
        if (!boundedId(result.artifact) || Object.keys(result).some(k => k !== 'artifact')) throw new Error();
        return result;
      }
      case 'prepare': {
        object(args, ['operation', 'params'], ['operation', 'params']);
        // Opaque media producer/handoff is not delivered; no caller-supplied frame/path/reference authority.
        const id = this.ports.identity(access); if (!boundedId(id)) throw new Error();
        result = publicJob(this.service.intent(access, id, args.operation, args.params as Json), this.ports.now()); changed = true; break;
      }
      case 'rerun': {
        object(args, ['id', 'changes'], ['id', 'changes']); object(args.changes, ['seed', 'batch_size']);
        const parent = job(args.id), request = variation(parent.request, args.changes);
        const id = this.ports.identity(access); if (!boundedId(id) || id === parent.id) throw new Error();
        result = { job: publicJob(this.service.intent(access, id, request.operation, request.params, request.inputs), this.ports.now()),
          parent: parent.id, lineage: 'preparation-only; durable host lineage pending' }; changed = true; break;
      }
      case 'usage': object(args, []); return this.service.usage(access);
      case 'history': object(args, []); return this.service.history(access).map(j => publicJob(j, this.ports.now()));
      case 'result': object(args, ['id'], ['id']); return publicJob(job(args.id), this.ports.now());
      case 'estimate': object(args, ['id'], ['id']); job(args.id); result = publicJob(this.service.estimate(access, args.id), this.ports.now()); changed = true; break;
      default: {
        object(args, ['id'], ['id']); const prior = job(args.id);
        if (!this.ports.admit) return { error: 'durable_admission_unavailable', job: publicJob(prior, this.ports.now()) };
        if (verb === 'submit' && !proofAllows(this.ports.proof, access, prior)) return { error: 'aggregate_approval_unavailable', job: publicJob(prior, this.ports.now()) };
        result = publicJob(this.ports.admit(this.service, access, prior.id, verb as 'submit' | 'cancel' | 'reconcile'), this.ports.now()); changed = true;
      }
    }
    if (changed && context.surface && context.instance && context.tab) {
      // Exactly one identity-only refresh hint per successful mutation. A hint is not a receipt.
      this.ports.surface.invalidate({ surface: context.surface, instance: context.instance, tab: context.tab });
    }
    return result;
  }
}
