import type { Json } from '../../../media-shared/src/contracts';
import type { UIDetails, UISnapshot } from '../../src/ui';
import type { InputSchema, EstimateView } from '../../../media-shared/ui/src/types';
import { validateParams } from '../../src/catalog';
import type { UITransport } from './transport';
export type UIState = { snapshot?: UISnapshot; details?: UIDetails; schema?: InputSchema; operation: string;
  values: Record<string, Json>; purpose: string; id?: string; estimating: boolean; busy: boolean; error?: string;
  unavailable?: string | null; stale?: boolean; filter: 'everyone' | 'you' | 'agent' | 'run' };
export function defaults(schema: InputSchema): Record<string, Json> {
  return Object.fromEntries(Object.entries(schema.properties ?? {}).filter(([, s]) => s.default !== undefined).map(([k, s]) => [k, s.default!]));
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
  constructor(readonly transport: UITransport) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private patch(value: Partial<UIState>) { this.state = { ...this.state, ...value }; this.listeners.forEach(fn => fn()); }
  async mount() {
    this.unsubscribe = this.transport.subscribe(() => { void this.refresh(); });
    await this.refresh();
    if (!this.state.operation && this.state.snapshot?.catalog.length) await this.selectModel(this.state.snapshot.catalog.find(m => m.id === 'higgsfield-ai/soul/v2/standard')?.id ?? this.state.snapshot.catalog.find(m => !m.unavailable)?.id ?? this.state.snapshot.catalog[0].id);
  }
  dispose() { this.unsubscribe?.(); }
  async refresh(offset = 0) {
    try {
      const snapshot = await this.transport.call('ui.snapshot', { offset, limit: 48 });
      for (const item of snapshot.items) this.priceDeadlines.set(item.id, Date.now() + (item.priceTTL ?? 0));
      this.patch({ snapshot: offset && this.state.snapshot ? { ...snapshot, items: [...this.state.snapshot.items, ...snapshot.items] } : snapshot,
        details: this.state.details && snapshot.items.some(i => i.id === this.state.details!.item.id) ? this.state.details : undefined });
    } catch { this.patch({ snapshot: undefined, details: undefined, id: undefined, values: {}, error: 'Studio bridge unavailable. Reopen this studio after its service is connected.' }); }
  }
  async selectModel(operation: string) {
    const version = ++this.editing;
    this.patch({ operation, values: {}, schema: undefined, id: undefined, details: undefined, error: undefined, unavailable: null, stale: false });
    try { const result = await this.transport.call('ui.schema', { operation }); if (version !== this.editing) return;
      this.patch({ schema: result.schema, values: defaults(result.schema), unavailable: result.unavailable });
    } catch { if (version === this.editing) this.patch({ unavailable: 'The provider has no supported input schema for this model.' }); }
  }
  edit(key: string, value: Json | undefined) {
    ++this.editing; const values = { ...this.state.values };
    if (value === undefined) delete values[key]; else values[key] = value;
    this.patch({ values, stale: !!this.state.id || this.state.stale, id: undefined, error: undefined });
  }
  purpose(value: string) { this.patch({ purpose: value.slice(0, 500) }); }
  filter(value: UIState['filter']) { this.patch({ filter: value }); }
  price(): EstimateView {
    const item = this.state.snapshot?.items.find(i => i.id === this.state.id);
    const gate = item?.price.kind === 'ready' && Date.now() >= (this.priceDeadlines.get(item.id) ?? 0)
      ? { kind: 'stale' as const } : item?.price;
    const count = typeof this.state.values.batch_size === 'number' ? this.state.values.batch_size : 1;
    let valid = false;
    try { valid = validateParams(this.state.operation, this.state.values); } catch { /* unsupported catalog */ }
    return { gate: gate ?? { kind: this.state.stale ? 'stale' : 'unavailable' }, count, available: this.state.snapshot?.capabilities.estimate ?? false,
      capable: !!this.state.snapshot?.capabilities.submit, busy: this.state.busy, estimating: this.state.estimating,
      invalid: !valid ? 'Complete the required model inputs.' : this.state.unavailable ?? (this.state.id && this.prepared.has(this.state.id) ? 'This generation is already in Results.' : undefined) };
  }
  async estimate() {
    if (this.state.busy || this.state.estimating || this.state.unavailable) return;
    const version = this.editing, operation = this.state.operation, params = this.state.values;
    try {
      if (!validateParams(operation, params)) { this.patch({ error: 'Complete the required model inputs.' }); return; }
      this.patch({ estimating: true, error: undefined });
      const prepared = await this.transport.call('prepare', { operation, params });
      if (version !== this.editing) return;
      this.patch({ id: prepared.id, stale: false });
      await this.transport.call('estimate', { id: prepared.id });
      await this.refresh();
    } catch { this.patch({ error: 'A safe price is unavailable. Check again without generating.' }); }
    finally { this.patch({ estimating: false }); }
  }
  async generate() {
    const view = this.price(), id = this.state.id;
    if (this.generating || !id || this.prepared.has(id) || view.gate.kind !== 'ready' || view.busy || view.invalid || !view.capable) return;
    this.generating = true; this.prepared.add(id); this.patch({ busy: true, error: undefined });
    try { await this.transport.call('submit', { id }); }
    catch { this.patch({ error: 'Submission status is uncertain. Check the existing generation before doing anything else.' }); }
    finally { this.generating = false; this.patch({ busy: false }); await this.refresh(); }
  }
  async inspect(id: string) {
    try { this.patch({ details: await this.transport.call('ui.details', { id }), error: undefined }); }
    catch { this.patch({ error: 'This result is unavailable in this view.' }); }
  }
  back() { this.patch({ details: undefined }); }
  async reuse(variation = false) {
    const d = this.state.details; if (!d) return;
    const values = { ...d.params };
    if (variation) {
      if (!d.schema.required?.includes('seed')) delete values.seed;
      const count = d.schema.properties?.batch_size;
      if (count && (count.maximum === undefined || count.maximum >= 4)) values.batch_size = 4;
      if (!validateParams(d.item.operation, values)) { this.patch({ error: 'These variation settings are not valid for this model.' }); return; }
    }
    ++this.editing;
    this.patch({ operation: d.item.operation, schema: d.schema, values, id: undefined, details: undefined, unavailable: null, error: undefined });
  }
  async action(method: 'cancel' | 'reconcile', id: string) {
    try { await this.transport.call(method, { id }); await this.refresh(); }
    catch { this.patch({ error: 'This action is unavailable. The existing generation is retained.' }); }
  }
}
