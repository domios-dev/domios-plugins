import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ElevenLabsService, catalog, modelCatalog, utf8Size } from '../src/client';
import type { ServicePorts, Reply, WireRequest } from '../src/client';
import { operations, operation, disposition, revision, validateParameters, validateRequest, schemaFor, modelSelection, modelAvailability } from '../src/catalog';
import { pointer, validateSchema } from '../src/schema';
import { createScribe } from '../src/scribe';
import plugin from '../src/plugin';
import type { Partition, Request, Scope, Quote } from '../../media-shared/src/contracts';
import openapi from '../evidence/openapi.json';

const scope = (owner = 'A', actorId = 'human', runId?: string): Scope => ({owner,workspace:'work',actorId,runId,
  actor:runId ? {kind:'run',label:'Run',runId} : {kind:'you'},human:actorId === 'human',authRevision:'auth1'});
const request = (id = 'text_to_speech_full'): Request => ({operation:id,revision,unit:'usd_micro',inputs:[],
  params:{path:{voice_id:'Rollo'},body:{text:'Hello',model_id:'eleven_multilingual_v2'}}});
function fixture(options: { maxHistory?: number; maxBytes?: number } = {}) {
  const partitions = new Map<string, Partition>(), files = new Map<string, any>(), calls: WireRequest[] = [];
  let now = 100, permitted = true, current = true, reply: Reply = {status:200,contentType:'audio/mpeg',bytes:new Uint8Array([1,2,3])};
  let http = (wire: WireRequest): Reply => { calls.push(wire); return reply; };
  let quote: (r: Request, binding: string) => Quote | null = (_r,binding) => ({binding,amount:8,unit:'usd_micro',safe:true,
    basis:'synthetic exact account tariff and input identity',tariffRevision:'fixture1',issuedAt:now,validUntilMs:now+100});
  const ports: ServicePorts = {
    store:{transact(owner, workspace, edit) {
      const key = JSON.stringify([owner,workspace]), before = partitions.get(key) ?? {jobs:[],ceilings:{usd_micro:100,characters:1000}};
      const draft = structuredClone(before), result = edit(draft); partitions.set(key,draft); return structuredClone(result);
    }},now:() => now,maxHistory:options.maxHistory ?? 20,maxBytes:options.maxBytes ?? 262144,
    access(caller) {return {scope:caller as Scope,current,inputsAuthorized:true};},permitted:() => permitted,
    quote:(_s,r,b) => quote(r,b),http:wire => http(wire),
    stream:function* (wire) { calls.push(wire); yield {kind:'bytes',bytes:new Uint8Array([1,2])}; yield {kind:'complete',status:200,contentType:'audio/mpeg'}; },
    save(s,id,output) {const file = s.owner + ':' + id; files.set(file,output); return {kind:'artifact',id:file,contentType:'json' in output ? 'application/json' : output.contentType};},
  };
  const service = new ElevenLabsService(ports);
  function ready(id = 'one', r = request(), caller = scope()) {
    service.intent(caller,id,r); service.estimate(caller,id); service.approve(caller,id,{amount:8,unit:'usd_micro'});
  }
  return {service,ports,partitions,files,calls,ready,setNow:(v:number) => {now=v;},setQuote:(v:typeof quote) => {quote=v;},
    setReply:(v:Reply) => {reply=v;},setHttp:(v:typeof http) => {http=v;},deny:() => {permitted=false;},revoke:() => {current=false;}};
}

