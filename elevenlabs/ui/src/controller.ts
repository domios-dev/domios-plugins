import type { Json, Request, Unit } from '../../../media-shared/src/contracts';
import type { EstimateView, InputSchema } from '../../../media-shared/ui/src';
import type { AudioItem, UIDetails, UISchema, UISnapshot, UITransport } from './api';
import { validateParameters, operation } from '../../src/catalog';
import { validateSchema } from '../../src/schema';

export type UIState = {snapshot?:UISnapshot;details?:UIDetails;schema?:UISchema;operation:string;params:Record<string,Json>;
  note:string;id?:string;estimating:boolean;busy:boolean;error?:string;unavailable?:string;stale:boolean;attempted:boolean;
  formRevision:number;inputs:Request['inputs'];unit:Unit;filter:'everyone'|'you'|'agent'|'run'};
export function validDefaults(schema:InputSchema):Record<string,Json> {
  const result:Record<string,Json>={};
  for(const [key,field] of Object.entries(schema.properties??{})) {
    if(field.default!==undefined && validateSchema(schema,field,field.default)) result[key]=structuredClone(field.default);
  }
  return result;
}
export const textLimits:Record<string,number>={eleven_v3:5000,eleven_multilingual_v2:10000,eleven_flash_v2:30000,eleven_flash_v2_5:40000};
const initial=():UIState=>({operation:'',params:{},inputs:[],unit:'usd_micro',note:'',estimating:false,busy:false,stale:false,attempted:false,formRevision:0,filter:'everyone'});
export class StudioController {
  state=initial();
  private listeners=new Set<()=>void>();
  private epoch=0; private refreshSerial=0; private selectSerial=0; private detailSerial=0; private editSerial=0;
  private deadLines=new Map<string,number>(); private submitted=new Set<string>(); private submitting=false;
  private unlisten?:()=>void; private pending=false;
  constructor(readonly transport:UITransport,readonly now=()=>Date.now()){}
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  getSnapshot=()=>this.state;
  private patch(p:Partial<UIState>){this.state={...this.state,...p};this.listeners.forEach(f=>f());}
  async mount(){this.unlisten=this.transport.subscribe(()=>{void this.refresh();});await this.refresh();if(!this.state.operation && this.state.snapshot)await this.selectOperation('text_to_speech_full');}
  dispose(){this.unlisten?.();++this.epoch;++this.detailSerial;++this.selectSerial;}
  resetContext(){++this.epoch;++this.refreshSerial;++this.detailSerial;++this.selectSerial;++this.editSerial;this.pending=true;this.deadLines.clear();this.state={...initial(),formRevision:this.state.formRevision+1};this.listeners.forEach(f=>f());}
  async refresh(offset=0){
    const epoch=this.epoch,serial=++this.refreshSerial,old=this.state.snapshot;
    ++this.detailSerial;this.pending=true;this.patch({snapshot:undefined,details:undefined});
    try{
      const snapshot=await this.transport.call('ui.snapshot',{offset,limit:50});
      if(epoch!==this.epoch||serial!==this.refreshSerial)return;
      if(snapshot.kind==='unavailable')throw new Error('unavailable');
      snapshot.items.forEach(i=>this.deadLines.set(i.id,this.now()+(i.priceTTL??0)));
      this.patch({snapshot:offset&&old?{...snapshot,items:[...old.items,...snapshot.items]}:snapshot,error:undefined});
    }catch{if(epoch===this.epoch&&serial===this.refreshSerial)this.patch({snapshot:undefined,details:undefined,params:{},schema:undefined,id:undefined,error:'Studio bridge unavailable. Reopen this studio after its service is connected.'});}
    finally{if(epoch===this.epoch&&serial===this.refreshSerial){this.pending=false;this.patch({});}}
  }
  async selectOperation(id:string){
    const epoch=this.epoch,serial=++this.selectSerial;++this.editSerial;++this.detailSerial;
    this.patch({operation:id,params:{},inputs:[],unit:'usd_micro',schema:undefined,id:undefined,details:undefined,stale:false,attempted:false,unavailable:undefined,error:undefined,formRevision:this.state.formRevision+1});
    try{
      const schema=await this.transport.call('ui.schema',{operation:id});
      if(epoch!==this.epoch||serial!==this.selectSerial)return;
      if(schema.kind==='unavailable'){this.patch({unavailable:schema.message});return;}
      const params=validDefaults(schema.schema);
      for(const [key,field] of Object.entries(schema.schema.properties??{})) if(field.type==='object'){
        const defaults=validDefaults(field);if(Object.keys(defaults).length)params[key]=defaults;
      }
      this.patch({schema,params,unavailable:schema.unavailable??undefined});
    }catch{if(epoch===this.epoch&&serial===this.selectSerial)this.patch({unavailable:'Inputs unavailable for this operation.'});}
  }
  edit(location:'path'|'query'|'body',key:string,value:Json|undefined){
    ++this.editSerial;const params=structuredClone(this.state.params),values={...params[location] as Record<string,Json>};
    if(value===undefined)delete values[key];else values[key]=value;params[location]=values;
    this.patch({params,id:undefined,stale:!!this.state.id||this.state.stale,error:undefined});
  }
  note(value:string){this.patch({note:value.slice(0,500)});}
  filter(value:UIState['filter']){++this.detailSerial;this.patch({filter:value,details:undefined});}
  body(){return (this.state.params.body??{}) as Record<string,Json>;}
  limit(){return textLimits[String(this.body().model_id??'eleven_multilingual_v2')];}
  issue():{action:string;helper:string}|undefined{
    const body=this.body(),text=typeof body.text==='string'?body.text:'',limit=this.limit();
    if(!this.state.operation.startsWith('text_to_speech')){
      try{if(validateParameters(operation(this.state.operation),this.state.params,this.state.inputs.length))return;}catch{}
      return {action:'Check inputs',helper:'Complete the operation inputs to get a price'};
    }
    if(limit&&[...text].length>limit)return {action:'Shorten the text',helper:`Shorten the text by ${[...text].length-limit} characters`};
    if(!((this.state.params.path??{}) as any).voice_id)return {action:'Choose a voice',helper:'Choose a voice to get a price'};
    if(!text.trim())return {action:'Add text',helper:'Add text to get a price'};
    try{if(validateParameters(operation(this.state.operation),this.state.params,this.state.inputs.length))return;}catch{}
    return {action:'Check inputs',helper:'Check the inputs to get a price'};
  }
  priceFor(item:Pick<AudioItem,'id'|'price'>){return item.price.kind==='ready' && this.now()>=(this.deadLines.get(item.id)??0)?{kind:'stale' as const}:item.price;}
  price():EstimateView{
    const s=this.state,item=s.snapshot?.items.find(i=>i.id===s.id),issue=this.issue();
    return {gate:item?this.priceFor(item):{kind:s.stale?'stale':'unavailable'},count:1,available:!!s.snapshot?.capabilities.estimate,
      capable:!!s.snapshot?.capabilities.submit&&!this.pending,busy:s.busy,estimating:s.estimating,
      invalid:issue?.helper??s.unavailable??(s.id&&this.submitted.has(s.id)?'This generation is already in Results.':undefined),invalidAction:issue?.action,
      refreshLabel:s.attempted||s.stale?'Check again':'Get price'};
  }
  async estimate(){
    if(this.state.estimating||this.state.busy||this.state.unavailable||this.issue())return;
    const epoch=this.epoch,edit=this.editSerial,params=structuredClone(this.state.params),inputs=structuredClone(this.state.inputs),unit=this.state.unit,operation=this.state.operation;
    this.patch({estimating:true,attempted:true,error:undefined});
    try{
      const prepared=await this.transport.call('prepare',{operation,params,inputs,unit});
      if(epoch!==this.epoch||edit!==this.editSerial)return;
      this.patch({id:prepared.id,stale:false});
      await this.transport.call('estimate',{id:prepared.id});
      if(epoch===this.epoch&&edit===this.editSerial)await this.refresh();
    }catch{if(epoch===this.epoch&&edit===this.editSerial)this.patch({error:'A safe price is unavailable. Check again without generating.'});}
    finally{if(epoch===this.epoch)this.patch({estimating:false});}
  }
  async generate(){
    const price=this.price(),id=this.state.id,epoch=this.epoch;
    if(this.submitting||!id||this.submitted.has(id)||price.gate.kind!=='ready'||price.invalid||!price.capable||price.busy||price.estimating)return;
    this.submitting=true;this.submitted.add(id);this.patch({busy:true,error:undefined});
    try{await this.transport.call('generate',{id});}catch{if(epoch===this.epoch)this.patch({error:'Submission status is uncertain. Keep this generation; do not submit it again.'});}
    finally{this.submitting=false;if(epoch===this.epoch){this.patch({busy:false});await this.refresh();}}
  }
  async inspect(id:string){
    if(this.pending)return;const epoch=this.epoch,serial=++this.detailSerial;this.patch({details:undefined});
    try{const details=await this.transport.call('ui.details',{id});if(epoch!==this.epoch||serial!==this.detailSerial)return;
      if(details.kind==='unavailable')this.patch({error:details.message});else this.patch({details,error:undefined});
    }catch{if(epoch===this.epoch&&serial===this.detailSerial)this.patch({error:'This result is unavailable in this view.'});}
  }
  back(){++this.detailSerial;this.patch({details:undefined});}
  reuse(variation=false){
    const d=this.state.details;if(!d)return;const params=structuredClone(d.params);
    if(variation && params.body && typeof params.body==='object'&&!Array.isArray(params.body))delete params.body.seed;
    if(!validateParameters(operation(d.item.operation),params,d.inputs.length)){this.patch({error:'These settings cannot be reused safely.'});return;}
    ++this.editSerial;++this.selectSerial;++this.detailSerial;
    const inputs:Request['inputs']=d.inputs.map(input=>input.type==='run-media'?{kind:'run-media',reference:input.id}:{kind:'artifact',id:input.id,contentType:input.type});
    this.patch({operation:d.item.operation,schema:{kind:'available',operation:d.item.operation,revision:'document',schema:d.schema,unavailable:null},params,inputs,unit:d.unit,id:undefined,details:undefined,stale:false,attempted:false,unavailable:undefined,error:undefined,formRevision:this.state.formRevision+1});
  }
  async reconcile(id:string){try{await this.transport.call('reconcile',{id});await this.refresh();}catch{this.patch({error:'Status is unavailable. The existing generation is retained.'});}}
}
