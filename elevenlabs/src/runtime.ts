import type { AgentCommandCtx, Host, SurfaceCallContext } from '@codeterm/plugin-sdk';
import { ElevenLabsService } from './client';
import { createCommands, verbs } from './commands';
import { documentAccess, hostStore, runtimeStatus } from '../../media-shared/src/host-runtime';
import { bodyObject, runtimeAvailable, HostMediaRuntime } from '../../media-shared/src/host-runtime';
import type { RuntimeHost } from '../../media-shared/src/host-runtime';
import { MediaCore } from '../../media-shared/src/core';
import { validateRequest } from './catalog';
import { speechRequest } from './blueprint';

export function createRuntime(host: Host) {
  const delivered = host as RuntimeHost;
  const core = new MediaCore(hostStore(host, 'elevenlabs'), () => host.unixNowMs(), 100, 'sync', validateRequest);
  const runtime = new HostMediaRuntime(delivered, 'elevenlabs', core);
  const credential = { kind: 'secret' as const, name: 'elevenlabs-api-key', header: 'xi-api-key' };
  const liveVerbs = ['voices', 'live-models', 'account'];
  function live(verb: string, args: string[], agent = false): any {
    const done = (value: unknown): any => agent ? { result: JSON.stringify(value) } : JSON.stringify(value);
    bodyObject(args, []);
    if (!runtimeAvailable(delivered)) return done({ error: 'runtime_unavailable', paid: false });
    const path = verb === 'voices' ? '/v2/voices?page_size=20&include_total_count=false' : verb === 'live-models' ? '/v1/models' : '/v1/user/subscription';
    return runtime.transfer({ url: 'https://api.elevenlabs.io' + path, method: 'GET', credential,
      response: { kind: 'json', maxBytes: 262144, statuses: [200] }, timeoutMs: 15000 }, result => {
      if ('error' in result || result.kind !== 'json') return done({ error: 'account_read_unavailable', paid: false,
        reason: 'error' in result ? result.error : 'invalid_response', next: 'Check declared plugin credential and exact api.elevenlabs.io network grant.' });
      const value = result.data as any;
      // Return bounded useful metadata only. Never propagate arbitrary provider objects or settings.
      if (verb === 'voices') return done({ voices: (Array.isArray(value?.voices) ? value.voices : []).slice(0, 20).map((v: any) => ({
        id: v.voice_id, name: v.name, category: v.category, owned: v.is_owner ?? null, models: v.high_quality_base_model_ids,
        rate: v.sharing?.rate ?? null })), hasMore: value?.has_more === true, mutable: false });
      if (verb === 'live-models') return done({ models: (Array.isArray(value) ? value : []).slice(0, 30).map((m: any) => ({
        id: m.model_id, name: m.name, tts: m.can_do_text_to_speech, maxText: m.maximum_text_length_per_request,
        rates: m.model_rates, tokenCostFactor: m.token_cost_factor })), usdTariff: null });
      return done({ tier: value?.tier, currency: value?.currency ?? null, status: value?.status,
        used: value?.character_count, limit: value?.character_limit, maxCreditExtension: value?.max_credit_limit_extension,
        canExtend: value?.can_extend_character_limit, currentOverage: value?.current_overage,
        safeUsdTariff: false, autoTopUpPolicy: 'not exposed by this endpoint',
        missing: 'Exact model/voice USD upper tariff OR verified prepaid request with fail-closed quota, no overage and no auto top-up. Credit multipliers are not USD rates.' });
    });
  }
  const service = new ElevenLabsService({ store: hostStore(host, 'elevenlabs'), now: () => host.unixNowMs(),
    access: caller => documentAccess('elevenlabs', caller), permitted: () => false, maxHistory: 100, maxBytes: 8 * 1024 * 1024 });
  const commands = createCommands(service, { surface: host.surface, caller: c => c, now: () => host.unixNowMs(),
    nextIntent: () => { throw new Error('host_intent_unavailable'); } });
  return {
    onAgentCommand(ctx: AgentCommandCtx) {
      if (![...verbs, ...liveVerbs].includes(ctx.verb as any) || ctx.args.length || (ctx.body?.length ?? 0) > 1800)
        return { error: 'invalid_arguments' };
      if (liveVerbs.includes(ctx.verb)) {
        try { return live(ctx.verb, ctx.body ? [ctx.body] : [], true); }
        catch { return { error: 'account_read_refused' }; }
      }
      return host.surface.dispatch(ctx.verb, ctx.body ? [ctx.body] : []);
    },
    onSurfaceCall(context: SurfaceCallContext, verb: string, args: string[]) {
      if (context.owner !== context.actor) return JSON.stringify({ error: 'request_refused', paid: false });
      if (liveVerbs.includes(verb)) { try { return live(verb, args); } catch { return JSON.stringify({ error: 'account_read_refused', paid: false }); } }
      if (verb === 'prepare') {
        try {
          const b = bodyObject(args, ['voice', 'text', 'model']);
          if (typeof b.text !== 'string' || !b.text.trim() || b.text.length > 240) throw new Error();
          speechRequest({ voice: b.voice, text: b.text, model: b.model ?? 'eleven_multilingual_v2' });
          return JSON.stringify({ error: 'safe_pricing_unavailable', paid: false,
            next: 'Run account, live-models and voices (free reads). Obtain an account/model/voice-specific USD upper tariff or a guaranteed prepaid no-overage/no-auto-top-up request policy. Public base pricing and credit multipliers do not prove a USD bound.',
            defaults: { model: 'eleven_multilingual_v2', output: 'mp3_44100_128' }, maxText: 240 });
        } catch { return JSON.stringify({ error: 'invalid_arguments', paid: false }); }
      }
      if (['generate', 'result', 'inspect'].includes(verb) && runtimeAvailable(delivered)) {
        try {
          const b = bodyObject(args, ['id']);
          if (verb !== 'generate') return JSON.stringify(runtime.result(context, b.id));
          // No production preparation can currently supply a safe quote. This boundary cannot accept one from args.
          return runtime.submit(context, b.id, (job, token) => {
            if (job.request.operation !== 'text_to_speech_full') throw new Error('operation_unavailable');
            const params = job.request.params as any;
            if (!/^[A-Za-z0-9_-]{1,255}$/.test(params.path?.voice_id)) throw new Error('voice_required');
            return runtime.transfer({ url: 'https://api.elevenlabs.io/v1/text-to-speech/' + params.path.voice_id + '?output_format=mp3_44100_128',
              method: 'POST', credential, body: { kind: 'json', value: params.body },
              response: { kind: 'file', fileName: 'speech.mp3', contentType: 'audio/mpeg', maxBytes: 8 * 1024 * 1024, statuses: [200] }, timeoutMs: 30000 }, result => {
              if ('error' in result || result.kind !== 'file') { core.unknown(token); return JSON.stringify({ id: job.id, state: 'unknown', noReplay: true, error: 'speech_delivery_unconfirmed' }); }
              core.beginOutput(token);
              const media = runtime.save({ current: true, scope: job.scope }, job.id, result.file);
              core.complete(token, [{ kind: 'artifact', id: media, contentType: 'audio/mpeg' }]);
              return JSON.stringify({ id: job.id, state: 'generated', media, file: host.dataDir() + '/elevenlabs/' + result.file.path, noReplay: true });
            });
          });
        } catch { return JSON.stringify({ error: 'safe_prepared_job_required', paid: false, next: 'TTS is blocked until safe real pricing is established. No caller-supplied quote or approval is accepted.' }); }
      }
      if (verb === 'status' || verb === 'help') {
        if (context.owner !== context.actor || args.length) return JSON.stringify({ error: 'request_refused' });
        return JSON.stringify({ ...runtimeStatus(), verbs: [...verbs, ...liveVerbs], structuredBody: true, protectedReads: runtimeAvailable(delivered),
          pricingRequirement: 'Account-specific USD tariff or provider-guaranteed prepaid/no-overage request, with no auto top-up. Not proved.' });
      }
      if (['catalog', 'capabilities', 'models', 'describe', 'open', 'close'].includes(verb))
        return commands.onSurfaceCall(context, verb, args);
      return JSON.stringify({ error: 'runtime_unavailable', ...runtimeStatus() });
    },
    viewCall(method: string, args: unknown, context: unknown) {
      if (method === 'status') return runtimeStatus();
      const result = commands.viewCall(method, args, context);
      if (method === 'ui.snapshot' && result && typeof result === 'object' && 'capabilities' in result)
        return { ...result, capabilities: { estimate: false, submit: false, reconcile: false } };
      return result;
    },
    mediaFile(id?: string, context?: any) { return id && context ? runtime.mediaFile(id, context) : null; },
    jobReconcile(context: any) { return { job: context.job, state: 'unknown' }; },
    transcribeStatus() { return { state: 'unavailable', reason: 'Secure Scribe transport and approval binding are not configured.' }; },
    transcribe() { return { error: 'Secure Scribe transport and approval binding are not configured.' }; },
  };
}