// Every inventory row has exact source/schema behavior or a visible, sourced policy/transport limitation.
for (const row of operations) test(`catalog ${row.id}`, () => {
  const state = disposition(row);
  assert.ok(state.source.url.startsWith('https://'));
  assert.ok(state.source.retrieved_at);
  assert.equal(validateParameters(row, {path:{injected:'https://evil.invalid'},body:{authorization:'secret'}}),false);
  assert.equal(validateParameters(row, null as any),false);
  if (row.schema.format === 'openapi') {
    const schema = schemaFor(row);
    assert.equal(schema.operationId,row.id);
    for (const p of schema.parameters ?? []) if (p.required && p.in !== 'header') {
      assert.equal(validateParameters(row, {[p.in]:{[p.name]:{untyped:true}}}),false);
    }
    assert.ok(state.limitation || state.prerequisites.includes('account-entitlement'));
    assert.equal(state.parameterPolicy.pointer,row.schema.pointer);
    assert.match(state.parameterPolicy.limitation,/unavailable/);
  } else {
    assert.match(state.limitation!,/Session\/listener/);
  }
  if (row.family === 'voices' && row.method !== 'GET' && !row.path.startsWith('/v1/voice-changer/')) assert.match(state.limitation!,/immutable/);
});
for (const model of modelCatalog().models) test(`model schema ${model.id}`, () => {
  const result = modelSelection(model.id,model.id);
  assert.ok(result.sources.length);
  assert.equal('valid' in result,false);
  assert.deepEqual(result.execution,model.execution);
  assert.ok(result.execution.operations.length || result.execution.limitation);
  if (model.schema_bindings?.length) {
    assert.equal(result.selectorMembership,true);
    assert.equal(modelSelection(model.id,{invented:'model'}).selectorMembership,false);
  } else assert.match(result.limitation!,/Overview-only/);
});
for (const model of modelCatalog().display) test(`display limitation ${model.id}`, () => {
  assert.equal(model.vendor_api_model_id,null);
  assert.ok(model.availability.limitation);
  assert.ok(model.sources[0].url);
});
for (const model of modelCatalog().models.filter(m=>m.execution.status==='adapter-supported')) {
  for(const id of model.execution.operations) test(`runnable model ${model.id} -> ${id} keeps exact compatible operation`, () => {
    let r:Request;
    if(id==='text_to_speech_full') {r=request();(r.params as any).body.model_id=model.id;}
    else if(id==='text_to_dialogue') r={operation:id,revision,inputs:[],unit:'usd_micro',params:{body:{model_id:model.id,inputs:[{text:'Hello',voice_id:'Rollo'}]}}};
    else if(id==='speech_to_text') {r=scribeRequest();(r.params as any).body.model_id=model.id;}
    else if(id==='speech_to_speech_full') r={operation:id,revision,inputs:[{kind:'artifact',id:'immutable-audio',contentType:'audio/wav'}],unit:'usd_micro',params:{path:{voice_id:'Rollo'},body:{model_id:model.id,audio:{input:0}}}};
    else if(id==='sound_generation') r={operation:id,revision,inputs:[],unit:'usd_micro',params:{body:{model_id:model.id,text:'A bell',duration_seconds:1}}};
    else if(id==='generate') r={operation:id,revision,inputs:[],unit:'usd_micro',params:{query:{output_format:'mp3_44100_128'},body:{model_id:model.id,prompt:'A bell melody',music_length_ms:3000}}};
    else throw new Error('Missing explicit runnable-model fixture');
    const f=fixture();assert.equal(validateRequest(r),true);f.ready('model',r);
    if(id==='speech_to_text')f.setReply({status:200,contentType:'application/json',json:{text:'Hello',language_code:'en',language_probability:1,words:[]}});
    assert.equal(f.service.start(scope(),'model').state,'generated');assert.equal(f.calls.length,1);
    assert.equal(f.calls[0].params.body.model_id,model.id);assert.equal(f.service.history(scope())[0].request.operation,id);
  });
}
test('selector membership is distinct from runnable models, deprecated aliases and realtime limitations', () => {
  for(const id of ['eleven_turbo_v2','eleven_turbo_v2_5','scribe_v1']) {
    const availability=modelAvailability(id);assert.equal(availability.deprecated,true);assert.equal(availability.status,'limited');assert.deepEqual(availability.operations,[]);
    assert.match(availability.limitation!,/Deprecated/);
  }
  assert.equal(modelSelection('eleven_turbo_v2','eleven_turbo_v2').selectorMembership,true);
  assert.equal(modelSelection('eleven_turbo_v2','eleven_turbo_v2').execution.status,'limited');
  for(const id of ['turbo','v4','flash']) {assert.equal(modelSelection(id,id).selectorMembership,true);assert.equal(modelAvailability(id).status,'limited');}
  assert.deepEqual(modelAvailability('eleven_v4').operations,['text_to_dialogue']);
  const incompatible=request();(incompatible.params as any).body.model_id='eleven_v4';assert.equal(validateRequest(incompatible),false);
  const deprecated=request();(deprecated.params as any).body.model_id='eleven_turbo_v2';assert.equal(validateRequest(deprecated),false);
  for(const id of ['scribe_v2_realtime','eleven_realtime_v1_mini','eleven_realtime_v1_max'])assert.match(modelAvailability(id).limitation!,/Realtime\/session/);
});

