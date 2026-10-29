// Deterministic SOURCE declarations only. No host, account, credential or network access.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const json=async p=>JSON.parse(await readFile(new URL(p,root),'utf8'));
const save=(p,v)=>writeFile(new URL(p,root),JSON.stringify(v,null,2)+'\n');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const caps=await json('capabilities.json'),models=await json('models.json');
const verbs=['help','open','close','status','activity','catalog','capabilities','models','describe','estimate','usage','history','result','cancel','reconcile','prepare','rerun','generate','inspect','read'];
const node=family=>'elevenlabs.'+family.replaceAll('-','_');
const outcomes=['succeeded','failed','canceled','unknown'];
const steps=[...new Set(caps.operations.map(o=>o.family))].sort().map(family=>({
  contractVersion:1,revision:1,id:node(family),title:'ElevenLabs '+family,
  description:'Source declaration; execution refused until host runtime, closed nested schemas, durable media and budget contracts are delivered. Operation enum provides discovery only; it is not arbitrary JSON execution.',
  params:{type:'object',properties:{operation:{type:'string',enum:caps.operations.filter(o=>o.family===family).map(o=>o.id),maxLength:256}},required:['operation']},
  inputs:{},outputs:{},outcomes,lifecycle:{reconcile:false,cancel:false},effects:{sideEffects:true,potentiallyPaid:true},
}));
// A closed, actually representable scalar request family. No JSON string escape for nested vendor params.
steps.push({contractVersion:1,revision:1,id:'elevenlabs.tts',title:'ElevenLabs speech',
 description:'Bounded scalar TTS preparation contract. Submit refused until durable execution ports exist; defaults and exact schema validation use the accepted service.',
 params:{type:'object',properties:{voice:{type:'string',maxLength:255},text:{type:'string',maxLength:5000},model:{type:'string',enum:['eleven_v3','eleven_multilingual_v2','eleven_flash_v2','eleven_flash_v2_5'],maxLength:64}},required:['voice','text','model']},
 inputs:{},outputs:{audio:{kind:'audio',minItems:1,maxItems:1}},outcomes,lifecycle:{reconcile:false,cancel:false},effects:{sideEffects:true,potentiallyPaid:true}});
await save('plugin.json',{id:'elevenlabs',version:'0.1.0',hostApi:2,displayName:'ElevenLabs',description:'Source candidate. Host release/minimum version and final UI/bundle pending HIG-11.',entry:'plugin.js',readme:'AGENTS.md',license:'Apache-2.0',
 capabilities:{view:true,transcriber:true,agentCommands:true,surfaces:[{id:'studio',title:'ElevenLabs',renderer:'view',agentBound:true,agentVerbs:verbs,stateInvalidation:true,restore:'none'}],graphNodes:{steps}},
 permissions:{view:true,surfaces:true,agentCommands:true}});
const limitation='Nested/vendor-specific parameters and lifecycle cannot be represented by current flat NodeSchema; family descriptor is discovery only and refuses execution. See AGENTS.md and PLATFORM-GAPS.md. No unsupported API/web/account claim is inferred.';
await save('coverage.json',{revision:1,snapshot_date:caps.snapshot_date,status:'source-only; not runtime or whole-API execution acceptance',
 operations:caps.operations.map(o=>({id:o.id,evidence:{file:'capabilities.json',pointer:'/operations/'+caps.operations.indexOf(o),sha256:hash(o)},sources:o.sources,schema:o.schema.format+':'+o.schema.source_id+'#'+o.schema.pointer,
 command:{verb:'describe',body:{operation:o.id}},blueprint:{node:node(o.family),operation:o.id,limitation},docs:o.sources[0].url,ui:'Deferred Iris-owned studio task; no UI delivered here'})),
 models:models.models.map(m=>({id:m.id,evidence:{file:'models.json',pointer:'/models/'+models.models.indexOf(m),sha256:hash(m)},sources:m.sources,command:{verb:'models'},blueprint:{node:m.coverage.blueprint?.replaceAll('-','_')??null,limitation:'Source selector membership is not compatible adapter or account availability. Exact availability is returned by modelCatalog().'},docs:m.sources[0].url})),
 display:models.catalog_display_models.map(m=>({id:m.id,evidence:{file:'models.json',pointer:'/catalog_display_models/'+models.catalog_display_models.indexOf(m),sha256:hash(m)},sources:m.sources,command:{verb:'models'},limitation:m.availability.limitation,docs:m.sources[0].url})),
 unresolved:models.unresolved_catalogs});
