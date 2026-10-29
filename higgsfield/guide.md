# Higgsfield agent guide

**Candidate only.** Version 0.1.0 and host target 1.18.0 are preparation inputs. No installed handler, released minimum host/SDK, usable paid capability or final bundle is proved. HIG-11 / task_3xiri2 owns production integration and acceptance. See [RELEASE-EVIDENCE.md](RELEASE-EVIDENCE.md).

Discover installed capabilities through `domios capabilities`, then use the plugin's actual advertised verbs. The following are source invocation contracts and become usable only after production wiring:

1. Use `catalog` and `describe` to inspect the operation's exact dated schema and restrictions. Missing schemas, account-only/web-only controls and unavailable transport must remain explicit refusals.
2. Write one JSON object into your pad and pass it with `--from-pad`; use `--from-file` or `--stdin` as alternatives. Choose one body source and do not mix it with argv JSON. Body limit is 16,000 UTF-8 bytes. Identity, owner, actor, frame, run and budget come from trusted host context.
3. `prepare` creates a free validated intent. `rerun` prepares another validated intent and does not generate. `history`, `result` and `usage` return authorized local receipts; local usage is not an account balance.
4. `estimate` requires a trusted fresh quote bound to the exact intent. No command grants payment approval. `submit`, `cancel` and `reconcile` refuse without durable host admission; no generated ID, filename or JSON payload substitutes for authority.

Example pad `prepare.json`:

```json
{"operation":"higgsfield-ai/soul/v2/standard","params":{"prompt":"A quiet garden"}}
```

Source-only invocation: `domios plugin higgsfield prepare --from-pad prepare.json`.

The finite surface verbs are `open`, `close`, `catalog`, `describe`, `prepare`, `rerun`, `estimate`, `usage`, `history`, `result`, `cancel`, `reconcile`, `submit`, `metadata`. Host routing owns child creation/reuse/close and delegation. Do not invent tab IDs, owner fields or a scheduler. `metadata` is a bounded saved-JSON seam, not arbitrary HTTP or a substitute for lifecycle/paid effects. [COMMANDS.md](COMMANDS.md) documents exact payloads and refusals.

Use model-native audio where documented. A video URL or poster does not prove audio playback. Scribe uses the existing selectable transcriber backend; do not add a transcription UI or change settings/voices. Authorized saved image paths can use existing standalone `@ds-image ABSOLUTE_PATH` only when the host has actually supplied that authorized path.

Frame media handles are ephemeral, exact-document authority, never durable job IDs or Blueprint media references. Expired access should reopen/reacquire the saved result for free; never pay to regenerate merely for a token. Copy/save/reveal require actual host availability and a user gesture. Do not print backend paths or raw provider URLs/errors. Actual binary input/output production and current result-lookup authorization remain external requirements.

The four source Blueprint families and all 105 coverage mappings remain in `adapter-contracts.json`, `adapter-index.json` and `src/blueprint.ts`. Nested source JSON schemas are not runnable host NodeSchema descriptors. Registration is deliberately withheld pending accepted closed schemas, durable waiting/unknown/budget/media contracts and actual agent media review (or explicit Elgar disposition). No generic converter/HTTP escape hatch or fake reviewer satisfies that contract.
