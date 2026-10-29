import type { Host, ViewCallContext } from '@codeterm/plugin-sdk';
import type { Access, JobStore, Partition } from './contracts';

/** Only the host-stamped document callback has a workspace in the delivered SDK.
 * A surface actor, local actor, or observation receipt grants no human spend authority. */
export function documentAccess(plugin: string, context: unknown): Access {
  const c = context as ViewCallContext;
  if (!c || c.plugin !== plugin || c.origin !== 'document' || c.actor?.kind !== 'local' ||
      ![c.owner, c.workspace, c.frame, c.surface, c.instance, c.tab].every(v => typeof v === 'string' && v.length > 0))
    throw new Error('trusted_document_workspace_required');
  return { current: true, inputsAuthorized: false, scope: {
    owner: c.owner!, workspace: c.workspace!, actorId: c.owner!,
    actor: { kind: 'agent', label: 'Studio owner' }, human: false, authRevision: c.frame!,
  } };
}

/** One bounded locked partition per owner/workspace in this plugin's confined data root.
 * Lock refusal is immediate. Missing/corrupt/unreadable existing data never becomes an empty ledger. */
export function hostStore(host: Host, plugin: string): JobStore {
  if (!/^[a-z][a-z0-9-]*$/.test(plugin)) throw new Error('invalid_plugin');
  const root = host.dataDir() + '/' + plugin + '/runtime';
  return { transact<T>(owner: string, workspace: string, edit: (data: Partition) => T): T {
    if (!owner || !workspace || !host.fs.makeDirs(root)) throw new Error('store_unavailable');
    const key = host.md5(JSON.stringify([owner, workspace]));
    if (!/^[a-f0-9]{32}$/.test(key)) throw new Error('store_unavailable');
    const path = root + '/' + key + '.json';
    const lock = host.fs.lockFile(path + '.lock');
    if (!lock) throw new Error('store_busy');
    try {
      const exists = host.fs.fileExists(path);
      const text = exists ? host.fs.readFileHead(path, 8 * 1024 * 1024 + 1) : null;
      if (exists && (text === null || text.length > 8 * 1024 * 1024)) throw new Error('store_unavailable');
      const envelope = exists ? JSON.parse(text!) : { owner, workspace, partition: { jobs: [], ceilings: {} } };
      if (envelope.owner !== owner || envelope.workspace !== workspace || !Array.isArray(envelope.partition?.jobs) ||
          !envelope.partition?.ceilings || typeof envelope.partition.ceilings !== 'object') throw new Error('store_corrupt');
      const result = edit(envelope.partition);
      const encoded = JSON.stringify(envelope);
      // UTF-16 length is bounded more strictly than the host UTF-8 read cap.
      if (encoded.length > 2 * 1024 * 1024 || !host.fs.writeFileAtomic(path, encoded)) throw new Error('store_write_unavailable');
      return result;
    } finally { host.fs.unlockFile(lock); }
  } };
}

export const runtimeLimitations = [
  'Production document generation stays unavailable; the minimum effect path is agent-owned.',
  'Only the exact DEV build 550cb1cbcbc34ab484a5f199c56d5b564661daba is targeted; public released minimum is unknown.',
  'Parent must serialize the independent aggregate USD2 proof inside shared USD5, including unknown reservations across days.',
  'Output downloads require an exact host grant and a verified response MIME; missing access never regenerates.',
  'ElevenLabs safe account tariff/prepaid no-overage guarantee, cancellation and Scribe remain unavailable.',
  'Comments, immutable revision resolution, Blueprint execution and agent media review are unavailable.',
];
export function runtimeStatus() {
  return { state: 'unavailable', paid: false, discovery: true, documentHistory: true,
    preparation: false, estimate: false, submission: false, limitations: runtimeLimitations };
}

