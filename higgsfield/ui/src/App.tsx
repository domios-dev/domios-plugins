import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Studio, Inspector, Settings } from '../../../media-shared/ui/src';
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
  const [mediaRevision, mediaChanged] = useState(0);
  const [, clockChanged] = useState(0);
  // Display clock only: never derives a job transition or triggers provider work.
  useEffect(() => { const timer = window.setInterval(() => clockChanged(n => n + 1), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { void c.mount(); return () => c.dispose(); }, [c]);
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
      <button className="higgs-select" onClick={() => select(i.id)}>
        <span className="higgs-thumb" aria-hidden="true">{i.outputs[0]?.contentType.startsWith('video/') ? '▷' : '▧'}</span>
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
      {active && helper && <p className="ct-meta higgs-row-note">{helper}</p>}
      {i.notice && <p className="ct-meta">{i.notice}</p>}
      {i.source && <button type="button" className="ct-btn ct-btn-ghost higgs-lineage" onClick={() => select(i.source!.id)}>From: {i.source.label}</button>}
      {!active && helper && <p className="ct-meta">{helper}</p>}
    </div>;
  }
  return <Studio thumbnail={thumbnail} thumbnailRevision={mediaRevision} title="Higgsfield" controls={controls} fixtureNotice={fixtureNotice} ownerLabel={ownerLabel} renderStripStatus={i=>{const waiting=['waiting_ok','price_stale','price_unavailable'].includes(i.state);if(!waiting)return i.status;const gate=c.priceFor(i), result=pipelinePrice(gate);return {label:result.label,tone:jobStatus(gate.kind==='ready'?'waiting_ok':gate.kind==='stale'?'price_stale':'price_unavailable').tone};}} renderStripAction={i=>{const cancel=cancelAction(i.state,{cancelQueued:snap?.capabilities.cancelQueued??false,cancelRunning:false});return cancel?<button className="ct-btn ct-btn-ghost" onClick={()=>void c.action('cancel',i.id)}>{cancel.label}</button>:null;}} initialLibrary={fixtureLibrary && !d} notice={s.error} now={Date.now()} items={snap?.items ?? []} capacity={snap?.capacity ?? 0} activity={snap?.activity ?? []} activitySummary={snap?.activitySummary} filter={s.filter} onFilter={v => c.filter(v)}
    onSelect={select} selected={d?.item.id} onBack={() => c.back()} renderItem={item}
    next={snap?.next != null && <button className="ct-btn" onClick={() => void c.refresh(snap.next!)}>More results</button>}
    inspector={d ? navigation => <Inspector tools={stageTools} navigation={navigation} onBack={() => c.back()} preview={selection ? selection(d.item, <MediaPreview actions={false} media={d.item.outputs[0] ? media?.get(d.item.outputs[0].id) ?? null : null} />) : <MediaPreview actions={false} media={d.item.outputs[0] ? media?.get(d.item.outputs[0].id) ?? null : null} />}><div className="studio-rail-actions">{(()=>{const local=d.item.outputs[0]?media?.get(d.item.outputs[0].id):null;const actions=allowedActions(local);return <>{local?.save&&actions.includes('saveAs')&&<button className="ct-btn ct-btn-ghost" onClick={local.save}>Save as…</button>}{media?.copyPrompt&&allowedActions(media).includes('copyText')&&<button className="ct-btn ct-btn-ghost" onClick={()=>media.copyPrompt!(String(d.params.prompt??''))}>Copy prompt</button>}{media?.reopen&&d.item.outputs[0]&&<button className="ct-btn ct-btn-ghost" onClick={()=>{void media.reopen!(d.item.outputs[0].id).then(()=>mediaChanged(n=>n+1));}}>Reopen result</button>}{local?.reveal&&actions.includes('reveal')&&<button className="ct-btn ct-btn-ghost" onClick={local.reveal}>Show in folder</button>}</>;})()}</div><h2>Prompt</h2><p>{String(d.params.prompt ?? '')}</p><h3>Model</h3><p>{d.item.modelLabel ?? 'Model unavailable'}</p><h3>Settings</h3>{Object.keys(d.params).some(k => k !== 'prompt') ? <Settings schema={d.schema} values={Object.fromEntries(Object.entries(d.params).filter(([k]) => k !== 'prompt'))} /> : <p className="ct-meta">Model defaults</p>}<h3>Cost</h3><p>{d.item.recordedCost ? <span title={d.item.recordedCost.amount + " " + d.item.recordedCost.unit}>{d.item.recordedCost.text} ({d.item.recordedCost.kind})</span> : "Not recorded"}</p><p className="ct-meta">Started by {d.item.startedBy}</p>{d.item.source && <button type="button" className="ct-btn ct-btn-ghost higgs-lineage" onClick={() => select(d.item.source!.id)}>From: {d.item.source.label}</button>}{d.inputs.length > 0 && <div className="higgs-inputs">{d.inputs.map((i, n) => { const local = media?.get(i.id); return <span className="higgs-input-chip" key={i.id} title={i.contentType}><span aria-hidden="true">▧</span>{local?.fileName ?? "Reference " + (n + 1)}</span>; })}</div>}</Inspector> : undefined} />;
}
