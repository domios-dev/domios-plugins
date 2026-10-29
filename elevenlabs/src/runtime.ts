import type { AgentCommandCtx, Host, SurfaceCallContext } from '@codeterm/plugin-sdk';
import { ElevenLabsService } from './client';
import { createCommands, verbs } from './commands';
import { documentAccess, hostStore, runtimeStatus } from '../../media-shared/src/host-runtime';

export function createRuntime(host: Host) {
  const service = new ElevenLabsService({ store: hostStore(host, 'elevenlabs'), now: () => host.unixNowMs(),
    access: caller => documentAccess('elevenlabs', caller), permitted: () => false, maxHistory: 100, maxBytes: 8 * 1024 * 1024 });
  const commands = createCommands(service, { surface: host.surface, caller: c => c, now: () => host.unixNowMs(),
    nextIntent: () => { throw new Error('host_intent_unavailable'); } });
  return {
    onAgentCommand(ctx: AgentCommandCtx) {
      if (!verbs.includes(ctx.verb as any) || ctx.args.length || (ctx.body?.length ?? 0) > 24000)
        return { error: 'invalid_arguments' };
      return host.surface.dispatch(ctx.verb, ctx.body ? [ctx.body] : []);
    },
    onSurfaceCall(context: SurfaceCallContext, verb: string, args: string[]) {
      if (verb === 'status' || verb === 'help') {
        if (context.owner !== context.actor || args.length) return JSON.stringify({ error: 'request_refused' });
        return JSON.stringify({ ...runtimeStatus(), verbs, structuredBody: true });
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
    mediaFile() { return null; },
    transcribeStatus() { return { state: 'unavailable', reason: 'Secure Scribe transport and approval binding are not configured.' }; },
    transcribe() { return { error: 'Secure Scribe transport and approval binding are not configured.' }; },
  };
}
