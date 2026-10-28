import { clone } from '../../src/contracts';
import type { Authority, JobStore, OutputStore, Partition, Ports, Request, Scope, Unit } from '../../src/contracts';

export function harness(maxHistory = 32) {
  let now = 1000;
  let live = true;
  const human: Scope = { owner: 'A', workspace: 'W', actorId: 'owner', actor: { kind: 'you' }, human: true, authRevision: '1' };
  const agent: Scope = { ...human, actorId: 'agent-1', actor: { kind: 'agent', label: 'Rex' }, human: false };
  const run: Scope = { ...agent, runId: 'run-1', actor: { kind: 'run', runId: 'run-1', label: 'Daily covers run #12' } };
  const tokens = new Map<unknown, Scope>();
  const caller = (scope: Scope) => { const token = {}; tokens.set(token, clone(scope)); return token; };
  const owner = caller(human); const agentCaller = caller(agent); const runCaller = caller(run);
  const authority: Authority = { resolve: async token => tokens.get(token) ?? null, current: async () => live };
  const partitions = new Map<string, Partition>();
  const data = (owner = 'A', workspace = 'W') => {
    const key = JSON.stringify([owner, workspace]);
    if (!partitions.has(key)) partitions.set(key, { jobs: [], ceilings: { usd_micro: 100, credit_milli: 200, characters: 300 } });
    return partitions.get(key)!;
  };
  // Synchronous edit on a cloned snapshot is atomic in this neutral in-memory fixture.
  // Production must supply durable transaction/locking, not reuse this fixture.
  const store: JobStore = { async transact(owner, workspace, edit) {
    const next = clone(data(owner, workspace));
    const result = edit(next);
    partitions.set(JSON.stringify([owner, workspace]), next);
    return result;
  } };
  const files = new Map<string, { scope: Scope; bytes: Uint8Array }>();
  let saves = 0;
  const outputs: OutputStore = { async save(scope, intent, output) {
    if ('kind' in output) {
      const file = files.get(output.id);
      if (!file || file.scope.owner !== scope.owner || file.scope.workspace !== scope.workspace) throw Error('foreign_file');
      return output;
    }
    const id = `${scope.owner}:${intent}:${++saves}`;
    files.set(id, { scope, bytes: output.bytes.slice() });
    return { kind: 'artifact', id, contentType: output.contentType };
  } };
  const ports: Ports = { authority, store, outputs, now: () => now, maxHistory, maxOutputBytes: 8,
    inputs: { async authorize(scope, inputs) { return inputs.every(ref => ref.kind === 'artifact' && files.get(ref.id)?.scope.owner === scope.owner); } } };
  return { ports, data, files, caller, owner, human, agent, agentCaller, run, runCaller,
    tick: (value: number) => { now = value; }, revoke: () => { live = false; }, now: () => now };
}
export function request(unit: Unit = 'usd_micro'): Request {
  return { operation: 'render', revision: '1', params: { prompt: 'a ceramic fox', count: 1 }, inputs: [], unit };
}
export function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
