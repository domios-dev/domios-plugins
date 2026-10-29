import type { Json } from '../../../media-shared/src/contracts';
import type { UIDetails, UISnapshot, UISchema, UIUnavailable } from '../../src/ui';
import type { InputSchema } from '../../../media-shared/ui/src/types';
export type Methods = {
  'ui.snapshot': { args: { offset?: number; limit?: number }; result: UISnapshot | UIUnavailable };
  'ui.details': { args: { id: string }; result: UIDetails | UIUnavailable };
  'ui.schema': { args: { operation: string }; result: UISchema | UIUnavailable };
  prepare: { args: { operation: string; params: Record<string, Json> }; result: { id: string } };
  estimate: { args: { id: string }; result: { id: string } };
  submit: { args: { id: string }; result: { id: string } };
  reconcile: { args: { id: string }; result: { id: string } };
  cancel: { args: { id: string }; result: { id: string } };
};
export interface UITransport {
  call<K extends keyof Methods>(method: K, args: Methods[K]['args']): Promise<Methods[K]['result']>;
  subscribe(listener: () => void): () => void;
}
/** Real bridge seam. No fixture fallback, inferred authority, or polling. */
export type DocumentBridge = { invoke(method: string, args: unknown): Promise<unknown>;
  onSurfaceStateChanged?(listener: () => void): () => void };
export function bridgeTransport(bridge?: DocumentBridge): UITransport {
  return { async call(method, args) {
    if (!bridge) throw new Error('Studio bridge unavailable.');
    const result = await bridge.invoke(method, args);
    if (!result || typeof result !== 'object' || 'error' in result) throw new Error('This action is unavailable in this view.');
    return result as any;
  }, subscribe(listener) { return bridge?.onSurfaceStateChanged?.(listener) ?? (() => {}); } };
}
