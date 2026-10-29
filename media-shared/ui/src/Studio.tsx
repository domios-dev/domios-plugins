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
    return String(v);
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
export function Studio(p: StudioProps) {
  const [library, setLibrary] = useState(p.initialLibrary ?? false);
  const [search, setSearch] = useState('');
  useEffect(() => { if (p.selected) setLibrary(false); }, [p.selected]);
  const filtered = p.items.filter(i => (!p.filter || p.filter === 'everyone' || i.actor.kind === p.filter) && `${i.title} ${i.operation}`.toLowerCase().includes(search.toLowerCase()));
  const active = filtered.filter(i => !['generated', 'failed', 'canceled'].includes(i.state));
  const finished = filtered.filter(i => !active.includes(i));
  const selectedIndex = filtered.findIndex(i => i.id === p.selected);
  const navigation: InspectorNavigation | undefined = selectedIndex < 0 ? undefined : {
    index: selectedIndex + 1, total: filtered.length,
    previous: selectedIndex > 0 ? () => p.onSelect(filtered[selectedIndex - 1].id) : undefined,
    next: selectedIndex + 1 < filtered.length ? () => p.onSelect(filtered[selectedIndex + 1].id) : undefined };
  const open = (id: string) => { p.onSelect(id); setLibrary(false); };
  const navigate = (event: React.KeyboardEvent) => {
    if (event.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    if (event.key === 'Escape' && library) { setLibrary(false); event.preventDefault(); }
    else if (event.key === 'Escape' && p.selected) { p.onBack(); event.preventDefault(); }
  };
  return <main className="studio studio-stage-shell" onKeyDown={navigate}>
    <header className="ct-toolbar"><h1>{p.title}</h1><button className="ct-btn" type="button" aria-expanded={library} onClick={() => setLibrary(!library)}>{library ? 'Close library' : 'Library'}</button></header>
    {p.notice && <p role="status" className="studio-activity">{p.notice}</p>}
    {p.activity.length > 0 && <div className="studio-activity">{p.activitySummary ?? p.activity[0]}</div>}
    <div className="studio-stage-content">{library ? <section className="studio-results" aria-label="Library"><div className="studio-library-controls"><select aria-label="Show activity from" value={p.filter ?? 'everyone'} onChange={e => p.onFilter?.(e.target.value as NonNullable<StudioProps['filter']>)}><option value="everyone">Everyone</option><option value="you">You</option><option value="agent">Agents</option><option value="run">Pipelines</option></select><input type="search" aria-label="Search prompts" placeholder="Search prompts" value={search} onChange={e => setSearch(e.target.value)} /></div>{active.length > 0 && <section><h2>In progress</h2><div className="studio-active">{active.map(i=><article key={i.id}>{p.renderItem(i)}</article>)}</div></section>}<FinishedFeed items={finished} now={p.now} renderItem={p.renderItem} feedLayout={p.feedLayout}/>{filtered.length === 0 && <p>No results in this view.</p>}{p.next}</section> : p.selected && p.inspector ? (typeof p.inspector === 'function' ? p.inspector(navigation) : p.inspector) : <div className="studio-stage-empty"><p>{p.items.length ? 'Select a result to view it.' : 'Nothing has been made yet. It will appear here as it runs.'}</p></div>}</div>
    {!library && filtered.length > 0 && <section className="studio-strip" aria-label="Results and activity" onKeyDown={e => { if (!['ArrowLeft','ArrowRight'].includes(e.key) || !(e.target instanceof HTMLButtonElement) || !e.target.hasAttribute('data-stage-item')) return; const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-stage-item]')); const index = buttons.indexOf(e.target); const next = buttons[index + (e.key === 'ArrowRight' ? 1 : -1)]; if (next) { e.preventDefault(); next.focus(); } }}>{filtered.filter(i => i.outputs.length > 0).map(i => <button key={i.id} className="ct-btn ct-btn-ghost" type="button" data-stage-item aria-current={i.id === p.selected ? 'true' : undefined} onClick={() => open(i.id)}>{i.title}</button>)}{active.map(i => <div className="studio-active studio-strip-active" key={i.id}>{p.renderItem(i)}</div>)}</section>}
  </main>;
}
export function Inspector({ onBack, preview, children, navigation }: { onBack(): void; preview: React.ReactNode; children: React.ReactNode; navigation?: InspectorNavigation }) {
  const [detailsOpen, setDetailsOpen] = useState(() => typeof window === 'undefined' || !window.matchMedia('(max-width:1024px)').matches);
  return <section className="studio-inspector" aria-label="Result inspector"><div className="studio-inspector-nav"><button className="ct-btn ct-btn-ghost" onClick={onBack}>Back to results</button>{navigation && <><span className="ct-meta">{navigation.index} of {navigation.total}</span><button className="ct-btn ct-btn-ghost" aria-label="Previous result" disabled={!navigation.previous} onClick={navigation.previous}>‹</button><button className="ct-btn ct-btn-ghost" aria-label="Next result" disabled={!navigation.next} onClick={navigation.next}>›</button></>}</div><div className="studio-inspector-body"><div className="studio-preview">{preview}</div><div className="studio-inspector-rail"><button type="button" className="ct-btn studio-details-toggle" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}>Details</button>{detailsOpen && <div className="studio-inspector-details">{children}</div>}</div></div></section>;
}
