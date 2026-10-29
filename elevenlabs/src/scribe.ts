import type { Request } from '../../media-shared/src/contracts';
import { ElevenLabsService } from './client';

export type TranscribeResult = { text: string; language?: string } | { error: string; code: string };
/** Trusted composer binding, not a caller-provided file grant or new selection/configuration mechanism. */
export interface ScribePorts {
  available(): boolean;
  resolve(path: string, language?: string): { caller: unknown; intent: string; request: Request } | null;
  text(caller: unknown, artifact: string): { text: string; language_code?: string } | null;
}
export function createScribe(service: ElevenLabsService, ports: ScribePorts) {
  return {
    transcribeStatus() {
      return ports.available() ? { state:'ready' as const } :
        { state:'unavailable' as const, reason:'Scribe requires authorized input, safe price, owner approval and confined binary transport.' };
    },
    transcribe(path: string, language?: string): TranscribeResult {
      try {
        if (!ports.available()) return {error:'Scribe is unavailable.',code:'unavailable'};
        const binding = ports.resolve(path, language === 'auto' ? undefined : language);
        if (!binding || binding.request.operation !== 'speech_to_text') return {error:'Audio input is not authorized.',code:'denied'};
        const b = (binding.request.params as any).body;
        if (language && language !== 'auto' && b?.language_code !== language) return {error:'Language differs from the approved input.',code:'denied'};
        // Reuse exact persisted intent. Neither status nor transcribe mints quotes/approvals or selects this backend.
        service.intent(binding.caller, binding.intent, binding.request);
        const job = service.start(binding.caller, binding.intent);
        if (job.state !== 'generated') return {error:job.state === 'unknown' ? 'Transcription status is unknown. Do not retry payment.' : 'Transcription needs a fresh price and owner approval.',code:job.state};
        const output = ports.text(binding.caller, job.outputs[0].id);
        if (!output || typeof output.text !== 'string' || !output.text.trim() || output.text.length > 100000 ||
          output.language_code !== undefined && !/^[a-z]{2,3}$/.test(output.language_code)) return {error:'No valid transcript was returned.',code:'invalid'};
        return {text:output.text, ...(output.language_code ? {language:output.language_code} : {})};
      } catch { return {error:'Transcription could not be completed.',code:'unavailable'}; }
    },
  };
}
