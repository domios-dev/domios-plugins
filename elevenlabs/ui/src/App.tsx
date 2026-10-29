import React,{useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import { Studio,SchemaFields,Price,Inspector,Settings } from '../../../media-shared/ui/src';
import type { InputSchema } from '../../../media-shared/ui/src';
import type { Json } from '../../../media-shared/src/contracts';
import { jobStatus,pipelinePrice } from '../../../media-shared/src/presentation';
import type { AudioItem } from './api';
import type { StudioController } from './controller';
import { validateSchema } from '../../src/schema';
import type { MediaPort,VoicePort,VoiceList } from './media';
import { PlaybackGroup,unavailableMedia,unavailableVoices } from './media';
import { AudioPlayer } from './Audio';
const modelNames={eleven_multilingual_v2:'Multilingual v2',eleven_v3:'Eleven v3',eleven_flash_v2:'Flash v2',eleven_flash_v2_5:'Flash v2.5'};
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
export function App({controller:c,media=unavailableMedia,voices=unavailableVoices}:{controller:StudioController;media?:MediaPort;voices?:VoicePort}){
  const s=useSyncExternalStore(c.subscribe,c.getSnapshot,c.getSnapshot),snap=s.snapshot,d=s.details;
  const group=useMemo(()=>new PlaybackGroup(),[c]);
  const [,tick]=useState(0);
  // Visual quote expiry only. Never polls, reconciles or advances a lifecycle.
  useEffect(()=>{const timer=setInterval(()=>tick(n=>n+1),1000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{void c.mount();return()=>c.dispose();},[c]);
  const body=c.body(),path=(s.params.path??{}) as Record<string,Json>,text=typeof body.text==='string'?body.text:'',count=[...text].length,limit=c.limit();
  const speech=s.operation.startsWith('text_to_speech'),scribe=s.schema?.unavailable?.includes('voice-note transcriber');
  const bodySchema=s.schema?.schema.properties?.body??{},rawVoiceSettings=controlSchema(bodySchema.properties?.voice_settings);
  const voiceSettings={...rawVoiceSettings,properties:rawVoiceSettings.properties?Object.fromEntries(Object.entries(rawVoiceSettings.properties).map(([key,field])=>[key,controlSchema(field)])):undefined};
  const extraBody=Object.fromEntries(Object.entries(bodySchema.properties??{}).filter(([key])=>!['text','model_id','voice_settings'].includes(key)).map(([k,v])=>[k,controlSchema(v)]));
  const select=(id:string)=>{void c.inspect(id);};
  function row(i:AudioItem){
    const waiting=['waiting_ok','price_stale','price_unavailable'].includes(i.state),gate=c.priceFor(i),wait=waiting?pipelinePrice(gate):undefined;
    const status=wait?jobStatus(gate.kind==='ready'?'waiting_ok':gate.kind==='stale'?'price_stale':'price_unavailable'):i.status;
    const content=<><button data-audio-select="true" className="eleven-select ct-btn ct-btn-ghost" onClick={()=>select(i.id)}><span className="eleven-text">{i.title}</span><span className="eleven-meta"><small>{i.voiceLabel}</small><small>{i.modelLabel}</small></span></button>
      <span className="studio-status" data-tone={status.tone}>{status.label}{['starting','queued','generating'].includes(i.state)&&i.status.elapsed?` · ${i.status.elapsed}`:''}</span><small>{i.startedBy}</small></>;
    return <div className="eleven-row" data-state={i.state}>
      {i.outputs[0]?<AudioPlayer id={i.outputs[0].id} media={media} group={group}>{content}</AudioPlayer>:content}
      {wait&&<p className="ct-meta">{wait.helper??'Approve in the run view'}</p>}
      {i.state==='unknown'&&snap?.capabilities.reconcile&&<button className="ct-btn ct-btn-ghost" onClick={()=>void c.reconcile(i.id)}>Check again</button>}
      {i.notice&&<p className="ct-meta">{i.notice}</p>}
      {i.actor.kind==='run'&&i.runLink&&<a href={i.runLink}>View run</a>}
      {i.source&&<button className="ct-btn ct-btn-ghost eleven-link" onClick={()=>select(i.source!.id)}>From: {i.source.label}</button>}
    </div>;
  }
  return <Studio title="ElevenLabs" feedLayout="rows" now={c.now()} capacity={snap?.capacity??null} items={snap?.items??[]} renderItem={i=>row(i as AudioItem)}
    activity={snap?.activity??[]} activitySummary={snap?.activitySummary} selected={d?.item.id} onSelect={select} onBack={()=>c.back()} filter={s.filter} onFilter={v=>c.filter(v)}
    toolbar={<select aria-label="Operation" value={s.operation} disabled={!snap} onChange={e=>void c.selectOperation(e.target.value)}>{snap?.catalog.map(row=><option key={row.id} value={row.id}>{row.label}</option>)}</select>}
    composer={<>{s.error&&<p role="status">{s.error}</p>}
      {speech?<>
      <VoicePicker key={'voices:'+s.formRevision} port={voices} media={media} group={group} value={String(path.voice_id??'')} onChange={v=>c.edit('path','voice_id',v)}/>
      <div className="studio-field"><label htmlFor="eleven-model">Model</label><select id="eleven-model" disabled={!s.schema} value={String(body.model_id??'')} onChange={e=>c.edit('body','model_id',e.target.value)}><option value="">Model default</option>{Object.entries(modelNames).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></div>
      <div className="studio-field"><label htmlFor="eleven-text">Text</label><textarea id="eleven-text" value={text} onChange={e=>c.edit('body','text',e.target.value)} aria-describedby="eleven-count"/>
      <small id="eleven-count" className={limit&&count>limit*.9?'eleven-near-limit':''}>{count.toLocaleString('en-US')}{limit?` / ${limit.toLocaleString('en-US')}`:''} characters</small></div>
      {voiceSettings.properties&&<SchemaFields key={'settings:'+s.formRevision} schema={voiceSettings} keyFields={['stability','similarity_boost','style']}
        values={(body.voice_settings??{}) as Record<string,Json>} onChange={(key,value)=>{const settings={...(body.voice_settings??{}) as Record<string,Json>};if(value===undefined)delete settings[key];else settings[key]=value;c.edit('body','voice_settings',Object.keys(settings).length?settings:undefined);}}/>}
      {s.schema&&<details><summary>Request options</summary><SchemaFields schema={{type:'object',properties:extraBody}} values={Object.fromEntries(Object.entries(body).filter(([k])=>k in extraBody))} onChange={(k,v)=>c.edit('body',k,v)}/>
      {s.schema.schema.properties?.query&&<SchemaFields schema={s.schema.schema.properties.query} values={(s.params.query??{}) as Record<string,Json>} defaultValid={(_k,f)=>f.default!==undefined&&validateSchema(s.schema!.schema,f,f.default)} onChange={(k,v)=>c.edit('query',k,v)}/>}</details>}
      </>:!scribe&&s.schema&&(['path','body','query'] as const).map(location=>s.schema!.schema.properties?.[location]&&<SchemaFields key={location+':'+s.formRevision} schema={s.schema!.schema.properties[location]} values={(s.params[location]??{}) as Record<string,Json>} defaultValid={(_key,field)=>field.default!==undefined&&validateSchema(s.schema!.schema,field,field.default)} onChange={(key,value)=>c.edit(location,key,value)}/>)}
      {s.unavailable&&<p className="ct-meta">{s.unavailable}</p>}
      {s.inputs.length>0&&<p className="ct-meta">{s.inputs.length} authorized input reference{s.inputs.length===1?'':'s'} loaded from this result.</p>}
      <details><summary>Note</summary><div className="studio-field"><label htmlFor="eleven-note">Note (optional)</label><input id="eleven-note" value={s.note} maxLength={500} onChange={e=>c.note(e.target.value)}/><small>Kept in this studio while you edit. This note is not an approval.</small></div></details>
    </>}
    footer={<Price view={c.price()} onEstimate={()=>void c.estimate()} onGenerate={()=>void c.generate()}/>}
    empty={<p>Your audio generations will appear here.</p>}
    next={snap?.next!=null&&<button className="ct-btn" onClick={()=>void c.refresh(snap.next!)}>More results</button>}
    inspector={d?navigation=><Inspector navigation={navigation} onBack={()=>c.back()} preview={d.item.outputs[0]?<AudioPlayer key={d.item.id} id={d.item.outputs[0].id} media={media} group={group} native/>:<p className="ct-meta">Audio unavailable in this view</p>}>
      <h2>Text</h2><p className="eleven-full-text">{String((d.params.body as any)?.text??'')}</p>
      <h3>Voice</h3><p>{d.item.voiceLabel}</p><h3>Model</h3><p>{d.item.modelLabel}</p><h3>Settings</h3>
      <Settings schema={controlSchema(d.schema.properties?.body?.properties?.voice_settings)} values={((d.params.body as any)?.voice_settings??{}) as Record<string,Json>}/>
      <Settings schema={{...d.schema.properties?.body,properties:Object.fromEntries(Object.entries(d.schema.properties?.body?.properties??{}).filter(([key])=>!['text','model_id','voice_settings'].includes(key)))}} values={Object.fromEntries(Object.entries((d.params.body??{}) as Record<string,Json>).filter(([key])=>!['text','model_id','voice_settings'].includes(key)))}/>
      {d.params.query&&<Settings schema={d.schema.properties?.query??{}} values={d.params.query as Record<string,Json>}/>}
      <h3>Cost</h3><p>{d.item.recordedCost?`${d.item.recordedCost.text} (${d.item.recordedCost.kind})`:'Not recorded'}</p>
      <p className="ct-meta">Started by {d.item.startedBy}</p>{d.item.actor.kind==='run'&&d.item.runLink&&<a href={d.item.runLink}>View run</a>}
      {d.item.source&&<button className="ct-btn ct-btn-ghost eleven-link" onClick={()=>select(d.item.source!.id)}>From: {d.item.source.label}</button>}
      {d.inputs.map(input=><p key={input.id} className="ct-meta">{input.label} · {input.type}</p>)}
      <button className="ct-btn ct-btn-ghost" onClick={()=>c.reuse()}>Use these settings</button><button className="ct-btn ct-btn-ghost" onClick={()=>c.reuse(true)}>Make variations…</button>
    </Inspector>:undefined}/>;
}
