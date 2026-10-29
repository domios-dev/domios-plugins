/** Bounded, conservative consumer of the saved vendor schemas. No coercion/default insertion. */
export type Schema = Record<string, any>;
export function pointer(root: any, ref: string): any {
  if (!ref.startsWith('#/')) throw new Error('external_schema');
  let value = root;
  for (const part of ref.slice(2).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!value || !Object.prototype.hasOwnProperty.call(value, key)) throw new Error('missing_schema');
    value = value[key];
  }
  return value;
}
const annotations = new Set(['title','description','default','examples','example','deprecated','discriminator',
  'readOnly','writeOnly','nullable','embed','x-fern-ignore']);
const rules = new Set(['$ref','type','enum','const','anyOf','oneOf','allOf','not','properties','required',
  'additionalProperties','items','minItems','maxItems','uniqueItems','minLength','maxLength','pattern',
  'minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf','format','minProperties','maxProperties']);
export function validateSchema(root: any, schema: Schema, value: unknown, depth = 0): boolean {
  if (!schema || typeof schema !== 'object' || depth > 40) return false;
  if (Object.keys(schema).some(k => !rules.has(k) && !annotations.has(k) && !k.startsWith('x-'))) return false;
  const check = (s: Schema, v = value) => validateSchema(root, s, v, depth + 1);
  if (schema.$ref && !check(pointer(root, schema.$ref))) return false;
  if (schema.anyOf && !schema.anyOf.some((s: Schema) => check(s))) return false;
  if (schema.oneOf && schema.oneOf.filter((s: Schema) => check(s)).length !== 1) return false;
  if (schema.allOf && !schema.allOf.every((s: Schema) => check(s))) return false;
  if (schema.not && check(schema.not)) return false;
  if ('const' in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) return false;
  if (schema.enum && !schema.enum.some((v: unknown) => JSON.stringify(value) === JSON.stringify(v))) return false;
  if (schema.format === 'binary') {
    // Consumer marker; trusted host binds it to an authorized opaque input, never a path/URL.
    return !!value && typeof value === 'object' && Object.keys(value).length === 1 &&
      Number.isSafeInteger((value as any).input) && (value as any).input >= 0;
  }
  const type = schema.type;
  if (Array.isArray(type)) return type.some(t => check({ ...schema, type: t }));
  if (type === 'null') return value === null;
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'integer' || type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || type === 'integer' && !Number.isSafeInteger(value)) return false;
    return !(schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum ||
      schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum ||
      schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum ||
      schema.multipleOf !== undefined && !Number.isInteger(value / schema.multipleOf));
  }
  if (type === 'string') {
    if (typeof value !== 'string' || value.length > 100000) return false;
    if (schema.format && !['uuid','date-time','date','email','uri','url','password','byte','duration','hostname','ipv4','ipv6'].includes(schema.format)) return false;
    // Formats beyond structural strings are deliberately unavailable, not silently accepted.
    if (schema.format) return false;
    return !(schema.minLength !== undefined && [...value].length < schema.minLength ||
      schema.maxLength !== undefined && [...value].length > schema.maxLength || schema.pattern && !new RegExp(schema.pattern).test(value));
  }
  if (type === 'array' || schema.items) {
    if (!Array.isArray(value) || value.length > 1000 || !schema.items) return false;
    return !(schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems ||
      schema.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length) && value.every(v => check(schema.items, v));
  }
  if (type === 'object' || schema.properties) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const object = value as Record<string, unknown>, keys = Object.keys(object), props = schema.properties ?? {};
    if (keys.length > 128 || schema.minProperties !== undefined && keys.length < schema.minProperties ||
      schema.maxProperties !== undefined && keys.length > schema.maxProperties ||
      (schema.required ?? []).some((k: string) => !Object.prototype.hasOwnProperty.call(object, k))) return false;
    return keys.every(k => !['__proto__','constructor','prototype'].includes(k) &&
      (Object.prototype.hasOwnProperty.call(props, k) ? check(props[k], object[k]) :
        typeof schema.additionalProperties === 'object' && check(schema.additionalProperties, object[k])));
  }
  // Empty/Any and boolean additionalProperties are not an executable schema contract.
  return !!(schema.$ref || schema.anyOf || schema.oneOf || schema.allOf || schema.enum || 'const' in schema);
}
