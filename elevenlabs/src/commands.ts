import type { AgentCommandCtx, HostSurface, SurfaceCallContext } from '@codeterm/plugin-sdk';
import { ElevenLabsService, utf8Size } from './client';
import { catalog, modelCatalog, operation, disposition, revision, validateRequest } from './catalog';
import type { Job, Request } from '../../media-shared/src/contracts';

export const verbs = ['help','open','close','status','activity','catalog','capabilities','models','describe','estimate','usage','history','result','cancel','reconcile','prepare','rerun','generate','inspect','read'] as const;
export interface CommandPorts {
  surface: HostSurface;
  /** Host policy resolves each trusted context anew. Never construct scope from body/args. */
  caller(context: SurfaceCallContext | unknown): unknown;
  nextIntent(): string;
}
const keys = (v: any, allowed: string[]) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => allowed.includes(k));
function body(args: string[]) {
  if (args.length > 1 || args.some(a => typeof a !== 'string') || utf8Size(args[0] ?? '') > 24000) throw new Error('invalid_arguments');
  const value = args.length ? JSON.parse(args[0]) : {};
  if (!keys(value, ['id','operation','params','inputs','unit','offset','limit'])) throw new Error('invalid_arguments');
  return value;
}
/** No prompts, raw arguments, provider errors, credentials, owner metadata or backend paths. */
export function summary(job: Job) {
  return { id:job.id, operation:job.request.operation, state:job.state, waitReason:job.waitReason,
    at:job.at, updatedAt:job.updatedAt, outputs:job.outputs.length,
    actor:job.scope.actor.kind, runId:job.scope.runId,
    quote:job.quote ? {amount:job.quote.amount,unit:job.quote.unit,validUntilMs:job.quote.validUntilMs} : null };
}
export function createCommands(service: ElevenLabsService, ports: CommandPorts) {
  function execute(caller: unknown, verb: string, args: string[]) {
    const data = body(args);
    const expect = (fields: string[]) => { if (!keys(data,fields)) throw new Error('invalid_arguments'); };
    const job = () => {
      expect(['id']);
      if (typeof data.id !== 'string') throw new Error('invalid_arguments');
      const found = service.history(caller).find(j => j.id === data.id);
      if (!found) throw new Error('job_unavailable');
      return found;
    };
    switch (verb) {
      case 'help': expect([]); return {verbs,structuredBody:true,guide:'AGENTS.md',execution:'Unavailable until reviewed host continuation ports are delivered'};
      case 'open': case 'close': expect([]); return {ok:true}; // host.surface.call owns actual child creation/reuse/close
      case 'catalog': case 'capabilities': case 'models': {
        expect(['offset','limit']);
        const offset=data.offset ?? 0,limit=data.limit ?? 20;
        if (!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50) throw new Error('invalid_arguments');
        const rows=verb==='models' ? (()=>{const m=modelCatalog();return [...m.models.map(v=>({id:v.id,availability:v.availability,execution:v.execution})),
          ...m.display.map(v=>({id:v.id,availability:v.availability}))];})() : catalog().map(v=>({id:v.id,family:v.family,source:v.source,limitation:v.limitation}));
        return {total:rows.length,offset,items:rows.slice(offset,offset+limit),next:offset+limit<rows.length?offset+limit:null};
      }
      case 'describe': {
        expect(['operation']);const row=operation(data.operation),policy=disposition(row);
        return {id:row.id,family:row.family,sources:row.sources,schema:{file:row.schema.format==='openapi'?'evidence/openapi.json':'evidence/asyncapi.json',source_id:row.schema.source_id,pointer:row.schema.pointer},
          limitation:policy.limitation,parameterPolicy:policy.parameterPolicy,responsePolicy:policy.responsePolicy,prerequisites:policy.prerequisites};
      }
      case 'history': case 'activity': case 'status': expect([]); return service.history(caller).map(summary);
      case 'usage': expect([]); return service.ledger(caller);
      case 'inspect': return summary(job());
      case 'result': return {job:summary(job()),artifacts:job().outputs};
      case 'estimate': return summary(service.estimate(caller,job().id));
      case 'cancel': job(); return {error:'cancel_unavailable',reason:'This synchronous/stream service has no reviewed vendor cancellation port.'};
      case 'reconcile': job(); return {error:'reconcile_unavailable',reason:'Unknown effects remain held; no automatic replay or fabricated provider status.'};
      case 'generate': job(); return {error:'execution_unavailable',reason:'Durable host continuation and transport delivery required. No effect entered.'};
      case 'prepare': {
        expect(['operation','params','inputs','unit']);
        const request: Request = {operation:data.operation,revision,params:data.params,inputs:data.inputs ?? [],unit:data.unit ?? 'usd_micro'};
        if (!validateRequest(request)) throw new Error('invalid_request');
        return summary(service.intent(caller,ports.nextIntent(),request));
      }
      case 'rerun': {
        const old = job();
        return summary(service.intent(caller,ports.nextIntent(),old.request));
      }
      case 'read': {
        expect(['operation','params','inputs','unit']);
        const request: Request = {operation:data.operation,revision,params:data.params,inputs:data.inputs ?? [],unit:data.unit ?? 'usd_micro'};
        service.prepareRead(caller,request);
        return {error:'read_transport_unavailable',reason:'Validated read; host transport continuation is not installed.'};
      }
      default: throw new Error('command_unavailable');
    }
  }
  function safe(caller:unknown,verb:string,args:string[]) {
    try { return execute(caller,verb,args); } catch { return {error:'request_refused'}; }
  }
  return {
    onAgentCommand(ctx: AgentCommandCtx): {result:string}|{error:string} {
      if (!verbs.includes(ctx.verb as any) || ctx.args.length || utf8Size(ctx.body ?? '') > 24000) return {error:'invalid_arguments'};
      try {
        // Exact generic host path; it stamps context, creates/reuses own child, and enforces close policy.
        const response = JSON.parse(ports.surface.call(ctx.verb, JSON.stringify(ctx.body ? [ctx.body] : [])));
        return typeof response.result === 'string' ? {result:response.result} : {error:'surface_unavailable'};
      } catch { return {error:'surface_unavailable'}; }
    },
    onSurfaceCall(context:SurfaceCallContext,verb:string,args:string[]): string {
      let result:unknown;
      try {
        if (context.owner !== context.actor) throw new Error('delegation_unavailable');
        result = safe(ports.caller(context),verb,args);
        if (['prepare','rerun','estimate'].includes(verb) && !(result as any)?.error)
          ports.surface.invalidate({surface:context.surface,instance:context.instance,tab:context.tab});
      } catch { result = {error:'authority_unavailable'}; }
      return JSON.stringify(result);
    },
    /** Trusted document context is distinct from SurfaceCallContext. Resolver refuses absent/foreign/remote origins. */
    viewCall(method:string,args:unknown,context:unknown) {
      try { return safe(ports.caller(context),method,args === undefined ? [] : [JSON.stringify(args)]); }
      catch { return {error:'authority_unavailable'}; }
    },
  };
}
