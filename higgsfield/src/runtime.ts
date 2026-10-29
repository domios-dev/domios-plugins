import type { AgentCommandCtx, Host, SurfaceCallContext } from '@codeterm/plugin-sdk';
import { HiggsfieldService } from './service';
import { HiggsfieldClient } from './client';
import { HiggsfieldCommands, describe, verbs } from './commands';
import { models, operations, revision } from './catalog';
import { documentAccess, hostStore, runtimeStatus } from '../../media-shared/src/host-runtime';

export function createRuntime(host: Host) {
  const service = new HiggsfieldService({ store: hostStore(host, 'higgsfield'), now: () => host.unixNowMs(),
    maxHistory: 100, client: new HiggsfieldClient() });
  const commands = new HiggsfieldCommands(service, { surface: host.surface, now: () => host.unixNowMs(),
    access: c => documentAccess('higgsfield', c), identity: () => { throw new Error('host_intent_unavailable'); } });
  return {
    onAgentCommand(ctx: AgentCommandCtx) {
      if (![...verbs, 'status'].includes(ctx.verb as any) || ctx.args.length || (ctx.body?.length ?? 0) > 16000)
        return { error: 'invalid_arguments' };
      return host.surface.dispatch(ctx.verb, ctx.body ? [ctx.body] : []);
    },
    onSurfaceCall(context: SurfaceCallContext, verb: string, args: string[]) {
      try {
        if (context.owner !== context.actor || args.length > 1 || (args[0]?.length ?? 0) > 16000) throw new Error();
        const body = args.length ? JSON.parse(args[0]) : {};
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
        if (verb === 'describe' && Object.keys(body).length === 1 && typeof body.operation === 'string')
          return JSON.stringify(describe(body.operation));
        if (Object.keys(body).length) throw new Error();
        if (verb === 'catalog') return JSON.stringify({ revision, models: models.map(m => ({ id: m.id, category: m.category })),
          operations: operations.map(o => ({ id: o.id })), runtime: runtimeStatus() });
        if (verb === 'open' || verb === 'close') return JSON.stringify({ acknowledged: verb });
        return JSON.stringify(runtimeStatus());
      } catch { return JSON.stringify({ error: 'request_refused' }); }
    },
    viewCall(method: string, args: unknown, context: any) {
      if (method === 'status') return runtimeStatus();
      return commands.viewCall(method, args, context);
    },
    mediaFile() { return null; },
  };
}


