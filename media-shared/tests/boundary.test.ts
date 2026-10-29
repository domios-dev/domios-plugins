import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

test('common runtime has only relative shared imports and no vendor branch, network endpoint or host SDK guess', () => {
  const root = new URL('../src/', import.meta.url);
  for (const file of readdirSync(root).filter(f => f.endsWith('.ts'))) {
    const source = readFileSync(new URL(file, root), 'utf8');
    assert.doesNotMatch(source, /higgsfield|elevenlabs|https?:\/\/|\bfetch\s*\(|\bct\.|host\.(?:fetch|surface)/i, file);
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) assert.match(match[1], /^\.\/(contracts|cost|presentation)$/, file);
    assert.doesNotMatch(source, /(?:vendor|provider)(?:Id|Name)\s*(?:===|==)|switch\s*\(\s*(?:vendor|provider)/i, file);
  }
  const controllerTest = readFileSync(new URL('./controller.test.ts', import.meta.url), 'utf8');
  for (const fixture of ['async-job', 'sync-stream']) assert.ok(controllerTest.includes(`./fixtures/${fixture}`));
  assert.match(controllerTest, /new MediaController/);
  const async = readFileSync(new URL('./fixtures/async-job.ts', import.meta.url), 'utf8');
  const bytes = readFileSync(new URL('./fixtures/sync-stream.ts', import.meta.url), 'utf8');
  assert.match(async, /kind: 'async'/); assert.match(async, /ticket/); assert.doesNotMatch(async, /kind: 'stream'/);
  assert.match(bytes, /kind: 'sync'/); assert.match(bytes, /kind: 'stream'/); assert.doesNotMatch(bytes, /inspect\(/);
});
