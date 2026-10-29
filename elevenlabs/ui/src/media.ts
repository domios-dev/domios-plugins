/** Only an injected reviewed host adapter may supply a playable frame URL or gesture handler.
 * No guessed ct.media/host-action consumption before HIG-11 delivery proof. */
import type {HumanAction} from '../../../media-shared/src/presentation';
export type LocalAudio = { url:string|null; label:string; declared?:string[]; availability?:Record<HumanAction,boolean>; save?:()=>void; reveal?:()=>void };
export interface MediaPort { acquire(id:string):Promise<LocalAudio|null> }
export const unavailableMedia:MediaPort={async acquire(){return null;}};
export type Voice = {id:string;name:string;description?:string;language?:string;sampleId?:string};
export type VoiceList = {kind:'available';voices:Voice[];synthetic?:boolean}|{kind:'unavailable';message:string};
/** Existing read/service transport may be injected later; no account requests in the document. */
export interface VoicePort {list():Promise<VoiceList>}
export const unavailableVoices:VoicePort={async list(){return {kind:'unavailable',message:'Voices unavailable in this view'};}};
/** Shared by samples, feed and inspector. Playback state comes exclusively from media events. */
export class PlaybackGroup {
  private active?:HTMLMediaElement;
  play(element:HTMLMediaElement){if(this.active!==element)this.active?.pause();this.active=element;}
  release(element:HTMLMediaElement){if(this.active===element){element.pause();this.active=undefined;}}
}
export function seekAudio(element:Pick<HTMLMediaElement,'currentTime'|'duration'>,delta:number){
  if(Number.isFinite(element.duration)&&element.duration>=0)element.currentTime=Math.max(0,Math.min(element.duration,element.currentTime+delta));
}
