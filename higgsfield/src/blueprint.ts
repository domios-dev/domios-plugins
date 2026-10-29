import { models, operations, revision, prepare, limitation } from './catalog';
import { operationDisposition, HiggsfieldService } from './service';
import { publicJob } from './commands';
import type { Access, Job, Json, Request } from '../../media-shared/src/contracts';
import declared from '../adapter-contracts.json';
import { proofAllows } from './admission';
import type { ProofPort } from './admission';

export const outcomes = ['done', 'waiting', 'submitting', 'queued', 'generating', 'failed', 'canceled', 'unknown'] as const;
export const family = (category: string) => `higgsfield.generate-${category}`;
// SOURCE registry: exact JSON Schema constraints; NOT a claim that flat host NodeSchema
// supports anyOf/$defs/conditionals. No registration until Loom's reviewed nested-schema delivery.
export const stepContracts = declared.families.filter(f => f.category !== 'operation').map(({ category }) => ({
  contractVersion: 1, revision, id: family(category), title: `Higgsfield ${category}`,
  params: { dialect: 'json-schema-source-registry', closed: true,
    variants: models.filter(m => m.category === category).map(m => ({ operation: m.id, schema: m.schema, limitation: limitation(m.id) })) },
  inputs: [{ name: 'source', kind: 'file', minItems: 0, maxItems: 64, authority: 'durable-run-media-only' }],
  outputs: [{ name: 'result', kind: category === 'reference' ? 'json' : category, minItems: 0, maxItems: 64 }],
  outcomes, lifecycle: { reconcile: category !== 'reference', cancel: category !== 'reference' },
  effects: { sideEffects: true, potentiallyPaid: true }, cost: { unit: 'usd_micro', estimate: 'fresh-exact-binding', unknown: 'waiting' },
  registration: 'withheld: nested schemas, durable callbacks and authorized media review pending',
}));
export const metadataContract = {
  contractVersion: 1, revision, id: 'higgsfield.metadata',
  params: { dialect: 'json-schema-source-registry', closed: true, variants: operations.map(o => ({ operation: o.id, schema: o.schema, disposition: operationDisposition(o.id) })) },
  inputs: [], outputs: [{ name: 'result', kind: 'json', minItems: 0, maxItems: 1 }],
  outcomes: ['done', 'failed'], lifecycle: { reconcile: false, cancel: false },
  effects: { sideEffects: false, potentiallyPaid: false }, cost: { unit: 'usd_micro', amount: 0, basis: 'local discovery only; no vendor dispatch' },
  registration: 'withheld: safe metadata artifact transport and lifecycle job binding required',
};
export const blueprintContracts = [...stepContracts, metadataContract];
export type RunCall = { nodeType: string; revision: string; params: { operation: string; controls: Json } };
export type RunPorts = {
  // Separately host-resolved C context. Caller params have no owner/run/operation identity authority.
  resolve(context: unknown): { access: Access; operation: string } | null;
  inputs(context: unknown): Request['inputs'];
  now(): number;
  proof?: ProofPort;
  admit?: (service: HiggsfieldService, access: Access, id: string, action: 'submit' | 'reconcile' | 'cancel') => Job;
};
export class HiggsfieldBlueprint {
  constructor(readonly service: HiggsfieldService, private readonly ports: RunPorts) {}
  private bind(call: RunCall, context: unknown) {
    if (!call || Object.keys(call).some(k => !['nodeType', 'revision', 'params'].includes(k)) || call.revision !== revision ||
      !call.params || Object.keys(call.params).some(k => !['operation', 'controls'].includes(k))) throw new Error('invalid_step');
    const row = models.find(m => m.id === call.params.operation);
    if (!row || family(row.category) !== call.nodeType) throw new Error('invalid_step');
    const trusted = this.ports.resolve(context);
    if (!trusted || !trusted.access.current || trusted.access.scope.human || trusted.access.scope.actor.kind !== 'run' ||
      !trusted.access.scope.runId || trusted.access.scope.actor.runId !== trusted.access.scope.runId ||
      !/^[A-Za-z0-9_-]{1,255}$/.test(trusted.operation)) throw new Error('run_authority_unavailable');
    const inputs = this.ports.inputs(context);
    if (!Array.isArray(inputs) || inputs.length > 64 || inputs.some(i => i.kind !== 'run-media' ||
      Object.keys(i).some(k => !['kind', 'reference'].includes(k)) || !i.reference || /^[a-f0-9]{64}$/.test(i.reference))) throw new Error('durable_media_required');
    // Every supplied reference is resolved by the trusted input port, never by a frame/path/string in params.
    const request = prepare(row.id, call.params.controls, inputs);
    const job = this.service.intent(trusted.access, trusted.operation, request.operation, request.params, request.inputs);
    return { ...trusted, job };
  }
  estimate(call: RunCall, context: unknown) {
    const b = this.bind(call, context);
    try { return publicJob(this.service.estimate(b.access, b.operation), this.ports.now()); }
    catch { return { ...publicJob(b.job, this.ports.now()), error: 'estimate_unavailable' }; }
  }
  dispatch(call: RunCall, context: unknown, action: 'submit' | 'reconcile' | 'cancel') {
    if (!['submit', 'reconcile', 'cancel'].includes(action)) throw new Error('invalid_action');
    const b = this.bind(call, context);
    if (!this.ports.admit) return { outcome: 'waiting', reason: 'durable_admission_unavailable', job: publicJob(b.job, this.ports.now()) };
    if (action === 'submit' && !proofAllows(this.ports.proof, b.access, b.job)) return { outcome: 'waiting', reason: 'aggregate_approval_unavailable', job: publicJob(b.job, this.ports.now()) };
    const job = this.ports.admit(this.service, b.access, b.operation, action);
    const outcome = job.state === 'generated' ? 'done' : job.state === 'starting' ? 'submitting' : job.state;
    if (!outcomes.includes(outcome as typeof outcomes[number])) throw new Error('unknown_outcome');
    return { outcome, job: publicJob(job, this.ports.now()) };
  }
}
