/** Existing selectable transcriber exports. Runtime wiring is refused until reviewed host ports are delivered.
 * HIG-11 owns manifest/min-host/bundle integration; no guessed SDK/binary/approval API is consumed here.
 */
export { createScribe } from './scribe';
export { ElevenLabsService } from './client';
export { createCommands } from './commands';
export { createBlueprint } from './blueprint';
import type { AgentCommandCtx } from '@codeterm/plugin-sdk';
import { verbs } from './commands';
declare const host: import('@codeterm/plugin-sdk').Host;
const plugin = {
  onAgentCommand(ctx: AgentCommandCtx) {
    if (!verbs.includes(ctx.verb as any) || ctx.args.length || (ctx.body?.length ?? 0)>24000) return {error:'invalid_arguments'};
    try {
      const response=JSON.parse(host.surface.call(ctx.verb,JSON.stringify(ctx.body ? [ctx.body] : [])));
      return typeof response.result==='string' ? {result:response.result} : {error:'surface_unavailable'};
    } catch { return {error:'surface_unavailable'}; }
  },
  onSurfaceCall() { return JSON.stringify({error:'secure_context_service_binding_unavailable'}); },
  viewCall() { return {error:'secure_context_service_binding_unavailable'}; },
  transcribeStatus() { return {state:'unavailable',reason:'Secure Scribe transport and approval binding are not configured.'}; },
  transcribe(_path: string, _lang?: string) { return {error:'Secure Scribe transport and approval binding are not configured.'}; },
};
export default plugin;
