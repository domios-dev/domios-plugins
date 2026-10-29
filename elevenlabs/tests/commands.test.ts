import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCommands,verbs} from '../src/commands';
import plugin from '../src/plugin';
import {fixture,request} from './adapter-fixture';

function setup(){
  const f=fixture(),A={surface:'studio',instance:'a',tab:'child-a',owner:'A',actor:'A',actorLabel:'Agent A'},B={...A,instance:'b',tab:'child-b',owner:'B',actor:'B'};
  f.grant(A,'A');f.grant(B,'B');
  const invalidations:any[]=[],opened=new Map<string,string>(),calls:any[]=[];
  let active=A,adapter:ReturnType<typeof createCommands>;
  const surface={call(verb:string,argsJson:string){
    calls.push({verb,argsJson});
    // Host behavior simulated only to verify exact adapter seam, not real nesting.
    if(verb==='open')opened.set(active.owner,active.tab);
    if(verb==='close')opened.delete(active.owner);
    return JSON.stringify({result:adapter.onSurfaceCall(active,verb,JSON.parse(argsJson))});
  },invalidate(identity:any){invalidations.push(identity);return {ok:true as const};}};
  adapter=createCommands(f.service,{surface,caller:f.authorize,nextIntent:f.next,now:f.now});
  const command=(verb:string,value?:unknown)=>{
    const r=adapter.onAgentCommand({verb,args:[],sessionId:'not-authority',...(value!==undefined?{body:JSON.stringify(value)}:{})});
    return 'result' in r?JSON.parse(r.result):r;
  };
  return {...f,A,B,adapter,surface,invalidations,opened,calls,command,setActive:(ctx:typeof A)=>{active=ctx;}};
}
test('open/reuse/close uses exact host.surface path and no fabricated plugin tabs',()=>{
  const f=setup();assert.deepEqual(f.command('open'),{ok:true});f.command('open');assert.equal(f.opened.size,1);
  f.setActive(f.B);f.command('open');assert.equal(f.opened.size,2);f.command('close');assert.deepEqual([...f.opened.keys()],['A']);
  assert.deepEqual(f.calls[0],{verb:'open',argsJson:'[]'});assert.equal(f.network(),0);
});
test('source entry dispatches through real host surface bridge; unconfigured binding refuses',()=>{
  let calls:any[]=[];(globalThis as any).host={surface:{call:(...args:any[])=>{calls.push(args);return JSON.stringify({result:'host receipt'});}}};
  try{assert.deepEqual(plugin.onAgentCommand({verb:'open',args:[],sessionId:'x'}),{result:'host receipt'});assert.deepEqual(calls,[['open','[]']]);
    assert.deepEqual(JSON.parse(plugin.onSurfaceCall()),{error:'secure_context_service_binding_unavailable'});
  }finally{delete (globalThis as any).host;}
});
test('direct document view open/close refuse without host lifecycle or a success receipt',()=>{
  const f=setup(),user={origin:'document',plugin:'elevenlabs',frame:'trusted-frame'};f.grant(user,'user',{human:true});
  f.command('open');const calls=f.calls.length,opened=[...f.opened.entries()];
  for(const verb of ['open','close']){
    assert.deepEqual(f.adapter.viewCall(verb,undefined,user),{error:'lifecycle_unavailable'});
    assert.deepEqual(f.adapter.viewCall(verb,{},user),{error:'lifecycle_unavailable'});
    assert.deepEqual(f.adapter.viewCall(verb,undefined,{...user}),{error:'authority_unavailable'});
  }
  assert.equal(f.calls.length,calls);assert.deepEqual([...f.opened.entries()],opened);assert.equal(f.invalidations.length,0);
  assert.equal(f.network(),0);
});
test('finite discovery retains full catalog and models without paid reads',()=>{
  const f=setup();assert.deepEqual(f.command('help').verbs,verbs);assert.equal(f.command('catalog').total,466);
  assert.equal(f.command('catalog').items.length,20);assert.equal(f.command('models').total,247);assert.equal(f.command('describe',{operation:'text_to_speech_full'}).id,'text_to_speech_full');
  assert.equal(f.network(),0);
});
test('prepare/estimate produce one invalidation per service update; activity excludes prompt and authority',()=>{
  const f=setup(),r=request(),prepared=f.command('prepare',{operation:r.operation,params:r.params});
  assert.equal(prepared.state,'waiting');assert.equal(f.invalidations.length,1);
  f.command('estimate',{id:prepared.id});assert.equal(f.invalidations.length,2);
  assert.deepEqual(f.invalidations[0],{surface:'studio',instance:'a',tab:'child-a'});
  const activity=JSON.stringify(f.command('activity'));assert.doesNotMatch(activity,/Private prompt|params|workspace-user|authRevision|credential|wire/);
  assert.equal(f.network(),0);
});
test('prepared intent price expires across command and document history without mutating persisted wait state',()=>{
  const f=setup(),r=request(),prepared=f.command('prepare',{operation:r.operation,params:r.params});
  assert.equal(prepared.priceState,'unavailable');assert.equal(prepared.quote,null);
  const fresh=f.command('estimate',{id:prepared.id});assert.equal(fresh.priceState,'ready');assert.deepEqual(fresh.quote,{amount:8,unit:'usd_micro',validUntilMs:150});
  assert.equal(fresh.waitReason,'owner_confirmation');f.setTime(150);
  const user={origin:'document',plugin:'elevenlabs',frame:'trusted-frame'};f.grant(user,'user',{human:true});
  const persisted=JSON.stringify([...f.store.values()]),invalidations=f.invalidations.length;
  for(const verb of ['history','activity','status']){
    for(const row of [f.command(verb)[0],(f.adapter.viewCall(verb,undefined,user) as any[])[0]]){
      assert.equal(row.priceState,'stale');assert.equal(row.quote,null);assert.equal(row.state,'waiting');assert.equal(row.waitReason,'price_stale');
    }
  }
  for(const row of [f.command('inspect',{id:prepared.id}),f.command('result',{id:prepared.id}).job]){
    assert.equal(row.quote,null);assert.equal(row.priceState,'stale');assert.equal(row.waitReason,'price_stale');
  }
  assert.equal(JSON.stringify([...f.store.values()]),persisted);assert.equal(f.service.history(f.A)[0].waitReason,'owner_confirmation');
  assert.equal(f.invalidations.length,invalidations);assert.equal(f.network(),0);
});
test('source summaries hide missing unsafe malformed wrong-unit and wrong-binding persisted quotes',()=>{
  const f=setup(),r=request(),prepared=f.command('prepare',{operation:r.operation,params:r.params});f.command('estimate',{id:prepared.id});
  const partition=[...f.store.values()][0],original=structuredClone(partition.jobs[0].quote!);
  // Corrupt synthetic persisted evidence to exercise adapter boundary defense, not shared transitions.
  const quotes=[undefined,null,{}, {...original,safe:false},{...original,amount:-1},{...original,amount:1.5},
    {...original,unit:'characters'},{...original,binding:'different-inputs'}, {...original,basis:''},{...original,tariffRevision:''},
    {...original,issuedAt:101},{...original,validUntilMs:100},{...original,validUntilMs:'tomorrow'}];
  const user={origin:'document',plugin:'elevenlabs',frame:'trusted-frame'};f.grant(user,'user',{human:true});
  for(const quote of quotes){
    [...f.store.values()][0].jobs[0].quote=quote as any;
    const before=JSON.stringify([...f.store.values()]);
    for(const row of [f.command('history')[0],f.command('activity')[0],f.command('inspect',{id:prepared.id}),
      f.command('result',{id:prepared.id}).job,(f.adapter.viewCall('history',undefined,user) as any[])[0]]){
      assert.equal(row.quote,null);assert.equal(row.priceState,'unavailable');assert.equal(row.waitReason,'price_unavailable');
    }
    assert.equal(JSON.stringify([...f.store.values()]),before);
  }
  [...f.store.values()][0].jobs[0].quote=original;f.setTime(Number.NaN);
  assert.equal(f.command('history')[0].quote,null);assert.equal(f.command('history')[0].priceState,'unavailable');assert.equal(f.network(),0);
});
test('two agents cannot inspect/cancel/rerun or fetch foreign jobs by id; user view sees authorized workspace',()=>{
  const f=setup(),r=request(),a=f.command('prepare',{operation:r.operation,params:r.params});f.setActive(f.B);
  assert.deepEqual(f.command('history'),[]);
  for(const verb of ['inspect','result','cancel','reconcile','rerun','estimate','generate'])assert.deepEqual(f.command(verb,{id:a.id}),{error:'request_refused'});
  const user={origin:'document',plugin:'elevenlabs',frame:'trusted-frame'};f.grant(user,'user',{human:true});
  assert.equal((f.adapter.viewCall('history',undefined,user) as any[]).length,1);
  assert.deepEqual(f.adapter.viewCall('history',undefined,{...user}),{error:'authority_unavailable'});
  const foreign={};f.grant(foreign,'A',{owner:'other-workspace-owner',human:true});assert.deepEqual(f.adapter.viewCall('history',undefined,foreign),[]);
});
test('args cannot forge owner/actor/run/frame/budget or delegation context',()=>{
  const f=setup(),r=request();
  for(const key of ['owner','actor','run','frame','budget','url','method','credential','approval']){
    assert.deepEqual(f.command('prepare',{operation:r.operation,params:r.params,[key]:'forged'}),{error:'request_refused'});
  }
  assert.deepEqual(JSON.parse(f.adapter.onSurfaceCall({...f.A},'history',[])),{error:'authority_unavailable'});
  const delegated={...f.A,actor:'B'};f.grant(delegated,'B');assert.deepEqual(JSON.parse(f.adapter.onSurfaceCall(delegated,'history',[])),{error:'authority_unavailable'});
  assert.equal(f.invalidations.length,0);assert.equal(f.network(),0);
});
test('rerun only prepares new intent; generate/cancel/reconcile refuse before paid entry',()=>{
  const f=setup(),r=request(),a=f.command('prepare',{operation:r.operation,params:r.params}),b=f.command('rerun',{id:a.id});
  assert.notEqual(a.id,b.id);assert.equal(b.state,'waiting');
  assert.equal(f.command('generate',{id:b.id}).error,'execution_unavailable');
  assert.equal(f.command('cancel',{id:b.id}).error,'cancel_unavailable');assert.equal(f.command('reconcile',{id:b.id}).error,'reconcile_unavailable');
  assert.equal(f.network(),0);assert.equal(f.service.history(f.A)[1].phase,undefined);
});
test('validated read prepares only; malformed schema/unknown operation/argv and oversized body refuse',()=>{
  const f=setup();assert.equal(f.command('read',{operation:'get_models',params:{}}).error,'read_transport_unavailable');
  assert.deepEqual(f.command('prepare',{operation:'not-a-vendor-operation',params:{}}),{error:'request_refused'});
  assert.deepEqual(f.command('prepare',{operation:request().operation,params:{body:{text:3}}}),{error:'request_refused'});
  assert.deepEqual(f.adapter.onAgentCommand({verb:'open',args:['--owner','B'],sessionId:'x'}),{error:'invalid_arguments'});
  assert.deepEqual(f.adapter.onAgentCommand({verb:'prepare',args:[],body:'x'.repeat(24001),sessionId:'x'}),{error:'invalid_arguments'});assert.equal(f.network(),0);
});
test('owned result exposes only opaque saved artifacts; never a backend file/frame authority',()=>{
  const f=setup(),id=f.next();f.service.intent(f.A,id,request());f.service.estimate(f.A,id);f.humanApproval(f.A,id);f.service.start(f.A,id);
  const result=f.command('result',{id});assert.deepEqual(result.artifacts,[{kind:'artifact',id,contentType:'audio/mpeg'}]);
  assert.equal(result.job.state,'generated');assert.doesNotMatch(JSON.stringify(result),/path|frame|credential|Private prompt/);
});
test('manifest view source declarations have finite verbs; no placeholder UI or converter escape',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../plugin.json',import.meta.url),'utf8'));
  assert.deepEqual(manifest.capabilities.surfaces[0].agentVerbs,verbs);assert.equal(manifest.capabilities.graphNodes.converters,undefined);
  assert.equal(manifest.minCodeterm,undefined);assert.equal(manifest.permissions.subprocess,undefined);
});
