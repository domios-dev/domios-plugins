import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {fixture,request} from './adapter-fixture';
import {createCommands,summary} from '../src/commands';
import {documentUI,selectedSchema,projectSchema,uiBounds,jsonBytes,displayAmount,validateUIArgs} from '../src/view-model';
import type {UIDetails,UISnapshot,UISchema} from '../src/view-model';
import {StudioController} from '../ui/src/controller';
import {bridgeTransport} from '../ui/src/api';
import type {UITransport} from '../ui/src/api';
import {App} from '../ui/src/App';
import {PlaybackGroup,seekAudio,unavailableMedia,unavailableVoices} from '../ui/src/media';
import {fixtureTransport,selectFixtureOwner,fixtureMedia,fixtureVoices} from '../ui/dev/fixtures';
const documentContext=(label:string)=>({origin:'document',plugin:'elevenlabs',frame:`fixture-frame-${label}`,surface:'studio',instance:`fixture-instance-${label}`,tab:`fixture-tab-${label}`,actor:{kind:'local'}});
function setup(){const f=fixture(),a=f.grant(documentContext('A'),'A'),b=f.grant(documentContext('B'),'B');return {f,a,b};}
test('document snapshot defaults20, exact pagination and maximum50 use same authorized history',()=>{
  const {f,a,b}=setup();for(let n=0;n<35;n++)f.service.intent(a,`a-${n}`,request());f.service.intent(b,'foreign',request());
  // Respect the accepted fixture's40-job capacity; no backend retention policy is altered for UI tests.
  const first=documentUI(f.service,a,'ui.snapshot',{},f.now()) as UISnapshot;
  assert.equal(first.kind,'available');assert.equal(first.items.length,20);assert.equal(first.total,35);assert.equal(first.next,20);
  const page=documentUI(f.service,a,'ui.snapshot',{offset:20,limit:50},f.now()) as UISnapshot;
  assert.equal(page.items.length,15);assert.equal(page.next,null);assert(!page.items.some(i=>i.id==='foreign'));
  assert.equal(jsonBytes(first)<=uiBounds.snapshot,true);
});
test('exact keys, safe integers, bounded strings, forged caller fields, unknown methods refuse',()=>{
  const {f,a}=setup();
  for(const args of [null,{offset:null},{limit:null},{offset:-1},{offset:1.1},{offset:Number.MAX_SAFE_INTEGER+1},{limit:0},{limit:51},{owner:'B'},{actor:'B'},{run:'x'},{frame:'x'},{offset:0,extra:1}])assert.equal(documentUI(f.service,a,'ui.snapshot',args,100).kind,'unavailable');
  for(const id of ['', ' '.repeat(3),'x'.repeat(256)])assert.equal(documentUI(f.service,a,'ui.details',{id},100).kind,'unavailable');
  assert.equal(documentUI(f.service,a,'ui.forged',{},100).kind,'unavailable');
  assert.throws(()=>validateUIArgs('ui.details',{id:'😀'.repeat(1100)}));
  assert.equal(jsonBytes('😀'),6);assert.equal(jsonBytes('é'),4);
});
test('details contain private authorized settings, opaque descriptors and complete selected schema; public summaries remain private-data-free',()=>{
  const {f,a,b}=setup();const job=f.service.intent(a,'own',request());
  const details=documentUI(f.service,a,'ui.details',{id:'own'},100) as UIDetails;
  assert.equal(details.kind,'available');assert.deepEqual(details.params,request().params);assert.equal((details.schema.properties?.body?.properties?.text as any).type,'string');
  assert.equal(documentUI(f.service,b,'ui.details',{id:'own'},100).kind,'unavailable');
  const publicText=JSON.stringify(summary(job,100));assert(!publicText.includes('Private prompt'));assert(!publicText.includes('model_id'));assert(!publicText.includes('voice_id'));
  const encoded=JSON.stringify(details);for(const marker of ['authRevision','binding','credential','tariffRevision','actorId','workspace-user'])assert(!encoded.includes(marker));
});
test('document viewCall retains trusted resolver refusal; agent verbs do not expose document DTO',()=>{
  const {f,a}=setup();let calls=0;
  const commands=createCommands(f.service,{caller(ctx){calls++;if(ctx!==a)throw new Error('foreign');return a;},surface:{call(){throw new Error('unavailable');},invalidate(){}} as any,now:f.now,nextIntent:f.next});
  assert.equal((commands.viewCall('ui.snapshot',{},a) as UISnapshot).kind,'available');
  assert.deepEqual(commands.viewCall('ui.snapshot',{},{...a as object}),{error:'authority_unavailable'});
  assert.equal(calls,2);assert.equal(commands.onAgentCommand({verb:'ui.snapshot',args:[]} as any).error,'invalid_arguments');
  assert.equal((commands.viewCall('ui.snapshot',{owner:'B'},a) as any).code,'arguments_refused');
});
test('document-only route rejects registered non-document and incomplete contexts even when shared resolver authorizes them',()=>{
  const {f,a}=setup();f.service.intent(a,'private',request());
  const surface={surface:'studio',instance:'registered-agent-instance',tab:'registered-agent-tab',owner:'A',actor:'A',actorLabel:'Agent A'};
  const rejected:unknown[]=[surface,{...documentContext('remote'),origin:'remote_task'},
    {...documentContext('recording'),origin:'recording_setup'},{...documentContext('agent'),origin:'agentSurface'},
    {...documentContext('missing-frame'),frame:undefined},{...documentContext('blank-frame'),frame:'  '},
    {...documentContext('missing-surface'),surface:undefined},{...documentContext('missing-instance'),instance:undefined},
    {...documentContext('missing-tab'),tab:undefined},{...documentContext('foreign-plugin'),plugin:'another-plugin'},
    {...documentContext('missing-actor'),actor:undefined},{...documentContext('non-string-frame'),frame:42},Object.assign([],documentContext('array')),{}];
  // Every negative context is genuinely registered in the same resolver/service fixture.
  // Registration is intentionally not a substitute for document-only routing.
  for(const context of rejected)f.grant(context,'A');
  let calls=0;
  const commands=createCommands(f.service,{caller(ctx){calls++;return f.authorize(ctx);},surface:{call(){throw new Error('unavailable');},invalidate(){}} as any,now:f.now,nextIntent:f.next});
  const methods=[['ui.snapshot',{}],['ui.details',{id:'private'}],['ui.schema',{operation:'text_to_speech_full'}]] as const;
  for(const [method,args] of methods){
    assert.equal((commands.viewCall(method,args,a) as any).kind,'available');
    const before=calls;
    for(const context of rejected)assert.deepEqual(commands.viewCall(method,args,context),{error:'authority_unavailable'});
    assert.equal(calls,before,'route rejects non-document contexts before shared resolver dispatch');
    for(const clone of [{...a as object},{...a as object,frame:'forged-frame'},{...a as object,owner:'forged-owner'}])
      assert.deepEqual(commands.viewCall(method,args,clone),{error:'authority_unavailable'});
  }
  // Existing public document/agent command semantics and public summaries are unchanged.
  assert.equal((commands.viewCall('history',{},surface) as any[]).length,1);
  assert.deepEqual(JSON.parse(commands.onSurfaceCall(surface,'ui.snapshot',[])),{error:'request_refused'});
  assert.equal(f.network(),0);
});
test('unchanged registered document still requires live resolver authorization and authorized service history',()=>{
  const {f,a,b}=setup();f.service.intent(a,'private',request());let live=true;
  const commands=createCommands(f.service,{caller(ctx){const token=f.authorize(ctx);if(!live)throw new Error('expired');return token;},surface:{call(){throw new Error('unavailable');},invalidate(){}} as any,now:f.now,nextIntent:f.next});
  assert.equal((commands.viewCall('ui.details',{id:'private'},a) as UIDetails).kind,'available');
  assert.equal((commands.viewCall('ui.details',{id:'private'},b) as any).code,'item_unavailable');
  live=false;assert.deepEqual(commands.viewCall('ui.snapshot',{},a),{error:'authority_unavailable'});
  assert.equal(f.network(),0);
});
test('selected schemas include actual constraints/defaults; schema depth/fields/size refuse without truncation',()=>{
  const schema=selectedSchema('text_to_speech_full') as UISchema;
  assert.equal(schema.kind,'available');assert.equal(schema.schema.properties?.path?.properties?.voice_id?.type,'string');
  assert.equal(schema.schema.properties?.body?.properties?.model_id?.default,'eleven_multilingual_v2');
  assert(schema.schema.properties?.query?.properties?.output_format?.enum?.includes('mp3_44100_128'));
  let deep:any={type:'string'};for(let n=0;n<13;n++)deep={type:'array',items:deep};assert.equal((projectSchema(deep) as any).kind,'unavailable');
  assert.equal((projectSchema({type:'object',properties:Object.fromEntries(Array.from({length:129},(_,n)=>[`f${n}`,{type:'string'}]))}) as any).kind,'unavailable');
  assert.equal((projectSchema({type:'string',description:'x'.repeat(uiBounds.schema)}) as any).code,'schema_too_large');
  assert.equal((projectSchema({type:'string',unrecognizedConstraint:true}) as any).kind,'unavailable');
  const preserved=projectSchema({type:'number',minimum:0,maximum:1,multipleOf:0.1});assert.deepEqual(preserved,{type:'number',minimum:0,maximum:1,multipleOf:0.1});
});
test('details response budget and unsupported host references disable reusable data',()=>{
  const {f,a}=setup();const r=request();(r.params as any).body.previous_text='😀'.repeat(17000);f.service.intent(a,'large',r);
  assert.equal((documentUI(f.service,a,'ui.details',{id:'large'},100) as any).code,'details_too_large');
  const job=f.service.intent(a,'path-output',request());
  for(const p of f.store.values())p.jobs.find(j=>j.id===job.id)!.outputs=[{kind:'artifact',id:'C:/private/file.wav',contentType:'audio/wav'}];
  assert.equal((documentUI(f.service,a,'ui.details',{id:job.id},100) as any).code,'details_unsupported');
});
test('unknown price and stale price stay gated; amount formatting preserves exact atomic units',()=>{
  assert.equal(displayAmount(8,'usd_micro'),'$0.000008');assert.equal(displayAmount(1501,'credit_milli'),'1.501 credits');assert.equal(displayAmount(1234,'characters'),'1,234 characters');
  const {f,a}=setup();f.service.intent(a,'price',request());f.service.estimate(a,'price');f.setTime(200);
  const item=(documentUI(f.service,a,'ui.snapshot',{},200) as UISnapshot).items[0];assert.equal(item.price.kind,'stale');assert.equal(item.state,'price_stale');
});
test('production bridge invokes typed real method and subscribes without fallback or polling',async()=>{
  await assert.rejects(()=>bridgeTransport().call('ui.snapshot',{}));let called='',listener:(()=>void)|undefined,invalidations=0;
  const transport=bridgeTransport({async invoke(method,args){called=method;assert.deepEqual(args,{id:'x'});return {kind:'unavailable',code:'item_unavailable',message:'Unavailable'};},onSurfaceStateChanged(fn){listener=fn;return()=>{listener=undefined;};}});
  await transport.call('ui.details',{id:'x'});assert.equal(called,'ui.details');const unsub=transport.subscribe(()=>invalidations++);listener!();assert.equal(invalidations,1);unsub();assert.equal(listener,undefined);
  assert.equal(await unavailableMedia.acquire('anything'),null);assert.equal((await unavailableVoices.list()).kind,'unavailable');
});
test('actual controller and fixture transport gate estimates, double submission and unknown reload without provider effects',async()=>{
  let saved='';const fixture=fixtureTransport({scenario:'owners',save:text=>{saved=text;},now:()=>1000}),c=new StudioController(fixture.transport,()=>1000);
  await c.mount();assert(c.price().invalid);c.edit('path','voice_id','synthetic-voice-alba');c.edit('body','text','A private narration.');await c.estimate();assert.equal(c.price().gate.kind,'ready');
  await Promise.all([c.generate(),c.generate()]);assert.equal(fixture.submissions(),1);fixture.unknown();await c.refresh();await c.generate();assert.equal(fixture.submissions(),1);
  const reloaded=fixtureTransport({scenario:'owners',load:()=>saved,now:()=>1000}),after=new StudioController(reloaded.transport,()=>1000);await after.mount();await after.generate();assert.equal(reloaded.submissions(),1);c.dispose();after.dispose();
});
test('stale quote disables paid submission and editing invalidates quote; over-limit Text has one helper',async()=>{
  let now=1000;const f=fixtureTransport({scenario:'owners',now:()=>now}),c=new StudioController(f.transport,()=>now);await c.mount();c.edit('path','voice_id','synthetic-voice-alba');c.edit('body','text','Hello');await c.estimate();now=62000;assert.equal(c.price().gate.kind,'stale');await c.generate();assert.equal(f.submissions(),0);
  c.edit('body','text','x'.repeat(10001));assert.equal(c.price().invalid,'Shorten the text by 1 characters');assert.equal(c.state.id,undefined);c.dispose();
});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
test('actual owner handler atomically clears old draft/history/details and fences stale snapshot/details/schema',async()=>{
  const fixture=fixtureTransport({scenario:'owners',now:()=>1000});const base=fixture.transport;
  const delayedSnapshot=deferred<any>(),delayedDetails=deferred<any>(),delayedSchema=deferred<any>();let hold='';
  const transport:UITransport={subscribe:base.subscribe,call(method,args){if(hold===method){hold='';return (method==='ui.snapshot'?delayedSnapshot:method==='ui.details'?delayedDetails:delayedSchema).promise;}return base.call(method,args) as any;}};
  const c=new StudioController(transport,()=>1000);await c.mount();const oldSnapshot=c.state.snapshot!;c.edit('body','text','Owner A secret');c.note('Owner A note');
  hold='ui.details';const detail=c.inspect(oldSnapshot.items[0].id);hold='ui.schema';const schema=c.selectOperation('text_to_speech_full');hold='ui.snapshot';const refresh=c.refresh();
  const change=selectFixtureOwner(fixture,c,'B');assert.equal(c.state.snapshot,undefined);assert.deepEqual(c.state.params,{});assert.equal(c.state.note,'');assert.equal(c.state.details,undefined);assert.equal(c.state.id,undefined);
  await change;const expected=c.state.snapshot;delayedSnapshot.resolve(oldSnapshot);delayedDetails.resolve({kind:'available',item:oldSnapshot.items[0],params:{body:{text:'Owner A secret'}},schema:{}});delayedSchema.resolve({kind:'available',schema:{properties:{}},revision:'old'});
  await Promise.all([detail,schema,refresh]);assert.equal(c.state.snapshot,expected);assert.equal(c.state.details,undefined);assert(!JSON.stringify(c.state).includes('Owner A secret'));c.dispose();
});
test('free reuse and variation are validated preparations, not effects',async()=>{
  const f=fixtureTransport({scenario:'all',now:()=>1000}),c=new StudioController(f.transport,()=>1000);await c.mount();const generated=c.state.snapshot!.items.find(i=>i.state==='generated')!;await c.inspect(generated.id);assert(c.state.details);c.reuse();assert.equal(c.state.id,undefined);assert.equal(f.submissions(),0);assert.equal(c.body().text,generated.title);c.dispose();
});
test('actual production App renders shared Studio/SchemaFields/Price/Inspector with audio rows and human labels',async()=>{
  const f=fixtureTransport({scenario:'all',now:()=>1000}),c=new StudioController(f.transport,()=>1000);await c.mount();
  let markup=renderToStaticMarkup(React.createElement(App,{controller:c,media:fixtureMedia,voices:fixtureVoices,fixtureLibrary:true}));
  assert(markup.includes('data-layout="rows"'));assert(markup.includes('eleven-row'));assert(!markup.includes('Note (optional)'));assert(!markup.includes('Generate for')); assert(!markup.includes('>eleven_multilingual_v2<'));assert(!markup.includes('>synthetic-voice-alba<'));
  const generated=c.state.snapshot!.items.find(i=>i.state==='generated')!;await c.inspect(generated.id);markup=renderToStaticMarkup(React.createElement(App,{controller:c}));assert(markup.includes('Result inspector'));assert(!markup.includes('Use these settings'));assert(!markup.includes('Back to results'));c.dispose();
});
test('playback group pauses previous sample/row and seeks within decoded duration',()=>{
  let pausesA=0,pausesB=0;const a={pause(){pausesA++;}},b={pause(){pausesB++;}},group=new PlaybackGroup();group.play(a as any);group.play(b as any);assert.equal(pausesA,1);group.release(b as any);assert.equal(pausesB,1);
  const audio={currentTime:2,duration:4};seekAudio(audio,5);assert.equal(audio.currentTime,4);seekAudio(audio,-5);assert.equal(audio.currentTime,0);audio.duration=NaN;seekAudio(audio,5);assert.equal(audio.currentTime,0);
});
test('production imports exclude all developer fixtures, service algorithms/public verbs unchanged by UI entry',()=>{
  for(const file of readdirSync(new URL('../ui/src/',import.meta.url)).filter(v=>/\.(ts|tsx)$/.test(v))){const source=readFileSync(new URL('../ui/src/'+file,import.meta.url),'utf8');assert(!/from\s+['"][^'"]*\/dev\//.test(source));assert(!source.includes('fixtureTransport'));}
  const media=readFileSync(new URL('../ui/src/media.ts',import.meta.url),'utf8');assert(!media.includes('fetch('));
  const dev=readFileSync(new URL('../ui/dev/fixtures.ts',import.meta.url),'utf8');assert(!dev.includes('fetch('));assert(!dev.includes('service.start('));
  const app=readFileSync(new URL('../ui/src/App.tsx',import.meta.url),'utf8');assert(app.includes("from '../../../media-shared/ui/src'"));assert(!app.includes('setTimeout'));
});

test('local text selection uses code points and never derives audio time', async()=>{
  const {textSpan,timeRange}=await import('../../media-shared/ui/src/selection');
  assert.deepEqual(textSpan('A😀BC',1,2),{start:1,end:2,quote:'😀'});
  assert.equal(textSpan('A😀BC',2,2),null);
  assert.equal(textSpan('A😀BC',0,5),null);
  assert.deepEqual(timeRange(1000,2000,4000),{t0_ms:1000,t1_ms:2000});
  assert.equal(timeRange(-1,2000,4000),null);
  assert.equal(timeRange(1000,4001,4000),null);
});


test('actual audio inspector hides comments without an explicit synthetic fixture target',async()=>{
  const f=fixtureTransport({scenario:'all'}),c=new StudioController(f.transport);await c.mount();const item=c.state.snapshot!.items.find(i=>i.state==='generated')!;await c.inspect(item.id);
  const real=renderToStaticMarkup(React.createElement(App,{controller:c,media:fixtureMedia}));assert(!real.includes('Fixture: not sent'));assert(!real.includes('>Comment</button>'));
  const simulated=renderToStaticMarkup(React.createElement(App,{controller:c,media:fixtureMedia,selection:(_i,_text,children)=>React.createElement('div',{'data-fixture-slot':true},children)}));assert(simulated.includes('data-fixture-slot'));assert.equal(f.submissions(),0);c.dispose();
});


test('fixture timeline gesture maps a drag to known-duration bounds',async()=>{
  const {timelineGesture}=await import('../../media-shared/ui/dev/FixtureSelection');
  assert.deepEqual(timelineGesture({left:10,width:400},110,210,4000),{t0_ms:1000,t1_ms:2000});
  assert.equal(timelineGesture({left:10,width:400},0,210,4000),null);
  assert.equal(timelineGesture({left:10,width:400},110,110,4000),null);
});


test('range and phrase event decisions use real offsets and keep no invented alignment',async()=>{
  const {handleTimelinePointer,spanFromOffsets}=await import('../../media-shared/ui/dev/FixtureSelection');const picked:any[]=[];const down={current:null as number|null};
  const event=(x:number)=>({clientX:x,currentTarget:{getBoundingClientRect:()=>({left:10,width:400})}} as any);
  handleTimelinePointer(event(110),false,4000,down,a=>picked.push(a));handleTimelinePointer(event(210),true,4000,down,a=>picked.push(a));
  assert.deepEqual(picked,[{kind:'range',range:{t0_ms:1000,t1_ms:2000}}]);assert.deepEqual(spanFromOffsets('A😀BC',1,3),{start:1,end:2,quote:'😀'});assert.equal(spanFromOffsets('A😀BC',1,2),null);
});


test('time range requires at least fifty milliseconds',async()=>{
  const {timeRange}=await import('../../media-shared/ui/src/selection');
  assert.equal(timeRange(1000,1049,4000),null);assert.deepEqual(timeRange(1000,1050,4000),{t0_ms:1000,t1_ms:1050});
});

test('audio file actions have a rail slot before the inspector text',async()=>{
  const f=fixtureTransport({scenario:'all'}),c=new StudioController(f.transport);await c.mount();const item=c.state.snapshot!.items.find(i=>i.state==='generated')!;await c.inspect(item.id);
  const markup=renderToStaticMarkup(React.createElement(App,{controller:c,media:fixtureMedia}));
  assert(markup.indexOf('studio-rail-actions')<markup.indexOf('<h2>Text</h2>'));assert.equal(f.submissions(),0);c.dispose();
});

test('text keyboard offsets retain complete code points at selection boundaries',async()=>{
  const {spanFromOffsets}=await import('../../media-shared/ui/dev/FixtureSelection');
  assert.deepEqual(spanFromOffsets('A😀BC',3,1),{start:1,end:2,quote:'😀'});
  assert.equal(spanFromOffsets('A😀BC',1,2),null);assert.equal(spanFromOffsets('A😀BC',3,3),null);
});
