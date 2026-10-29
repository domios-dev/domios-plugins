/** Existing selectable transcriber exports. Runtime wiring is refused until reviewed host ports are delivered.
 * HIG-11 owns manifest/min-host/bundle integration; no guessed SDK/binary/approval API is consumed here.
 */
export { createScribe } from './scribe';
export { ElevenLabsService } from './client';
const plugin = {
  transcribeStatus() { return {state:'unavailable',reason:'Secure Scribe transport and approval binding are not configured.'}; },
  transcribe(_path: string, _lang?: string) { return {error:'Secure Scribe transport and approval binding are not configured.'}; },
};
export default plugin;
