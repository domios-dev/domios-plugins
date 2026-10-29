import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {DotRow,Icon} from '../../../media-shared/ui/src';
import {humanActions} from '../../../media-shared/src/presentation';
import type { LocalAudio, MediaPort } from './media';
import { PlaybackGroup, seekAudio } from './media';
export const audioTime=(seconds:number)=>`${Math.floor(seconds/60)}:${(seconds%60).toFixed(1).padStart(4,'0')}`;
export function AudioPlayer({id,media,group,native=false,children,actionsTarget,onDuration}:{id:string;media:MediaPort;group:PlaybackGroup;native?:boolean;children?:React.ReactNode;actionsTarget?:HTMLElement|null;onDuration?(seconds:number):void}){
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
    <audio ref={ref} src={source?.url??undefined} hidden preload="metadata" aria-label={source?.label??'Audio result'}
      onPlay={e=>{group.play(e.currentTarget);setPlaying(true);}} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)}
      onLoadedMetadata={e=>{const seconds=Number.isFinite(e.currentTarget.duration)?e.currentTarget.duration:0;setDuration(seconds);if(seconds>0)onDuration?.(seconds);}}
      onDurationChange={e=>{const seconds=Number.isFinite(e.currentTarget.duration)?e.currentTarget.duration:0;setDuration(seconds);if(seconds>0)onDuration?.(seconds);}}
      onTimeUpdate={e=>setTime(e.currentTarget.currentTime)} onError={()=>setFailed(true)}/>
    {<button ref={playRef} className="ct-btn ct-btn-ghost eleven-play" aria-label={playing?'Pause':'Play'} disabled={pending} onClick={()=>void toggle()}>{<Icon name={playing?'pause':'play'}/>}</button>}
    {children}
    {(native||playing||time>0)&&<div className="eleven-seek"><small className="eleven-time">{audioTime(time)} / {duration?audioTime(duration):'—'}</small><div className="eleven-dot-seek" role="slider" tabIndex={0} aria-label="Seek audio" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Math.min(time,duration)} aria-valuetext={`${audioTime(time)} / ${audioTime(duration)}`} aria-disabled={!duration}
      onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();if(ref.current){if(e.key==='Home')ref.current.currentTime=0;else if(e.key==='End'&&duration)ref.current.currentTime=duration;else seekAudio(ref.current,e.key==='ArrowLeft'?-5:5);}}}}
      onPointerDown={e=>{if(!duration||!ref.current)return;e.currentTarget.setPointerCapture(e.pointerId);const rect=e.currentTarget.getBoundingClientRect();ref.current.currentTime=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width))*duration;}}
      onPointerMove={e=>{if(!duration||!ref.current||!e.currentTarget.hasPointerCapture(e.pointerId))return;const rect=e.currentTarget.getBoundingClientRect();ref.current.currentTime=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width))*duration;}}
      onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}><DotRow played={duration?time/duration:0}/></div></div>}
    {native&&pending&&<small>Loading audio…</small>}
    {native&&!pending&&(!source?.url||failed)&&<><small>Audio unavailable in this view</small><button className="ct-btn ct-btn-ghost" onClick={()=>{const current=revision.current;setPending(true);void media.acquire(id).then(local=>{if(current===revision.current){setSource(local);setFailed(false);setPending(false);}}).catch(()=>{if(current===revision.current)setPending(false);});}}>Reopen result</button></>}
    {!native&&failed&&<small role="status">Couldn't play audio. Open the result to check file access.</small>}
    {native&&(()=>{const buttons=<>{source?.save&&actions.includes('saveAs')&&<button className="ct-btn ct-btn-ghost" onClick={source.save}>Save as…</button>}{source?.reveal&&actions.includes('reveal')&&<button className="ct-btn ct-btn-ghost" onClick={source.reveal}>Show in folder</button>}</>;return actionsTarget===undefined?buttons:actionsTarget?createPortal(buttons,actionsTarget):null;})()}

  </div>;
}
