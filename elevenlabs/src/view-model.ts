/** Private authorized document projection. No new service, storage or effect policy. */
import type { Actor, Job, Json, Unit } from '../../media-shared/src/contracts';
import type { InputSchema, StudioItem } from '../../media-shared/ui/src/types';
import { actorLabel, activityLine, jobPrice, jobStatus } from '../../media-shared/src/presentation';
import { quoteState } from '../../media-shared/src/cost';
import { catalog, disposition, operation, revision, schemaFor, validateParameters } from './catalog';
import { pointer } from './schema';
import openapi from '../evidence/openapi.json';
import { utf8Size } from './client';
import type { ElevenLabsService } from './client';

export const uiBounds = { args:4096, snapshot:256*1024, details:64*1024, schema:128*1024, depth:12, fields:128 } as const;
export type UIUnavailable = { kind:'unavailable'; code:'arguments_refused'|'item_unavailable'|'schema_unsupported'|'schema_too_large'|'details_unsupported'|'details_too_large'|'snapshot_too_large'; message:string };
export type UIReference = { id:string; type:string; label:string; capability:'unavailable' };
export type AudioItem = StudioItem & { voiceLabel:string };
export type UISchema = { kind:'available'; operation:string; revision:string; schema:InputSchema; unavailable:string|null };
export type UIDetails = { kind:'available'; item:AudioItem; unit:Unit; params:Record<string,Json>; schema:InputSchema; inputs:UIReference[]; outputs:UIReference[] };
export type UISnapshot = { kind:'available'; items:AudioItem[]; offset:number; next:number|null; total:number; capacity:number|null;
  catalog:{id:string;label:string;unavailable:string|null}[]; activity:string[]; activitySummary?:string;
  voices:{kind:'unavailable';message:string}; capabilities:{estimate:boolean;submit:boolean;reconcile:boolean} };
