# Higgsfield command and graph source slice

Source adapters only, **registration withheld**. This batch installs no plugin, UI, scheduler or Blueprint runner. All evidence uses the accepted service/MediaCore and synthetic zero-spend ports. HIG-11 owns actual two-agent child attachment/reuse/close/activity, updates, media, pipeline execution, screenshots, SDK/min-host and final release proof. Independent package version target remains 0.1.0; metadata/root packaging is another task.

`src/adapters.ts` creates command, view and run adapters over the **same** injected `HiggsfieldService`. The following UI/delivery task supplies real durable storage and current authorization/transport ports. `src/contributions.ts` exposes the source surface declaration (`agentBound`, finite `agentVerbs`, `stateInvalidation`) and four source graph families. It is not an installable manifest or an SDK assertion. No visible UI was edited; Iris retains all UI authority.

Agent entry `onAgentCommand` calls the actual generic `host.surface.call(verb, JSON.stringify(args))` through its exact captured surface port. Host context assigns the caller, resolves its owned child, performs open/close and authorizes delegated access before invoking the synchronous `onSurfaceCall`. Session IDs are never forwarded as owner authority. The fixture asserts exact calls and reuse wiring, not real tab creation. The injected access resolver must verify current registration, exact instance, plugin/workspace, owner versus actor, cross-owner host delegation and origin. It must not trust an object merely because it has matching keys. A local view actor does not establish human approval. ViewCall context and C run context use separate resolvers. Missing/refused access returns a fixed safe error.

Commands consume the SDK `AgentCommandCtx`, including its optional `body`. The platform CLI resolves `--from-pad PATH`, `--from-file PATH`, or `--stdin` into that body; the adapter forwards it as exactly one structured JSON surface argument. Supply a JSON object, at most 16,000 UTF-8 bytes (multibyte characters count by bytes), and no simultaneous argv payload. The compatibility argv path accepts exactly one JSON-object string under the same limit. Empty, malformed, scalar or array payloads refuse. Zero arguments with no body means `{}`. The serialized surface argument array must also fit the host's 32,768-byte bound. No shell file read, credentials, arbitrary HTTP or URL dispatch exists inside the plugin.

For agent use, write this JSON into the agent's pad as `prepare.json`, then use `domios plugin higgsfield prepare --from-pad prepare.json`. A normal UTF-8 JSON file can instead use `--from-file prepare.json`, or be piped with `--stdin`. Choose exactly one body source and do not append an argv JSON payload. These source invocation contracts require HIG-11 production wiring; the current source factory is not an installed handler.

```json
{"operation":"higgsfield-ai/soul/v2/standard","params":{"prompt":"A quiet garden"}}
```

Example structured payloads below are source command contracts, not claims that an installed CLI is available:

| Verb | Argument | Behavior |
|---|---|---|
| open / close | `{}` | Generic host child lifecycle; only authenticated onSurfaceCall acknowledges after host routing; viewCall returns `surface_lifecycle_unavailable` |
| catalog | `{}` | All 92 models, 13 operations and sourced limitations |
| describe | `{operation}` | Exact dated schema, source URL/date and limitation/disposition |
| prepare | `{operation,params}` | Local exact-schema intent, host-generated identity; no payment |
| rerun | `{id,changes:{seed?,batch_size?}}` | Free validated new intent; one-hop parent receipt, durable lineage still pending |
| estimate | `{id}` | Effect-free trusted exact-binding quote; missing pricing refuses |
| history / usage | `{}` | Authorized sanitized local receipts / separate-unit ledger; vendor balance unknown |
| result | `{id}` | Authorized local job receipt and opaque saved artifacts |
| submit / cancel / reconcile | `{id}` | Requires injected durable host admission, otherwise explicit unavailable |
| metadata | `{operation,params}` | Finite service metadata through bounded saved JSON artifact transport; missing transport refuses |

Lifecycle commands accept local owned intent IDs, never arbitrary provider request IDs. Metadata routes cannot substitute for status/cancel/delete/paid estimate. Deletion, binary PUT, training, private Influencer catalogs, missing Light schemas and malformed Omni schema retain service limitations. No raw backend path, transport correlation, provider URL/body, prompt, scope, run/frame identity, auth revision or raw error is included in command receipts/activity. Successful mutations emit one exact-instance identity-only invalidation hint. Receipt acquisition and restart scheduling require external durable host delivery; an invalidation is not a durable receipt.

No command approves money. `admission.ts` requires a trusted purpose, immutable operation/binding, exact atomic maximum, run ceiling evidence and Watt aggregate proof reference before a newly ready effect can enter. It creates no aggregate ledger and grants no authority itself. The external port must validate current evidence against Watt's ledger. MediaCore remains the only owner approval/quote/ceiling/reservation machine and rechecks fresh evidence at entry. Default ports cannot submit. An exception is stored on one immutable intent; it neither changes the ceiling nor authorizes a later node. Unknown/stale price cannot be overridden; refresh resets approval. No pipeline refresh control is exposed pending Loom batch2 transport.

