// Synthetic zero-spend service ports. No production host methods or timers.
import { ElevenLabsService } from '../src/client';
import type { Partition, Scope, Request, Quote } from '../../media-shared/src/contracts';
import { revision } from '../src/catalog';
export const request=():Request=>({operation:'text_to_speech_full',revision,unit:'usd_micro',inputs:[],params:{path:{voice_id:'owned'},body:{text:'Private prompt never goes in activity',model_id:'eleven_multilingual_v2'}}});
export function fixture(){
  const store=new Map<string,Partition>(),grants=new Map<unknown,Scope>(),files=new Map<string,Uint8Array>();
  let now=100,network=0,sequence=0,price=8;
  const service=new ElevenLabsService({
    store:{transact(owner,workspace,edit){const key=JSON.stringify([owner,workspace]);const draft=structuredClone(store.get(key)??{jobs:[],ceilings:{usd_micro:100}});const result=edit(draft);store.set(key,draft);return structuredClone(result);}},
    now:()=>now,maxBytes:1024,maxHistory:40,
    access(caller){const scope=grants.get(caller);if(!scope)throw new Error('untrusted');return {scope,current:true,inputsAuthorized:true};},
    permitted:()=>true,
    quote:(_s,_r,binding):Quote|null=>price<0?null:{binding,amount:price,unit:'usd_micro',safe:true,basis:'synthetic only',tariffRevision:'fixture',issuedAt:now,validUntilMs:now+50},
    http:()=>{network++;return {status:200,contentType:'audio/mpeg',bytes:new Uint8Array([1,2,3])};},
    save:(_scope,id,output)=>{if(!('bytes' in output))throw new Error('fixture_audio_only');files.set(id,output.bytes);return {kind:'artifact',id,contentType:output.contentType};},
  });
  function grant(token:unknown,actor='A',options:{human?:boolean;run?:string;owner?:string}={}){
    const s:Scope={owner:options.owner??'workspace-user',workspace:'workspace',actorId:actor,human:options.human??false,authRevision:'auth',runId:options.run,
      actor:options.run?{kind:'run',runId:options.run,label:'Trusted run'}:options.human?{kind:'you'}:{kind:'agent',label:'Agent'}};
    grants.set(token,s);return token;
  }
  return {service,grant,store,files,now:()=>now,network:()=>network,next:()=>`intent-${++sequence}`,setTime:(v:number)=>{now=v;},setPrice:(v:number)=>{price=v;},
    authorize(token:unknown){if(!grants.has(token))throw new Error('untrusted');return token;},
    humanApproval(token:unknown,id:string){const scope=grants.get(token)!;grants.set(token,{...scope,human:true});try{return service.approve(token,id,{amount:8,unit:'usd_micro'});}finally{grants.set(token,scope);}},
  };
}
