import React, { useState, useEffect, useRef } from 'react';
import type { Json } from '../../src/contracts';
import { groupHistory, studioPrice, jobStatus } from '../../src/presentation';
import type { EstimateView, InputSchema, StudioProps, InspectorNavigation, StudioItem } from './types';

const label = (key: string, schema: InputSchema) => schema.title || (key.charAt(0).toUpperCase() + key.slice(1).replaceAll('_', ' '));
export function Settings({ schema, values }: { schema: InputSchema; values: Record<string, Json> }) {
  function value(v: Json, s: InputSchema): React.ReactNode {
    if (v === null) return 'None';
    if (typeof v === 'boolean') return v ? 'On' : 'Off';
    if (Array.isArray(v)) return <ol>{v.map((entry, n) => <li key={n}>{value(entry, s.items ?? {})}</li>)}</ol>;
    if (typeof v === 'object') return <Settings schema={s} values={v} />;
    return typeof v === 'number' ? <span className="studio-mono">{v}</span> : String(v);
  }
  return <dl className="studio-settings">{Object.entries(values).map(([key, v]) => {
    const raw = schema.properties?.[key] ?? {};
    const s = raw.$ref?.startsWith('#/$defs/') ? schema.$defs?.[raw.$ref.slice(8)] ?? raw : raw;
    return <React.Fragment key={key}><dt title={key}>{label(key, s)}</dt><dd>{value(v, s)}</dd></React.Fragment>;
  })}</dl>;
}
export type SchemaFieldsProps = { schema: InputSchema; values: Record<string, Json>; keyFields?: string[];
  defaultValid?(key: string, field: InputSchema): boolean; onChange(key: string, value: Json | undefined): void };
