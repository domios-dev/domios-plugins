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
  'Agent SurfaceCallContext has no workspace; MediaCore agent scope cannot be resolved.',
  'Binary transfer has no JSON request body with host-resolved secret credentials.',
  'jobs.admit is observation_only; no studio spend admission or approval linkage is supplied.',
  'Exact-input fresh account pricing and aggregate USD admission are not configured.',
  'Submission, output storage/media registration, reconciliation, cancellation and Scribe are unavailable.',
  'Comments, immutable revision resolution, Blueprint execution and agent media review are unavailable.',
];
export function runtimeStatus() {
  return { state: 'unavailable', paid: false, discovery: true, documentHistory: true,
    preparation: false, estimate: false, submission: false, limitations: runtimeLimitations };
}
