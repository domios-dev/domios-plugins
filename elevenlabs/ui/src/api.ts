import type { UIArgs, UIResults, UIUnavailable } from '../../src/view-model';
import type { Json, Request, Unit } from '../../../media-shared/src/contracts';
export type { UISnapshot, UIDetails, UISchema, UIUnavailable, AudioItem, UIReference } from '../../src/view-model';
export type Methods = { [K in keyof UIArgs]:{args:UIArgs[K];result:UIResults[K]} } & {
  prepare:{args:{operation:string;params:Record<string,Json>;inputs?:Request['inputs'];unit:Unit};result:{id:string}};
  estimate:{args:{id:string};result:{id:string}};
  generate:{args:{id:string};result:{id:string}};
  reconcile:{args:{id:string};result:{id:string}};
};
export interface UITransport {
  call<K extends keyof Methods>(method:K,args:Methods[K]['args']):Promise<Methods[K]['result']>;
  subscribe(listener:()=>void):()=>void;
}
/** Exact injected document bridge; default binding/SDK delivery remains HIG-11. */
export type DocumentBridge = {invoke(method:string,args:unknown):Promise<unknown>;onSurfaceStateChanged?(listener:()=>void):()=>void};
export function bridgeTransport(bridge?:DocumentBridge):UITransport {
  return {async call(method,args) {
    if(!bridge) throw new Error('Studio bridge unavailable.');
    const response=await bridge.invoke(method,args);
    if(!response || typeof response!=='object'||'error' in response) throw new Error('This action is unavailable in this view.');
    return response as Methods[typeof method]['result'];
  },subscribe(listener){return bridge?.onSurfaceStateChanged?.(listener)??(()=>{});}};
}
export const isUnavailable = (v:{kind?:string}):v is UIUnavailable => v.kind==='unavailable';
