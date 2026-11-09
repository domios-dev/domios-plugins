import type { BlueprintStepRequest, BlueprintJobUpdate } from '@codeterm/plugin-sdk';
import { ElevenLabsService } from './client';
import { revision, validateRequest } from './catalog';
import type { Request } from '../../media-shared/src/contracts';

/** This is the scalar subset actually expressible by the currently available NodeSchema. */
export function speechRequest(params:Record<string,unknown>): Request {
  if (Object.keys(params).some(k=>!['voice','text','model'].includes(k)) ||
      typeof params.voice !== 'string' || typeof params.text !== 'string' || params.text.length>5000 ||
      !['eleven_v3','eleven_multilingual_v2','eleven_flash_v2','eleven_flash_v2_5'].includes(params.model as string)) throw new Error('invalid_parameters');
  const request:Request={operation:'text_to_speech_full',revision,unit:'usd_micro',inputs:[],
    params:{path:{voice_id:params.voice},body:{text:params.text,model_id:params.model as string}}};
  if (!validateRequest(request)) throw new Error('invalid_parameters');
  return request;
}
export interface RunPorts {
  /** Authenticate current host-stamped run context; never trust params.owner/run/budget/approval. */
  caller(request:BlueprintStepRequest): unknown;
  /** Stable persisted operation identity from host context, never a new ID on resume. */
  intent(request:BlueprintStepRequest): string;
}
export function createBlueprint(service:ElevenLabsService,ports:RunPorts) {
  function bound(request:BlueprintStepRequest) {
    if (request.nodeType!=='elevenlabs.tts' || request.revision!==1 || Object.keys(request.inputs).length) throw new Error('step_unavailable');
    const caller=ports.caller(request), id=ports.intent(request), vendor=speechRequest(request.params);
    const existing=service.history(caller).find(j=>j.id===id);
    if (!existing) service.intent(caller,id,vendor);
    else if (JSON.stringify(existing.request)!==JSON.stringify(vendor)) throw new Error('intent_conflict');
    return {caller,id};
  }
  return {
    blueprintEstimate(request:BlueprintStepRequest) {
      const {caller,id}=bound(request), job=service.estimate(caller,id);
      return job.quote ? {amount:job.quote.amount,unit:job.quote.unit,validUntilMs:job.quote.validUntilMs} : null;
    },
    blueprintSubmit(request:BlueprintStepRequest): BlueprintJobUpdate {
      bound(request);
      // SDK declarations alone provide neither authoritative waiting/resume nor durable callbacks.
      // Refuse BEFORE service.enter; no internal runner, approval override or duplicate paid path.
      throw new Error('host_execution_contract_unavailable');
    },
    blueprintReconcile(request:BlueprintStepRequest): BlueprintJobUpdate { bound(request); throw new Error('reconcile_unavailable'); },
    blueprintCancel(request:BlueprintStepRequest): BlueprintJobUpdate { bound(request); throw new Error('cancel_unavailable'); },
  };
}
