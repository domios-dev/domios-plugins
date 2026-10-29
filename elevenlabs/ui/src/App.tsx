import React,{useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import { Studio,Inspector,Settings } from '../../../media-shared/ui/src';
import type { InputSchema } from '../../../media-shared/ui/src';
import type { Json } from '../../../media-shared/src/contracts';
import { jobStatus,pipelinePrice } from '../../../media-shared/src/presentation';
import type { AudioItem } from './api';
import type { StudioController } from './controller';
import type { MediaPort,VoicePort,VoiceList } from './media';
import { PlaybackGroup,unavailableMedia,unavailableVoices } from './media';
import { AudioPlayer } from './Audio';
/** Nullable branches are edited through the same source field. No constraints/defaults change in DTO or reusable request. */
function controlSchema(schema:InputSchema|undefined):InputSchema {
  if(!schema)return {};
  const branches=schema.anyOf as InputSchema[]|undefined;
  if(branches?.length===2&&branches.some(s=>s.type==='null'))return {...branches.find(s=>s.type!=='null'),title:schema.title,description:schema.description};
  return schema;
}
export function VoicePicker({port,media,group,value,onChange}:{port:VoicePort;media:MediaPort;group:PlaybackGroup;value:string;onChange(v:string):void}){
  const [list,setList]=useState<VoiceList>({kind:'unavailable',message:'Voices unavailable in this view'}),[search,setSearch]=useState('');
  useEffect(()=>{let current=true;void port.list().then(v=>{if(current)setList(v);}).catch(()=>{if(current)setList({kind:'unavailable',message:'Voices unavailable in this view'});});return()=>{current=false;};},[port]);
  const selected=list.kind==='available'?list.voices.find(v=>v.id===value):undefined;
  return <div className="studio-field"><label htmlFor="eleven-voice">Voice</label>{list.kind==='available'&&list.voices.length>8&&<input type="search" aria-label="Search voices" value={search} onChange={e=>setSearch(e.target.value)}/>}
    <select id="eleven-voice" disabled={list.kind==='unavailable'} value={value} onChange={e=>onChange(e.target.value)}><option value="">Choose a voice</option>{list.kind==='available'&&list.voices.filter(v=>`${v.name} ${v.language??''}`.toLowerCase().includes(search.toLowerCase())).map(v=><option key={v.id} value={v.id}>{v.name}{v.language?` · ${v.language}`:''}</option>)}</select>
    {list.kind==='unavailable'?<small>{list.message}</small>:<>{list.synthetic&&<small>Synthetic fixture voices · not account voices</small>}{selected?.description&&<small>{selected.description}</small>}{selected?.sampleId&&<div><small>Free sample</small><AudioPlayer id={selected.sampleId} media={media} group={group}/></div>}</>}
  </div>;
}
export function App({controller:c,media=unavailableMedia,voices=unavailableVoices,selection,controls,stageTools,fixtureNotice,ownerLabel,fixtureLibrary=false}:{controller:StudioController;media?:MediaPort;voices?:VoicePort;selection?:(item:AudioItem,text:string,children:React.ReactNode)=>React.ReactNode;controls?:React.ReactNode;stageTools?:React.ReactNode;fixtureNotice?:React.ReactNode;ownerLabel?:string;fixtureLibrary?:boolean}){
  const s=useSyncExternalStore(c.subscribe,c.getSnapshot,c.getSnapshot),snap=s.snapshot,d=s.details;
  const [audioActions,setAudioActions]=useState<HTMLElement|null>(null);
  const group=useMemo(()=>new PlaybackGroup(),[c]);
  const [,tick]=useState(0);
  // Visual quote expiry only. Never polls, reconciles or advances a lifecycle.
  useEffect(()=>{const timer=setInterval(()=>tick(n=>n+1),1000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{void c.mount();return()=>c.dispose();},[c]);
  const select=(id:string)=>{void c.inspect(id);};
  // The current DTO supplies voice and descriptor as a single ' · '-separated display label.
  function row(i:AudioItem){
    const waiting=['waiting_ok','price_stale','price_unavailable'].includes(i.state),gate=c.priceFor(i),wait=waiting?pipelinePrice(gate):undefined;
    const status=wait?jobStatus(gate.kind==='ready'?'waiting_ok':gate.kind==='stale'?'price_stale':'price_unavailable'):i.status;
    const content=<><button data-audio-select="true" className="eleven-select ct-btn ct-btn-ghost" onClick={()=>select(i.id)}><span className="eleven-text">{i.title}</span><span className="eleven-meta"><small>{i.voiceLabel.split(' · ')[0]}</small><small>{i.modelLabel}</small><small>{i.startedBy}</small></span></button>
      <div className="eleven-row-end"><span className="studio-status" data-tone={status.tone}>{status.label}{['starting','queued','generating'].includes(i.state)&&i.status.elapsed?` · ${i.status.elapsed}`:''}</span>
      {i.state==='unknown'&&snap?.capabilities.reconcile&&<button className="ct-btn ct-btn-ghost" onClick={()=>void c.reconcile(i.id)}>Check again</button>}
      {i.actor.kind==='run'&&i.runLink&&<a href={i.runLink}>View run</a>}</div></>;
    return <div className="eleven-row" data-state={i.state}>
      {i.outputs[0]?<AudioPlayer id={i.outputs[0].id} media={media} group={group}>{content}</AudioPlayer>:<><span className="eleven-slot" aria-hidden="true"/>{content}</>}
      {wait&&<p className="ct-meta">{wait.helper??'Approve in the run view'}</p>}
      {i.notice&&<p className="ct-meta">{i.notice}</p>}
      {i.source&&<button className="ct-btn ct-btn-ghost eleven-link" onClick={()=>select(i.source!.id)}>From: {i.source.label}</button>}
    </div>;
  }
  return <Studio title="ElevenLabs" controls={controls} fixtureNotice={fixtureNotice} ownerLabel={ownerLabel} renderStripStatus={i=>{const waiting=['waiting_ok','price_stale','price_unavailable'].includes(i.state);if(!waiting)return i.status;const gate=c.priceFor(i), result=pipelinePrice(gate);return {label:result.label,tone:jobStatus(gate.kind==='ready'?'waiting_ok':gate.kind==='stale'?'price_stale':'price_unavailable').tone};}} renderStripAction={i=>i.state==='unknown'&&snap?.capabilities.reconcile?<button className="ct-btn ct-btn-ghost" onClick={()=>void c.reconcile(i.id)}>Check again</button>:null} initialLibrary={fixtureLibrary&&!d} notice={s.error} feedLayout="rows" now={c.now()} capacity={snap?.capacity??null} items={snap?.items??[]} renderItem={i=>row(i as AudioItem)}
    activity={snap?.activity??[]} activitySummary={snap?.activitySummary} selected={d?.item.id} onSelect={select} onBack={()=>c.back()} filter={s.filter} onFilter={v=>c.filter(v)}
    next={snap?.next!=null&&<button className="ct-btn" onClick={()=>void c.refresh(snap.next!)}>More results</button>}
    inspector={d?navigation=><Inspector tools={stageTools} navigation={navigation} onBack={()=>c.back()} preview={<div className="eleven-preview">{selection ? selection(d.item,String((d.params.body as any)?.text??''),d.item.outputs[0]?<AudioPlayer key={d.item.id} id={d.item.outputs[0].id} media={media} group={group} native actionsTarget={audioActions}/>:<p className="ct-meta">Audio unavailable in this view</p>) : <><p className="eleven-stage-text">{String((d.params.body as any)?.text??d.item.title)}</p><p className="ct-meta">{d.item.voiceLabel.split(' · ')[0]}</p>{d.item.outputs[0]?<AudioPlayer key={d.item.id} id={d.item.outputs[0].id} media={media} group={group} native actionsTarget={audioActions}/>:<p className="ct-meta">Audio unavailable in this view</p>}</>}</div>}>
      <div className="studio-rail-actions" ref={setAudioActions}/><h2>Text</h2><p className="eleven-full-text">{String((d.params.body as any)?.text??'')}</p>
      <h3>Voice</h3><p>{d.item.voiceLabel}</p><h3>Model</h3><p>{d.item.modelLabel}</p><h3>Settings</h3>
      {!Object.keys(((d.params.body as any)?.voice_settings??{})).length&&!Object.keys((d.params.body??{}) as Record<string,Json>).some(key=>!['text','model_id','voice_settings'].includes(key))&&!Object.keys((d.params.query??{}) as Record<string,Json>).length&&<p className="ct-meta">Model defaults</p>}
      <Settings schema={controlSchema(d.schema.properties?.body?.properties?.voice_settings)} values={((d.params.body as any)?.voice_settings??{}) as Record<string,Json>}/>
      <Settings schema={{...d.schema.properties?.body,properties:Object.fromEntries(Object.entries(d.schema.properties?.body?.properties??{}).filter(([key])=>!['text','model_id','voice_settings'].includes(key)))}} values={Object.fromEntries(Object.entries((d.params.body??{}) as Record<string,Json>).filter(([key])=>!['text','model_id','voice_settings'].includes(key)))}/>
      {d.params.query&&<Settings schema={d.schema.properties?.query??{}} values={d.params.query as Record<string,Json>}/>}
      <h3>Cost</h3><p>{d.item.recordedCost?`${d.item.recordedCost.text} (${d.item.recordedCost.kind})`:'Not recorded'}</p>
      <p className="ct-meta">Started by {d.item.startedBy}</p>{d.item.actor.kind==='run'&&d.item.runLink&&<a href={d.item.runLink}>View run</a>}
      {d.item.source&&<button className="ct-btn ct-btn-ghost eleven-link" onClick={()=>select(d.item.source!.id)}>From: {d.item.source.label}</button>}
      {d.inputs.map(input=><p key={input.id} className="ct-meta">{input.label} · {input.type}</p>)}
    </Inspector>:undefined}/>;
}
