import type { Json } from '../../../media-shared/src/contracts';
import type { UIDetails, UISnapshot } from '../../src/ui';
import type { InputSchema, EstimateView, StudioItem } from '../../../media-shared/ui/src/types';
import { validateParams } from '../../src/catalog';
import { matches } from '../../src/schema';
import type { UITransport } from './transport';
export type UIState = { snapshot?: UISnapshot; details?: UIDetails; schema?: InputSchema; operation: string;
  values: Record<string, Json>; purpose: string; id?: string; estimating: boolean; busy: boolean; error?: string;
  unavailable?: string | null; stale?: boolean; priceAttempted?: boolean; formRevision?: number; filter: 'everyone' | 'you' | 'agent' | 'run' };
export function defaults(schema: InputSchema): Record<string, Json> {
  return Object.fromEntries(Object.entries(schema.properties ?? {}).filter(([, s]) => s.default !== undefined && matches(s, s.default, schema, 0, false)).map(([k, s]) => [k, s.default!]));
}
/** UI state only. Durable identity, costs, authority and lifecycle belong to the same backend service. */
export class StudioController {
  state: UIState = { operation: '', values: {}, purpose: '', estimating: false, busy: false, filter: 'everyone' };
  private listeners = new Set<() => void>();
  private editing = 0;
  private generating = false;
  private prepared = new Set<string>();
  private unsubscribe?: () => void;
  private priceDeadlines = new Map<string, number>();
  private viewRevision = 0;
  private refreshRequest = 0;
  private detailRequest = 0;
  private selectionRequest = 0;
  private visibilityPending = false;
  constructor(readonly transport: UITransport) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private patch(value: Partial<UIState>) { this.state = { ...this.state, ...value }; this.listeners.forEach(fn => fn()); }
  async mount() {
    this.unsubscribe = this.transport.subscribe(() => { void this.refresh(); });
    await this.refresh();
    if (!this.state.operation && this.state.snapshot?.catalog.length) await this.selectModel(this.state.snapshot.catalog.find(m => m.id === 'higgsfield-ai/soul/v2/standard')?.id ?? this.state.snapshot.catalog.find(m => !m.unavailable)?.id ?? this.state.snapshot.catalog[0].id);
  }
  dispose() { this.unsubscribe?.(); ++this.viewRevision; ++this.detailRequest; ++this.selectionRequest; }
  /** Atomic UI reset for a known context replacement; never constructs backend authority. */
  resetContext() {
    ++this.viewRevision; ++this.refreshRequest; ++this.detailRequest; ++this.selectionRequest; ++this.editing;
    this.visibilityPending = true; this.priceDeadlines.clear();
    this.patch({ snapshot: undefined, details: undefined, schema: undefined, values: {}, purpose: '', id: undefined,
      operation: '', error: undefined, unavailable: null, stale: false, priceAttempted: false, estimating: false,
      formRevision: (this.state.formRevision ?? 0) + 1 });
  }
  async refresh(offset = 0) {
    const view = this.viewRevision, request = ++this.refreshRequest;
    ++this.detailRequest; ++this.selectionRequest;
    this.visibilityPending = true;
    const previous = this.state.snapshot;
    this.patch({ details: undefined, snapshot: undefined });
    try {
      const snapshot = await this.transport.call('ui.snapshot', { offset, limit: 50 });
      if (view !== this.viewRevision || request !== this.refreshRequest) return;
      if ('kind' in snapshot) throw new Error(snapshot.message);
      for (const item of snapshot.items) this.priceDeadlines.set(item.id, Date.now() + (item.priceTTL ?? 0));
      this.visibilityPending = false;
      this.patch({ snapshot: offset && previous ? { ...snapshot, items: [...previous.items, ...snapshot.items] } : snapshot, details: undefined });
    } catch {
      if (view === this.viewRevision && request === this.refreshRequest) this.patch({ snapshot: undefined, details: undefined, id: undefined, values: {}, error: 'Studio bridge unavailable. Reopen this studio after its service is connected.' });
    } finally { if (view === this.viewRevision && request === this.refreshRequest) this.visibilityPending = false; }
  }
  async selectModel(operation: string) {
    const version = ++this.selectionRequest, view = this.viewRevision;
    ++this.editing; ++this.detailRequest;
    this.patch({ operation, values: {}, schema: undefined, id: undefined, details: undefined, error: undefined, unavailable: null, stale: false, priceAttempted: false, formRevision: (this.state.formRevision ?? 0) + 1 });
    try { const result = await this.transport.call('ui.schema', { operation }); if (version !== this.selectionRequest || view !== this.viewRevision) return;
      if ('kind' in result) { this.patch({ unavailable: result.message }); return; }
      this.patch({ schema: result.schema, values: defaults(result.schema), unavailable: result.unavailable });
    } catch { if (version === this.selectionRequest && view === this.viewRevision) this.patch({ unavailable: 'The provider has no supported input schema for this model.' }); }
  }
  edit(key: string, value: Json | undefined) {
    ++this.editing; const values = { ...this.state.values };
    if (value === undefined) delete values[key]; else values[key] = value;
    this.patch({ values, stale: !!this.state.id || this.state.stale, id: undefined, error: undefined });
  }
  purpose(value: string) { this.patch({ purpose: value.slice(0, 500) }); }
  filter(value: UIState['filter']) { ++this.detailRequest; this.patch({ filter: value, details: undefined }); }
  private inputIssue(): { helper: string; action: string } | undefined {
    const missing = this.state.schema?.required?.find(key => this.state.values[key] === undefined ||
      typeof this.state.values[key] === 'string' && !String(this.state.values[key]).trim());
    if (missing) {
      const name = this.state.schema?.properties?.[missing]?.title ?? missing.replace(/_/g, ' ');
      const action = missing === 'prompt' ? 'Add a prompt' : `Add ${name.toLowerCase()}`;
      return { action, helper: `${action} to get a price` };
    }
    try { if (validateParams(this.state.operation, this.state.values)) return; } catch { /* schema not selected */ }
    return { action: 'Check inputs', helper: 'Check the model inputs to get a price' };
  }
  priceFor(item: StudioItem) {
    return item.price.kind === 'ready' && Date.now() >= (this.priceDeadlines.get(item.id) ?? 0) ? { kind: 'stale' as const } : item.price;
  }
  price(): EstimateView {
    const item = this.state.snapshot?.items.find(i => i.id === this.state.id);
    const gate = item ? this.priceFor(item) : undefined;
    const count = typeof this.state.values.batch_size === 'number' ? this.state.values.batch_size : 1;
    const issue = this.inputIssue();
    return { gate: gate ?? { kind: this.state.stale ? 'stale' : 'unavailable' }, count, available: this.state.snapshot?.capabilities.estimate ?? false,
      capable: !!this.state.snapshot?.capabilities.submit && !this.visibilityPending, busy: this.state.busy, estimating: this.state.estimating,
      refreshLabel: gate?.kind === 'stale' || this.state.stale || this.state.priceAttempted ? 'Check again' : 'Get price',
      invalid: issue?.helper ?? this.state.unavailable ?? (this.state.id && this.prepared.has(this.state.id) ? 'This generation is already in Results.' : undefined),
      invalidAction: issue?.action };
  }
  async estimate() {
    if (this.state.busy || this.state.estimating || this.state.unavailable) return;
    const version = this.editing, scope = this.viewRevision, operation = this.state.operation, params = this.state.values;
    try {
      const issue = this.inputIssue(); if (issue) { this.patch({ error: issue.helper }); return; }
      this.patch({ estimating: true, priceAttempted: true, error: undefined });
      const prepared = await this.transport.call('prepare', { operation, params });
      if (version !== this.editing || scope !== this.viewRevision) return;
      this.patch({ id: prepared.id, stale: false });
      await this.transport.call('estimate', { id: prepared.id });
      if (scope !== this.viewRevision) return;
      await this.refresh();
    } catch { if (scope === this.viewRevision) this.patch({ error: 'A safe price is unavailable. Check again without generating.' }); }
    finally { if (scope === this.viewRevision) this.patch({ estimating: false }); }
  }
  async generate() {
    const view = this.price(), id = this.state.id;
    if (this.generating || !id || this.prepared.has(id) || view.gate.kind !== 'ready' || view.busy || view.invalid || !view.capable) return;
    this.generating = true; this.prepared.add(id); this.patch({ busy: true, error: undefined });
    const scope = this.viewRevision;
    try { await this.transport.call('submit', { id }); }
    catch { if (scope === this.viewRevision) this.patch({ error: 'Submission status is uncertain. Check the existing generation before doing anything else.' }); }
    finally { this.generating = false; this.patch({ busy: false }); if (scope === this.viewRevision) await this.refresh(); }
  }
  async inspect(id: string) {
    if (this.visibilityPending) return;
    const request = ++this.detailRequest, view = this.viewRevision;
    ++this.selectionRequest;
    this.patch({ details: undefined });
    try {
      const details = await this.transport.call('ui.details', { id });
      if (view !== this.viewRevision || request !== this.detailRequest) return;
      if ('kind' in details) { this.patch({ error: details.message }); return; }
      this.patch({ details, error: undefined });
    } catch { if (view === this.viewRevision && request === this.detailRequest) this.patch({ error: 'This result is unavailable in this view.' }); }
  }
  back() { ++this.detailRequest; ++this.selectionRequest; this.patch({ details: undefined }); }
  async reuse(variation = false) {
    const d = this.state.details; if (!d) return;
    const values = { ...d.params };
    if (variation) {
      if (!d.schema.required?.includes('seed')) delete values.seed;
      const count = d.schema.properties?.batch_size;
      if (count && (count.maximum === undefined || count.maximum >= 4)) values.batch_size = 4;
      if (!validateParams(d.item.operation, values)) { this.patch({ error: 'These variation settings are not valid for this model.' }); return; }
    }
    ++this.editing; ++this.detailRequest; ++this.selectionRequest;
    this.patch({ operation: d.item.operation, schema: d.schema, values, id: undefined, details: undefined, unavailable: null, error: undefined, formRevision: (this.state.formRevision ?? 0) + 1 });
  }
  async action(method: 'cancel' | 'reconcile', id: string) {
    try { await this.transport.call(method, { id }); await this.refresh(); }
    catch { this.patch({ error: 'This action is unavailable. The existing generation is retained.' }); }
  }
}
