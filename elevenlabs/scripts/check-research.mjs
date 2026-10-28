// Authorized offline gate: catalog integrity and source coverage, never vendor execution.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const read=async p=>readFile(new URL(p,root));
const text=async p=>(await read(p)).toString('utf8').replace(/^\uFEFF/,'');
const json=async p=>JSON.parse(await text(p));
const digest=x=>createHash('sha256').update(x).digest('hex');
let assertions=0;
const check=(ok,message)=>{assertions++;assert.ok(ok,message);};
const equal=(a,b,message)=>{assertions++;assert.deepEqual(a,b,message);};
const unique=(rows,label)=>{const ids=rows.map(x=>x.id);check(ids.every(x=>typeof x==='string'&&x.length>0),label+' absent ID');equal(new Set(ids).size,ids.length,label+' duplicate ID');};
const pointer=(object,ptr)=>{
 check(typeof ptr==='string'&&ptr.startsWith('/'),'invalid JSON pointer '+ptr);
 let value=object;
 for(const encoded of ptr.slice(1).split('/')){const key=encoded.replace(/~1/g,'/').replace(/~0/g,'~');check(value!==null&&typeof value==='object'&&Object.hasOwn(value,key),'schema hole '+ptr);value=value[key];}
 return value;
};
function refs(value,document,label){
 if(!value||typeof value!=='object')return;
 if(typeof value.$ref==='string'){
  check(value.$ref.startsWith('#/'),'unresolved external schema '+label+' '+value.$ref);
  pointer(document,value.$ref.slice(1));
 }
 for(const child of Object.values(value))refs(child,document,label);
}
const caps=await json('capabilities.json');
const models=await json('models.json');
const contract=await json('contracts.json');
const spec=await json('evidence/openapi.json');
const protocols=await json('evidence/asyncapi.json');
const manifest=await json('evidence/page-manifest.json');
const host=await json('evidence/host-source.json');
check(/^\* -text$/m.test(await text('evidence/.gitattributes')),'evidence bytes must survive cross-platform checkout');
equal(contract.snapshot_date,'2026-10-29','snapshot date changed without review');
equal(caps.snapshot_date,contract.snapshot_date,'operation date');
equal(models.snapshot_date,contract.snapshot_date,'model date');
unique(caps.operations,'operation');unique(models.models,'model');unique(caps.sources,'source');
const sourceMap=new Map(caps.sources.map(s=>[s.id,s]));
const date=value=>typeof value==='string'&&/^2026-10-(28|29)(?:$|T)/.test(value);
for(const source of caps.sources){
 check(date(source.retrieved_at),'missing/invalid source retrieval '+source.id);
 check(/^https:\/\/(elevenlabs\.io|api\.elevenlabs\.io)\//.test(source.url),'nonprimary source '+source.id);
 equal(digest(await read(source.file)),source.sha256,'source tampering '+source.file);
}
function sourced(s,label){check(s&&sourceMap.has(s.source_id),'missing source '+label);check(date(s.retrieved_at),'missing retrieval '+label);equal(s.url,sourceMap.get(s.source_id).url,'wrong source URL '+label);}
const index=await text('evidence/llms.txt');
const indexedApi=[...new Set([...index.matchAll(/\((https:\/\/elevenlabs\.io\/docs\/[^)]+\/api-reference\/[^)]+\.md|https:\/\/elevenlabs\.io\/docs\/api-reference\/[^)]+\.md)\)/g)].map(m=>m[1]))].sort();
equal(caps.catalog_entries.map(x=>x.url).sort(),indexedApi,'missing/duplicate API index URL');
equal(manifest.filter(x=>x.url.includes('/api-reference/')).map(x=>x.url).sort(),indexedApi,'incomplete source acquisition');
check(manifest.every(x=>x.valid&&x.status===200),'source retrieval failure');
for(const entry of caps.catalog_entries){
 check(date(entry.retrieved_at),'catalog missing date '+entry.url);
 check(sourceMap.has(entry.source_id),'catalog missing saved source '+entry.url);
 check(entry.kind==='operation'?caps.operations.some(o=>o.id===entry.operation_id):entry.kind==='guide'&&entry.limitation?.length>0,'orphan catalog entry '+entry.url);
}
const expected=[];
for(const [path,item] of Object.entries(spec.paths))for(const [method,op] of Object.entries(item))if(['get','post','put','patch','delete','head','options'].includes(method))expected.push({path,method:method.toUpperCase(),op});
equal(caps.operations.filter(o=>o.id_origin==='vendor-openapi-operationId').map(o=>o.id).sort(),expected.map(x=>x.op.operationId).sort(),'omitted/foreign HTTP operation');
refs(spec,spec,'OpenAPI');
const expectedChannels=new Set();const messageIds=new Set();
for(const [i,d] of protocols.documents.entries()){
 const source=sourceMap.get(d.source_id);check(source,'missing AsyncAPI primary source');
 const raw=await text(source.file);const yaml=raw.match(/```yaml\s*\n(asyncapi:[\s\S]*?)\n```/);
 check(yaml,'missing embedded AsyncAPI '+d.url);equal(digest(yaml[1]),d.yaml_sha256,'AsyncAPI extraction input '+d.url);
 equal(d.spec.asyncapi,'2.6.0','AsyncAPI version');refs(d.spec,d.spec,'AsyncAPI '+i);
 for(const [path,channel] of Object.entries(d.spec.channels)){
  expectedChannels.add(path);
  for(const direction of ['publish','subscribe'])if(channel[direction])messageIds.add(channel[direction].operationId);
 }
}
equal(caps.operations.filter(o=>o.id_origin==='documented-protocol-path').map(o=>o.path).sort(),[...expectedChannels].sort(),'omitted protocol channel');
equal([...new Set(caps.operations.flatMap(o=>o.schema.message_operation_ids||[]))].sort(),[...messageIds].sort(),'omitted message operation ID');
for(const row of caps.operations){
 check(row.sources?.length>0,'unsourced operation '+row.id);row.sources.forEach(s=>sourced(s,row.id));
 for(const field of ['availability','authorization','transport','lifecycle','cost']){check(row[field]&&typeof row[field]==='object','missing '+field+' '+row.id);sourced(row[field].source,row.id+' '+field);}
 check(['documented-http','documented-websocket'].includes(row.availability.api),'unsupported API/web status '+row.id);
 check(['deprecated','not-explicitly-guaranteed-GA'].includes(row.availability.stage),'unsourced GA/preview claim '+row.id);
 check(row.authorization.owner_policy&&row.availability.account_entitlement,'authorization hole '+row.id);
 check(row.lifecycle.cancel&&row.lifecycle.progress&&row.lifecycle.preview&&row.lifecycle.reconcile,'lifecycle hole '+row.id);
 check(row.cost.status&&row.cost.permission&&row.cost.pricing_source==='pricing-browser.txt','cost hole '+row.id);
 equal(row.cost.safe_estimate.status,'not-established','unsupported safe-estimate claim '+row.id);
 equal(row.cost.safe_estimate.authoritative_full_operation_estimate,false,'unsupported full-operation quote '+row.id);
 check(row.schema.defaults_and_limits,'defaults/limits hole '+row.id);
 check(Array.isArray(row.schema.documented_parameters)&&Array.isArray(row.schema.documented_limits),'documentation schema hole '+row.id);
 if(row.schema.format==='openapi'){
  const actual=pointer(spec,row.schema.pointer);
  equal(actual.operationId,row.id,'schema/id mismatch');
  equal(row.schema.parameters,actual.parameters||[],'omitted parameter '+row.id);
  equal(row.schema.requestBody,actual.requestBody??null,'omitted request body '+row.id);
  equal(row.schema.responses,actual.responses,'omitted response schema '+row.id);
  check(Object.keys(actual.responses||{}).length>0,'response schema hole '+row.id);
 }else{
  equal(row.schema.format,'asyncapi','missing protocol schema '+row.id);
  const protocol=pointer(protocols,row.schema.pointer);check(protocol.channels[row.path],'missing protocol schema path');
  check(row.schema.message_operation_ids.length>0,'missing protocol operations');
 }
 const coverage=row.coverage;check(coverage?.status==='proposed-not-implemented','false implementation claim '+row.id);
 check(coverage.command.startsWith('domios plugin elevenlabs '+row.family+' --operation '+row.id),'missing finite command '+row.id);
 equal(coverage.blueprint.operation_enum,row.id,'missing typed operation discriminator');
 check(coverage.blueprint.descriptor==='elevenlabs.'+row.family&&coverage.blueprint.schema_binding&&coverage.blueprint.limitation,'typed Blueprint schema/limitation hole');
 check(coverage.ui.destination&&coverage.ui.docs&&coverage.ui.status,'UI/docs hole '+row.id);
}
const families=new Set(caps.operations.map(o=>o.coverage.blueprint.descriptor));check(families.size<=32,'descriptor cap exceeded');
// Independent model reconciliation: table plus schema-bound selectors, including refs and unions.
const requiredModels=new Set();
const modelText=await text('evidence/models.md');
const table=modelText.slice(modelText.indexOf('## Models overview'),modelText.indexOf('## Eleven v4\n'));
for(const m of table.matchAll(/^\|\s*`([^`]+)`\s*\|/gm))requiredModels.add(m[1]);
const named=new Set(['LLM','EmbeddingModelEnum','MusicModelID','RealtimeModel','SFXModelId','TTSConversationalModel','TurnModel','TTSModelFamily']);
function collectValues(node,doc,seen=new Set()){
 if(!node||typeof node!=='object')return;
 if(node.$ref&&!seen.has(node.$ref)){seen.add(node.$ref);collectValues(pointer(doc,node.$ref.slice(1)),doc,seen);}
 for(const v of [...(node.enum||[]),node.default,node.const])if(typeof v==='string'&&v.length&&v!=='string')requiredModels.add(v);
 for(const k of ['anyOf','oneOf','allOf'])for(const child of node[k]||[])collectValues(child,doc,seen);
}
function modelSelectors(node,doc){
 if(!node||typeof node!=='object')return;
 for(const [k,v] of Object.entries(node)){
  if(/(?:^|_)model_id$/.test(k)||k==='model'||named.has(k))collectValues(v,doc);
  modelSelectors(v,doc);
 }
}
modelSelectors(spec,spec);protocols.documents.forEach(d=>modelSelectors(d.spec,d.spec));
equal(models.models.map(m=>m.id).sort(),[...requiredModels].sort(),'omitted or invented model variant/selector');
for(const model of models.models){
 check(model.sources.length>0,'unsourced model '+model.id);model.sources.forEach(s=>sourced(s,model.id));
 check(model.schema&&model.cost&&model.lifecycle&&model.coverage?.command&&model.coverage?.blueprint&&model.coverage?.ui,'model schema/cost/lifecycle/coverage hole '+model.id);
 check(sourceMap.has(model.schema.source_id),'model schema source hole '+model.id);
}
unique(models.catalog_display_models,'display catalog model');
const visualPage=manifest.find(p=>p.url.endsWith('/overview/capabilities/image-video.md'));
const visualText=await text('evidence/'+visualPage.file);
const displayNames=[...visualText.slice(visualText.indexOf('## Models')).matchAll(/^#### ([^\n]+)\n/gm)].map(m=>m[1]).filter(n=>!n.endsWith('models'));
equal(models.catalog_display_models.map(m=>m.display_name).sort(),displayNames.sort(),'omitted visual display catalog model');
for(const model of models.catalog_display_models){
 equal(model.vendor_api_model_id,null,'guessed visual API ID');model.sources.forEach(s=>sourced(s,model.id));
 check(model.schema&&model.cost&&model.lifecycle&&model.coverage.limitation&&model.coverage.docs,'missing evidenced display-model limitation');
}
equal(host.commit,contract.platform.host_sha,'host proof SHA mismatch');
check(host.files.length>=40,'missing host trace');
for(const file of host.files)equal(digest(file.text),file.sha256,'host evidence integrity '+file.path);
for(const [vendor,ledger] of Object.entries(contract.ledger))if(['elevenlabs','higgsfield','aggregate'].includes(vendor)){
 equal(ledger.spent,{amount:0,unit:'usd_micro'},'research spend not zero');equal(ledger.reserved,{amount:0,unit:'usd_micro'},'research reservation not zero');equal(ledger.unknown_submissions,0,'unknown vendor submission');
}
for(const k of ['credential_reads','authenticated_vendor_calls','generation_training_upload_calls','settings_mutations'])equal(contract.safety[k],0,'prohibited research action '+k);
equal(contract.platform.minimum_host,'unknown','unproven minimum host');
equal(contract.platform.released_sdk_with_required_capabilities,'unknown','unproven SDK release');
equal(contract.pricing_decision.require_safe_fresh_estimate,true,'safe fresh estimate required');
equal(contract.pricing_decision.missing_price_submission_allowed,false,'unsafe price submission policy');
equal(contract.pricing_decision.unknown_price_approval_allowed,false,'unsafe price approval policy');
check((await text('PLATFORM-GAPS.md')).includes('AgentTaskInput'),'media-review platform gap omitted');
check((await text('RESEARCH.md')).includes('UNRUN'),'unrun proof omitted');
console.log(JSON.stringify({status:'PASS',assertions,http_operations:expected.length,websocket_channels:expectedChannels.size,message_operation_ids:messageIds.size,api_index_entries:indexedApi.length,models_and_selectors:requiredModels.size,display_catalog_models:displayNames.length,typed_descriptor_families:families.size,ledger:'$0; no authenticated or paid vendor calls; task-local ledger only',proof:'Offline source/catalog integrity, not live implementation, entitlement, price quote or released host proof'},null,2));