test('finite catalog and every operation family/transport/method retained', () => {
  assert.equal(catalog().length,466); assert.equal(modelCatalog().models.length,166);
  assert.equal(modelCatalog().display.length,81);
  assert.equal(new Set(operations.map(x => x.family)).size,15);
  assert.deepEqual(new Set(operations.map(x => x.transport.kind)),new Set(['http','http-stream','websocket','websocket-upstream-server']));
  assert.deepEqual(new Set(operations.map(x => x.method)),new Set(['GET','POST','DELETE','PUT','PATCH']));
});
test('exact closed schemas reject unknowns, coercion, unresolved/Any/unsupported format and bounded recursion', () => {
  const root = {components:{schemas:{value:{type:'integer',minimum:1,maximum:3}}}};
  assert.equal(validateSchema(root,{$ref:'#/components/schemas/value'},2),true);
  for (const v of ['2',0,4,1.5,NaN]) assert.equal(validateSchema(root,{$ref:'#/components/schemas/value'},v),false);
  assert.equal(validateSchema(root,{},{}),false);
  assert.equal(validateSchema(root,{type:'object',properties:{x:{type:'boolean'}},required:['x']},{x:true}),true);
  assert.equal(validateSchema(root,{type:'object',properties:{x:{type:'boolean'}}},{x:true,y:1}),false);
  assert.equal(validateSchema(root,{type:'string',format:'email'},'a@b.c'),false);
  assert.throws(() => pointer(root,'https://evil.invalid/schema'));
  assert.equal(validateSchema({}, {type:'array',items:{type:'integer'},maxItems:1},[1,2]),false);
});
test('valid speech, dialogue, Scribe and reads retain separate schema/operation semantics', () => {
  assert.equal(validateRequest(request()),true);
  assert.equal(validateParameters(operation('get_models'),{}),true);
  assert.equal(validateParameters(operation('text_to_dialogue'),{body:{inputs:[{text:'Hello',voice_id:'Rollo'}]}}),true);
  const r = scribeRequest(); assert.equal(validateRequest(r),true);
  for (const body of [{text:'x',model_id:'eleven_v4'},{text:'x',seed:-1},{text:'x',extra:1},
    {text:'x'.repeat(10001)},{text:'x',source_url:'https://evil.invalid'},{text:'x',model_id:4}]) {
    assert.equal(validateParameters(operation('text_to_speech_full'),{path:{voice_id:'Rollo'},body}),false);
  }
  for (const id of ['../other','https://evil.invalid','a?xi-api-key=x','a/b']) assert.equal(validateParameters(operation('text_to_speech_full'),{path:{voice_id:id},body:{text:'x'}}),false);
  const invalid = structuredClone(r); (invalid.params as any).body.file = 'C:/private/audio.wav'; assert.equal(validateRequest(invalid),false);
  const missing = structuredClone(r); missing.inputs=[]; assert.equal(validateRequest(missing),false);
  for (const extra of [{webhook:true},{use_multi_channel:true},{use_speaker_library:true},{detect_speaker_roles:true},
    {diarization_threshold:0.2},{keyterms:['x'.repeat(50)]},{transcript_edit:'x',entity_detection:'all'}]) {
    assert.equal(validateParameters(operation('speech_to_text'),{body:{...(r.params as any).body,...extra}},1),false);
  }
});
test('multiline/tab prose and literal URL, bearer, token and API-key words are spoken as exact data', () => {
  const f=fixture(),r=request(),text='First paragraph.\n\n\tVisit https://example.org/a?token=demo\nSay bearer token and xi-api-key literally.';
  (r.params as any).body.text=text;
  f.ready('prose',r);const prepared=f.service.prepare(scope(),'prose');
  assert.equal((prepared.wire.body as any).data.text,text);assert.equal(f.calls.length,0);
  assert.equal(f.service.start(scope(),'prose').state,'generated');
  assert.equal((f.calls[0].params.body as any).text,text);
  assert.equal((f.service.history(scope())[0].request.params as any).body.text,text);
});
test('transport authority injection remains denied by exact fields/schema despite unrestricted prose', () => {
  const f=fixture();
  for(const injected of [{headers:{authorization:'Bearer injected'}},{credential:{name:'foreign'}},{url:'https://evil.invalid'},
    {endpoint:'https://evil.invalid'},{method:'DELETE'}]) {
    const r=request();r.params={...(r.params as any),...injected};assert.throws(()=>f.service.intent(scope(),'inject',r),/invalid_request/);
  }
  for(const field of ['authorization','xi-api-key','cookie','api_key','endpoint']) {
    const r=request();(r.params as any).query={[field]:'https://evil.invalid'};assert.equal(validateRequest(r),false);
  }
  for(const field of ['source_url','cloud_storage_url']) {
    const r=scribeRequest();(r.params as any).body[field]='https://evil.invalid/audio.wav';assert.equal(validateRequest(r),false);
  }
  assert.equal(f.calls.length,0);
});
const input = {kind:'artifact' as const,id:'immutable-audio-sha256-identity',contentType:'audio/wav'};
for (const example of [
  {id:'sound_generation',params:{body:{text:'A closing door',duration_seconds:1}},inputs:[],json:undefined},
  {id:'audio_isolation',params:{body:{audio:{input:0}}},inputs:[input],json:undefined},
  {id:'speech_to_speech_full',params:{path:{voice_id:'Rollo'},body:{audio:{input:0}}},inputs:[input],json:undefined},
  {id:'text_to_dialogue',params:{body:{inputs:[{text:'Hello',voice_id:'Rollo'}]}},inputs:[],json:undefined},
  {id:'generate',params:{query:{output_format:'mp3_44100_128'},body:{prompt:'A short instrumental',music_length_ms:3000}},inputs:[],json:undefined},
  {id:'forced_alignment',params:{body:{file:{input:0},text:'Hello'}},inputs:[input],json:{characters:[],words:[],loss:0}},
  {id:'text_to_speech_full_with_timestamps',params:{path:{voice_id:'Rollo'},body:{text:'Hello'}},inputs:[],json:{audio_base64:'AQID'}},
]) test(`synchronous operation class ${example.id}: exact schema, one effect, saved output`, () => {
  const f=fixture(),r:Request={operation:example.id,revision,unit:'usd_micro',inputs:example.inputs,params:example.params};
  assert.equal(validateRequest(r),true);
  f.ready('class',r);
  if(example.json) f.setReply({status:200,contentType:'application/json',json:example.json});
  const job=f.service.start(scope(),'class');assert.equal(job.state,'generated');assert.equal(job.outputs.length,1);
  assert.equal(f.calls.length,1);assert.equal(f.files.size,1);
  f.service.start(scope(),'class');assert.equal(f.calls.length,1);
  const invalid=structuredClone(r);(invalid.params as any).body.unknown_field=true;assert.equal(validateRequest(invalid),false);
});
test('provider prose constraints and structured protocols remain operation-specific', () => {
  assert.equal(validateParameters(operation('sound_generation'),{body:{text:'x',duration_seconds:31}}),false);
  assert.equal(validateParameters(operation('sound_generation'),{body:{text:'x',prompt_influence:1.1}}),false);
  for(const body of [{},{prompt:'music',seed:1},{prompt:'music',composition_plan:{}},{music_length_ms:3000}])
    assert.equal(validateParameters(operation('generate'),{body}),false);
  assert.equal(validateParameters(operation('speech_to_speech_full'),{path:{voice_id:'Rollo'},body:{audio:{input:0},voice_settings:'{"stability":0.5}'}},1),false);
  assert.match(disposition(operation('compose_detailed')).limitation!,/multipart decoder/);
  assert.match(disposition(operation('text_to_speech_stream_with_timestamps')).limitation!,/Structured/);
});
test('runtime-shaped service works without URL and URLSearchParams globals', () => {
  const globals=globalThis as any, previousURL=globals.URL, previousSearch=globals.URLSearchParams;
  try {
    globals.URL=undefined;globals.URLSearchParams=undefined;
    const f=fixture();f.ready();assert.equal(f.service.start(scope(),'one').state,'generated');assert.equal(f.calls.length,1);
    const read:Request={operation:'get_models',revision,params:{},inputs:[],unit:'usd_micro'};
    f.setReply({status:200,contentType:'application/json',json:[]});assert.deepEqual(f.service.read(scope(),read),{json:[]});
    assert.equal(f.calls[0].url,'https://api.elevenlabs.io/v1/text-to-speech/Rollo');
  } finally { globals.URL=previousURL;globals.URLSearchParams=previousSearch; }
});
test('estimate/read/rerun preparation perform zero paid calls; deliberate action performs exactly one', () => {
  const f = fixture(); f.ready(); assert.equal(f.calls.length,0);
  f.service.intent(scope(),'one',request()); assert.equal(f.calls.length,0);
  const job=f.service.start(scope(),'one'); assert.equal(job.state,'generated'); assert.equal(f.calls.length,1);
  assert.equal(f.service.start(scope(),'one').state,'generated'); assert.equal(f.calls.length,1);
  assert.deepEqual(f.service.ledger(scope()),{spent:{},reserved:{usd_micro:8},unknown:0});
  assert.equal(job.quote!.unit,'usd_micro'); // no billed usage evidence was invented
  const wire=f.calls[0]; assert.equal(wire.url,'https://api.elevenlabs.io/v1/text-to-speech/Rollo');
  assert.deepEqual(wire.credential,{plugin:'elevenlabs',name:'elevenlabs-api-key'});
  assert.equal(wire.retry,0); assert.equal(wire.redirect,'error');
  assert.ok(!JSON.stringify(f.service.history(scope())).includes('credential'));
});
for (const reason of ['401','429','500','timeout','redirect','wrong-mime','empty','malformed-json']) test(`uncertain ${reason} retains reservation; reload and concurrency add zero effects`, () => {
  const f=fixture(); f.ready(); let calls=0;
  f.setHttp(wire => {
    calls++; assert.equal(new ElevenLabsService(f.ports).start(scope(),'one').state,'starting');
    if (reason === 'timeout') throw new Error('sensitive vendor body and key must never escape');
    if (['401','429','500','redirect'].includes(reason)) return {status:reason==='redirect'?302:Number(reason),contentType:'audio/mpeg',bytes:new Uint8Array([1])};
    if (reason==='wrong-mime') return {status:200,contentType:'text/html',bytes:new Uint8Array([1])};
    if (reason==='malformed-json') return {status:200,contentType:'application/json',json:{token:'private'}};
    return {status:200,contentType:'audio/mpeg',bytes:new Uint8Array()};
  });
  assert.equal(f.service.start(scope(),'one').state,'unknown');
  const reloaded=new ElevenLabsService(f.ports); reloaded.recover(scope());
  assert.equal(reloaded.start(scope(),'one').state,'unknown'); assert.equal(calls,1);
  assert.deepEqual(reloaded.ledger(scope()),{spent:{},reserved:{usd_micro:8},unknown:1});
});
test('explicit durable continuation recovery preserves effect identity without replay', () => {
  const f=fixture(); f.ready(); const entered=f.service.enter(scope(),'one'); assert.ok(entered.action);
  assert.equal(f.calls.length,0); // host has the one dispatch action, not a transport job ID
  const reloaded=new ElevenLabsService(f.ports); assert.equal(reloaded.recover(scope())[0].state,'unknown');
  assert.equal(reloaded.start(scope(),'one').state,'unknown'); assert.equal(f.calls.length,0);
  assert.throws(() => f.service.receipt(entered.action!,{status:200,contentType:'audio/mpeg',bytes:new Uint8Array([1])}),/stale_continuation/);
});
test('effect-free persisted plan supports an explicit fixture marker and one callback receipt after resume', () => {
  const f=fixture(),r=request();f.ready('explicit',r);
  const plan=f.service.prepare(scope(),'explicit');assert.equal(f.calls.length,0);assert.equal(f.service.history(scope()).length,1);
  assert.equal(plan.binding,JSON.stringify(r));assert.deepEqual(plan.wire.inputs,r.inputs);
  const forged=structuredClone(plan);forged.wire.url='https://evil.invalid';
  assert.throws(()=>f.service.enter(scope(),'explicit',forged),/intent_conflict/);
  assert.equal(f.service.history(scope())[0].state,'waiting');
  const boundary=f.service.enter(scope(),'explicit',plan);assert.ok(boundary.action);assert.deepEqual(boundary.plan,plan);
  assert.equal(f.service.enter(scope(),'explicit',plan).action,undefined);
  let paidEntries=0;
  // Test-only marker/queue. It models an explicit returned marker; it is not a claimed host SDK implementation.
  function fakeTransfer(wire:typeof plan.wire) {paidEntries++;assert.deepEqual(wire,plan.wire);return {fixtureMarker:'pending',continuation:boundary.action!};}
  const marker=fakeTransfer(boundary.plan!.wire);assert.equal(marker.fixtureMarker,'pending');assert.equal(paidEntries,1);
  const resumed=new ElevenLabsService(f.ports);
  const generated=resumed.receipt(marker.continuation,{status:200,contentType:'audio/mpeg',bytes:new Uint8Array([1,2])});
  assert.equal(generated.state,'generated');assert.equal(f.files.size,1);
  assert.throws(()=>resumed.receipt(marker.continuation,{status:200,contentType:'audio/mpeg',bytes:new Uint8Array([1,2])}),/effect_not_entered/);
  assert.equal(resumed.enter(scope(),'explicit',resumed.prepare(scope(),'explicit')).action,undefined);
  assert.equal(resumed.history(scope()).length,1);assert.equal(paidEntries,1);
  assert.throws(()=>resumed.prepare(scope('B'),'explicit'),/job_unavailable/);
});
test('explicit callback error/suppressed callback retains Unknown and cannot replay its effect', () => {
  for(const lost of [false,true]) {
    const f=fixture();f.ready();const boundary=f.service.enter(scope(),'one',f.service.prepare(scope(),'one'));
    assert.ok(boundary.action);
    const resumed=new ElevenLabsService(f.ports);
    if(lost)resumed.recover(scope());else resumed.uncertain(boundary.action!);
    assert.equal(resumed.history(scope())[0].state,'unknown');
    assert.equal(resumed.enter(scope(),'one',resumed.prepare(scope(),'one')).action,undefined);
    assert.equal(resumed.ledger(scope()).unknown,1);assert.equal(f.calls.length,0);
  }
});
test('bounded stream requires explicit terminal event, no bytes after completion, no replay', () => {
  for (const variant of ['success','truncated','oversize','after-complete','bad-status']) {
    const f=fixture({maxBytes:4}); f.ready('stream',request('text_to_speech_stream')); let calls=0;
    f.ports.stream=function* () {calls++;yield {kind:'bytes',bytes:new Uint8Array(variant==='oversize'?5:2)};
      if(variant!=='truncated') yield {kind:'complete',status:variant==='bad-status'?500:200,contentType:'audio/mpeg'};
      if(variant==='after-complete') yield {kind:'bytes',bytes:new Uint8Array([1])};};
    assert.equal(f.service.start(scope(),'stream').state,variant==='success'?'generated':'unknown');
    f.service.start(scope(),'stream'); assert.equal(calls,1);
  }
});
for (const variant of ['absent','unsafe','negative','fraction','wrong-unit','wrong-binding','future','stale']) test(`quote ${variant} cannot authorize execution`, () => {
  const f=fixture(); f.service.intent(scope(),'one',request());
  f.setQuote((_r,b) => {
    if(variant==='absent')return null;
    return {binding:variant==='wrong-binding'?'different':b,amount:variant==='negative'?-1:variant==='fraction'?0.5:8,
      unit:variant==='wrong-unit'?'characters':'usd_micro',safe:variant!=='unsafe',basis:'fixture',tariffRevision:'r',
      issuedAt:variant==='future'?200:0,validUntilMs:variant==='stale'?99:300};
  });
  assert.equal(f.service.estimate(scope(),'one').waitReason,'price_unavailable');
  assert.throws(() => f.service.approve(scope(),'one',{amount:8,unit:'usd_micro'}));
  assert.equal(f.service.start(scope(),'one').state,'waiting');assert.equal(f.calls.length,0);
});
test('approval, expiry and exact params/revision/input references are independently bound', () => {
  const f=fixture(); f.ready();
  for(const change of [(r:Request)=>{(r.params as any).body.text='different';},(r:Request)=>{r.revision='other';},
    (r:Request)=>{r.inputs=[{kind:'artifact',id:'different-content',contentType:'audio/wav'}];}]) {
    const r=request(); change(r); assert.throws(() => f.service.intent(scope(),'one',r));
  }
  f.setNow(200);assert.equal(f.service.start(scope(),'one').waitReason,'price_stale');assert.equal(f.calls.length,0);
  const g=fixture();g.service.intent(scope(),'one',request());g.service.estimate(scope(),'one');
  assert.equal(g.service.start(scope(),'one').waitReason,'owner_confirmation');
  g.service.approve(scope(),'one',{amount:8,unit:'usd_micro'});g.deny(); assert.throws(()=>g.service.start(scope(),'one'),/operation_denied/);assert.equal(g.calls.length,0);
});
test('owner/workspace/run/actor isolation, independent unit ceilings, and bounded durable history', () => {
  const f=fixture({maxHistory:2}), a=scope('A','agent','run1'), b=scope('A','agent','run2');
  f.service.intent(a,'a',request());assert.equal(f.service.history(b).length,0);assert.equal(f.service.history(scope('B')).length,0);
  assert.equal(f.service.history({...a,workspace:'other'}).length,0);assert.throws(()=>f.service.start(b,'a'),/job_unavailable/);
  f.service.intent(b,'b',request());assert.equal(f.service.history(scope()).length,2);
  assert.throws(()=>f.service.intent(scope(),'c',request()),/history_capacity/);
  f.service.estimate(a,'a');assert.throws(()=>f.service.approve(a,'a',{amount:8,unit:'usd_micro'}),/owner_approval_required/);
  const g=fixture();g.ports.store.transact('A','work',d=>{d.ceilings.usd_micro=7;return true;});g.ready();
  assert.equal(g.service.start(scope(),'one').waitReason,'ceiling');assert.equal(g.calls.length,0);
});
test('final trusted boundary rechecks input grants, authority and quote freshness before transport', () => {
  for(const refusal of ['input','authority','expiry']) {
    const f=fixture(),r=scribeRequest();f.ready('note',r);let reserved=false;
    const transact=f.ports.store.transact;
    f.ports.store.transact=(owner,workspace,edit)=>{
      const result=transact(owner,workspace,edit);
      if((result as any)?.phase==='reserved') {reserved=true;if(refusal==='expiry')f.setNow(200);}
      return result;
    };
    f.ports.access=caller=>{
      return {scope:caller as Scope,current:!(refusal==='authority'&&reserved),
        inputsAuthorized:!(refusal==='input'&&reserved)};
    };
    // start/job and enter/job obtain fresh trusted access, then reserve and final enter revalidate it.
    if(refusal==='expiry') assert.equal(f.service.start(scope(),'note').state,'waiting');
    else assert.throws(()=>f.service.start(scope(),'note'));
    assert.equal(f.calls.length,0);
    reserved=false;
    assert.equal(f.service.history(scope())[0].reservation,undefined);
  }
});
test('GET read is effect-free and refuses response/schema/secret-bearing failures', () => {
  const f=fixture();f.setReply({status:200,contentType:'application/json',json:[]});
  const r:Request={operation:'get_models',revision,params:{},inputs:[],unit:'usd_micro'};
  assert.deepEqual(f.service.read(scope(),r),{json:[]});assert.equal(f.service.history(scope()).length,0);
  for(const status of [401,429,500,302]) {f.setReply({status,contentType:'application/json',json:{secret:'private'}});assert.throws(()=>f.service.read(scope(),r),/^Error: read_unavailable$/);}
  f.setReply({status:200,contentType:'application/json',json:{access_token:'private'}});assert.throws(()=>f.service.read(scope(),r),/read_unavailable/);
  assert.throws(()=>f.service.read(scope(),request()),/invalid_read/);
});
function sourceExample(name:string) {return structuredClone((openapi as any).components.schemas[name].example);}
for(const [id, schema,query] of [
  ['get_voices','GetVoicesResponseModel',{}],
  ['get_library_voices','GetLibraryVoicesResponseModel',{}],
  ['get_user_subscription_info','ExtendedSubscriptionResponseModel',{}],
  ['usage_characters','UsageCharactersResponseModel',{start_unix:1738252091000,end_unix:1739404800000}],
] as const) test(`positive source response DTO ${id}: exact nonempty data, read-only transport`, () => {
  const f=fixture(),body=sourceExample(schema),r:Request={operation:id,revision,params:{query},inputs:[],unit:'usd_micro'};
  assert.ok(body&&Object.keys(body).length);if('voices' in body)assert.ok(body.voices.length);
  f.setReply({status:200,contentType:'application/json',json:body});
  const result=f.service.read(scope(),r);assert.deepEqual(result,{json:body});assert.equal(f.calls.length,1);assert.equal(f.calls[0].method,'GET');
  assert.equal(f.service.history(scope()).length,0);assert.equal(f.files.size,0);
  if('voices' in body)assert.equal((result as any).json.voices[0].preview_url,body.voices[0].preview_url);
  if(id==='get_user_subscription_info') {
    assert.equal((result as any).json.character_count,1000);assert.equal((result as any).json.character_limit,10000);
    assert.deepEqual((result as any).json.current_overage,{amount:'0',currency:'usd'}); // exact vendor DTO; no inferred account balance/credit conversion
  }
  const invalid=structuredClone(body);
  const mandatory=id==='usage_characters'?'time':id==='get_user_subscription_info'?'character_limit':'voices';
  delete invalid[mandatory];f.setReply({status:200,contentType:'application/json',json:invalid});
  assert.throws(()=>f.service.read(scope(),r),/read_unavailable/);
});
test('voice-list cursor and preview metadata roundtrip through prepareRead/receipt without becoming transport authority', () => {
  const f=fixture(),voice=sourceExample('VoiceResponseModel'),cursor='page-token:abc+/= bearer https://cursor.example/';
  const dto={voices:[voice],has_more:true,total_count:2,next_page_token:cursor};
  const r:Request={operation:'get_user_voices_v2',revision,params:{query:{page_size:1}},inputs:[],unit:'usd_micro'};
  const plan=f.service.prepareRead(scope(),r);assert.equal(f.calls.length,0);
  const result=f.service.readReceipt(scope(),plan,{status:200,contentType:'application/json',json:dto});
  assert.deepEqual(result,{json:dto});
  const next={...r,params:{query:{page_size:1,next_page_token:(result as any).json.next_page_token}}};
  f.setReply({status:200,contentType:'application/json',json:{...dto,has_more:false,next_page_token:null}});
  assert.equal((f.service.read(scope(),next) as any).json.next_page_token,null);
  assert.equal(f.calls.length,1);assert.ok(f.calls[0].url.startsWith('https://api.elevenlabs.io/v2/voices?'));
  assert.ok(f.calls[0].url.includes('next_page_token='+encodeURIComponent(cursor)));
  assert.equal(f.calls[0].params.query!.next_page_token,cursor);assert.deepEqual(f.calls[0].credential,{plugin:'elevenlabs',name:'elevenlabs-api-key'});
  assert.throws(()=>f.service.prepareRead(scope(),{...r,params:{query:{page_size:101}}}),/invalid_read/);
  const forged=structuredClone(plan);forged.wire.url=voice.preview_url;
  assert.throws(()=>f.service.readReceipt(scope(),forged,{status:200,contentType:'application/json',json:dto}),/intent_conflict/);
});
test('exact credential/session issuer operations have sourced limitations, not blanket token stripping', () => {
  const f=fixture();
  for(const id of ['get_conversation_signed_link','get_signed_url_deprecated','get_livekit_token','get_service_account_api_keys_route']) {
    assert.match(disposition(operation(id)).limitation!,/credentials\/session authority/);
  }
  const r:Request={operation:'get_livekit_token',revision,params:{query:{agent_id:'agent_safe'}},inputs:[],unit:'usd_micro'};
  assert.throws(()=>f.service.prepareRead(scope(),r));assert.equal(f.calls.length,0);
});
test('credential resolution is confined to the transport at the pinned origin; no secret in requests/jobs/errors', () => {
  const f=fixture();const fakeSecret='fixture-secret-never-returned';let resolutions=0;
  f.setHttp(wire=>{
    assert.equal(new URL(wire.url).origin,'https://api.elevenlabs.io');
    assert.deepEqual(wire.credential,{plugin:'elevenlabs',name:'elevenlabs-api-key'});
    // This fake host resolves only after checking the origin and plugin bucket. The service has no value-reading API.
    const backendOnly=new Map([['elevenlabs/elevenlabs-api-key',fakeSecret]]);
    const header=backendOnly.get(wire.credential.plugin+'/'+wire.credential.name);resolutions++;
    assert.equal(header,fakeSecret);
    throw new Error('transport error reflected '+header);
  });
  f.ready();assert.equal(resolutions,0);const job=f.service.start(scope(),'one');assert.equal(resolutions,1);
  assert.equal(job.state,'unknown');assert.ok(!JSON.stringify({job,history:f.service.history(scope())}).includes(fakeSecret));
  assert.ok(!JSON.stringify(f.calls).includes(fakeSecret));
});
test('metadata cap counts UTF8 bytes and never silently truncates a long Scribe transcript', () => {
  assert.equal(utf8Size('xé世😀'),10);
  const f=fixture(), r=scribeRequest();f.ready('note',r);
  f.setReply({status:200,contentType:'application/json',json:{text:'世'.repeat(90000),language_code:'en',language_probability:1,words:[]}});
  assert.equal(f.service.start(scope(),'note').state,'unknown');assert.equal(f.files.size,0);
});
test('missing transport and unsupported serialization refuse before effect admission', () => {
  const f=fixture();f.ready();f.ports.http=undefined;
  assert.throws(()=>f.service.start(scope(),'one'),/transport_unavailable/);assert.equal(f.service.history(scope())[0].state,'waiting');
  const g=fixture(),r=scribeRequest();(r.params as any).body.keyterms=['hello'];
  g.ready('note',r);assert.throws(()=>g.service.start(scope(),'note'),/multipart_serialization_unavailable/);
  assert.equal(g.service.history(scope())[0].state,'waiting');assert.equal(g.calls.length,0);
});
test('every voice mutation denies before network, including design/cloning and existing settings', () => {
  const f=fixture();
  for(const row of operations.filter(x=>x.family==='voices'&&x.method!=='GET'&&!x.path.startsWith('/v1/voice-changer/'))) {
    assert.match(disposition(row).limitation!,/immutable/);
    assert.throws(()=>f.service.intent(scope(),row.id,{operation:row.id,revision,params:{},inputs:[],unit:'usd_micro'}));
  }
  assert.equal(f.calls.length,0);
});
test('schema-valid existing settings, cloning and persistent creation requests are denied before admission', () => {
  const f=fixture();
  const requests:Request[]=[
    {operation:'edit_voice_settings',revision,unit:'usd_micro',inputs:[],params:{path:{voice_id:'Rollo'},body:sourceExample('VoiceResponseModel').settings}},
    {operation:'add_voice',revision,unit:'usd_micro',inputs:[{kind:'artifact',id:'immutable-test-audio',contentType:'audio/wav'}],params:{body:{name:'Denied clone',files:[{input:0}]}}},
    {operation:'create_voice',revision,unit:'usd_micro',inputs:[],params:{body:{voice_name:'Denied creation',voice_description:'A description with at least twenty characters',generated_voice_id:'source-preview-id'}}},
  ];
  for(const r of requests) {assert.equal(validateRequest(r),true);assert.throws(()=>f.service.intent(scope(),r.operation,r),/protected_voice/);}
  assert.equal(f.calls.length,0);assert.equal(f.service.history(scope()).length,0);
});
function scribeRequest():Request { return {operation:'speech_to_text',revision,unit:'usd_micro',
  inputs:[{kind:'artifact',id:'immutable-audio-sha256-identity',contentType:'audio/wav'}],
  params:{body:{model_id:'scribe_v2',file:{input:0},language_code:'en'}}}; }
