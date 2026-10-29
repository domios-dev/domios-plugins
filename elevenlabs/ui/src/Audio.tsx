import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {humanActions} from '../../../media-shared/src/presentation';
import type { LocalAudio, MediaPort } from './media';
import { PlaybackGroup, seekAudio } from './media';
export const audioTime=(seconds:number)=>`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
export function AudioPlayer({id,media,group,native=false,children,actionsTarget}:{id:string;media:MediaPort;group:PlaybackGroup;native?:boolean;children?:React.ReactNode;actionsTarget?:HTMLElement|null}){
  const ref=useRef<HTMLAudioElement>(null),playRef=useRef<HTMLButtonElement>(null),revision=useRef(0);
  const [source,setSource]=useState<LocalAudio|null>(null),[pending,setPending]=useState(false),[failed,setFailed]=useState(false);
  const [playing,setPlaying]=useState(false),[duration,setDuration]=useState(0),[time,setTime]=useState(0);
  useEffect(()=>{
    const current=++revision.current;setSource(null);setPlaying(false);setDuration(0);setTime(0);setFailed(false);setPending(false);
    // Only an explicitly opened inspector acquires immediately. Feed rows and voice samples acquire on first Play.
    if(native){setPending(true);void media.acquire(id).then(value=>{if(current===revision.current){setSource(value);setPending(false);}}).catch(()=>{if(current===revision.current){setFailed(true);setPending(false);}});}
    const audio=ref.current;
    return()=>{++revision.current;if(audio)group.release(audio);};
  },[id,media,group,native]);
  const toggle=async()=>{
    const audio=ref.current;if(!audio||pending)return;
    if(!audio.paused){audio.pause();return;}
    const current=revision.current;
    try{
      let local=source;
      if(!local?.url||failed){setPending(true);local=await media.acquire(id);if(current!==revision.current)return;setSource(local);setPending(false);}
      if(!local?.url){setFailed(true);return;}
      if(audio.getAttribute('src')!==local.url)audio.src=local.url;
      await audio.play();if(current===revision.current)setFailed(false);
    }catch{if(current===revision.current){setFailed(true);setPending(false);}}
  };
  const key=(event:React.KeyboardEvent)=>{
    const rowSelect=event.target instanceof HTMLElement&&event.target.dataset.audioSelect==='true';
    if(event.target!==playRef.current&&!rowSelect)return;
    if(event.key===' '){event.preventDefault();event.stopPropagation();void toggle();}
    if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();event.stopPropagation();if(ref.current)seekAudio(ref.current,event.key==='ArrowLeft'?-5:5);}
  };
  const actions=humanActions(source?.availability??{copyText:false,saveAs:false,reveal:false},source?.declared??[]);
  return <div className={native?'eleven-audio eleven-audio-inspector':'eleven-audio'} onKeyDown={key}>
    <audio ref={ref} src={source?.url??undefined} controls={native&&!!source?.url&&!failed} preload="metadata" aria-label={source?.label??'Audio result'}
      onPlay={e=>{group.play(e.currentTarget);setPlaying(true);}} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)}
      onLoadedMetadata={e=>setDuration(Number.isFinite(e.currentTarget.duration)?e.currentTarget.duration:0)}
      onDurationChange={e=>setDuration(Number.isFinite(e.currentTarget.duration)?e.currentTarget.duration:0)}
      onTimeUpdate={e=>setTime(e.currentTarget.currentTime)} onError={()=>setFailed(true)}/>
    {!native&&<button ref={playRef} className="ct-btn ct-btn-ghost eleven-play" aria-label={playing?'Pause':'Play'} disabled={pending} onClick={()=>void toggle()}>{playing?'❚❚':'▶'}</button>}
    {children}
    {!native&&(playing||time>0)&&<div className="eleven-seek"><input type="range" className="eleven-duration" aria-label="Seek audio" min={0} max={duration||1} step={0.1} value={Math.min(time,duration)} disabled={!duration}
      onChange={e=>{if(ref.current)ref.current.currentTime=Number(e.target.value);}}/>{duration>0&&<small>{audioTime(time)} / {audioTime(duration)}</small>}</div>}
    {native&&pending&&<small>Loading audio…</small>}
    {native&&!pending&&(!source?.url||failed)&&<><small>Audio unavailable in this view</small><button className="ct-btn ct-btn-ghost" onClick={()=>{const current=revision.current;setPending(true);void media.acquire(id).then(local=>{if(current===revision.current){setSource(local);setFailed(false);setPending(false);}}).catch(()=>{if(current===revision.current)setPending(false);});}}>Reopen result</button></>}
    {!native&&failed&&<small role="status">Couldn't play audio. Open the result to check file access.</small>}
    {native&&(()=>{const buttons=<>{source?.save&&actions.includes('saveAs')&&<button className="ct-btn ct-btn-ghost" onClick={source.save}>Save as…</button>}{source?.reveal&&actions.includes('reveal')&&<button className="ct-btn ct-btn-ghost" onClick={source.reveal}>Show in folder</button>}</>;return actionsTarget===undefined?buttons:actionsTarget?createPortal(buttons,actionsTarget):null;})()}

  </div>;
}