// Runtime contracts deliberately target the merged DEV source rather than the old SDK junction.
import type { Host as DeliveredHost, SurfaceCallContext, MediaFileContext, TransferRequest, TransferResult, JobOriginReceipt, JobStatus } from '../../../codeterm/codeterm-worktrees/next-integ/packages/plugin-sdk/src/index';
import { MediaCore } from './core';
import { HostEntryGate, canonical } from './host-entry';
import type { Job, Request, Quote } from './contracts';
export type RuntimeHost = DeliveredHost;
export function runtimeAvailable(host: RuntimeHost): boolean {
  return ['admit', 'requestBinding', 'prepare', 'enter', 'status'].every(k => typeof (host.jobs as any)?.[k] === 'function') &&
    typeof host.transfer?.async === 'function';
}
export function agentAccess(plugin: string, context: SurfaceCallContext, receipt: JobOriginReceipt | JobStatus): Access {
  const { scope, origin } = receipt;
  if (!scope || scope.plugin !== plugin || !scope.workspace || scope.owner !== context.owner || context.owner !== context.actor ||
      origin?.kind !== 'studio_agent' || origin.actor !== context.actor || origin.surface !== context.surface ||
      origin.instance !== context.instance || origin.tab !== context.tab) throw new Error('trusted_agent_scope_required');
  return { current: true, inputsAuthorized: true, scope: { owner: scope.owner, workspace: scope.workspace, actorId: origin.actor,
    actor: { kind: 'agent', label: context.actorLabel }, human: false, authRevision: receipt.operation } };
}
export function bodyObject(args: string[], allowed: string[], max = 1800): any {
  if (args.length > 1 || (args[0]?.length ?? 0) > max) throw new Error('invalid_arguments');
  const body = args.length ? JSON.parse(args[0]) : {};
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !allowed.includes(k))) throw new Error('invalid_arguments');
  return body;
}
export class HostMediaRuntime {
  readonly store: JobStore;
  readonly gate: HostEntryGate;
  constructor(readonly host: RuntimeHost, readonly plugin: string, readonly core: MediaCore) {
    this.store = hostStore(host, plugin); this.gate = new HostEntryGate(host.jobs);
  }
  admit(context: SurfaceCallContext) {
    if (!runtimeAvailable(this.host)) throw new Error('runtime_unavailable_exact_DEV_build_required');
    const receipt = this.host.jobs.admit();
    if ('error' in receipt) throw new Error('host_admission_unavailable');
    return { receipt, access: agentAccess(this.plugin, context, receipt) };
  }
  current(context: SurfaceCallContext, id: string) {
    if (!/^[a-f0-9]{64}$/.test(id ?? '')) throw new Error('valid_job_id_required');
    const status = this.host.jobs.status(id);
    if ('error' in status) throw new Error('host_job_unavailable');
    const access = agentAccess(this.plugin, context, status);
    this.core.recover(access);
    const job = this.core.history(access).find(j => j.id === id);
    if (!job) throw new Error('job_unavailable');
    // A crash after host entry and before plugin persistence must also retain the full reservation.
    if (status.spend?.state === 'entered_unknown' && !job.reservation) {
      this.store.transact(access.scope.owner, access.scope.workspace, d => {
        const found = d.jobs.find(j => j.id === id)!;
        if (!found.quote || canonical(status.spend!.request) !== canonical(found.request) ||
            status.spend!.quote.amount !== found.quote.amount || status.spend!.quote.unit !== found.quote.unit)
          throw new Error('host_reservation_mismatch');
        found.reservation = { amount: found.quote.amount, unit: found.quote.unit }; found.accounting = 'unknown';
        found.state = 'unknown'; found.phase = undefined;
      });
    }
    return { status, access, job: this.core.history(access).find(j => j.id === id)! };
  }
  prepare(context: SurfaceCallContext, request: Request, quote: (binding: string, then: (q: Quote) => string) => string): string {
    const { receipt, access } = this.admit(context);
    if (JSON.stringify(request).length > 1800) throw new Error('request_too_large');
    const binding = this.host.jobs.requestBinding(request as any);
    if ('error' in binding) throw new Error('binding_unavailable');
    const job = this.core.intent(access, receipt.operation, request);
    // Fixed DEV per-plugin scope ceiling. Parent owns the independent shared two-vendor USD2/USD5 ledger.
    this.store.transact(access.scope.owner, access.scope.workspace, d => {
      d.ceilings.usd_micro = d.ceilings.usd_micro === undefined ? 1000000 : Math.min(d.ceilings.usd_micro, 1000000);
    });
    return quote(binding.binding, q => {
      const current = this.current(context, job.id);
      this.core.prepareHost(current.access, job.id, { ...q, binding: job.binding }, {
        plugin: this.plugin, team: receipt.scope.team, binding: binding.binding, deadlineMs: receipt.deadlineMs, origin: receipt.origin });
      const approval = this.host.jobs.prepare(job.id, request as any, { binding: binding.binding, amount: q.amount, unit: q.unit,
        basis: q.basis, tariffRevision: q.tariffRevision, issuedAt: q.issuedAt, validUntilMs: q.validUntilMs });
      if ('error' in approval) throw new Error('host_quote_preparation_refused');
      return JSON.stringify({ id: job.id, state: approval.state, quote: q, deadlineMs: receipt.deadlineMs,
        next: 'Owner approves the host question; then submit/generate with this id. Expiry requires fresh prepare.' });
    });
  }
  submit(context: SurfaceCallContext, id: string, send: (job: Job, token: import('./contracts').Continuation) => string): string {
    const { job, access, status } = this.current(context, id);
    if (job.state !== 'waiting' || job.reservation || !job.quote || !job.hostAdmission || status.spend?.state === 'entered_unknown')
      throw new Error('noReplay_use_status_or_reconcile');
    const prior = this.core.history(access).reduce((n, j) => n + (j.reservation?.unit === job.quote!.unit ? j.reservation.amount : 0), 0);
    if (job.quote.unit !== 'usd_micro' || prior + job.quote.amount > 1000000) throw new Error('aggregate_ceiling');
    const proof = this.gate.enter(id, job.request as any);
    if ('state' in proof) return JSON.stringify({ id, state: proof.state, next: proof.state === 'expired_readmit_needed' ? 'Prepare again for a fresh quote and host approval.' : 'Await the host owner decision.' });
    const entered = this.core.enterHost(access, id, proof);
    // No await/scheduling gap or public receipt injection exists between fresh enter, durable persistence and dispatch.
    try { return send(entered.job, entered.action.continuation); }
    catch { this.core.unknown(entered.action.continuation); throw new Error('submission_unknown_noReplay'); }
  }
  transfer(request: TransferRequest, then: (result: TransferResult) => string): string {
    return this.host.transfer.async(request, then);
  }
  save(access: Access, id: string, file: any): string {
    if (!file || !/^[a-zA-Z0-9_.-]+$/.test(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) ||
        !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 8 * 1024 * 1024 ||
        !['image/png', 'image/jpeg', 'image/webp', 'audio/mpeg'].includes(file.contentType)) throw new Error('invalid_saved_file');
    const media = this.host.md5(JSON.stringify([id, file.sha256]));
    this.store.transact(access.scope.owner, access.scope.workspace, d => {
      const job = d.jobs.find(j => j.id === id && j.scope.actorId === access.scope.actorId);
      if (!job) throw new Error('job_unavailable');
      job.savedFiles = [{ ...file, id: media }];
    });
    return media;
  }
  mediaFile(id: string, context: MediaFileContext) {
    try {
      if (context.origin !== 'document') return null;
      const access = documentAccess(this.plugin, context);
      const jobs = this.core.history(access);
      const file = jobs.flatMap(j => j.outputs.some(o => o.id === id) ? j.savedFiles ?? [] : []).find(f => f.id === id);
      return file ? { path: file.path, contentType: file.contentType as any, fileName: file.fileName } : null;
    } catch { return null; }
  }
  result(context: SurfaceCallContext, id: string) {
    const { job, status } = this.current(context, id);
    return { id, state: job.state, providerId: job.jobId ?? null, quote: job.quote ?? null, noReplay: !!job.reservation,
      accounting: job.accounting ?? null, reservation: job.reservation ?? null, hostState: status.spend?.state ?? null,
      outputs: job.outputs.map(o => {
        const f = job.savedFiles?.find(f => f.id === o.id);
        return { ...o, ...(f ? { file: this.host.dataDir() + '/' + this.plugin + '/' + f.path, size: f.size, sha256: f.sha256 } : {}) };
      }) };
  }
}