export function SchemaFields({ schema, values, onChange, keyFields = [], defaultValid = () => false }: SchemaFieldsProps) {
  const fields = Object.entries(schema.properties ?? {});
  const required = new Set(schema.required ?? []);
  const resolve = (s: InputSchema) => s.$ref?.startsWith('#/$defs/') ? schema.$defs?.[s.$ref.slice(8)] ?? s : s;
  const needsInput = fields.filter(([key, s]) => key !== 'prompt' && required.has(key) && !defaultValid(key, resolve(s))).map(([key]) => key);
  const parameters = [...needsInput];
  if (parameters.length <= 3) for (const key of keyFields) if (parameters.length < 3 && key !== 'prompt' && schema.properties?.[key] && !parameters.includes(key)) parameters.push(key);
  const visible = new Set([...parameters, ...(schema.properties?.prompt ? ['prompt'] : [])]);
  function field(key: string, raw: InputSchema) {
    const s = raw.$ref?.startsWith('#/$defs/') ? schema.$defs?.[raw.$ref.slice(8)] ?? raw : raw;
    const name = label(key, s), value = values[key];
    const numeric = s.type === 'number' || s.type === 'integer';
    const update = (text: string) => { try { onChange(key, text === '' ? undefined : JSON.parse(text)); } catch { onChange(key, text); } };
    let control;
    if (s.enum && s.enum.length <= 4) control = <div role="radiogroup" aria-label={name} className="studio-segments">{s.enum.map((option, i) => <button type="button" role="radio" className="ct-btn" key={i} aria-checked={JSON.stringify(value) === JSON.stringify(option)} onClick={() => onChange(key, option)}>{String(option)}</button>)}</div>;
    else if (s.enum) control = <select aria-label={name} value={value === undefined ? '' : JSON.stringify(value)} onChange={e => update(e.target.value)}><option value="">Choose…</option>{s.enum.map((v, i) => <option key={i} value={JSON.stringify(v)}>{String(v)}</option>)}</select>;
    else if (s.type === 'boolean') control = <input type="checkbox" role="switch" aria-label={name} checked={value === true} onChange={e => onChange(key, e.target.checked)} />;
    else if (numeric) control = <div className="studio-number">{s.minimum !== undefined && s.maximum !== undefined && <input type="range" aria-label={`${name} slider`} min={s.minimum} max={s.maximum} step={s.multipleOf ?? (s.type === 'integer' ? 1 : 'any')} value={typeof value === 'number' ? value : s.minimum} onChange={e => onChange(key, Number(e.target.value))} />}<input type="number" aria-label={name} min={s.minimum} max={s.maximum} step={s.multipleOf ?? (s.type === 'integer' ? 1 : 'any')} value={typeof value === 'number' ? value : ''} onChange={e => onChange(key, e.target.value === '' ? undefined : Number(e.target.value))} />{key === 'seed' && <label><input type="checkbox" checked={value === undefined} onChange={e => onChange(key, e.target.checked ? undefined : 0)} />Random</label>}</div>;
    else if (s.type === 'string') control = key === 'prompt' || (s.maxLength ?? 0) > 500 ? <textarea aria-label={name} value={typeof value === 'string' ? value : ''} maxLength={s.maxLength} onChange={e => onChange(key, e.target.value)} /> : <input aria-label={name} value={typeof value === 'string' ? value : ''} maxLength={s.maxLength} onChange={e => onChange(key, e.target.value)} />;
    else control = <StructuredField name={name} value={value} onChange={update} />;
    function markRequired(node: React.ReactNode): React.ReactNode {
      if (!React.isValidElement(node)) return node;
      const element = node as React.ReactElement<any>;
      const input = ['input', 'textarea', 'select'].includes(String(element.type)) || element.type === StructuredField || element.props.role === 'radiogroup';
      return React.cloneElement(element, input ? { 'aria-required': true } : {}, element.props.children === undefined ? undefined : React.Children.map(element.props.children, markRequired));
    }
    const marked = required.has(key) ? markRequired(control) : control;
    return <div className="studio-field" key={key}><label title={key}>{name}{required.has(key) && <><span className="studio-sr-only"> required</span><small className="studio-required" aria-hidden="true">Required</small></>}</label>{marked}{s.description && <small>{s.description}</small>}{s.maxItems !== undefined && <small>Up to {s.maxItems} items</small>}</div>;
  }
  const more = fields.filter(([key]) => !visible.has(key));
  const changed = more.filter(([key, s]) => JSON.stringify(values[key]) !== JSON.stringify(defaultValid(key, resolve(s)) ? resolve(s).default : undefined)).length;
  return <>{fields.filter(([key]) => visible.has(key)).sort(([a], [b]) => a === 'prompt' ? -1 : b === 'prompt' ? 1 : 0).map(([key, s]) => field(key, s))}{more.length > 0 && <details><summary>More settings ({more.length}){changed > 0 ? ` · ${changed} changed` : ''}</summary>{changed > 0 && <button type="button" className="ct-btn ct-btn-ghost" onClick={() => more.forEach(([key, s]) => onChange(key, defaultValid(key, resolve(s)) ? resolve(s).default : undefined))}>Reset</button>}{more.map(([key, s]) => field(key, s))}</details>}</>;
}
export function StructuredField({ name, value, onChange, ...aria }: { name: string; value: Json | undefined; onChange(value: string): void; 'aria-required'?: boolean }) {
  const [draft, setDraft] = useState(value === undefined ? '' : JSON.stringify(value, null, 2));
  const external = JSON.stringify(value);
  const emitted = useRef(external);
  useEffect(() => {
    if (external !== emitted.current) { setDraft(value === undefined ? '' : JSON.stringify(value, null, 2)); emitted.current = external; }
  }, [external, value]);
  return <textarea {...aria} aria-label={name} value={draft} onChange={e => {
    const text = e.target.value; setDraft(text);
    try { emitted.current = JSON.stringify(text === '' ? undefined : JSON.parse(text)); } catch { emitted.current = JSON.stringify(text); }
    onChange(text);
  }} placeholder="Structured input" />;
}
export function Price({ view, onEstimate, onGenerate }: { view: EstimateView; onEstimate(): void; onGenerate(): void }) {
  const price = studioPrice(view.gate, view.count, view.available);
  const helper = view.invalid ?? (!Number.isSafeInteger(view.count) || view.count < 1 ? price.helper : view.insufficient ? `Not enough balance (needs ${view.insufficient.needs}, have ${view.insufficient.have})` :
    !view.capable ? 'Generation is unavailable in this context.' : view.gate.kind === 'ready' ? view.gate.text : price.helper);
  return <div className="studio-price">{helper && <p className="ct-meta" role="status">{helper}</p>}
    <button type="button" className="ct-btn ct-btn-primary" title={view.gate.kind === 'ready' ? `${view.gate.amount} ${view.gate.unit}` : undefined} disabled={price.disabled || !view.capable || view.busy || view.estimating || !!view.invalid || !!view.insufficient} onClick={onGenerate}>{view.invalid ? view.invalidAction ?? 'Check inputs' : view.estimating ? 'Estimating cost…' : view.busy ? jobStatus('starting').label : price.primary}</button>
    {view.available && view.gate.kind !== 'ready' && !view.invalid && !view.estimating && <button type="button" className="ct-btn ct-btn-ghost" disabled={view.busy} onClick={onEstimate}>{view.refreshLabel ?? price.refresh ?? 'Get price'}</button>}</div>;
}
/** DOM composition only. Preserve foundation day/run ordering; merge adjacent ordinary buckets into sibling grids. */
export function FinishedFeed({ items, now, renderItem, feedLayout = 'tiles' }: { items: StudioItem[]; now: number; renderItem: StudioProps['renderItem']; feedLayout?: StudioProps['feedLayout'] }) {
  return <>{groupHistory(items, now).map(day => {
    const blocks: typeof day.runs = [];
    for (const bucket of day.runs) {
      const last = blocks[blocks.length - 1];
      if (bucket.actor.kind !== 'run' && last && last.actor.kind !== 'run') last.items.push(...bucket.items);
      else blocks.push({ actor: bucket.actor, items: [...bucket.items] });
    }
    return <section key={day.day}><h2>{day.day}</h2>{blocks.map((block, n) => block.actor.kind === 'run'
      ? <div key={n} className="studio-run"><p className="ct-meta">{block.actor.label}</p><div className="studio-feed" data-layout={feedLayout}>{block.items.map(item => <article key={item.id}>{renderItem(item)}</article>)}</div></div>
      : <div key={n} className="studio-feed" data-layout={feedLayout}>{block.items.map(item => <article key={item.id}>{renderItem(item)}</article>)}</div>)}</section>;
  })}</>;
}
/** Honest, amplitude-free audio projection. Dots retain their circular geometry. */
export function DotRow({ played = 0 }: { played?: number }) {
  const ref=useRef<SVGSVGElement>(null),[width,setWidth]=useState(660);
  useEffect(()=>{const node=ref.current;if(!node||typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(()=>setWidth(Math.max(6,node.clientWidth)));observer.observe(node);return()=>observer.disconnect();},[]);
  const columns=Math.max(1,Math.floor(width/6));
  return <svg ref={ref} className="studio-dot-row" viewBox={`0 0 ${width} 60`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">{Array.from({length:columns}, (_, n) => <circle key={n} cx={n*6+3} cy={30} r={1.7} fill={n/columns < played ? 'var(--ct-accent)' : 'var(--ct-faint, var(--ct-muted-fg))'} opacity={n/columns < played ? 1 : .7}/>)}</svg>;
}
export function Developing({ state = 'empty', audio = false }: { state?: string; audio?: boolean }) {
  const running = ['starting','queued','generating'].includes(state);
  return <div className={`studio-developing${audio ? ' studio-developing-audio' : ''}`} data-state={state} aria-label={running ? 'Developing, no preview yet' : 'No preview available'}>{audio ? <DotRow/> : running ? <span className="studio-develop-ring"/> : null}</div>;
}
export function ResultState({ item, status = item.status }: { item: StudioItem; status?: {label:string;tone:string} }) {
  const running = ['starting','queued','generating'].includes(item.state);
  return <span className="studio-status" data-tone={status.tone}>{running && <ActivityDots/>}{status.label}{item.status.elapsed && <span className="studio-mono">{item.status.elapsed}</span>}{item.status.progress !== undefined && <progress aria-label="Provider reported progress" max={1} value={item.status.progress}/>}</span>;
}
function ActivityDots() { return <span className="studio-beat" aria-hidden="true"><i/><i/><i/></span>; }
/** Look up already-available media only near visible thumbnails; never acquire here. */
export function Thumbnail({item, lookup, revision}:{item:StudioItem;lookup?:StudioProps['thumbnail'];revision?:number}) {
  const ref=useRef<HTMLSpanElement>(null),[url,setUrl]=useState<string|null>(null),[failed,setFailed]=useState(false);
  useEffect(()=>{setUrl(null);setFailed(false);const node=ref.current;if(!node||!lookup||!item.outputs[0]?.contentType.startsWith('image/')||typeof IntersectionObserver==='undefined')return;const root=node.closest('.studio-strip, .studio-results');const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setUrl(lookup(item));observer.disconnect();}},{root,rootMargin:'100px'});observer.observe(node);return()=>observer.disconnect();},[item,lookup,revision]);
  return <span ref={ref} className="studio-strip-thumb" data-state={item.state} aria-hidden="true">{url&&!failed?<img src={url} alt="" loading="lazy" decoding="async" onError={()=>setFailed(true)}/>:item.outputs[0]?.contentType.startsWith('audio/')?<DotRow/>:item.outputs[0]?.contentType.startsWith('video/')?<span className="studio-video-glyph">▷</span>:<Developing state={item.state}/>}</span>;
}
/** Keep an authorized displayed item across refresh; ordering never implies lineage. */
export function stageCandidate(items: StudioItem[], remembered?: string) {
  if(remembered&&items.some(i=>i.id===remembered))return remembered;
  const newest=[...items].sort((a,b)=>b.at-a.at);
  return (newest.find(i=>['starting','queued','generating'].includes(i.state))??newest[0])?.id;
}
/** Escape closes the contact sheet; a staged result is never a dismissible landing. */
export function handleStageKey(event: React.KeyboardEvent, library: boolean, closeLibrary: () => void) {
  if(typeof HTMLElement!=='undefined'&&event.target instanceof HTMLElement&&/INPUT|TEXTAREA|SELECT/.test(event.target.tagName))return;
  if(event.key==='Escape'&&library){closeLibrary();event.preventDefault();}
}
export function Studio(p: StudioProps) {
  const [library, setLibrary] = useState(p.initialLibrary ?? false);
  const [search, setSearch] = useState('');
  const stripRef=useRef<HTMLElement>(null),autoStaged=useRef(false),remembered=useRef<string|undefined>(undefined);
  useEffect(()=>{stripRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({block:'nearest',inline:'nearest'});},[p.selected]);
  useEffect(() => { if (p.selected) { setLibrary(false); autoStaged.current=true; remembered.current=p.selected; } }, [p.selected]);
  // The first authorized snapshot stages live work, then stays with that exact item.
  // Empty/context-reset snapshots fence the previous owner's automatic choice.
  useEffect(()=>{if(!p.items.length){autoStaged.current=false;return;}if(autoStaged.current||p.selected||library)return;autoStaged.current=true;const id=stageCandidate(p.items,remembered.current);remembered.current=id;if(id)p.onSelect(id);},[p.items,p.selected,library,p.onSelect]);
  const filtered = p.items.filter(i => (!p.filter || p.filter === 'everyone' || i.actor.kind === p.filter) && `${i.title} ${i.operation}`.toLowerCase().includes(search.toLowerCase()));
  const active = filtered.filter(i => !['generated', 'failed', 'canceled'].includes(i.state));
  const finished = filtered.filter(i => !active.includes(i));
  const selectedIndex = filtered.findIndex(i => i.id === p.selected);
  const navigation: InspectorNavigation | undefined = selectedIndex < 0 ? undefined : {
    index: selectedIndex + 1, total: filtered.length,
    previous: selectedIndex > 0 ? () => p.onSelect(filtered[selectedIndex - 1].id) : undefined,
    next: selectedIndex + 1 < filtered.length ? () => p.onSelect(filtered[selectedIndex + 1].id) : undefined };
  const open = (id: string) => { autoStaged.current=true; remembered.current=id; p.onSelect(id); setLibrary(false); };
  const navigate = (event: React.KeyboardEvent) => handleStageKey(event, library, () => setLibrary(false));
  const chronological=[...filtered].sort((a,b)=>b.at-a.at);
  const staged=p.items.find(i=>i.id===(p.selected??remembered.current))??p.items.find(i=>i.id===stageCandidate(p.items));
  const running=p.items.some(i=>['starting','queued','generating'].includes(i.state));
  const thumb=(i:StudioItem)=><button key={i.id} className="studio-strip-result" data-wide={p.feedLayout==='rows'||i.outputs[0]?.contentType.startsWith('video/')} type="button" data-stage-item aria-label={i.title} title={i.title} aria-current={i.id === p.selected ? 'true' : undefined} onClick={() => open(i.id)}><Thumbnail item={i} lookup={p.thumbnail} revision={p.thumbnailRevision}/><span className="studio-strip-title">{i.title}</span></button>;
  return <main className="studio studio-stage-shell" onKeyDown={navigate}>
    <header className="ct-toolbar"><span className="studio-glyph" aria-hidden="true">{p.glyph}</span><h1>{p.title}</h1>{(p.activitySummary??p.activity[0]??p.ownerLabel)&&<div className="studio-live-line">{running&&<ActivityDots/>}<span className="studio-agent-short">{p.ownerLabel}</span><div className="studio-activity">{p.activitySummary ?? p.activity[0] ?? p.ownerLabel ?? null}</div></div>}<div className="studio-header-controls">{p.controls}<button className="ct-btn studio-library-button" type="button" aria-label={library?'Close library':'Library'} aria-expanded={library} onClick={() => setLibrary(!library)}><span aria-hidden="true">▦</span><span className="studio-control-label">{library ? 'Close library' : 'Library'}</span></button></div></header>
    {p.notice && <p role="status" className="studio-activity">{p.notice}</p>}{p.fixtureNotice}
    <div className="studio-light-table" data-library={library}>
    {!library&&filtered.length>0&&<section ref={stripRef} className="studio-strip" aria-label="Results and activity" onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)||!(e.target instanceof HTMLButtonElement)||!e.target.hasAttribute('data-stage-item'))return;const buttons=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-stage-item]'));const index=buttons.indexOf(e.target),delta=e.key==='ArrowUp'?-3:e.key==='ArrowDown'?3:e.key==='ArrowLeft'?-1:1;const next=buttons[index+delta];if(next){e.preventDefault();next.focus();}}}><FinishedFeed items={chronological} now={p.now} renderItem={thumb}/>{p.next}</section>}
    <div className="studio-stage-content">{library ? <section className="studio-results" aria-label="Library"><div className="studio-library-controls"><select aria-label="Show activity from" value={p.filter ?? 'everyone'} onChange={e => p.onFilter?.(e.target.value as NonNullable<StudioProps['filter']>)}><option value="everyone">Everyone</option><option value="you">You</option><option value="agent">Agents</option><option value="run">Pipelines</option></select><input type="search" aria-label="Search prompts" placeholder="Search prompts" value={search} onChange={e => setSearch(e.target.value)} /></div>{active.length > 0 && <section><h2>In progress</h2><div className="studio-active">{active.map(i=><article key={i.id}>{p.renderItem(i)}</article>)}</div></section>}<FinishedFeed items={finished} now={p.now} renderItem={p.renderItem} feedLayout={p.feedLayout}/>{filtered.length === 0 && <p>No results in this view.</p>}{p.next}</section> : p.selected && p.inspector ? (typeof p.inspector === 'function' ? p.inspector(navigation) : p.inspector) : p.items.length>0 ? <div className="studio-stage-pending"><Developing state={staged?.state} audio={p.feedLayout==='rows'}/>{staged&&<><p className="studio-prompt">{staged.title}</p><ResultState item={staged} status={p.renderStripStatus?.(staged)}/></>}</div> : <div className="studio-stage-empty">{p.empty??<Developing audio={p.feedLayout==='rows'}/>}<p>{p.ownerLabel ? `${p.ownerLabel} will put results here as it works.` : 'Your agent will put results here as it works.'}</p></div>}</div>
    </div>
  </main>;
}
export function Inspector({ preview, children, navigation, tools, caption, status }: { onBack(): void; preview: React.ReactNode; children: React.ReactNode; navigation?: InspectorNavigation; tools?: React.ReactNode; caption?:React.ReactNode; status?:React.ReactNode }) {
  return <section className="studio-inspector" aria-label="Result inspector"><div className="studio-inspector-nav"><div className="studio-step">{navigation&&<><button className="ct-btn studio-icon-button" aria-label="Previous result" disabled={!navigation.previous} onClick={navigation.previous}>‹</button><span className="studio-mono">{navigation.index} / {navigation.total}</span><button className="ct-btn studio-icon-button" aria-label="Next result" disabled={!navigation.next} onClick={navigation.next}>›</button></>}</div>{tools}{status}</div><div className="studio-inspector-body"><div className="studio-preview">{preview}</div><div className="studio-caption">{caption}<details className="studio-inspector-rail" onKeyDown={e=>{if(e.key==='Escape'&&e.currentTarget.open){e.preventDefault();e.stopPropagation();e.currentTarget.open=false;e.currentTarget.querySelector('summary')?.focus();}}}><summary>Details</summary><div className="studio-inspector-details">{children}</div></details></div></div></section>;
}
