import React, { useRef, useState } from 'react';
import { containPoint, region, textSpan, timeRange, type Point } from './selection';

/** This port is explicitly fixture-only. It is not a host delivery contract. */
export type FixtureTarget = { kind: 'image' | 'video' | 'audio'; revision: string; durationMs?: number; text?: string; refuse?: (proposal: FixtureProposal) => void };
export type FixtureProposal = { revision: string; anchor: Anchor; text: string; intent: 'change' | 'question' };
export type Anchor = { kind: 'point'; point: Point } | { kind: 'rect'; rect: NonNullable<ReturnType<typeof region>> } | { kind: 'frame'; t_ms: number; point?: Point; rect?: NonNullable<ReturnType<typeof region>> } | { kind: 'range'; range: NonNullable<ReturnType<typeof timeRange>> } | { kind: 'span'; span: NonNullable<ReturnType<typeof textSpan>> };
export function pointFromImage(image: Pick<HTMLImageElement, 'naturalWidth' | 'naturalHeight' | 'getBoundingClientRect'>, clientX: number, clientY: number) {
  const box = image.getBoundingClientRect();
  return containPoint(clientX - box.left, clientY - box.top, box.width, box.height, image.naturalWidth, image.naturalHeight);
}
/** Resolve a pointer gesture only against the measured media, never the surrounding stage. */
export function imageGesture(image: Pick<HTMLImageElement, 'naturalWidth'|'naturalHeight'|'getBoundingClientRect'>, from: {x:number;y:number}, to: {x:number;y:number}): Extract<Anchor,{kind:'point'|'rect'}> | null {
  const first=pointFromImage(image,from.x,from.y), last=pointFromImage(image,to.x,to.y);
  if(!first || !last)return null;
  if(first.x===last.x && first.y===last.y)return {kind:'point',point:last}; const rect=region(first,last); return rect ? {kind:'rect',rect} : null;
}
export function handleFixturePointer(event: Pick<React.PointerEvent<HTMLDivElement>, 'clientX'|'clientY'|'currentTarget'>, finish: boolean, down: {current: {x:number;y:number}|null}, accept: (anchor: Anchor)=>void) {
  const image=event.currentTarget.querySelector('img,video'); if(!image)return;
  const media = image.tagName === 'VIDEO' ? {naturalWidth:(image as HTMLVideoElement).videoWidth,naturalHeight:(image as HTMLVideoElement).videoHeight,getBoundingClientRect:()=>image.getBoundingClientRect()} : image as HTMLImageElement;
  if(!finish){down.current={x:event.clientX,y:event.clientY};return;}
  const first=down.current;down.current=null;if(!first)return;
  const selected=imageGesture(media,first,{x:event.clientX,y:event.clientY});if(!selected)return;
  if(image.tagName === 'VIDEO'){if(!Number.isFinite((image as HTMLVideoElement).currentTime)||!Number.isFinite((image as HTMLVideoElement).duration)||(image as HTMLVideoElement).duration<=0||(image as HTMLVideoElement).currentTime<0||(image as HTMLVideoElement).currentTime>(image as HTMLVideoElement).duration)return; const t_ms=Math.round((image as HTMLVideoElement).currentTime*1000);accept(selected.kind==='point'?{kind:'frame',t_ms,point:selected.point}:{kind:'frame',t_ms,rect:selected.rect});}else accept(selected);
}
export function timelineGesture(box: {left:number;width:number}, from: number, to: number, duration: number) {
  if (![box.left,box.width,from,to,duration].every(Number.isFinite) || box.width<=0 || duration<=0) return null;
  const a=(from-box.left)/box.width, b=(to-box.left)/box.width;
  if(a<0 || a>1 || b<0 || b>1) return null;
  return timeRange(a*duration,b*duration,duration);
}
export function handleTimelinePointer(event: Pick<React.PointerEvent<HTMLDivElement>, 'clientX'|'currentTarget'>, finish: boolean, duration: number, down: {current:number|null}, accept: (anchor: Anchor)=>void) {
  if(!finish){down.current=event.clientX;return;} const from=down.current;down.current=null;if(from===null)return;
  const range=timelineGesture(event.currentTarget.getBoundingClientRect(),from,event.clientX,duration);if(range)accept({kind:'range',range});
}
export function spanFromOffsets(text:string, anchor:number, focus:number) {
  const a=Math.min(anchor,focus),b=Math.max(anchor,focus);
  const splitsPair=(offset:number)=>offset>0 && offset<text.length && /[\uD800-\uDBFF]/.test(text[offset-1]) && /[\uDC00-\uDFFF]/.test(text[offset]);
  if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b>text.length||splitsPair(a)||splitsPair(b))return null;
  return textSpan(text,Array.from(text.slice(0,a)).length,Array.from(text.slice(0,b)).length);
}
/** Fixture refusal is local and retains the supplied words; it cannot report delivery. */
export function submitFixture(target: FixtureTarget, anchor: Anchor | null, text: string, intent: 'change'|'question'): boolean {
  if(!anchor || !text.trim() || text.length>4000 || !target.revision.startsWith('synthetic:'))return false;
  try { target.refuse?.({revision:target.revision,anchor,text,intent}); } catch { /* A fixture refusal leaves the words in place. */ } return true;
}
export function FixtureSelection({ target, children }: { target: FixtureTarget; children: React.ReactNode }) {
  const [commenting, setCommenting] = useState(false), [anchor, setAnchor] = useState<Anchor | null>(null), [text, setText] = useState(''), [intent, setIntent] = useState<'change' | 'question'>('change'), [sent, setSent] = useState(false);
  const [cross, setCross] = useState<Point>({x:.5,y:.5}), [start, setStart] = useState(''), [end, setEnd] = useState(''), [simulated, setSimulated] = useState('');
  const surfaceRef = useRef<HTMLDivElement>(null);
  const down = useRef<{x:number;y:number} | null>(null), keyboardOrigin = useRef<Point | null>(null), rangeDown = useRef<number | null>(null);
  const [bounds, setBounds] = useState<{left:number;top:number;width:number;height:number}|null>(null);
  const measure = (surface: HTMLDivElement) => { const image=surface.querySelector('img,video'); if(!image)return; const iw=image.tagName === 'VIDEO'?(image as HTMLVideoElement).videoWidth:(image as HTMLImageElement).naturalWidth, ih=image.tagName === 'VIDEO'?(image as HTMLVideoElement).videoHeight:(image as HTMLImageElement).naturalHeight; if(!iw||!ih)return; const box=image.getBoundingClientRect(), outer=surface.getBoundingClientRect(), scale=Math.min(box.width/iw,box.height/ih), width=iw*scale, height=ih*scale; setBounds({left:box.left-outer.left+(box.width-width)/2,top:box.top-outer.top+(box.height-height)/2,width,height}); };
  const summary = anchor?.kind === 'point' ? `Point: ${Math.round(anchor.point.x*100)}%, ${Math.round(anchor.point.y*100)}%` : anchor?.kind === 'rect' ? `Region: ${Math.round(anchor.rect.x*100)}%, ${Math.round(anchor.rect.y*100)}%, ${Math.round(anchor.rect.w*100)}% × ${Math.round(anchor.rect.h*100)}%` : anchor?.kind === 'frame' ? `Frame: ${(anchor.t_ms/1000).toFixed(1)} seconds` : anchor?.kind === 'range' ? `Range: ${(anchor.range.t0_ms/1000).toFixed(1)} – ${(anchor.range.t1_ms/1000).toFixed(1)} seconds` : anchor?.kind === 'span' ? `Text: “${anchor.span.quote}”` : 'No selection';
  const update = (next: Anchor) => { setAnchor(next); setSent(false); };
  const pointer = (e: React.PointerEvent<HTMLDivElement>, finish: boolean) => {
    if (!commenting || !['image','video'].includes(target.kind)) return;
    measure(e.currentTarget); handleFixturePointer(e,finish,down,update);
  };
  const keyboard = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!commenting || e.target !== e.currentTarget) return;
    if (e.key==='Escape') { e.preventDefault(); e.stopPropagation(); setAnchor(null); setCommenting(false); return; }
    if ((target.kind==='audio' || target.kind==='video') && ['i','o'].includes(e.key.toLowerCase())) { const media=e.currentTarget.querySelector('audio,video') as HTMLMediaElement | null; if(!media || !Number.isFinite(media.duration) || !Number.isFinite(media.currentTime) || media.duration<=0)return; e.preventDefault(); if(e.key.toLowerCase()==='i')setStart(String(media.currentTime));else setEnd(String(media.currentTime)); return; }
    if (!['image','video'].includes(target.kind)) return;
    if (e.key === ' ') { e.preventDefault(); keyboardOrigin.current = cross; return; }
    if (e.key === 'Enter') { e.preventDefault(); if(target.kind==='video'){const video=e.currentTarget.querySelector('video'); if(!video || !Number.isFinite(video.currentTime) || !Number.isFinite(video.duration) || video.duration<=0)return; update({kind:'frame',t_ms:Math.round(video.currentTime*1000),point:cross});}else update({kind:'point',point:cross}); return; }
    const delta = e.shiftKey ? .1 : .01; const movement: Record<string,Point> = {ArrowLeft:{x:-delta,y:0},ArrowRight:{x:delta,y:0},ArrowUp:{x:0,y:-delta},ArrowDown:{x:0,y:delta}};
    const move = movement[e.key]; if (!move) return; e.preventDefault(); const next={x:Math.max(0,Math.min(1,cross.x+move.x)),y:Math.max(0,Math.min(1,cross.y+move.y))}; setCross(next); if(keyboardOrigin.current){const rect=region(keyboardOrigin.current,next);if(rect){if(target.kind==='video'){const video=e.currentTarget.querySelector('video');if(video && Number.isFinite(video.currentTime) && Number.isFinite(video.duration) && video.duration>0)update({kind:'frame',t_ms:Math.round(video.currentTime*1000),rect});}else update({kind:'rect',rect});}}
  };
  const selectText = (e: React.SyntheticEvent<HTMLParagraphElement>) => {
    if (!commenting) return; const selection = window.getSelection(), node = e.currentTarget.firstChild; if (!selection || !node || selection.anchorNode !== node || selection.focusNode !== node || !target.text) return;
    const span = spanFromOffsets(target.text,selection.anchorOffset,selection.focusOffset); if (span) update({kind:'span',span});
  };
  const visual = anchor?.kind==='point' ? anchor.point : anchor?.kind==='rect' ? {x:anchor.rect.x+anchor.rect.w,y:anchor.rect.y+anchor.rect.h} : anchor?.kind==='frame' ? (anchor.point ?? (anchor.rect ? {x:anchor.rect.x+anchor.rect.w,y:anchor.rect.y+anchor.rect.h} : undefined)) : undefined;
  const surfaceBox=surfaceRef.current?.getBoundingClientRect(), parentBox=surfaceRef.current?.parentElement?.getBoundingClientRect();
  const popupStyle: React.CSSProperties | undefined = visual && bounds && surfaceBox && parentBox ? (()=>{const width=Math.min(320,parentBox.width), x=surfaceBox.left-parentBox.left+bounds.left+visual.x*bounds.width, y=surfaceBox.top-parentBox.top+bounds.top+visual.y*bounds.height, flip=surfaceBox.top+bounds.top+visual.y*bounds.height>window.innerHeight-260; return {position:'absolute',width,left:Math.max(0,Math.min(parentBox.width-width,x)),top:y,transform:flip?'translateY(-100%)':undefined,zIndex:2};})() : undefined;
  return <div className="studio-fixture-selection"><div className="studio-fixture-mode"><span className="ct-meta">Fixture: not sent · synthetic target</span><button type="button" className="ct-btn" aria-pressed={commenting} onClick={()=>setCommenting(!commenting)}>Comment</button></div>
    <div ref={surfaceRef} className="studio-selection-surface" tabIndex={commenting?0:undefined} aria-label={commenting?'Media selection surface':undefined} onPointerDown={e=>pointer(e,false)} onPointerUp={e=>pointer(e,true)} onPointerCancel={()=>{down.current=null;}} onKeyDown={keyboard} onKeyUp={e=>{if(e.key===' ')keyboardOrigin.current=null;}} onFocus={e=>measure(e.currentTarget)}>{children}{commenting && bounds && (target.kind==='image'||target.kind==='video') && <div className="studio-selection-bounds" style={bounds} aria-hidden="true"><span className="studio-crosshair" style={{left:`${cross.x*100}%`,top:`${cross.y*100}%`}}>+</span>{(anchor?.kind==='point' || anchor?.kind==='frame' && anchor.point) && <span className="studio-pin" style={{left:`${(anchor.kind==='point'?anchor.point:anchor.point!).x*100}%`,top:`${(anchor.kind==='point'?anchor.point:anchor.point!).y*100}%`}}>1</span>}{(anchor?.kind==='rect' || anchor?.kind==='frame' && anchor.rect) && <span className="studio-region" style={{left:`${anchor.rect!.x*100}%`,top:`${anchor.rect!.y*100}%`,width:`${anchor.rect!.w*100}%`,height:`${anchor.rect!.h*100}%`}}/>}</div>}</div>
    {target.text && <p className="studio-selection-text" onMouseUp={selectText} onKeyUp={selectText}>{target.text}</p>}
    {commenting && target.durationMs && Number.isFinite(target.durationMs) && target.durationMs>0 && <div className="studio-range-fields"><label>Start (seconds)<input type="number" min="0" max={target.durationMs/1000} step="0.1" value={start} onChange={e=>setStart(e.target.value)}/></label><label>End (seconds)<input type="number" min="0" max={target.durationMs/1000} step="0.1" value={end} onChange={e=>setEnd(e.target.value)}/></label><button type="button" className="ct-btn" onClick={()=>{if(start===''||end==='')return;const range=timeRange(Number(start)*1000,Number(end)*1000,target.durationMs!);if(range)update({kind:'range',range});}}>Select range</button></div>}
    {commenting && target.durationMs && Number.isFinite(target.durationMs) && target.durationMs>0 && <div className="studio-range-track" aria-label="Drag to select a time range" onPointerDown={e=>{handleTimelinePointer(e,false,target.durationMs!,rangeDown,update);e.currentTarget.setPointerCapture(e.pointerId);}} onPointerUp={e=>handleTimelinePointer(e,true,target.durationMs!,rangeDown,update)} onPointerCancel={()=>{rangeDown.current=null;}}>{anchor?.kind==='range' && <span style={{left:`${100*anchor.range.t0_ms/target.durationMs}%`,width:`${100*(anchor.range.t1_ms-anchor.range.t0_ms)/target.durationMs}%`}}/>}</div>}
    {commenting && anchor?.kind==='range' && <button type="button" className="ct-btn" onClick={()=>{const media=surfaceRef.current?.querySelector('audio,video') as HTMLMediaElement|null;if(media && Number.isFinite(media.duration) && anchor.range.t1_ms<=media.duration*1000)media.currentTime=anchor.range.t0_ms/1000;}}>Go to range start</button>}
    {commenting && <p className="ct-meta" role="status">{summary}</p>}
    {commenting && anchor && <div className="studio-comment" style={popupStyle}>{!sent && <><label>What should change?<textarea placeholder="What should change?" maxLength={4000} value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setAnchor(null);}else if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();if(submitFixture(target,anchor,text,intent))setSent(true);}}}/></label><div><button type="button" className="ct-btn" aria-pressed={intent==='change'} onClick={()=>setIntent('change')}>Change</button><button type="button" className="ct-btn" aria-pressed={intent==='question'} onClick={()=>setIntent('question')}>Question</button><button type="button" className="ct-btn" disabled={!text.trim()} onClick={()=>{if(submitFixture(target,anchor,text,intent))setSent(true);}}>Send (fixture)</button></div></>}{sent&&<><p role="status">Fixture: not sent</p><button type="button" className="ct-btn" onClick={()=>setSent(false)}>Edit comment</button></>}<details><summary>Simulated evidence examples</summary>{['Sending…','Sent','Seen','Addressed in v3'].map(label=><button type="button" className="ct-btn" key={label} onClick={()=>setSimulated(label)}>Simulated {label}</button>)}{simulated&&<p>Simulated {simulated}</p>}</details></div>}
  </div>;
}
