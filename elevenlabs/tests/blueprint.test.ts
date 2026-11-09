import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createBlueprint,speechRequest} from '../src/blueprint';
import type {BlueprintStepRequest} from '@codeterm/plugin-sdk';
import {fixture} from './adapter-fixture';
import {checkCoverage,checkDescriptors,inputs} from '../scripts/check-coverage.mjs';

function setup(){
  const f=fixture();
  const req:BlueprintStepRequest={context:{scope:{workspace:'workspace',team:'team',run:'trusted-run'},owner:'workspace-user',node:'speech',attempt:'attempt',operation:'stable-operation',runView:'trusted-run-view',runLabel:'Run',nodeLabel:'Speech',inputLineage:[]},
    nodeType:'elevenlabs.tts',revision:1,params:{voice:'owned',text:'Hello',model:'eleven_multilingual_v2'},inputs:{},job:null,deadlineMs:1000};
  const token=f.grant({},'run-actor',{run:'trusted-run'}),snapshot=JSON.stringify(req.context);
  const bp=createBlueprint(f.service,{caller(r){if(r!==req||JSON.stringify(r.context)!==snapshot)throw new Error('forged_run');return token;},intent(r){if(r!==req)throw new Error('forged_run');return r.context.operation;}});
  return {...f,req,token,bp,id:'stable-operation'};
}
test('typed scalar mapping shares exact service schema, preserves text and inserts no unapproved fields',()=>{
  const r=speechRequest({voice:'owned',text:'Hello\nexact',model:'eleven_v3'});
  assert.deepEqual(r.params,{path:{voice_id:'owned'},body:{text:'Hello\nexact',model_id:'eleven_v3'}});
  for(const bad of [{voice:'../escape',text:'x',model:'eleven_v3'},{voice:'owned',text:3,model:'eleven_v3'},{voice:'owned',text:'x',model:'not-a-model'},
    {voice:'owned',text:'x',model:'eleven_v3',owner:'forged'},{voice:'owned',text:'x',model:'eleven_v3',params:'{"arbitrary":true}'}])assert.throws(()=>speechRequest(bad),/invalid_parameters/);
});
test('run estimate persists stable intent and never turns allowance into approval; submit refused pre-entry',()=>{
  const f=setup();assert.deepEqual(f.bp.blueprintEstimate(f.req),{amount:8,unit:'usd_micro',validUntilMs:150});
  f.bp.blueprintEstimate(f.req);assert.equal(f.service.history(f.token).length,1);
  assert.equal(f.service.history(f.token)[0].waitReason,'owner_confirmation');
  assert.throws(()=>f.bp.blueprintSubmit(f.req),/host_execution_contract_unavailable/);
  assert.equal(f.service.history(f.token)[0].phase,undefined);assert.equal(f.network(),0);
});
test('forged run context, cross-owner clone, nested params, unbound media and family execution refuse',()=>{
  const f=setup();assert.throws(()=>f.bp.blueprintEstimate({...f.req}),/forged_run/);
  f.req.context.owner='B';assert.throws(()=>f.bp.blueprintEstimate(f.req),/forged_run/);f.req.context.owner='workspace-user';
  f.req.params.owner='B';assert.throws(()=>f.bp.blueprintEstimate(f.req),/invalid_parameters/);delete f.req.params.owner;
  f.req.inputs={audio:[{kind:'media',handle:'ephemeral-frame-handle',media:'audio'}]};assert.throws(()=>f.bp.blueprintEstimate(f.req),/step_unavailable/);
  f.req.inputs={};f.req.nodeType='elevenlabs.speech';assert.throws(()=>f.bp.blueprintEstimate(f.req),/step_unavailable/);assert.equal(f.network(),0);
});
test('changed params cannot acquire new identity on waiting resume',()=>{
  const f=setup();f.bp.blueprintEstimate(f.req);f.req.params.text='changed';assert.throws(()=>f.bp.blueprintEstimate(f.req),/intent_conflict/);
  assert.equal(f.service.history(f.token).length,1);assert.equal(f.network(),0);
});
test('missing and stale estimates never acquire approval or enter an effect',()=>{
  const f=setup();f.setPrice(-1);assert.equal(f.bp.blueprintEstimate(f.req),null);
  assert.equal(f.service.enter(f.token,f.id).job.waitReason,'price_unavailable');
  assert.throws(()=>f.humanApproval(f.token,f.id),/price_not_approvable/);
  f.setPrice(8);f.bp.blueprintEstimate(f.req);f.setTime(151);
  assert.equal(f.service.enter(f.token,f.id).job.waitReason,'price_stale');assert.throws(()=>f.humanApproval(f.token,f.id),/price_not_approvable/);assert.equal(f.network(),0);
});
test('synthetic core waiting/resume produces one effect identity, no automatic submit, no duplicate entry',()=>{
  const f=setup();f.bp.blueprintEstimate(f.req);assert.equal(f.service.enter(f.token,f.id).job.waitReason,'owner_confirmation');
  f.humanApproval(f.token,f.id);
  const partition=[...f.store.values()][0];partition.ceilings.usd_micro=0;
  assert.equal(f.service.enter(f.token,f.id).job.waitReason,'ceiling');assert.equal(f.network(),0);
  // Synthetic host policy update; not a plugin ceiling override or a real waiting UI proof.
  [...f.store.values()][0].ceilings.usd_micro=100;
  const entered=f.service.enter(f.token,f.id);assert.ok(entered.action);assert.equal(entered.action.intentId,f.id);
  assert.equal(f.service.enter(f.token,f.id).action,undefined);
  const completed=f.service.receipt(entered.action,{status:200,contentType:'audio/mpeg',bytes:new Uint8Array([1,2,3])});
  assert.equal(completed.state,'generated');assert.equal(f.service.enter(f.token,f.id).action,undefined);
  assert.throws(()=>f.service.receipt(entered.action!,{status:200,contentType:'audio/mpeg',bytes:new Uint8Array([1])}));assert.equal(f.network(),0);
});
test('uncertain submission/reload remains Unknown; cancel/reconcile cannot replay it',()=>{
  const f=setup();f.bp.blueprintEstimate(f.req);f.humanApproval(f.token,f.id);
  const entered=f.service.enter(f.token,f.id);f.service.uncertain(entered.action!);
  f.service.recover(f.token);assert.equal(f.service.history(f.token)[0].state,'unknown');
  assert.equal(f.service.enter(f.token,f.id).action,undefined);
  assert.throws(()=>f.bp.blueprintCancel(f.req),/cancel_unavailable/);assert.throws(()=>f.bp.blueprintReconcile(f.req),/reconcile_unavailable/);
  assert.equal(f.service.ledger(f.token,'trusted-run').unknown,1);assert.equal(f.network(),0);
});
test('transport failure is uncertainty, never fabricated failed/canceled vendor proof',()=>{
  const f=setup();f.bp.blueprintEstimate(f.req);f.humanApproval(f.token,f.id);const entry=f.service.enter(f.token,f.id);
  assert.throws(()=>f.service.receipt(entry.action!,{status:500,contentType:'application/json',json:{error:'private vendor data'}}));
  f.service.uncertain(entry.action!);assert.equal(f.service.history(f.token)[0].state,'unknown');assert.equal(f.service.enter(f.token,f.id).action,undefined);
});
test('synthetic opaque audio handoff and bounded stub review retain one-hop lineage; NOT real reviewer proof',()=>{
  const f=setup();f.bp.blueprintEstimate(f.req);f.humanApproval(f.token,f.id);const entry=f.service.enter(f.token,f.id);
  f.service.receipt(entry.action!,{status:200,contentType:'audio/mpeg',bytes:new Uint8Array([1,2,3])});
  const artifact=f.service.history(f.token)[0].outputs[0],handles=new Map([['run-owned-audio',artifact.id]]);let calls=0;
  const review=(caller:unknown,input:{kind:string;id:string;media:string})=>{
    assert.equal(caller,f.token);assert.equal(input.kind,'media_source');assert.equal(input.media,'audio');
    const id=handles.get(input.id);assert.ok(id);assert.ok(f.files.get(id)!.byteLength<=3);assert.ok(++calls<=1);
    return {fixtureOnly:true,actualReviewerAcceptance:false,state:'succeeded',runView:f.req.context.runView,lineage:[{plugin:'elevenlabs',operation:f.id,port:'audio'}]};
  };
  assert.throws(()=>review({}, {kind:'media_source',id:'run-owned-audio',media:'audio'}));
  assert.throws(()=>review(f.token,{kind:'media_source',id:'frame-token',media:'audio'}));
  const result=review(f.token,{kind:'media_source',id:'run-owned-audio',media:'audio'});assert.equal(result.lineage.length,1);assert.equal(result.actualReviewerAcceptance,false);
  assert.throws(()=>review(f.token,{kind:'media_source',id:'run-owned-audio',media:'audio'}));assert.equal(f.network(),0);
});
test('manifest schema and coverage reconcile every catalog row; removed row, bad type and unknown outcome fail',async()=>{
  const data=await inputs();checkCoverage(...data);
  const missing=structuredClone(data);missing[0].operations.pop();assert.throws(()=>checkCoverage(...missing),/missing\/foreign/);
  const omitted=structuredClone(data);omitted[0].models.pop();assert.throws(()=>checkCoverage(...omitted),/missing\/foreign/);
  const bad=structuredClone(data[3]);bad.capabilities.graphNodes.steps[0].params.properties.operation.type='arbitrary';assert.throws(()=>checkDescriptors(bad),/bad type/);
  const outcome=structuredClone(data[3]);outcome.capabilities.graphNodes.steps[0].outcomes.push('retry-paid');assert.throws(()=>checkDescriptors(outcome),/unknown outcome/);
  const source=structuredClone(data);source[0].operations[0].evidence.sha256='forged';assert.throws(()=>checkCoverage(...source),/changed source/);
  const claim=structuredClone(data);claim[0].operations[0].supported=true;assert.throws(()=>checkCoverage(...claim),/unsupported claim/);
});
test('YAML fixtures explicitly refuse host execution and label stub review',()=>{
  const fixture=readFileSync(new URL('../blueprints/fixture-zero-spend.yaml',import.meta.url),'utf8');assert.match(fixture,/Not host Blueprint syntax/);assert.match(fixture,/actualReviewerAcceptance: false/);
  const production=readFileSync(new URL('../blueprints/fixture-production.yaml',import.meta.url),'utf8');assert.match(production,/NOT an executable Blueprint/);assert.match(production,/paidExecutionDefault: false/);
});
