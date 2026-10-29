import React, { useState, useEffect, useRef } from 'react';
import type { Json } from '../../src/contracts';
import { groupHistory, studioPrice, jobStatus } from '../../src/presentation';
import type { EstimateView, InputSchema, StudioProps } from './types';

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
  return <div className="studio-price"><p className="ct-meta">{view.gate.kind === 'ready' ? view.gate.text : price.helper}</p>{view.invalid && <p role="status">{view.invalid}</p>}{view.insufficient && <p>Not enough balance (needs {view.insufficient.needs}, have {view.insufficient.have})</p>}
    <button type="button" className="ct-btn ct-btn-primary" disabled={price.disabled || !view.capable || view.busy || view.estimating || !!view.invalid || !!view.insufficient} onClick={onGenerate}>{view.estimating ? 'Estimating cost…' : view.busy ? jobStatus('starting').label : price.primary}</button>
    {view.available && <button type="button" className="ct-btn ct-btn-ghost" disabled={view.busy || view.estimating} onClick={onEstimate}>{price.refresh ?? 'Estimate'}</button>}
    {!view.capable && <p className="ct-meta">Generation is unavailable in this context.</p>}</div>;
}
export function Studio(p: StudioProps) {
  const [pane, setPane] = useState<'compose' | 'results'>('compose');
  const [search, setSearch] = useState('');
  const filtered = p.items.filter(i => (!p.filter || p.filter === 'everyone' || i.actor.kind === p.filter) && `${i.title} ${i.operation}`.toLowerCase().includes(search.toLowerCase()));
  const active = filtered.filter(i => !['generated', 'failed', 'canceled'].includes(i.state));
  const finished = filtered.filter(i => !active.includes(i));
  const navigate = (event: React.KeyboardEvent) => {
    if (event.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    if (event.key === 'Escape' && p.selected) { p.onBack(); event.preventDefault(); }
    if (p.selected && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { const index = filtered.findIndex(i => i.id === p.selected); const next = filtered[index + (event.key === 'ArrowLeft' ? -1 : 1)]; if (next) p.onSelect(next.id); event.preventDefault(); }
  };
  return <main className="studio" data-pane={pane} onKeyDown={navigate}><header className="ct-toolbar"><h1>{p.title}</h1><select aria-label="Show activity from" value={p.filter ?? 'everyone'} onChange={e => p.onFilter?.(e.target.value as NonNullable<StudioProps['filter']>)}><option value="everyone">Everyone</option><option value="you">You</option><option value="agent">Agents</option><option value="run">Pipelines</option></select>{p.toolbar}<input type="search" aria-label="Search prompts" placeholder="Search prompts" value={search} onChange={e => setSearch(e.target.value)} /></header>
    {p.activity.length > 0 && <details className="studio-activity"><summary>{p.activity[0]} · Show activity ({p.activity.length})</summary><ol>{p.activity.map((line, i) => <li key={i}>{line}</li>)}</ol></details>}
    <nav className="studio-mobile studio-segments" aria-label="Studio panes"><button className="ct-btn" aria-pressed={pane === 'compose'} onClick={() => setPane('compose')}>Compose</button><button className="ct-btn" aria-pressed={pane === 'results'} onClick={() => setPane('results')}>Results ({p.items.length})</button></nav>
    <div className="studio-panes"><aside className="studio-composer" aria-label="Composer"><div className="studio-composer-body">{p.composer}</div><footer>{p.footer}</footer></aside><section className="studio-results" aria-label="Results" tabIndex={-1}>
      {p.selected ? p.inspector : <>{active.length > 0 && <section><h2>In progress</h2><div className="studio-active">{active.map(i => <article key={i.id}>{p.renderItem(i)}</article>)}</div></section>}{groupHistory(finished, p.now).map(day => <section key={day.day}><h2>{day.day}</h2>{day.runs.map((run, n) => <div key={n} className={run.actor.kind === 'run' ? 'studio-run' : ''}>{run.actor.kind === 'run' && <p className="ct-meta">{run.actor.label}</p>}<div className="studio-feed">{run.items.map(i => <article key={i.id}>{p.renderItem(i)}</article>)}</div></div>)}</section>)}{filtered.length === 0 && p.empty}{p.next}<p className="ct-meta">Keeps up to {p.capacity} generations. Unsettled work is retained.</p></>}
    </section></div></main>;
}
export function Inspector({ onBack, preview, children }: { onBack(): void; preview: React.ReactNode; children: React.ReactNode }) {
  return <section className="studio-inspector" aria-label="Result inspector"><button className="ct-btn ct-btn-ghost" onClick={onBack}>Back to results</button><div className="studio-inspector-body"><div className="studio-preview">{preview}</div><div className="studio-inspector-details">{children}</div></div></section>;
}