`adapter-index.json` maps all 105 dated research coverage rows to commands, exact schema references, four source operation families and documentation, with explicit source-only status. It also retains the three web aliases, six console-only controls and absent endpoint categories. `adapter-contracts.json` records descriptor types, outcomes/effects and named external limitations. `src/blueprint.ts` binds each operation to the actual model schema, validates controls with the accepted service, and accepts only trusted run input references. No raw JSON/HTTP pass-through or converter is used. These **source schema registries are not host NodeSchema**. Nested arrays/refs/conditionals cannot honestly be registered against flat host schemas. Training family is discovery-only under the existing service refusal. Auxiliary export formats require durable typed-port delivery, not a guessed image/video conversion.

The source fixture tests exercise waiting, owner confirmation, stale quote, independent ceiling and one-intent exception, submitting, queued, failure, cancel acknowledgement/Unknown, exact-job reconciliation, no replay and bound durable fake input/output. The bounded reviewer stub explicitly reports `actualMediaConsumption:false`; it does not inspect pixels or satisfy actual review. No production YAML is fabricated: `blueprints/fixture-source.json` documents the deterministic fixture contract, and HIG-11 authors/checks/applies production YAML only after accepted external schema/runner/media-review delivery.

The original lane base clears `cancelRequested` in `MediaCore.unknown()` after cancellation acknowledgement. Watt reports this corrected on canonical `6523cd6b2cc632542918eb631a631145b7082364`: pending cancellation survives Unknown/queued/generating until an exact-job terminal result, with provider identity/reservation retained, and canonical shared selector exit 0/71. This is parent-supplied dependency evidence; no shared code was copied or merged into this lane and no common tests were rerun here. Canonical integration verifies the source adapters against that correction. Durable cross-instance lineage remains external; the rerun receipt is preparation evidence only.

External owners/actions/triggers:

| Owner | Required action | Trigger for HIG-11 proof |
|---|---|---|
| Concierge A | Accepted trusted ViewCall/agent surface context, real child lifecycle and history updates | Merged contract plus native/JS two-owner authorization evidence |
| Courier B | Selected/owned opaque inputs, bounded JSON/file/empty transfer, origin pins and confined media | Accepted opaque producer, output allowlist/confinement and exact-frame media proof |
| Loom/Concierge C | Nested closed schemas, durable run callbacks/admission/owner history, batch2 refresh and durable lineage | Reviewed merged runner/SDK signatures and zero-spend runtime fixture apply/show/log |
| Loom/Courier; Elgar disposition through Watt | Actual authorized media-aware review input | Delivered review contract or explicit Elgar disposition; stub insufficient |
| Watt | Purpose, fresh exact account pricing, ceilings and controlled aggregate proof ledger | Separate explicit approval before any live paid proof |
| Iris / HIG-11 | All UI and final media/host/pipeline acceptance | Actual reviewed built candidate and final screenshot/live evidence |

Candidate A `5eb71627…` and C `7f7adf92…` are research inputs, not released SDK/min-host/runtime proof. See [SERVICE.md](SERVICE.md), [PLATFORM-GAPS.md](PLATFORM-GAPS.md) and the dated [research](RESEARCH.md). No service import/projection changes were needed; the unchanged client suite is not rerun here. Authorized focused source gates are the commands/Blueprint test selector and coverage checker; no build/typecheck/install/server/live calls are run. Spend/reserved/unknown paid effects for this lane: 0/0/0.

Executed source proof (2026-10-29): `node --import tsx --test higgsfield/tests/commands.test.ts higgsfield/tests/blueprint.test.ts` — raw exit 0, 17 passed / 0 failed / 0 skipped. `node higgsfield/scripts/check-coverage.mjs` — raw exit 0, 105 rows plus alias/console/absence declarations; four negative mutations rejected (removed row, bad output type, unknown outcome, unsupported production-ready claim). Each exact gate ran once. These results establish only source/fixture behavior; final host/media/reviewer evidence remains unrun.

Correction proof after source review bounce of `8383e269a8be9e5960dcde66060ae82956e186e3`: the same exact commands/Blueprint selector ran once, raw exit 0, **21 passed / 0 failed / 0 skipped**. The coverage checker ran once because this guide changed, raw exit 0, 105 rows and four negative mutations rejected. Original 17-test/coverage evidence above remains historical. Four added regressions cover SDK body forwarding through the surface handler into preparation, ASCII/three-byte/supplementary UTF-8 limits at 16,000 bytes and one byte above for body/argv/direct surface, args/body conflicts and malformed bodies, and authenticated surface-only lifecycle acknowledgement with view refusal. CLI body-source syntax was read from the host CLI `cli/src/cmd/plugin/body_source.rs`; installed SDK supplies the imported `AgentCommandCtx`. No production handler or real child was exercised.
