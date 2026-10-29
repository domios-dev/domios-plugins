import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Studio, Inspector, Settings, Developing, ResultState, Thumbnail, StateHelper, NoPreview } from '../../../media-shared/ui/src';
import { cancelAction, unknownAction, pipelinePrice, humanActions, jobStatus } from '../../../media-shared/src/presentation';
import type { HumanAction } from '../../../media-shared/src/presentation';
import type { StudioItem } from '../../../media-shared/ui/src';
import type { StudioController } from './controller';
export type ActionAvailability = { declared?: string[]; availability?: Record<HumanAction, boolean> };
export type LocalMedia = ActionAvailability & { url: string | null; fileName?: string; kind: 'image' | 'video' | 'audio'; save?: () => void; reveal?: () => void };
/** Media comes only from a reviewed frame adapter or the separate local fixture entry. */
export type MediaViewPort = ActionAvailability & { get(id: string): LocalMedia | null; reopen?(id: string): Promise<void>; copyPrompt?(text: string): void };
const allowedActions = (port?: ActionAvailability | null) => humanActions(port?.availability ?? { copyText: false, saveAs: false, reveal: false }, port?.declared ?? []);
export function MediaPreview({ media, actions = true }: { media: LocalMedia | null; actions?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [media?.url]);
  if (!media) return <p className="ct-meta">Media preview unavailable in this view.</p>;
  const allowed = allowedActions(media);
  return <div className="higgs-media">{failed || !media.url ? <p className="ct-meta">Preview unavailable</p> : media.kind === 'image' ? <img src={media.url} loading="lazy" decoding="async" onError={() => setFailed(true)} alt="Generated result" /> : media.kind === 'video' ? <video src={media.url} controls preload="metadata" onError={() => setFailed(true)} /> : <audio src={media.url} controls preload="metadata" onError={() => setFailed(true)} />}{actions && media.save && allowed.includes('saveAs') && <button className="ct-btn ct-btn-ghost" onClick={media.save}>Save as…</button>}{actions && media.reveal && allowed.includes('reveal') && <button className="ct-btn ct-btn-ghost" onClick={media.reveal}>Show in folder</button>}</div>;
}
export function App({ controller: c, media, selection, controls, stageTools, fixtureNotice, ownerLabel, fixtureLibrary = false }: { controller: StudioController; media?: MediaViewPort; selection?: (item: StudioItem, children: React.ReactNode) => React.ReactNode; controls?: React.ReactNode; stageTools?: React.ReactNode; fixtureNotice?: React.ReactNode; ownerLabel?: string; fixtureLibrary?: boolean }) {
  const s = useSyncExternalStore(c.subscribe, c.getSnapshot, c.getSnapshot);
  const [stageReady,setStageReady]=useState(false);
  const [mediaRevision, mediaChanged] = useState(0);
  const [, clockChanged] = useState(0);
  // Display clock only: never derives a job transition or triggers provider work.
  useEffect(() => { const timer = window.setInterval(() => clockChanged(n => n + 1), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { let current=true;setStageReady(false);void c.mount().then(()=>{if(current)setStageReady(true);});return()=>{current=false;c.dispose();}; }, [c]);
  const snap = s.snapshot, d = s.details;
  useEffect(() => { let current = true; const id = d?.item.outputs[0]?.id;
    if (id && media?.reopen) void media.reopen(id).then(() => { if (current) mediaChanged(n => n + 1); });
    return () => { current = false; };
  }, [d?.item.id, media]);
  const thumbnail = useCallback((i: StudioItem) => { const id=i.outputs[0]?.id; const local=id?media?.get(id):null; return local?.kind==='image'?local.url:null; }, [media]);
  const select = (id: string) => { void c.inspect(id); };

  function item(i: StudioItem) {
    const active = !['generated', 'failed', 'canceled'].includes(i.state);
    const cancel = cancelAction(i.state, { cancelQueued: snap?.capabilities.cancelQueued ?? false, cancelRunning: false });
    const check = i.state === 'unknown' ? unknownAction(snap?.capabilities.reconcile ?? false) : null;
    const gate = c.priceFor(i);
    const wait = ['waiting_ok', 'price_unavailable', 'price_stale'].includes(i.state) ? pipelinePrice(gate) : null;
    const helper = wait ? wait.helper ?? 'Approve in the run view' : null;
    const status = wait ? { label: wait.label, tone: jobStatus(gate.kind === 'ready' ? 'waiting_ok' : gate.kind === 'stale' ? 'price_stale' : 'price_unavailable').tone } : i.status;
    const elapsed = ['starting', 'queued', 'generating'].includes(i.state) ? i.status.elapsed : undefined;
    return <div className={active ? 'higgs-tile higgs-row' : 'higgs-tile'} data-state={i.state}>
      <button className="higgs-select" title={i.title} aria-label={i.title} onClick={() => select(i.id)}>
        <span className="higgs-thumb"><Thumbnail item={i} lookup={thumbnail} revision={mediaRevision}/></span>
        <span className="higgs-content">
          <span className="higgs-prompt">{i.title}</span>
          <span className="higgs-metadata"><small>{i.modelLabel ?? 'Model unavailable'}</small><small>{i.startedBy}</small>
          </span>
        </span>
      </button>
      <div className="higgs-row-end"><span className="studio-status" data-tone={status.tone}>{status.label}{elapsed ? ' · ' + elapsed : ''}</span>
      {i.status.progress !== undefined && <progress aria-label="Provider reported progress" max={1} value={i.status.progress} />}
      <div className="higgs-actions">
        {cancel && <button className="ct-btn ct-btn-ghost" onClick={() => void c.action('cancel', i.id)}>{cancel.label}</button>}
        {check && <button className="ct-btn ct-btn-ghost" onClick={() => void c.action('reconcile', i.id)}>{check.label}</button>}
        {i.actor.kind === 'run' && i.runLink && <a href={i.runLink}>View run</a>}
      </div></div>
      {active && helper && <p className="ct-meta higgs-row-note" title={helper}>{helper}</p>}
      {i.notice && <p className="ct-meta" title={i.notice}>{i.notice}</p>}
      {i.source && <button type="button" className="ct-btn ct-btn-ghost higgs-lineage" onClick={() => select(i.source!.id)}>From: {i.source.label}</button>}
      {!active && helper && <p className="ct-meta">{helper}</p>}
    </div>;
  }
  return <Studio stageReady={stageReady} renderStageCaption={i=><><p className="studio-prompt">{i.title}</p><div className="studio-facts"><span>{i.modelLabel??'Model unavailable'}</span>{c.priceFor(i).kind==='ready'&&<span className="studio-mono">{(c.priceFor(i) as {text:string}).text}</span>}<span>by {i.startedBy}</span></div><div className="studio-rail-actions">{(()=>{const cancel=cancelAction(i.state,{cancelQueued:snap?.capabilities.cancelQueued??false,cancelRunning:false});return cancel?<button className="ct-btn" onClick={()=>void c.action('cancel',i.id)}>{cancel.label}</button>:null;})()}</div></>} thumbnail={thumbnail} thumbnailRevision={mediaRevision} title="Higgsfield" glyph={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 4v16M19 4v16M5 12h3.5M15.5 12H19"/><circle cx="12" cy="12" r="3.5"/></svg>} controls={controls} fixtureNotice={fixtureNotice} ownerLabel={ownerLabel} renderStripStatus={i=>{const waiting=['waiting_ok','price_stale','price_unavailable'].includes(i.state);if(!waiting)return i.status;const gate=c.priceFor(i), result=pipelinePrice(gate);return {label:result.label,tone:jobStatus(gate.kind==='ready'?'waiting_ok':gate.kind==='stale'?'price_stale':'price_unavailable').tone};}} renderStripAction={i=>{const cancel=cancelAction(i.state,{cancelQueued:snap?.capabilities.cancelQueued??false,cancelRunning:false});return cancel?<button className="ct-btn ct-btn-ghost" onClick={()=>void c.action('cancel',i.id)}>{cancel.label}</button>:null;}} initialLibrary={fixtureLibrary && !d} notice={s.error} now={Date.now()} items={snap?.items ?? []} capacity={snap?.capacity ?? 0} activity={snap?.activity ?? []} activitySummary={snap?.activitySummary} filter={s.filter} onFilter={v => c.filter(v)}
    onSelect={select} selected={d?.item.id} onBack={() => c.back()} renderItem={item}
    next={snap?.next != null && <button className="ct-btn" onClick={() => void c.refresh(snap.next!)}>More results</button>}
    inspector={d ? navigation => {
      const i=d.item,gate=c.priceFor(i),waiting=['waiting_ok','price_stale','price_unavailable'].includes(i.state),wait=waiting?pipelinePrice(gate):null;
      const status=wait?{label:wait.label,tone:jobStatus(gate.kind==='ready'?'waiting_ok':gate.kind==='stale'?'price_stale':'price_unavailable').tone}:i.status;
      const local=i.outputs[0]?media?.get(i.outputs[0].id):null,allowed=allowedActions(local);
      const cancel=cancelAction(i.state,{cancelQueued:snap?.capabilities.cancelQueued??false,cancelRunning:false});
      const expired=/^(?:Expired|File access expired)/i.test(i.notice??snap?.items.find(item=>item.id===i.id)?.notice??'')&&!local?.url;
      const reopenable=!!(i.outputs[0]&&media?.reopen&&(allowed.length||allowedActions(media).length));
      const preview=expired?<NoPreview/>:i.outputs[0]?<MediaPreview actions={false} media={local}/>:<Developing state={i.state} aspect={d.params.aspect_ratio}/>;
      const caption=<><p className="studio-prompt">{String(d.params.prompt??i.title)}</p><div className="studio-facts"><span>{i.modelLabel??'Model unavailable'}</span>{i.recordedCost?<span title={i.recordedCost.amount+' '+i.recordedCost.unit}><span className="studio-mono">{i.recordedCost.text}</span> ({i.recordedCost.kind})</span>:gate.kind==='ready'?<span className="studio-mono">{gate.text}</span>:null}<span>by {i.startedBy}</span></div>
        <div className="studio-rail-actions">{local?.save&&allowed.includes('saveAs')&&<button className="ct-btn" onClick={local.save}>Save as…</button>}{local?.reveal&&allowed.includes('reveal')&&<button className="ct-btn" onClick={local.reveal}>Show in folder</button>}{media?.copyPrompt&&allowedActions(media).includes('copyText')&&<button className="ct-btn" onClick={()=>media.copyPrompt!(String(d.params.prompt??''))}>Copy prompt</button>}{reopenable&&<button className="ct-btn" onClick={()=>{void media!.reopen!(i.outputs[0].id).then(()=>mediaChanged(n=>n+1));}}>Reopen result</button>}{cancel&&<button className="ct-btn" onClick={()=>void c.action('cancel',i.id)}>{cancel.label}</button>}{i.state==='unknown'&&snap?.capabilities.reconcile&&<button className="ct-btn" onClick={()=>void c.action('reconcile',i.id)}>Check again</button>}</div>
        {wait&&<p className="studio-caption-helper">{wait.helper??'Approve in the run view'}</p>}<StateHelper state={i.state} notice={i.notice} expired={expired} reopenable={reopenable}/>{i.actor.kind==='run'&&i.runLink&&<a className="studio-lineage" href={i.runLink}>View run</a>}{i.source&&<button className="ct-btn higgs-lineage studio-lineage" onClick={()=>select(i.source!.id)}>From: {i.source.label}</button>}</>;
      return <Inspector tools={stageTools} navigation={navigation} status={<ResultState item={i} status={status}/>} caption={caption} onBack={()=>c.back()} preview={selection?selection(i,preview):preview}>
        <h3>Settings</h3>{Object.keys(d.params).some(k=>k!=='prompt')?<Settings schema={d.schema} values={Object.fromEntries(Object.entries(d.params).filter(([k])=>k!=='prompt'))}/>:<p className="ct-meta">Model defaults</p>}{d.inputs.length>0&&<div className="higgs-inputs">{d.inputs.map((input,n)=><span className="higgs-input-chip" key={input.id} title={input.contentType}>{media?.get(input.id)?.fileName??'Reference '+(n+1)}</span>)}</div>}
      </Inspector>;
    } : undefined} />;
}
