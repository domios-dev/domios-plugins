/** Zero-network synthetic transport. Excluded from every production import/entry. */
import {ElevenLabsService} from '../../src/client';
import {createCommands} from '../../src/commands';
import {revision} from '../../src/catalog';
import {quoteState} from '../../../media-shared/src/cost';
import type {Job,Partition,Request,Scope} from '../../../media-shared/src/contracts';
import type {Methods,UITransport,UISnapshot,UIDetails} from '../src/api';
import type {MediaPort,VoicePort} from '../src/media';
export type FixtureOwner='A'|'B'|'user';
export type FixtureOptions={scenario?:string;load?():string|null;save?(text:string):void;now?():number};
export function fixtureTransport(options:FixtureOptions={}){
  const store=new Map<string,Partition>(),grants=new Map<unknown,Scope>(),listeners=new Set<()=>void>();
  const clock=options.now??(()=>Date.now());let owner:FixtureOwner=options.scenario==='owners'?'A':'user',sequence=0,submissions=0;
  const key=JSON.stringify(['fixture-workspace-user','fixture-workspace']);
  const emit=()=>{persist();listeners.forEach(f=>f());};
  const service=new ElevenLabsService({store:{transact(o,w,fn){const k=JSON.stringify([o,w]),partition=structuredClone(store.get(k)??{jobs:[],ceilings:{usd_micro:100000}});const result=fn(partition);store.set(k,partition);return structuredClone(result);}},
    now:clock,maxHistory:200,maxBytes:1024,
    access(caller){const scope=grants.get(caller);if(!scope)throw new Error('untrusted');return {scope,current:true,inputsAuthorized:true};},
    permitted:()=>true,
    quote:(_s,_r,binding)=>({binding,amount:800,unit:'usd_micro',safe:true,basis:'Synthetic fixture only; not account pricing',tariffRevision:'synthetic',issuedAt:clock(),validUntilMs:clock()+60000}),
    // No HTTP, stream, credential or output-save port exists.
  });
  function token(id:FixtureOwner,run=false){const suffix=run?'run':id;
    const t={origin:'document',plugin:'elevenlabs',frame:`fixture-frame-${suffix}`,surface:'studio',instance:`fixture-instance-${suffix}`,tab:`fixture-tab-${suffix}`,actor:{kind:'local'}};
    grants.set(t,{owner:'fixture-workspace-user',workspace:'fixture-workspace',actorId:id,human:id==='user',authRevision:'synthetic-only',
    actor:run?{kind:'run',runId:'fixture-run',label:'Narration run #3'}:id==='user'?{kind:'you'}:{kind:'agent',label:id==='A'?'Ada':'Bea'},runId:run?'fixture-run':undefined});return t;}
  const tokens={A:token('A'),B:token('B'),user:token('user')},runToken=token('A',true);
  const request=(text:string):Request=>({operation:'text_to_speech_full',revision,unit:'usd_micro',inputs:[],params:{path:{voice_id:'synthetic-voice-alba'},body:{text,model_id:'eleven_multilingual_v2'}}});
  function persist(){options.save?.(JSON.stringify({partition:store.get(key),sequence,submissions}));}
  function edit(id:string,fn:(job:Job)=>void){const p=store.get(key)!;const j=p.jobs.find(j=>j.id===id);if(j)fn(j);}
  let restored=false;
  try{const saved=JSON.parse(options.load?.()??'null');if(saved?.partition?.jobs&&Array.isArray(saved.partition.jobs)){store.set(key,saved.partition);sequence=saved.sequence??0;submissions=saved.submissions??0;restored=true;}}catch{}
  if(!restored){
    const pipeline=options.scenario?.startsWith('pipeline'),states=pipeline?['generated','failed','waiting']:['starting','queued','generating','generated','failed','canceled','unknown','waiting','generated'];
    states.forEach((state,n)=>{
      const caller=pipeline?runToken:n%3===0?tokens.user:tokens.A;
      const job=service.intent(caller,`fixture-${++sequence}`,request(pipeline?['Welcome to the field guide.','A quiet pause before the next chapter.','The final narration awaits your OK.'][n]:['A warm welcome to the studio.','Let the story unfold, one sentence at a time.','The morning train crosses the valley.','A finished local audio sample.','The source request failed safely.','This request was canceled.','Delivery is uncertain; keep the existing request.','Waiting for a safe price.','File access expired; the saved synthetic audio still exists.'][n]));
      if(pipeline&&state==='waiting'&&options.scenario!=='pipeline-missing')service.estimate(caller,job.id);
      edit(job.id,j=>{j.state=state as Job['state'];j.at=clock()-n*90000;j.updatedAt=clock();if(state==='waiting')j.waitReason=pipeline&&options.scenario!=='pipeline-missing'?'owner_confirmation':'price_unavailable';if(state==='generated')j.outputs=[{kind:'artifact',id:!pipeline&&n===8?'fixture-expired-tone':'fixture-local-tone',contentType:'audio/wav'}];});
    });
    service.intent(tokens.B,`fixture-${++sequence}`,request('Bea private fixture text.'));
    persist();
  }
  function safeDisplay<T extends UISnapshot|UIDetails>(result:T):T{
    const items='items' in result?result.items:[result.item];
    const p=store.get(key)!;
    items.forEach(i=>{i.voiceLabel='Alba · synthetic';if(i.actor.kind==='run'){
      i.runLink='#fixture-existing-run';const before=p.jobs.find(j=>j.scope.runId==='fixture-run'&&j.id!==i.id&&j.state==='generated');
      if(before&&i.state!=='generated')i.source={id:before.id,label:'Welcome narration'};
    }if(i.state==='failed')i.notice='Synthetic provider refusal. No request was sent.';if(i.state==='unknown')i.notice='Synthetic uncertain delivery. No retry is available.';if(i.outputs[0]?.id==='fixture-expired-tone')i.notice='File access expired. Reopen the result. Synthetic saved audio remains available without regeneration.';});
    return result;
  }
  const commands=createCommands(service,{surface:{call(){throw new Error('no-host');},invalidate(){}} as any,caller:ctx=>{if(ctx!==(options.scenario?.startsWith('pipeline')?runToken:tokens[owner]))throw new Error('foreign');return ctx;},nextIntent:()=>`fixture-${++sequence}`,now:clock});
  const transport:UITransport={async call(method,args){
    const caller=options.scenario?.startsWith('pipeline')?runToken:tokens[owner];
    if(method.startsWith('ui.')){
      const result=commands.viewCall(method,args,caller) as any;
      if(result.error)throw new Error('refused');
      if(result.kind==='available'&&('items' in result||'item' in result)){
        const projected=safeDisplay(result);
        if('items' in projected){projected.capabilities.submit=true;projected.capabilities.reconcile=true;projected.capacity=200;
          if(options.scenario?.startsWith('pipeline')){
            // Explicit synthetic pipeline view; grants are created above, never supplied by a UI argument.
            const pipelineResult=commands.viewCall(method,args,runToken) as any;
            if(pipelineResult.kind==='available'&&'items' in pipelineResult){const p=safeDisplay(pipelineResult);p.capabilities={estimate:false,submit:false,reconcile:false};p.activitySummary='Narration run #3 prepared 3 jobs';return p as Methods[typeof method]['result'];}
          }
        }
        return projected as Methods[typeof method]['result'];
      }
      return result as Methods[typeof method]['result'];
    }
    if(method==='generate'){
      const a=args as {id:string},job=service.history(caller).find(j=>j.id===a.id);if(!job)throw new Error('foreign');
      if(job.state!=='waiting')return {id:job.id} as any;
      if(quoteState(job.quote,job.binding,job.request.unit,clock())!=='ready')throw new Error('price');
      submissions++;edit(job.id,j=>{j.state='queued';j.updatedAt=clock();});emit();return {id:job.id} as any;
    }
    if(method==='reconcile'){const id=(args as {id:string}).id;if(!service.history(caller).some(j=>j.id===id))throw new Error('foreign');return {id} as any;}
    const result=commands.viewCall(method,args,caller) as any;
    if(result.error)throw new Error('refused');emit();return result;
  },subscribe(fn){listeners.add(fn);return()=>{listeners.delete(fn);};}};
  return {transport,service,owner:()=>owner,submissions:()=>submissions,
    setOwner(next:FixtureOwner){owner=next;},
    complete(){service.history(tokens[owner]).filter(j=>j.state==='queued'||j.state==='generating'||j.state==='starting').forEach(j=>edit(j.id,row=>{row.state='generated';row.outputs=[{kind:'artifact',id:'fixture-local-tone',contentType:'audio/wav'}];}));emit();},
    unknown(){service.history(tokens[owner]).filter(j=>['queued','generating','starting'].includes(j.state)).forEach(j=>edit(j.id,row=>{row.state='unknown';}));emit();},
  };
}
/** Actual owner-button handler. Reset synchronously BEFORE replacing fixture scope or awaiting a response. */
export async function selectFixtureOwner(fixture:ReturnType<typeof fixtureTransport>,controller:import('../src/controller').StudioController,owner:FixtureOwner){controller.resetContext();fixture.setOwner(owner);await controller.refresh();await controller.selectOperation('text_to_speech_full');}
export const fixtureVoices:VoicePort={async list(){return {kind:'available',synthetic:true,voices:[{id:'synthetic-voice-alba',name:'Alba',language:'English',description:'Synthetic warm narration fixture',sampleId:'fixture-local-tone'},{id:'synthetic-voice-milo',name:'Milo',language:'English',description:'Synthetic clear narration fixture',sampleId:'fixture-local-tone'}]};}};
let expiredShown=false;
export const fixtureMedia:MediaPort={async acquire(id){if(!['fixture-local-tone','fixture-expired-tone'].includes(id))return null;const expired=id==='fixture-expired-tone'&&!expiredShown;if(expired)expiredShown=true;return {url:expired?null:'/fixtures/tone.wav',label:'Synthetic local tone · not generated vendor audio',declared:['saveAs'],availability:{copyText:false,saveAs:true,reveal:false},save(){const link=document.createElement('a');link.href='/fixtures/tone.wav';link.download='synthetic-tone.wav';link.click();}};}};
