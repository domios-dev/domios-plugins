import type { AgentCommandCtx, SurfaceCallContext, MediaFileContext } from '@codeterm/plugin-sdk';
import { HiggsfieldService } from './service';
import { HiggsfieldClient, usdMicro, requestUrl } from './client';
import { identity, receipt } from './response';
import { HiggsfieldCommands, describe, verbs } from './commands';
import { models, operations, revision, prepare } from './catalog';
import { documentAccess, hostStore, runtimeStatus, runtimeAvailable, HostMediaRuntime, bodyObject } from '../../media-shared/src/host-runtime';
import type { RuntimeHost } from '../../media-shared/src/host-runtime';
import type { Access, Continuation } from '../../media-shared/src/contracts';
const operation = 'higgsfield-ai/soul/v2/standard';
const origin = 'https://api.higgsfield.ai';
const credential = { kind: 'secret' as const, name: 'higgsfield-api-key', header: 'Authorization', prefix: 'Key ' };
export function createRuntime(input: import('@codeterm/plugin-sdk').Host) {
  const host = input as RuntimeHost;
  const service = new HiggsfieldService({ store: hostStore(host, 'higgsfield'), now: () => host.unixNowMs(), maxHistory: 100, client: new HiggsfieldClient() });
  const runtime = new HostMediaRuntime(host, 'higgsfield', service.core);
  const commands = new HiggsfieldCommands(service, { surface: host.surface, now: () => host.unixNowMs(),
    access: c => documentAccess('higgsfield', c), identity: () => { throw new Error('host_intent_unavailable'); } });
  const status = () => ({ ...runtimeStatus(), state: runtimeAvailable(host) ? 'agent_runtime' : 'unavailable',
    estimate: runtimeAvailable(host), submission: runtimeAvailable(host), minimum: 'DEV build 550cb1cbcbc34ab484a5f199c56d5b564661daba only; public release unproved',
    operation, defaults: { resolution: '720p', aspect_ratio: '1:1', batch_size: 1, enhance_prompt: false, seed: 42 },
    output: 'Saved file/media when the authenticated receipt URL has an exact host network grant. Missing grant never regenerates.' });
  function receive(access: Access, token: Continuation, data: unknown): string {
    try {
      const normalized = identity(data);
      const observed = service.core.observation(token, normalized);
      if (!observed.saveOutputs) return JSON.stringify({ id: token.id, state: observed.job.state, providerId: observed.job.jobId, next: 'reconcile with this id; never resubmit' });
      const full = receipt(data, () => true);
      if (full.assets.length !== 1 || full.assets[0].kind !== 'images') throw new Error('single_image_receipt_required');
      const url = full.assets[0].url;
      const match = /\.(png|jpe?g|webp)(?:\?|$)/i.exec(url);
      if (!match) throw new Error('output_content_type_unavailable');
      const contentType = match[1].toLowerCase() === 'png' ? 'image/png' : match[1].toLowerCase() === 'webp' ? 'image/webp' : 'image/jpeg';
      // Output URL comes only from the authenticated provider receipt; no API credential is forwarded.
      return runtime.transfer({ url, method: 'GET', response: { kind: 'file', fileName: 'cover.' + match[1].toLowerCase(), contentType, maxBytes: 8 * 1024 * 1024, statuses: [200] }, timeoutMs: 30000 }, result => {
        if ('error' in result || result.kind !== 'file') {
          service.core.unknown(token);
          return JSON.stringify({ id: token.id, state: 'unknown', providerId: normalized.jobId, error: 'output_acquisition_unavailable',
            next: 'Grant the exact noncredential output hostname through supported plugin permissions, then reconcile this same id FREE. Never regenerate.',
            outputHost: /^https:\/\/([^/?#]+)\//.exec(url)?.[1] ?? null, transport: 'error' in result ? result.error : 'invalid_response', noReplay: true });
        }
        const media = runtime.save(access, token.id, result.file);
        service.core.complete(token, [{ kind: 'artifact', id: media, contentType }]);
        return JSON.stringify({ id: token.id, state: 'generated', providerId: normalized.jobId, media, file: host.dataDir() + '/higgsfield/' + result.file.path, noReplay: true });
      });
    } catch {
      service.core.unknown(token);
      return JSON.stringify({ id: token.id, state: 'unknown', error: 'receipt_or_output_unavailable', noReplay: true, next: 'Use status/reconcile on this id. Never submit another job to recover output.' });
    }
  }
  return {
    onAgentCommand(ctx: AgentCommandCtx) {
      if (![...verbs, 'status'].includes(ctx.verb as any) || ctx.args.length || (ctx.body?.length ?? 0) > 1800) return { error: 'invalid_arguments' };
      return host.surface.dispatch(ctx.verb, ctx.body ? [ctx.body] : []);
    },
    onSurfaceCall(context: SurfaceCallContext, verb: string, args: string[]) {
      try {
        if (context.owner !== context.actor) throw new Error('request_refused');
        if (verb === 'describe') { const b = bodyObject(args, ['operation']); return JSON.stringify(describe(b.operation)); }
        if (verb === 'catalog') { bodyObject(args, []); return JSON.stringify({ revision, models: models.map(m => ({ id: m.id, category: m.category })), operations: operations.map(o => ({ id: o.id })), runtime: status() }); }
        if (verb === 'open' || verb === 'close') { bodyObject(args, []); return JSON.stringify({ acknowledged: verb }); }
        if (verb === 'status' && !args.length) return JSON.stringify(status());
        if (!runtimeAvailable(host)) return JSON.stringify({ ...status(), error: 'runtime_unavailable', paid: false });
        if (verb === 'prepare') {
          const b = bodyObject(args, ['prompt', 'aspect_ratio', 'seed']);
          if (typeof b.prompt !== 'string' || !b.prompt.trim() || b.prompt.length > 1000) throw new Error('prompt_required_max_1000');
          const request = prepare(operation, { prompt: b.prompt, resolution: '720p', aspect_ratio: b.aspect_ratio ?? '1:1', batch_size: 1, enhance_prompt: false, seed: b.seed ?? 42 });
          return runtime.prepare(context, request, (binding, then) => runtime.transfer({ url: origin + '/estimate/' + operation, method: 'POST', credential,
            body: { kind: 'json', value: request.params }, response: { kind: 'json', maxBytes: 16384, statuses: [200] }, timeoutMs: 15000 }, result => {
            if ('error' in result || result.kind !== 'json') return JSON.stringify({ error: 'price_unavailable', paid: false, next: 'Check credential/grant and prepare again; no generation was submitted.' });
            const amount = usdMicro((result.data as any)?.usd), now = host.unixNowMs();
            if (!amount || amount > 1000000) return JSON.stringify({ error: 'price_unavailable_or_over_USD1_scope_cap', paid: false });
            return then({ binding, amount, unit: 'usd_micro', safe: true, basis: 'Authenticated same-input Higgsfield /estimate USD; local freshness 120 seconds.', tariffRevision: 'estimate-sha256:' + result.sha256, issuedAt: now, validUntilMs: now + 120000 });
          }));
        }
        if (['status', 'result'].includes(verb)) { const b = bodyObject(args, ['id']); return JSON.stringify(runtime.result(context, b.id)); }
        if (verb === 'submit') {
          const b = bodyObject(args, ['id']);
          return runtime.submit(context, b.id, (job, token) => runtime.transfer({ url: origin + '/' + operation, method: 'POST', credential,
            headers: { 'Idempotency-Key': job.id }, body: { kind: 'json', value: job.request.params }, response: { kind: 'json', maxBytes: 65536, statuses: [200, 201, 202] }, timeoutMs: 30000 }, result => {
            if ('error' in result || result.kind !== 'json') { service.core.unknown(token); return JSON.stringify({ id: job.id, state: 'unknown', noReplay: true, error: 'submission_unconfirmed', next: 'Never resubmit. Reconcile only if a provider ID is known.' }); }
            return receive({ current: true, inputsAuthorized: true, scope: job.scope }, token, result.data);
          }));
        }
        if (verb === 'reconcile') {
          const b = bodyObject(args, ['id']), current = runtime.current(context, b.id);
          if (!current.job.jobId) throw new Error('provider_id_unknown_noReplay');
          const decision = service.core.beginReconcile(current.access, b.id), token = decision.continuation!;
          return runtime.transfer({ url: requestUrl(current.job.jobId, 'status'), method: 'GET', credential,
            response: { kind: 'json', maxBytes: 65536, statuses: [200] }, timeoutMs: 15000 }, result => {
            if ('error' in result || result.kind !== 'json') { service.core.unknown(token); return JSON.stringify({ id: b.id, state: 'unknown', noReplay: true, error: 'status_read_unavailable' }); }
            return receive(current.access, token, result.data);
          });
        }
        return JSON.stringify({ error: 'operation_unavailable_in_runtime', paid: false });
      } catch (e) { return JSON.stringify({ error: e instanceof Error && /^[A-Za-z0-9_]+$/.test(e.message) ? e.message : 'request_refused', paid: false }); }
    },
    viewCall(method: string, args: unknown, context: any) { if (method === 'status') return status(); return commands.viewCall(method, args, context); },
    mediaFile(id: string, context: MediaFileContext) { return runtime.mediaFile(id, context); },
    // Monitoring is not registered until the provider identity is known; explicit reconcile is the real free lookup.
    jobReconcile(context: any) { return { job: context.job, state: 'unknown' }; },
  };
}
