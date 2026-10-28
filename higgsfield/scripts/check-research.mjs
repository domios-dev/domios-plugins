import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(resolve(root, path), 'utf8').replace(/^\uFEFF/, '');
const json = (path) => JSON.parse(read(path));
const hash = (path) => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');
const primaryHost = /^(docs|open|console)\.higgsfield\.ai$/;
const date = '2026-10-29';
const sourceModels = new Map();
const docsOperations = new Map();

function completeSchema(text) {
  const schemas = [];
  for (const block of text.matchAll(/> ```json[^\n]*\n([\s\S]*?)> ```/g)) {
    const value = JSON.parse(block[1].split('\n').map((line) => line.replace(/^> ?/, '')).join('\n'));
    if (value && typeof value === 'object' && (value.properties || value.$defs)) schemas.push(value);
  }
  if (schemas.length !== 1) throw new Error(`Expected one complete input schema, found ${schemas.length}`);
  return schemas[0];
}

for (const name of readdirSync(resolve(root, 'evidence'))) {
  if (!name.startsWith('docs-') || !name.endsWith('.md')) continue;
  const path = `evidence/${name}`;
  const text = read(path);
  const id = text.match(/\*\*(?:Endpoint|Catalog) ID:\*\* `([^`]+)`/)?.[1];
  if (id) {
    if (sourceModels.has(id)) throw new Error(`Duplicate primary model ID ${id}`);
    sourceModels.set(id, { schema: completeSchema(text), path, text });
  }
  // This independently reconciles every family-table operation, not just a fixed count.
  for (const match of text.matchAll(/\| \[[^\n]+\]\((https:\/\/docs\.higgsfield\.ai\/docs\/models\/[^)]+)\) \| `(POST|GET|DELETE) ([^`]+)` \|/g)) {
    docsOperations.set(`${match[2]} ${match[3]}`, match[1]);
  }
}

const original = { models: json('models.json'), contracts: json('contracts.json'), capabilities: json('capabilities.json') };
const retrievals = json('evidence/retrievals.json');
const consoleRetrievals = json('evidence/console-model-retrievals.json');
const snapshotSources = json('evidence/sources.json');
const consoleExtra = new Map();
for (const row of snapshotSources.filter((row) => row.kind === 'console-model')) {
  const text = read(row.file);
  const id = text.match(/higgsfield\.subscribe\(\s*(?:\d+\s*)?"([^"]+)"/)?.[1];
  if (id) consoleExtra.set(id, row);
}
const expectedIds = new Set([...sourceModels.keys(), ...consoleExtra.keys()]);
const requiredShared = [
  'requests.status', 'requests.cancel', 'requests.delete', 'estimate.model',
  'files.upload-url', 'files.put', 'styles.soul', 'styles.soul-v2',
  'presets.marketing', 'presets.restyle', 'references.get', 'references.list', 'influencer.options',
];

