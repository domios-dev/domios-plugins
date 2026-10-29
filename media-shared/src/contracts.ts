/** Consumer contracts, not host SDK methods. Only trusted injected ports may construct scopes. */
export type Unit = 'usd_micro' | 'credit_milli' | 'characters';
export type Amount = { amount: number; unit: Unit };
export type Actor = { kind: 'you' } | { kind: 'agent'; label: string } | { kind: 'run'; label: string; runId: string };
export type Scope = {
  owner: string; workspace: string; actorId: string; actor: Actor; runId?: string;
  human: boolean; authRevision: string;
};
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Artifact = { kind: 'artifact'; id: string; contentType: string };
export type RunMedia = { kind: 'run-media'; reference: string };
export type Request = {
  operation: string; revision: string; params: Json; inputs: (Artifact | RunMedia)[]; unit: Unit;
};
export type Quote = Amount & {
  binding: string; safe: boolean; basis: string; tariffRevision: string;
  issuedAt: number; validUntilMs: number;
};
export type State = 'waiting' | 'starting' | 'queued' | 'generating' | 'generated' | 'failed' | 'canceled' | 'unknown';
export type WaitReason = 'price_unavailable' | 'price_stale' | 'owner_confirmation' | 'ceiling' | 'unknown_reservation';
export type Job = {
  id: string; scope: Scope; request: Request; binding: string; at: number; updatedAt: number;
  state: State; waitReason?: WaitReason; quote?: Quote; approval?: Amount;
  ceilingException?: boolean; jobId?: string; cancelRequested?: boolean;
  reservation?: Amount; accounting?: 'reserved' | 'unknown' | 'spent';
  outputs: Artifact[]; progress?: number; providerState?: string;
  lease?: 'preflight' | 'estimate' | 'reconcile' | 'cancel';
  phase?: 'preflight' | 'reserved' | 'submitting' | 'receipt';
  epoch?: number;
  hostAdmission?: { plugin: string; team: string | null; binding: string; deadlineMs: number; origin: unknown };
  savedFiles?: { id: string; path: string; contentType: string; fileName: string; size: number; sha256: string }[];
  pendingReceipt?: Omit<Observation, 'outputs' | 'jobId'>;
};
export type Partition = { jobs: Job[]; ceilings: Partial<Record<Unit, number>> };
/** Must be synchronous, durable, atomic and serialized across instances/processes for this owner/workspace. */
export interface JobStore {
  transact<T>(owner: string, workspace: string, edit: (data: Partition) => T): T;
}
/** Trusted HOST-resolved values for this synchronous transition, never UI-supplied authority. */
export type Access = { scope: Scope; current: boolean; inputsAuthorized?: boolean };
/** Persist in the host continuation, never use as a client authorization token or a host job id. */
export type Continuation = { owner: string; workspace: string; id: string; binding: string; epoch: number };
export type Decision = { job: Job; continuation?: Continuation };
export type Submission = { kind: 'async' | 'sync' | 'stream'; intentId: string; request: Request; continuation: Continuation };
/** Async fixture/UI driver port only; production passes fresh HOST-resolved Access to MediaCore. */
export interface Authority {
  resolve(caller: unknown): Promise<Scope | null>;
  current(scope: Scope): Promise<boolean>;
}
export type Binary = { bytes: Uint8Array; contentType: string };
export type Output = Artifact | Binary;
export type Observation = {
  jobId: string; state: 'queued' | 'generating' | 'generated' | 'failed' | 'canceled';
  providerState: string; outputs?: Output[]; progress?: number;
  /** Only exact provider billing evidence settles a reservation, including zero/refund. */
  charged?: Amount;
};
type BaseAdapter = {
  validate(request: Request): boolean;
  /** Must be effect-free; absence means there is no supported price refresh. */
  estimate?: (request: Request, binding: string) => Promise<Quote | null>;
};
export type Adapter = BaseAdapter & (
  | { kind: 'async'; submit(request: Request, intentId: string): Promise<Observation>;
      inspect(jobId: string): Promise<Observation>;
      cancel?: { queued: boolean; running: boolean; request(jobId: string): Promise<void> } }
  | { kind: 'sync'; execute(request: Request, intentId: string): Promise<Output[]> }
  | { kind: 'stream'; stream(request: Request, intentId: string): AsyncIterable<StreamEvent> }
);
export type StreamEvent = { kind: 'bytes'; bytes: Uint8Array } | { kind: 'complete'; contentType: string };
/** Saves/validates already-produced media; must not submit, cancel or reconcile work. */
export interface OutputStore {
  save(scope: Scope, intentId: string, output: Output): Promise<Artifact>;
}
/** Async driver ports, not a QuickJS export or a host SDK declaration. */
export type Ports = {
  authority?: Authority; store?: JobStore; outputs?: OutputStore; now(): number;
  maxHistory: number; maxOutputBytes: number;
  inputs?: { authorize(scope: Scope, inputs: Request['inputs']): Promise<boolean> };
};
export function bindingOf(request: Request): string {
  // Preserve omission/null and array order; adapter validation owns exact schema/default semantics.
  return JSON.stringify(request);
}
export function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
export function sameOwner(a: Scope, b: Scope): boolean {
  return a.owner === b.owner && a.workspace === b.workspace;
}
export function visible(scope: Scope, job: Job): boolean {
  return sameOwner(scope, job.scope) && (scope.human ||
    (scope.actorId === job.scope.actorId && scope.runId === job.scope.runId));
}
export function sameIntent(scope: Scope, job: Job): boolean {
  return sameOwner(scope, job.scope) && scope.actorId === job.scope.actorId && scope.runId === job.scope.runId;
}
