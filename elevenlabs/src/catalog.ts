import inventory from '../capabilities.json';
import models from '../models.json';
import openapi from '../evidence/openapi.json';
import asyncapi from '../evidence/asyncapi.json';
import { pointer, validateSchema } from './schema';
import type { Request } from '../../media-shared/src/contracts';

export const revision = 'elevenlabs-public-2026-10-29-v1';
export const operations = inventory.operations;
export type Operation = typeof operations[number];
export type Parameters = { path?: Record<string, any>; query?: Record<string, any>; body?: any };
export const synchronousEffects = new Set(['text_to_speech_full','text_to_speech_full_with_timestamps',
  'text_to_speech_stream','text_to_speech_stream_with_timestamps','text_to_dialogue',
  'text_to_dialogue_full_with_timestamps','text_to_dialogue_stream','text_to_dialogue_stream_with_timestamps',
  'speech_to_text','speech_to_speech_full','speech_to_speech_stream','sound_generation','audio_isolation',
  'audio_isolation_stream','generate','stream_compose','compose_detailed','compose_detailed_stream','forced_alignment']);
export function operation(id: string): Operation {
  const row = operations.find(row => row.id === id);
  if (!row) throw new Error('operation_unavailable');
  return row;
}
export function schemaFor(row: Operation): any {
  if (row.schema.format !== 'openapi') return null;
  return pointer(openapi, '#' + row.schema.pointer);
}
export function validateResponse(row: Operation, status: number, mime: string, value: unknown): boolean {
  try {
    const schema = schemaFor(row)?.responses[String(status)]?.content?.[mime]?.schema;
    return !!schema && validateSchema(openapi, schema, value);
  } catch { return false; }
}
export function disposition(row: Operation) {
  const source = row.sources[0];
  let limitation: string | null = null;
  if (row.transport.kind.startsWith('websocket')) limitation = 'Session/listener transport and JWT/commit lifecycle are not delivered; see PLATFORM-GAPS.md.';
  else if (row.transport.kind === 'http-stream' && !row.transport.response_types?.some(mime => mime.startsWith('audio/')))
    limitation = 'Structured event/timestamp stream needs its exact bounded decoder; raw byte completion cannot establish that protocol. See the saved operation schema/source.';
  else if (row.transport.response_types?.includes('multipart/mixed'))
    limitation = 'Multipart response metadata/audio needs the exact bounded multipart decoder; see this operation response schema.';
  else if (row.family === 'voices' && row.method !== 'GET' && !['speech_to_speech_full','speech_to_speech_stream'].includes(row.id))
    limitation = 'All existing voices/settings are immutable; design, creation and cloning need separate owner approval (contracts.json#/safety).';
  else if (row.method !== 'GET' && !synchronousEffects.has(row.id)) limitation = 'No owner authorization for this mutation or reviewed exact lifecycle adapter; schema remains inspectable. See contracts.json#/safety and this operation source.';
  return { id: row.id, family: row.family, source, schema: row.schema, limitation,
    parameterPolicy: { source: row.schema.source_id, pointer: row.schema.pointer,
      limitation:'Only the bounded closed schema subset executes: no Any/open maps, unsupported formats, URLs/credentials, custom headers, structured query serialization or undocumented multipart JSON encoding. Rejected parameter variants remain unavailable; defaults are never inserted.' },
    responsePolicy: {source:row.schema.source_id, limitation:'Only source-declared JSON or finite audio/video/image MIME responses are consumed. Wildcard music audio requires an explicit documented mp3 output_format; other wildcard, multipart, empty and unsupported MIME variants remain unavailable.'},
    prerequisites: ['trusted-owner-input-context','account-entitlement','confined-transport',
      ...(row.method === 'GET' ? [] : ['safe-fresh-account-price','independent-owner-approval'])] };
}
function safeValues(value: unknown, depth = 0): boolean {
  if (depth > 40) return false;
  if (typeof value === 'string') return !/[\u0000-\u001f]/.test(value) &&
    !/https?:\/\/|file:|data:|bearer\s|xi-api-key/i.test(value);
  if (Array.isArray(value)) return value.length <= 1000 && value.every(v => safeValues(v, depth + 1));
  if (value && typeof value === 'object') return Object.entries(value).every(([k,v]) =>
    !/secret|api.?key|authorization|token|password|source_url|cloud_storage_url|webhook|callback|redirect/i.test(k) && safeValues(v, depth + 1));
  return value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value);
}
export function validateParameters(row: Operation, params: Parameters, inputCount = 0): boolean {
  try {
    if (!params || typeof params !== 'object' || Array.isArray(params) ||
      Object.keys(params).some(k => !['path','query','body'].includes(k)) || JSON.stringify(params).length > 131072 || !safeValues(params)) return false;
    const schema = schemaFor(row);
    if (!schema) return false;
    for (const location of ['path','query']) {
      const values = (params as any)[location] ?? {};
      if (!values || typeof values !== 'object' || Array.isArray(values)) return false;
      const declarations = (schema.parameters ?? []).map((p: any) => p.$ref ? pointer(openapi, p.$ref) : p)
        .filter((p: any) => p.in === location);
      if (Object.keys(values).some(k => !declarations.some((p: any) => p.name === k))) return false;
      for (const p of declarations) {
        if (!(p.name in values)) { if (p.required) return false; }
        else if (!validateSchema(openapi, p.schema, values[p.name])) return false;
      }
      if (location === 'path' && Object.values(values).some(v => typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(v))) return false;
    }
    const content = schema.requestBody?.content ?? {};
    const bodySchema = content['application/json']?.schema ?? content['multipart/form-data']?.schema ?? content['application/x-www-form-urlencoded']?.schema;
    if (params.body === undefined) { if (schema.requestBody?.required) return false; }
    else if (!bodySchema || !validateSchema(openapi, bodySchema, params.body)) return false;
    const markers = (v: any): boolean => !v || typeof v !== 'object' ||
      ('input' in v ? Object.keys(v).length === 1 && Number.isSafeInteger(v.input) && v.input >= 0 && v.input < inputCount : Object.values(v).every(markers));
    if (!markers(params.body)) return false;
    // The batch capability cannot silently turn into an asynchronous webhook request.
    if (row.id === 'speech_to_text') {
      const b = params.body;
      if (!b?.file || !['scribe_v2','scribe_v2_medical'].includes(b.model_id) || b.use_multi_channel || b.use_speaker_library) return false;
      if (b.transcript_edit && (b.transcript_edit.length > 2000 || b.entity_detection || b.entity_redaction)) return false;
      if (b.diarization_threshold != null && (!b.diarize || b.num_speakers != null)) return false;
      if (b.detect_speaker_roles && !b.diarize) return false;
      if (b.no_verbatim && b.model_id !== 'scribe_v2') return false;
      if (b.keyterms && (b.keyterms.length > 1000 || b.keyterms.some((s: string) => s.length >= 50 || s.trim().split(/\s+/).length > 5 || /[<>{}\[\]\\]/.test(s)))) return false;
    }
    if (row.id.startsWith('text_to_speech')) {
      const b = params.body, model = b?.model_id ?? 'eleven_multilingual_v2';
      const limits: Record<string, number> = { eleven_v3:5000, eleven_multilingual_v2:10000, eleven_flash_v2:30000, eleven_flash_v2_5:40000 };
      // v4 is documented through dialogue; dynamic IDs need account model validation, not a guessed mapping.
      if (!(model in limits) || !b?.text?.length || [...b.text].length > limits[model]) return false;
      if (b.seed != null && (b.seed < 0 || b.seed > 4294967295)) return false;
      for (const k of ['previous_request_ids','next_request_ids','pronunciation_dictionary_locators']) if (b[k]?.length > 3) return false;
    }
    if (row.id.startsWith('text_to_dialogue')) {
      const b = params.body;
      if (!b?.inputs?.length || b.inputs.reduce((n: number,v: any) => n + [...v.text].length, 0) > 2000) return false;
      // Restrictive documented bound while v4 speaker-count sources conflict.
      if (new Set(b.inputs.map((v: any) => v.voice_id)).size > 1) return false;
    }
    if (['generate','stream_compose','compose_detailed','compose_detailed_stream'].includes(row.id)) {
      const b = params.body;
      if (!b || !!b.prompt === !!b.composition_plan || b.music_prompt || b.prompt && b.seed != null ||
        !b.prompt && (b.music_length_ms != null || b.force_instrumental || b.generation_mode)) return false;
    }
    if (row.id === 'sound_generation') {
      const b = params.body;
      if (!b?.text?.length || b.duration_seconds != null && (b.duration_seconds < 0.5 || b.duration_seconds > 30) ||
        b.prompt_influence != null && (b.prompt_influence < 0 || b.prompt_influence > 1)) return false;
    }
    if (['speech_to_speech_full','speech_to_speech_stream'].includes(row.id)) {
      const b = params.body;
      // Persisted settings never change; JSON-string overrides need their own nested validation, not raw passthrough.
      if (b.voice_settings != null || b.seed != null && (b.seed < 0 || b.seed > 4294967295)) return false;
    }
    return true;
  } catch { return false; }
}
export function validateRequest(request: Request): boolean {
  try { return request.revision === revision && !!request.inputs && validateParameters(operation(request.operation), request.params as Parameters, request.inputs.length); }
  catch { return false; }
}
export function catalog() { return operations.map(disposition); }
export function modelCatalog() {
  return { models: models.models, display: models.catalog_display_models, unresolved: models.unresolved_catalogs };
}
/** A selector is valid only at its saved schema pointer; this never grants endpoint/model entitlement. */
export function modelSelection(id: string, value: unknown) {
  const model = models.models.find(m => m.id === id);
  if (!model) throw new Error('model_unavailable');
  const bindings = model.schema_bindings ?? [];
  if (!bindings.length) return { valid:false, limitation:'Overview-only model: no closed selector schema. Account capability/endpoint mapping required.', sources:model.sources };
  const results = bindings.map(binding => {
    const root = binding.source_id === 'openapi.json' ? openapi : asyncapi.documents.find(d => d.source_id === binding.source_id)?.spec;
    return !!root && validateSchema(root, pointer(root, '#' + binding.pointer), value);
  });
  return {valid:results.some(Boolean), limitation:null, sources:model.sources};
}