function validate(data) {
  const errors = [];
  const need = (condition, message) => { if (!condition) errors.push(message); };
  const models = data.models.models;
  const operations = data.contracts.operations;
  const coverage = data.capabilities.coverage;
  const map = (rows, kind) => {
    const result = new Map();
    for (const row of rows) {
      need(typeof row.id === 'string' && row.id.length > 0, `${kind} missing ID`);
      need(!result.has(row.id), `${kind} duplicate ID ${row.id}`);
      result.set(row.id, row);
    }
    return result;
  };
  const modelMap = map(models, 'model');
  const operationMap = map(operations, 'operation');
  const coverageMap = map(coverage, 'coverage');
  const checkSource = (source, id) => {
    let primary = false;
    try { primary = primaryHost.test(new URL(source?.url).hostname); } catch {}
    need(primary, `${id}: missing primary URL`);
    need(source?.retrievedDate === date, `${id}: missing retrieval date`);
    need(source?.snapshot && source?.sha256 === hash(source.snapshot), `${id}: missing/changed source snapshot`);
  };
  for (const id of expectedIds) need(modelMap.has(id), `omitted model ${id}`);
  for (const id of modelMap.keys()) need(expectedIds.has(id), `unsourced model ${id}`);
  for (const id of requiredShared) need(operationMap.has(id), `omitted shared operation ${id}`);
  for (const [key, url] of docsOperations) {
    need(models.some((model) => `${model.method} ${new URL(model.endpoint).pathname}` === key), `uncovered family operation ${key} (${url})`);
  }
  for (const row of [...models, ...operations]) {
    checkSource(row.source, row.id);
    need(row.availability?.status && row.availability?.liveTested === false, `${row.id}: unsourced/live availability claim`);
    need(row.cost?.status && row.cost?.source?.startsWith('https://docs.higgsfield.ai/'), `${row.id}: missing cost basis/status`);
    for (const field of ['transport', 'cancel', 'progress', 'preview']) need(row[field], `${row.id}: missing ${field}`);
    need(row.lifecycleRef || row.lifecycle, `${row.id}: missing lifecycle`);
    const target = coverageMap.get(row.id);
    need(target, `${row.id}: no coverage target or limitation`);
    need(target?.command?.status === 'proposed-not-implemented', `${row.id}: unsupported implemented command claim`);
    need(target?.command?.schemaRef && target?.blueprint?.schemaRef && target?.ui?.docs, `${row.id}: missing typed command/node/UI destination`);
    need(target?.blueprint?.status === 'blocked-external-Loom', `${row.id}: unsupported delivered Blueprint claim`);
    need(target?.productionReady === false, `${row.id}: unsupported production readiness`);
    if (row.schemaStatus === 'unavailable-primary-schema') {
      // An evidenced unsupported limitation is not a schema that may be submitted.
      need(row.schema === null && row.limitations?.length && target?.limitation?.length, `${row.id}: unacknowledged schema hole`);
      need(row.submissionDisposition === 'refuse-vendor-clarification-required', `${row.id}: schema hole must refuse submission`);
    } else if (row.schemaStatus === 'model-schema-reference') {
      need(row.id === 'estimate.model' && row.schema === null && row.notes.includes('exact selected generation schema'), `${row.id}: invalid schema reference`);
    } else if (row.schemaStatus === 'binary-body') {
      need(row.id === 'files.put' && row.schema === null && row.notes.includes('Exact bytes'), `${row.id}: invalid binary contract`);
    } else {
      need(row.schema?.type === 'object' && row.schema?.properties, `${row.id}: schema hole`);
    }
  }
  for (const model of models) {
    const primary = sourceModels.get(model.id);
    if (primary) {
      need(isDeepStrictEqual(model.schema, primary.schema), `${model.id}: schema field/default/enum/limit omitted or changed`);
      need(model.source.snapshot === primary.path, `${model.id}: incorrect primary schema source`);
    } else if (model.schema) {
      const text = read(model.source.snapshot);
      const table = text.match(/(?:Parameter\tType\tRequired\tDefault\tDescription|Parameter\tType \/ default\tUsage)\r?\n([\s\S]*)/)?.[1];
      const fields = [...(table ?? '').matchAll(/^([a-z][a-z0-9_]*)\t/gm)].map((match) => match[1]);
      need(fields.length > 0 && isDeepStrictEqual([...new Set(fields)].sort(), Object.keys(model.schema.properties).sort()), `${model.id}: console parameter-table schema hole`);
    }
    need(isDeepStrictEqual(model.parameterNames, Object.keys(model.schema?.properties ?? {})), `${model.id}: missing parameter inventory`);
    need(model.accountLimits?.source && model.accountLimits?.value, `${model.id}: missing account limitation`);
    need(model.nativeAudio && model.nativeAudio.apiStatus && model.nativeAudio.cost, `${model.id}: missing native audio inventory`);
    need(isDeepStrictEqual(model.nativeAudio, data.capabilities.nativeAudio[model.id]), `${model.id}: missing/drifted audio coverage`);
    for (const [key, value] of Object.entries(model.schema?.properties ?? {})) {
      if (key === 'audio_url' || key === 'audio_urls') need(isDeepStrictEqual(model.nativeAudio.inputFields[key], value), `${model.id}: omitted audio parameter ${key}`);
    }
    if (model.id === 'soul-id') need(isDeepStrictEqual(model.variants.map((v) => v.id), ['soul-id:v1', 'soul-id:v2', 'soul-id:cinema']), 'omitted Soul ID training variant');
    need(model.cost?.amount === null, `${model.id}: unauthenticated quote asserted`);
  }
  need(coverage.length === models.length + operations.length, 'absent/extra coverage rows');
  for (const row of coverage) need(modelMap.has(row.id) || operationMap.has(row.id), `unknown coverage ID ${row.id}`);
  need(isDeepStrictEqual(data.contracts.generation.states, ['queued', 'in_progress', 'completed', 'failed', 'nsfw', 'canceled']), 'six vendor states changed');
  need(data.contracts.generation.cancel.includes('every job queued'), 'queued-only cancellation lost');
  for (const field of ['authenticatedCalls', 'secretReads', 'uploads', 'generations', 'training']) need(data.contracts.ledger[field] === 0, `zero-spend boundary changed: ${field}`);
  for (const key of ['spent', 'reserved', 'unknown']) need(data.contracts.ledger.thisResearchAggregate[key] === '0' && data.contracts.ledger.higgsfield[key] === '0', `nonzero ledger ${key}`);
  need(data.capabilities.productionReady === false, 'research cannot assert production delivery');
  need(data.contracts.costPolicy.submission?.includes('No paid submit studio or pipeline without fresh safe estimate'), 'safe estimate submission rule lost');
  need(data.contracts.costPolicy.unknownUi?.pipelineApprove === false, 'unknown price cannot be approved');
  need(data.contracts.platformDependencies?.every((gap) => gap.minimumHost === null && gap.releasedSdk === null && gap.owner && gap.action && gap.readyTrigger), 'missing external owner/action/ready/min-host uncertainty');
  need(data.contracts.platformDependencies?.length >= 8, 'omitted generic platform dependency');
  return errors;
}