test('existing selectable Scribe contract: preserves local/remote backend until explicit choice; repeat is free', () => {
  const f=fixture(), r=scribeRequest();f.ready('note',r);
  f.setReply({status:200,contentType:'application/json',json:{text:'Hello',language_code:'en',language_probability:0.99,words:[]}});
  const scribe=createScribe(f.service,{available:()=>true,resolve:()=>({caller:scope(),intent:'note',request:r}),
    text:(_caller,id)=>f.files.get(id)?.json});
  let active='transcriber', local=0, remote=0;
  const backends={transcriber:{transcribe:()=>{local++;return {text:'local'};}},remote:{transcribe:()=>{remote++;return {text:'remote'};}},elevenlabs:scribe};
  const invoke=()=>backends[active as keyof typeof backends].transcribe('host-selected-audio','en');
  assert.deepEqual(scribe.transcribeStatus(),{state:'ready'});assert.deepEqual(invoke(),{text:'local'});assert.equal(f.calls.length,0);
  active='remote';assert.deepEqual(invoke(),{text:'remote'});assert.equal(f.calls.length,0);
  active='elevenlabs';assert.deepEqual(invoke(),{text:'Hello',language:'en'});assert.equal(f.calls.length,1);
  assert.deepEqual(invoke(),{text:'Hello',language:'en'});assert.equal(f.calls.length,1);
  assert.equal(local,1);assert.equal(remote,1);assert.equal((scribe.transcribe('audio','fr') as any).code,'denied');
});
test('Scribe preserves exact transcript prose containing tabs/newlines, URL, bearer and API-key words', () => {
  const f=fixture(),r=scribeRequest(),text='\tOpen https://example.org/?token=read\nSay bearer token and xi-api-key, then pause.\n';
  f.ready('content',r);f.setReply({status:200,contentType:'application/json',json:{text,language_code:'en',language_probability:1,words:[]}});
  const scribe=createScribe(f.service,{available:()=>true,resolve:()=>({caller:scope(),intent:'content',request:r}),text:(_c,id)=>f.files.get(id)?.json});
  assert.deepEqual(scribe.transcribe('fixture-only-binding','en'),{text,language:'en'});assert.equal(f.files.get('A:content').json.text,text);
  assert.deepEqual(scribe.transcribe('fixture-only-binding','en'),{text,language:'en'});assert.equal(f.calls.length,1);
});
test('Scribe status is free; absent input/budget/transport/error stays typed and sanitized', () => {
  const f=fixture(), r=scribeRequest();
  const scribe=createScribe(f.service,{available:()=>true,resolve:()=>({caller:scope(),intent:'note',request:r}),text:()=>null});
  scribe.transcribeStatus();assert.equal(f.calls.length,0);
  assert.equal((scribe.transcribe('audio','en') as any).code,'waiting');assert.equal(f.calls.length,0);
  f.service.estimate(scope(),'note');f.service.approve(scope(),'note',{amount:8,unit:'usd_micro'});
  f.setHttp(()=>{throw new Error('private credential and path');});
  const result=scribe.transcribe('audio','en');assert.equal((result as any).code,'unknown');assert.ok(!JSON.stringify(result).includes('private'));
  assert.equal(plugin.transcribeStatus().state,'unavailable');assert.ok('error' in plugin.transcribe('audio'));
});
test('production uses common backend core/cost/contracts and leaves Promise media helpers to browser code', () => {
  const source=readFileSync(new URL('../src/client.ts',import.meta.url),'utf8');
  for(const module of ['core','cost','contracts']) assert.ok(source.includes(`../../media-shared/src/${module}`));
  assert.ok(!source.includes('../../media-shared/src/media'));assert.ok(!source.includes('humanAction'));assert.ok(!source.includes('reopen'));
  assert.ok(!source.includes('MediaController'));assert.ok(!source.includes('host.exec'));assert.ok(!source.includes('host.fetch'));
  assert.ok(!source.includes('apiKey:'));assert.ok(!source.includes('setInterval'));
  const f=fixture();assert.equal('reopen' in f.service,false);assert.equal('humanAction' in f.service,false);
});