export type UIResults = { 'ui.snapshot':UISnapshot|UIUnavailable; 'ui.details':UIDetails|UIUnavailable; 'ui.schema':UISchema|UIUnavailable };
export type UIArgs = { 'ui.snapshot':{offset?:number;limit?:number}; 'ui.details':{id:string}; 'ui.schema':{operation:string} };
export const unavailable = (code:UIUnavailable['code']):UIUnavailable => ({kind:'unavailable',code,message:'This information is unavailable in this view.'});
export function jsonBytes(value:unknown) { const text=JSON.stringify(value); if(text===undefined) throw new Error('encoding'); return utf8Size(text); }
function bounded<T>(value:T,max:number,code:UIUnavailable['code']):T|UIUnavailable { return jsonBytes(value)>max?unavailable(code):value; }
const opaque = (v:unknown):v is string => typeof v==='string' && /^[A-Za-z0-9_-]{1,255}$/.test(v);
const identifier = (v:unknown):v is string => typeof v==='string' && v.trim().length>0 && v.length<=255;
const copy = <T>(v:T):T => JSON.parse(JSON.stringify(v));
export function validateUIArgs(method:string,args:unknown):asserts args is Record<string,any> {
  const allowed = method==='ui.snapshot'?['offset','limit']:method==='ui.details'?['id']:method==='ui.schema'?['operation']:null;
  if(!allowed || !args || typeof args!=='object' || Array.isArray(args) || Object.keys(args).some(k=>!allowed.includes(k)) || jsonBytes(args)>uiBounds.args) throw new Error('arguments_refused');
  const a=args as any;
  const offset=a.offset===undefined?0:a.offset,limit=a.limit===undefined?20:a.limit;
  if(method==='ui.snapshot' && (!Number.isSafeInteger(offset) || offset<0 || !Number.isSafeInteger(limit) || limit<1 || limit>50)) throw new Error('arguments_refused');
  if(method==='ui.details' && !identifier(a.id) || method==='ui.schema' && !identifier(a.operation)) throw new Error('arguments_refused');
}
const annotations=new Set(['title','description','default','deprecated','readOnly','writeOnly','nullable']);
const scalars=new Set(['type','enum','const','required','additionalProperties','minItems','maxItems','uniqueItems','minLength','maxLength','pattern','minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf','format','minProperties','maxProperties']);
/** Preserve all executable constraints, expanding local references. Unknown rules/recursive or oversized schemas refuse. */
export function projectSchema(source:unknown):InputSchema|UIUnavailable {
  let fields=0;
  function walk(raw:any,depth:number,refs:Set<string>):any {
    if(depth>uiBounds.depth || !raw || typeof raw!=='object' || Array.isArray(raw)) throw new Error('unsupported');
    const out:Record<string,any>={};
    if(raw.$ref) {
      if(typeof raw.$ref!=='string' || !raw.$ref.startsWith('#/components/schemas/') || refs.has(raw.$ref)) throw new Error('unsupported');
      const next=new Set(refs); next.add(raw.$ref);
      const resolved=walk(pointer(openapi,raw.$ref),depth+1,next);
      const siblings=Object.fromEntries(Object.entries(raw).filter(([k])=>k!=='$ref'));
      return Object.keys(siblings).length?{allOf:[resolved,walk(siblings,depth+1,refs)]}:resolved;
    }
    for(const [key,value] of Object.entries(raw)) {
      if(annotations.has(key)||scalars.has(key)) {
        if(key==='additionalProperties' && value && typeof value==='object') out[key]=walk(value,depth+1,refs);
        else out[key]=copy(value);
      } else if(key==='properties') {
        if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('unsupported');
        const entries=Object.entries(value); fields+=entries.length;
        if(fields>uiBounds.fields || entries.some(([k])=>['__proto__','prototype','constructor'].includes(k) || /api.?key|secret|token|credential|authorization/i.test(k))) throw new Error('unsupported');
        out.properties=Object.fromEntries(entries.map(([k,v])=>[k,walk(v,depth+1,refs)]));
      } else if(key==='items'||key==='not') out[key]=walk(value,depth+1,refs);
      else if(['anyOf','oneOf','allOf'].includes(key)) {
        if(!Array.isArray(value)||value.length>128) throw new Error('unsupported');
        out[key]=value.map(v=>walk(v,depth+1,refs));
      } else if(!['example','examples','discriminator','embed'].includes(key) && !key.startsWith('x-')) throw new Error('unsupported');
    }
    return out;
  }
  try { return bounded(walk(source,0,new Set()),uiBounds.schema,'schema_too_large'); }
  catch { return unavailable('schema_unsupported'); }
}
export function selectedSchema(id:string):UISchema|UIUnavailable {
  const row=operation(id), source=schemaFor(row);
  if(!source) return unavailable('schema_unsupported');
  const properties:Record<string,any>={},required:string[]=[];
  for(const location of ['path','query']) {
    const declarations=(source.parameters??[]).map((p:any)=>p.$ref?pointer(openapi,p.$ref):p).filter((p:any)=>p.in===location);
    if(declarations.length) {
      properties[location]={type:'object',properties:Object.fromEntries(declarations.map((p:any)=>[p.name,p.schema])),required:declarations.filter((p:any)=>p.required).map((p:any)=>p.name)};
      if(properties[location].required.length) required.push(location);
    }
  }
  const content=source.requestBody?.content??{};
  const body=content['application/json']?.schema??content['multipart/form-data']?.schema??content['application/x-www-form-urlencoded']?.schema;
  if(body) {properties.body=body;if(source.requestBody.required)required.push('body');}
  const schema=projectSchema({type:'object',properties,required});
  if('kind' in schema) return schema as UIUnavailable;
  const limitation=disposition(row).limitation??(row.family==='transcriptions'?'Use the existing voice-note transcriber. Scribe integration is unavailable in this studio.':row.method==='GET'?'This read operation uses the existing command interface.':null);
  return bounded({kind:'available' as const,operation:id,revision,schema,unavailable:limitation},uiBounds.schema,'schema_too_large');
}
export function displayAmount(amount:number,unit:Unit):string {
  if(!Number.isSafeInteger(amount)||amount<0) throw new Error('invalid_amount');
  if(unit==='usd_micro') {
    const fraction=String(amount%1000000).padStart(6,'0').replace(/0+$/,'').padEnd(2,'0');
    return `$${Math.floor(amount/1000000)}.${fraction}`;
  }
  if(unit==='credit_milli') return `${Math.floor(amount/1000)}${amount%1000?'.'+String(amount%1000).padStart(3,'0').replace(/0+$/,''):''} credits`;
  return `${amount.toLocaleString('en-US')} ${amount===1?'character':'characters'}`;
}
export const modelNames:Record<string,string>={eleven_multilingual_v2:'Multilingual v2',eleven_v3:'Eleven v3',eleven_flash_v2:'Flash v2',eleven_flash_v2_5:'Flash v2.5'};
function documentActor(job:Job):Actor {
  const actor=copy(job.scope.actor);
  if(actor.kind!=='you') {
    if(typeof actor.label!=='string'||actor.label.length>120||actor.kind==='run' && (!actor.label.trim()||actor.label===actor.runId)) actor.label=actor.kind==='run'?'Pipeline run':'Agent';
  }
  return actor;
}
export function uiItem(job:Job,now:number):AudioItem {
  const params=job.request.params as any, actor=documentActor(job);
  const gate=jobPrice(job,now,{one:'character',other:'characters'});
  const price=gate.kind==='ready'?{...gate,text:displayAmount(gate.amount,job.request.unit)}:gate;
  const state=job.state==='waiting'?price.kind==='stale'?'price_stale':price.kind==='unavailable'?'price_unavailable':'waiting_ok':job.state;
  const quoted=job.quote && quoteState(job.quote,job.binding,job.request.unit,job.quote.issuedAt)==='ready'?job.quote:undefined;
  const charged=job.accounting==='spent'?job.reservation:undefined, cost=charged??quoted;
  return {id:job.id,operation:job.request.operation,title:typeof params.body?.text==='string'?params.body.text.slice(0,240):'Audio generation',
    at:job.at,actor,startedBy:actorLabel(actor),state,status:jobStatus(state,{cancelRequested:job.cancelRequested,elapsedMs:['starting','queued','generating'].includes(state)?Math.max(0,now-job.at):undefined}),
    price,priceTTL:price.kind==='ready'?Math.max(0,job.quote!.validUntilMs-now):0,outputs:job.outputs.filter(o=>opaque(o.id)).slice(0,50).map(o=>({kind:'artifact',id:o.id,contentType:o.contentType.slice(0,120)})),
    voiceLabel:'Voice details unavailable',modelLabel:modelNames[params.body?.model_id??'eleven_multilingual_v2']??'Model unavailable',
    activity:activityLine(actor,'prepared','an audio request'),recordedCost:cost?{...{amount:cost.amount,unit:cost.unit},text:displayAmount(cost.amount,cost.unit),kind:charged?'charged':'quoted'}:undefined};
}
function references(job:Job,which:'inputs'|'outputs'):UIReference[] {
  const values=which==='inputs'?job.request.inputs:job.outputs;
  if(values.length>50) throw new Error('unsupported');
  return values.map((v,n)=>{
    const id=v.kind==='run-media'?v.reference:v.id;
    if(!opaque(id)) throw new Error('unsupported');
    return {id,type:v.kind==='artifact'?v.contentType.slice(0,120):'run-media',label:`${which==='inputs'?'Reference':'Audio result'} ${n+1}`,capability:'unavailable'};
  });
}
export function documentUI(service:ElevenLabsService,caller:unknown,method:string,args:unknown,now:number):UIResults[keyof UIResults] {
  try {validateUIArgs(method,args===undefined?{}:args);} catch {return unavailable('arguments_refused');}
  // The SAME authorized service read is mandatory for all document methods, including schema.
  const history=service.history(caller), a=args as any??{};
  if(method==='ui.snapshot') {
    const offset=a.offset??0,limit=a.limit??20,sorted=[...history].sort((a,b)=>b.at-a.at||a.id.localeCompare(b.id));
    return bounded({kind:'available' as const,items:sorted.slice(offset,offset+limit).map(j=>uiItem(j,now)),offset,total:sorted.length,next:offset+limit<sorted.length?offset+limit:null,capacity:null,
      catalog:catalog().map(r=>({id:r.id,label:operation(r.id).title,unavailable:r.limitation})),activity:sorted.filter(j=>j.scope.actor.kind!=='you').slice(0,8).map(j=>uiItem(j,now).activity),
      voices:{kind:'unavailable' as const,message:'Voices unavailable in this view'},capabilities:{estimate:true,submit:false,reconcile:false}},uiBounds.snapshot,'snapshot_too_large');
  }
  if(method==='ui.schema') {try{return selectedSchema(a.operation);}catch{return unavailable('item_unavailable');}}
  const job=history.find(j=>j.id===a.id);
  if(!job) return unavailable('item_unavailable');
  if(jsonBytes(job.request.params)>uiBounds.details) return unavailable('details_too_large');
  try {
    const selected=selectedSchema(job.request.operation);
    if(selected.kind==='unavailable'||!validateParameters(operation(job.request.operation),job.request.params as any,job.request.inputs.length)) return unavailable('details_unsupported');
    return bounded({kind:'available' as const,item:uiItem(job,now),unit:job.request.unit,params:copy(job.request.params) as Record<string,Json>,schema:selected.schema,inputs:references(job,'inputs'),outputs:references(job,'outputs')},uiBounds.details,'details_too_large');
  }catch{return unavailable('details_unsupported');}
}