try {
  for (const row of [...retrievals, ...consoleRetrievals, ...snapshotSources, ...json('evidence/host/sources.json')]) {
    if (row.error) continue;
    const file = row.file;
    if (!file || hash(file) !== row.sha256) throw new Error(`Evidence hash mismatch ${file}`);
  }
  const errors = validate(original);
  if (errors.length) throw new Error(errors.join('\n'));
  // Negative fixtures exercise the validator; no subprocess/network/vendor calls.
  const mutations = [
    ['missing model', (d) => d.models.models.pop()],
    ['duplicate model', (d) => d.models.models.push(d.models.models[0])],
    ['duplicate operation', (d) => d.contracts.operations.push(d.contracts.operations[0])],
    ['missing date', (d) => delete d.models.models[0].source.retrievedDate],
    ['schema hole', (d) => delete d.models.models[0].schema.properties[Object.keys(d.models.models[0].schema.properties)[0]]],
    ['missing cost', (d) => delete d.models.models[0].cost],
    ['missing coverage', (d) => d.capabilities.coverage.pop()],
    ['unsupported live claim', (d) => d.models.models[0].availability.liveTested = true],
    ['unacknowledged unavailable schema', (d) => d.models.models.find((m) => m.schema === null).limitations = []],
    ['fabricated minimum host', (d) => d.contracts.platformDependencies[0].minimumHost = '1.18.0'],
    ['nonzero spend', (d) => d.contracts.ledger.thisResearchAggregate.spent = '1'],
  ];
  for (const [name, mutate] of mutations) {
    const changed = structuredClone(original);
    mutate(changed);
    if (validate(changed).length === 0) throw new Error(`Negative oracle accepted ${name}`);
  }
  console.log(`PASS research integrity: ${sourceModels.size} primary schemas, ${original.models.models.length} union models, ${original.contracts.operations.length} shared operations, ${original.capabilities.coverage.length} coverage rows; ${mutations.length} negative oracles rejected.`);
  console.log('USD spent/reserved/unknown: 0/0/0; authenticated calls/secret reads/uploads/generations/training: 0.');
  console.log('Production consumption BLOCKED: declared vendor schema/auth conflicts and external delivery/SDK/min-host proof remain required. Integrity PASS is not a whole-API implementation or live acceptance claim.');
} catch (error) {
  console.error(`FAIL research integrity: ${error.message}`);
  process.exitCode = 1;
}
