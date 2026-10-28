// Offline, deterministic projection of the dated primary-source snapshot.
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const read=async p=>(await readFile(new URL(p,root),'utf8')).replace(/^\uFEFF/,'');
const json=async p=>JSON.parse(await read(p));
const save=async(p,x)=>writeFile(new URL(p,root),JSON.stringify(x,null,2)+'\n');
const hash=x=>createHash('sha256').update(x).digest('hex');
const date='2026-10-29';
const api=await json('evidence/openapi.json');
const asyncapi=await json('evidence/asyncapi.json');
const manifest=await json('evidence/page-manifest.json');
const pages=await Promise.all(manifest.map(async p=>({...p,text:await read('evidence/'+p.file)})));
const endpoint=t=>t.match(/^(GET|POST|PUT|PATCH|DELETE) (?:https:\/\/[^/\s]+)?(\/[^\s?]*)/m);
const refEscape=x=>x.replace(/~/g,'~0').replace(/\//g,'~1');
const sources=[];
for(const p of pages) sources.push({id:p.file,url:p.url,retrieved_at:p.retrieved_at,file:'evidence/'+p.file,sha256:p.sha256,title:p.title});
for(const [file,url] of [['openapi.json','https://api.elevenlabs.io/openapi.json'],['llms.txt','https://elevenlabs.io/docs/llms.txt'],['api-index.txt','https://elevenlabs.io/docs/api-reference/llms.txt'],['models.md','https://elevenlabs.io/docs/overview/models.md'],['pricing-browser.txt','https://elevenlabs.io/pricing/api']]){
  sources.push({id:file,url,retrieved_at:date,file:'evidence/'+file,sha256:hash(await readFile(new URL('evidence/'+file,root)))});
}
const sourceFor=p=>({url:p.url,retrieved_at:p.retrieved_at,source_id:p.file});
const catalog=pages.filter(p=>p.url.includes('/api-reference/'));
const byEndpoint=new Map();
for(const p of catalog){const m=endpoint(p.text);if(m){const key=m[1]+' '+m[2];byEndpoint.set(key,[...(byEndpoint.get(key)||[]),p]);}}
const sections=t=>[...t.matchAll(/^(#{2,4}) (.+)\r?\n([\s\S]*?)(?=^#{2,4} |$(?![\s\S]))/gm)].map(m=>({heading:m[2],text:m[3]}));
const statements=(text,pattern)=>text.split(/\r?\n/).filter(l=>pattern.test(l)).map(l=>l.trim()).filter(Boolean);
function documentedParameters(text){
 let location='unspecified';const out=[];let last;
 const lines=text.split(/\r?\n/);
 for(let i=0;i<lines.length;i++){
  const line=lines[i];if(/^## (Response|Errors|Types|Examples)/.test(line))break;
  const heading=line.match(/^### (.+)/);if(heading)location=heading[1];
  const field=line.match(/^- `([^`]+)` \(([^)]+)\)(?: — (.*))?/);
  if(field){last={name:field[1],location,documented_type:field[2],required:/(?:^|, )required(?:,|$)/.test(field[2]),description:field[3]||'',source_line:i+1};out.push(last);}
  else if(last&&/^  - Allowed values:/.test(line))last.enum_documentation=line.trim();
 }
 return out;
}
const familyOverview={voices:'/overview/capabilities/voices.md',flows:'/overview/capabilities/image-video.md',music:'/overview/capabilities/music.md',transcriptions:'/overview/capabilities/speech-to-text.md',studio:'/api-reference/studio-api-information.md'};
function family(path){
 if(path.includes('speech-to-text')||path.includes('forced-alignment'))return 'transcriptions';
 if(path.includes('/convai/')||path.startsWith('/v1/agents')||path.startsWith('/v1/realtime')) return 'agents';
 if(path.includes('text-to-speech')||path.includes('text-to-dialogue'))return 'speech';
 if(path.includes('speech-to-text')||path.includes('forced-alignment'))return 'transcriptions';
 if(path.includes('speech-engine'))return 'speech-engine';
 if(path.includes('voice')||path.includes('text-to-voice'))return 'voices';
 if(path.includes('music'))return 'music';
 if(path.includes('dubbing'))return 'dubbing';
 if(path.includes('pronunciation'))return 'dictionaries';
 if(path.includes('studio')||path.includes('projects')||path.includes('productions'))return 'studio';
 if(path.includes('/flows'))return 'flows';
 if(path.includes('workspace')||path.includes('/user')||path.includes('subscription'))return 'workspace';
 if(path.includes('history'))return 'history';
 if(path.includes('audio')||path.includes('sound'))return 'audio';
 if(path.includes('models'))return 'models';
 return 'administration';
}
const operations=[];
const catalogEntries=[];
const addOperation=(method,path,op,protocolOnly=false)=>{
 const key=method+' '+path;
 const docs=byEndpoint.get(key)||[];
 const p=docs.find(d=>!d.url.includes('/eleven-agents/api-reference/'))||docs[0];
 const id=protocolOnly?'ws:'+path:op.operationId;
 if(!id)throw Error('Missing source operationId '+key);
 const text=p?.text||op.description||'';
 const intro=text.split('## Types')[0];
 const f=family(path);
 const overview=familyOverview[f]?pages.find(d=>d.url.endsWith(familyOverview[f])):null;
 const protection=/voices|text-to-voice/.test(path)&&!['GET','HEAD'].includes(method)?'protected-voice-operation-owner-approval-required':'no-execution-authorized-in-research';
 const isStream=/\/stream(?:\/|$)|stream-input|\/upstream/.test(path)||/\bstreaming\b|server.sent.events/i.test(op.summary||'');
 const isAsync=/asynchronously|asynchronous|background job|processed.*background|queued/i.test(intro.split('## Response')[0]);
 const src=p?sourceFor(p):{url:'https://api.elevenlabs.io/openapi.json',retrieved_at:date,source_id:'openapi.json'};
 const protocolIndex=protocolOnly?asyncapi.documents.findIndex(d=>d.source_id===p.file):-1;
 if(protocolOnly&&protocolIndex<0)throw Error('Missing embedded AsyncAPI '+key);
 const protocolSpec=protocolOnly?asyncapi.documents[protocolIndex].spec:null;
 const schema=protocolOnly?{format:'asyncapi',source_id:p.file,snapshot_file:'evidence/asyncapi.json',pointer:'/documents/'+protocolIndex+'/spec',endpoint:key,message_operation_ids:Object.values(protocolSpec.channels).flatMap(c=>['publish','subscribe'].flatMap(k=>c[k]?.operationId?[c[k].operationId]:[])),parameters:protocolSpec.channels[path]?.bindings??null,defaults_and_limits:'Resolve full AsyncAPI message/component schema; source prose qualifications remain authoritative where stronger than schema.',sections:sections(text)}:{format:'openapi',source_id:'openapi.json',pointer:'/paths/'+refEscape(path)+'/'+method.toLowerCase(),parameters:op.parameters||[],requestBody:op.requestBody??null,responses:op.responses,security:op.security??api.security??[],defaults_and_limits:'Resolve the full referenced schema graph in evidence/openapi.json. Null/missing default means unspecified; do not invent one.',documentation_source_id:p?.file??null};
 schema.documented_parameters=documentedParameters(text);
 schema.documented_limits=statements(intro,/maximum|minimum|at most|must|cannot|only supported|limit|less than|between|up to|requires/i);
 const availabilityLines=statements(intro,/preview|experimental|deprecated|enterprise|only available|available.*plan|subscription|tier|permission|api.key|bearer|scope|access.*request/i);
 const rates=statements(intro,/billed|billable|credit|surcharge|pricing|cost|charged|price/i);
 const lifecycleLines=statements(intro,/asynchronous|webhook|cancel|status|progress|preview|stream|flush|close_socket|keep_alive|session|expire/i);
 const row={id,id_origin:protocolOnly?'documented-protocol-path':'vendor-openapi-operationId',method,path,family:f,title:op.summary||p?.title||id,sources:[src,...docs.filter(d=>d!==p).map(sourceFor)],schema,
 availability:{api:protocolOnly?'documented-websocket':'documented-http',stage:op.deprecated?'deprecated':'not-explicitly-guaranteed-GA',source:src,qualifications:availabilityLines,account_entitlement:'Not probed. API keys/scopes/plan/workspace and operation qualifications must be checked before use.'},
 authorization:{source:src,security:op.security??api.security??[],qualifications:availabilityLines,family_qualifications:overview?{source:sourceFor(overview),statements:statements(overview.text,/enterprise|paid plan|free tier|free plan|creator plan|pro plan|approval|permission|not available|restricted|only available|upon request/i)}:null,owner_policy:protection,credentials:'Backend-only plugin bucket; research never reads credentials.'},
 transport:{kind:protocolOnly?(path==='/speech-engine/upstream'?'websocket-upstream-server':'websocket'):isStream?'http-stream':'http',content_types:Object.keys(op.requestBody?.content||{}),response_types:[...new Set(Object.values(op.responses||{}).flatMap(v=>Object.keys(v.content||{})))],source:src},
 lifecycle:{mode:'defined-by-exact-source-response-and-protocol',extraction_hint:protocolOnly?'session':isAsync?'request-dependent-async-or-sync':isStream?'stream-response':'request-response',hint_status:'Lexical navigation aid, not a verified lifecycle assertion; exact response schema and documented statements govern. Priority workflows interpreted separately in contracts.json.',source:src,documented_statements:lifecycleLines,cancel:'Only a separately inventoried cancel/delete/session-control operation establishes semantics; disconnect/VM stop does not prove paid-job cancellation.',progress:'Only documented fields/events are evidence. Never infer percent or completion from elapsed time.',preview:'Only documented preview/audio responses; previews can incur cost.',reconcile:'Persist operation revision/params/input refs before submission; write-once vendor job identity; uncertain submission is unknown and never automatically replayed.'},
 cost:{status:rates.length?'documented-qualifications-base-rate-may-be-unknown':'unknown-operation-specific',source:src,statements:rates,pricing_source:'pricing-browser.txt',safe_estimate:{status:'not-established',authoritative_full_operation_estimate:false,documented_tariff_candidate:['speech','transcriptions','music','audio','dubbing','speech-engine'].includes(f),limitation:'A public advertised base tariff/LLM token estimate is not proof of a safe full operation estimate under the actual account tariff, exact input and expiry.'},permission:'No paid execution authorized. Missing/stale/unsafe price blocks paid studio and pipeline submission even if an owner offers approval. Require a fresh safe exact-operation estimate, then independent owner approval.'},
 coverage:{status:'proposed-not-implemented',command:'domios plugin elevenlabs '+f+' --operation '+id+' --input <validated-owned-json-reference>',blueprint:{descriptor:'elevenlabs.'+f,operation_enum:id,schema_binding:protocolOnly?{source_id:p.file}:{source_id:'openapi.json',pointer:schema.pointer},status:'blocked-external-closed-steps-contract',limitation:'Nested $ref/combinator/file/stream schemas need Loom closed schema support and opaque media references; no convert or arbitrary HTTP fallback.'},ui:{destination:'ElevenLabs owned surface / '+f+' / '+id,docs:p?.url??'https://api.elevenlabs.io/openapi.json',status:'proposed; Iris approval and delivered host contracts required'},dependencies:['trusted-view-context','binary-transport','typed-blueprint-steps','host-budget',...(f==='transcriptions'?['selectable-transcriber']:[]) ]}};
 operations.push(row);
 for(const d of docs) catalogEntries.push({source_id:d.file,url:d.url,retrieved_at:d.retrieved_at,operation_id:id,kind:'operation'});
};
for(const [path,item] of Object.entries(api.paths))for(const [method,op] of Object.entries(item))if(['get','post','put','patch','delete','head','options'].includes(method))addOperation(method.toUpperCase(),path,op);
for(const [key,docs] of byEndpoint){const [method,...rest]=key.split(' ');const path=rest.join(' ');if(!operations.some(o=>o.method===method&&o.path===path))addOperation(method,path,{summary:docs[0].title},true);}
for(const d of catalog.filter(p=>!endpoint(p.text)))catalogEntries.push({source_id:d.file,url:d.url,retrieved_at:d.retrieved_at,operation_id:null,kind:'guide',limitation:d.url.includes('studio-api')?'Studio API requires contact-sales access; no account permission assumed.':'Protocol/authentication introduction, not an operation.'});
operations.sort((a,b)=>a.id.localeCompare(b.id));
catalogEntries.sort((a,b)=>a.url.localeCompare(b.url));
const modelMap=new Map();
const modelDoc=await read('evidence/models.md');
const modelTable=modelDoc.slice(modelDoc.indexOf('## Models overview'),modelDoc.indexOf('## Eleven v4\n'));
for(const line of modelTable.split(/\r?\n/)){
 const m=line.match(/^\|\s*`([^`]+)`\s*\|([^|]+)\|/);
 if(m)modelMap.set(m[1],{id:m[1],description:m[2].trim(),sources:[{url:'https://elevenlabs.io/docs/overview/models.md',retrieved_at:date,source_id:'models.md'}],catalog_line:line,availability:modelTable.indexOf(line)>modelTable.indexOf('### Deprecated models')?'deprecated':'documented-catalog',schema_bindings:[]});
}
const modelEnumNames=new Set(['LLM','EmbeddingModelEnum','MusicModelID','RealtimeModel','SFXModelId','TTSConversationalModel','TurnModel','TTSModelFamily']);
function modelValues(node,doc,seen=new Set()){
 if(!node||typeof node!=='object')return [];
 if(node.$ref?.startsWith('#/')&&!seen.has(node.$ref)){
  seen.add(node.$ref);const target=node.$ref.slice(2).split('/').reduce((v,k)=>v?.[k.replace(/~1/g,'/').replace(/~0/g,'~')],doc);
  return modelValues(target,doc,seen);
 }
 return [...(node.enum||[]),...(typeof node.default==='string'?[node.default]:[]),...(typeof node.const==='string'?[node.const]:[]),...['anyOf','oneOf','allOf'].flatMap(k=>(node[k]||[]).flatMap(v=>modelValues(v,doc,seen)))];
}
function scanModels(x,pointer='',doc=api,sourceId='openapi.json',sourceUrl='https://api.elevenlabs.io/openapi.json'){
 if(!x||typeof x!=='object')return;
 for(const [k,v] of Object.entries(x)){
  const ptr=pointer+'/'+refEscape(k);
  if((/(?:^|_)model_id$/.test(k)||k==='model'||modelEnumNames.has(k))&&v&&typeof v==='object'){
   const candidates=modelValues(v,doc);
   for(const id of candidates.filter(x=>typeof x==='string'&&x.length&&x!=='string')){
    const source={url:sourceUrl,retrieved_at:date,source_id:sourceId,pointer:ptr};
    if(!modelMap.has(id))modelMap.set(id,{id,description:v.description||'Model identifier documented in schema',sources:[source],availability:'schema-documented-not-account-probed',schema_bindings:[]});
    modelMap.get(id).schema_bindings.push(source);
   }
  }
  scanModels(v,ptr,doc,sourceId,sourceUrl);
 }
}
scanModels(api);
for(const d of asyncapi.documents)scanModels(d.spec,'',d.spec,d.source_id,d.url);
for(const model of modelMap.values()){
 const id=model.id;
 const f=id.startsWith('scribe')?'transcriptions':id.startsWith('music')?'music':/ttv|sts/.test(id)?'voices':id.includes('sound')?'audio':id.includes('realtime')?'agents':id.startsWith('eleven')?'speech':/bytedance|image|veo|creatify/.test(id)?'flows':'agents';
 model.coverage={command:'domios plugin elevenlabs '+f+' --input <operation-schema-validated-model-selection:'+id+'>',blueprint:'elevenlabs.'+f,ui:'ElevenLabs owned surface / '+f,status:'proposed-not-implemented',limitation:'A model identifier is bound only to the schema context that names it. Do not send every model to every endpoint or expose model-family selectors as model IDs.'};
 model.cost={status:'advertised-rate-or-unknown-see-contracts',source_id:'pricing-browser.txt',account_quote:'unknown',paid_permission:'none'};
 model.schema={source_id:model.sources[0].source_id,bindings:model.schema_bindings,limits:'Exact source table/sections and bound operation schemas; not every model is accepted by every endpoint. See RESEARCH.md for v4 endpoint and source contradictions.'};
 model.lifecycle={status:'operation-dependent',source_id:model.sources[0].source_id};
}
const modelRows=[...modelMap.values()].sort((a,b)=>a.id.localeCompare(b.id));
const visualPage=pages.find(p=>p.url.endsWith('/overview/capabilities/image-video.md'));
const visualSection=visualPage.text.slice(visualPage.text.indexOf('## Models'));
const catalogDisplayModels=[...visualSection.matchAll(/^#### ([^\n]+)\n([\s\S]*?)(?=^#### |$(?![\s\S]))/gm)].filter(m=>!m[1].endsWith('models')).map(m=>({id:'display-model:'+m[1],display_name:m[1],vendor_api_model_id:null,sources:[sourceFor(visualPage)],documentation:m[2].trim(),availability:{status:'overview-catalog-only-not-proof-of-API-model-id',limitation:'Do not infer an API identifier or website-only status from a display name. Consume only a separately source-bound operation/model schema; unresolved catalog entries stay listed and unavailable.'},schema:{status:'API binding not established by this display catalog',source_id:visualPage.file},cost:{status:'no-safe-pricing-established',source_id:visualPage.file},lifecycle:{status:'not-established-without-API-schema',source_id:visualPage.file},coverage:{command:null,blueprint:null,ui:'Model catalog / unavailable',docs:visualPage.url,limitation:'No guessed model identifier, parameter mapping or pricing; vendor/owner must establish exact documented API schema and safe estimate before implementation.'}}));
await save('capabilities.json',{snapshot_date:date,status:'research-snapshot-not-implementation',complete_against:'All operation pages under API Docs in saved llms.txt plus ALL public API OpenAPI HTTP operations; URL aliases reference canonical operation IDs.',sources,catalog_entries:catalogEntries,operations});
await save('models.json',{snapshot_date:date,scope:'Every model table row including deprecated models plus exact schema-bound model selectors (including referenced enums/defaults/constants) in OpenAPI and AsyncAPI. Display-only Image/Video catalog entries are separately retained without invented API IDs. Open-string/dynamic account catalogs remain explicit unknowns.',models:modelRows,catalog_display_models:catalogDisplayModels,unresolved_catalogs:[{operation:'GET /v1/models',reason:'Live account-dependent model catalog not called; static documented model IDs are preserved.'},{operation:'Agents LLM listing and Flows model catalogs',reason:'Third-party model configurations and dynamic catalog contents are retained in full schemas/documentation, not asserted to be account available.'}]});
console.log(JSON.stringify({operations:operations.length,protocols:operations.filter(o=>o.id_origin==='documented-protocol-path').length,catalog_entries:catalogEntries.length,models:modelRows.length,display_models:catalogDisplayModels.length,families:[...new Set(operations.map(o=>o.family))]}));
