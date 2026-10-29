/** Bounded validator for the keywords in the dated Higgsfield schemas. No coercion/default insertion. */
export type Schema = { [key: string]: any };
const own = (v: object, k: string) => Object.prototype.hasOwnProperty.call(v, k);
export function matches(schema: Schema, value: unknown, root = schema, depth = 0, closed = true): boolean {
  if (depth > 32 || !schema || typeof schema !== 'object') return false;
  const test = (s: Schema, v = value) => matches(s, v, root, depth + 1, false);
  if (schema.$ref) {
    if (!/^#\/\$defs\/[A-Za-z0-9_]+$/.test(schema.$ref)) return false;
    return test(root.$defs?.[schema.$ref.slice(8)]);
  }
  if (schema.enum && !schema.enum.some((v: unknown) => JSON.stringify(v) === JSON.stringify(value))) return false;
  if (own(schema, 'const') && JSON.stringify(schema.const) !== JSON.stringify(value)) return false;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (types.length && !types.some((t: string) => t === type || t === 'integer' && typeof value === 'number' && Number.isSafeInteger(value))) return false;
  if (schema.allOf && !schema.allOf.every((s: Schema) => test(s))) return false;
  if (schema.anyOf && !schema.anyOf.some((s: Schema) => test(s))) return false;
  if (schema.if && !test(test(schema.if) ? schema.then ?? {} : schema.else ?? {})) return false;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum) return false;
    if (schema.multipleOf !== undefined && Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > 1e-8) return false;
  }
  if (typeof value === 'string') {
    if (value.length > 65536 || schema.minLength !== undefined && [...value].length < schema.minLength || schema.maxLength !== undefined && [...value].length > schema.maxLength) return false;
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return false;
    if (schema.format === 'uuid' && !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)) return false;
    if (schema.format === 'uri' && !publicHttps(value)) return false;
  }
  if (Array.isArray(value)) {
    if (value.length > 256 || schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    if (schema.items && !value.every(v => test(schema.items, v))) return false;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>, props = schema.properties ?? {};
    if (Object.keys(obj).length > 256 || schema.maxProperties !== undefined && Object.keys(obj).length > schema.maxProperties) return false;
    if (schema.required?.some((k: string) => !own(obj, k))) return false;
    for (const [k, v] of Object.entries(obj)) {
      if (['__proto__', 'constructor', 'prototype'].includes(k)) return false;
      if (own(props, k)) { if (!test(props[k], v)) return false; }
      else if (closed || schema.additionalProperties === false || schema.type === 'object' && schema.properties && typeof schema.additionalProperties !== 'object') return false;
      else if (typeof schema.additionalProperties === 'object' && !test(schema.additionalProperties, v)) return false;
    }
  }
  return true;
}
/** Conservative consumer policy; DNS/redirect/actual media checks remain a trusted transport duty. */
export function publicHttps(value: string): boolean {
  if (typeof value !== 'string' || value.length > 8192 || /[^\x21-\x7e]|[\\#]/.test(value) || /%(?![a-f\d]{2})/i.test(value)) return false;
  const match = /^https:\/\/([a-z\d.-]+)(?::443)?(?:[/?].*)?$/i.exec(value);
  if (!match) return false;
  const labels = match[1].toLowerCase().split('.');
  return labels.length >= 2 && labels.every(label => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label)) &&
    /^[a-z][a-z\d-]*$/.test(labels[labels.length - 1]) &&
    !['localhost', 'local', 'internal', 'test', 'invalid'].includes(labels[labels.length - 1]);
}
