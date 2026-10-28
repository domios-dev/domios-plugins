# ElevenLabs public API contract — 2026-10-29

This $0 research snapshot inventories the whole documented API, not a starter pair. It contains **458 HTTP operations, eight WebSocket channels, all 601 indexed API-reference pages (including aliases/guides), 166 schema-bound model/selector records and81 visual display catalog records**. Commands, typed Blueprint nodes and UI destinations are proposals. No plugin runtime, account entitlement or production capability is claimed.

No credential was read. No authenticated account call, generation, preview, upload, training, onboarding command or voice/settings mutation occurred. All existing voices—including Rollo—and settings remain untouched. Ledger: **spent $0, reserved $0, unknown submissions 0 for this task**; this does not assert balances for other Team activity.

## Evidence boundary and files

Snapshot date uses Europe/Riga; raw page retrieval timestamps use UTC (some are 2026-10-28 UTC, the same local research date). Each primary URL/date/hash and saved page is in [capabilities.json](capabilities.json). The finite boundary is the union of:

- [Complete public index](https://elevenlabs.io/docs/llms.txt), including its API Docs section and links to raw schemas.
- [Public API OpenAPI](https://api.elevenlabs.io/openapi.json): 340 path keys, 458 HTTP method/operation IDs; complete parameters, bodies, responses, components, defaults, enums and schema constraints preserved.
- Every indexed API operation page: eight distinct WebSocket channels have complete embedded AsyncAPI 2.6 schemas, including directional message operation IDs; HTTP aliases map to canonical OpenAPI operation IDs.
- [Model overview](https://elevenlabs.io/docs/overview/models.md), explicit model selectors/enum/default/const branches in OpenAPI and AsyncAPI, plus the [Image & Video display catalog](https://elevenlabs.io/docs/overview/capabilities/image-video.md). Display names never become guessed API IDs.
- [Public API pricing](https://elevenlabs.io/pricing/api), overview capability/account/billing/workspace pages and WebSocket guides. All were retrieved 2026-10-29 local. Pricing was read with the Domios Browser; Markdown/index/schema data used unauthenticated public HTTP.

Artifacts:

| File | Contract |
|---|---|
| [contracts.json](contracts.json) | Security/$0 ledger, exact-unit budget, pricing decision/rates, priority workflows, fixture oracles and known source conflicts. |
| [capabilities.json](capabilities.json) | Canonical operation IDs and paths, catalog aliases, dated primary sources, full schema pointers plus documented parameters/limits, authorization, transport, lifecycle/cost evidence, proposed command/node/UI and explicit limitations. |
| [models.json](models.json) | Every static schema-bound model/selector, deprecated overview entries, separate display-only visual catalog and unresolved dynamic account catalogs. |
| [PLATFORM-GAPS.md](PLATFORM-GAPS.md) | Exact current-source/draft contracts, ownership/security/parity, min-host/SDK unknowns, external owner/action/ready triggers, existing Scribe path. |
| [scripts/check-research.mjs](scripts/check-research.mjs) | Authorized offline catalog/source/schema/coverage/$0 gate; no vendor access. |
| [evidence/page-manifest.json](evidence/page-manifest.json) | 648 successfully saved primary Markdown pages, URLs, retrieval timestamps and hashes; no acquisition retries. |
| [evidence/openapi.json](evidence/openapi.json), [asyncapi.json](evidence/asyncapi.json) | Raw public OpenAPI and JSON extraction of nine embedded AsyncAPI documents (eight distinct channels; upstream alias duplicated). |
| [evidence/host-source.json](evidence/host-source.json) | 51 immutable source files with hashes at exact host/plugin SHAs. |

The raw docs schema links `https://elevenlabs.io/docs/openapi.json` and `https://elevenlabs.io/docs/asyncapi.json` returned HTML, not JSON. Their saved response bodies are acquisition evidence, not schemas. `llms-full.txt` returned the index body rather than full docs; pages were fetched individually. The shorter `/docs/api-reference/llms.txt` includes only introduction/auth/streaming guides, so it cannot define completeness. The global index is essential.

## Whole-API coverage

The 466 canonical rows include every HTTP operation from the public schema, even 63 HTTP operations absent from indexed Markdown pages. Those retain the public schema as their primary source and do not gain invented prose, permissions or GA status. The 588 HTTP endpoint pages are not 588 distinct operations: many ElevenAgents URLs alias the same method/path. Four indexed pages are guides. Every URL is retained; aliases do not create duplicate operation IDs. Eight WebSocket channel records preserve both client/server message operation IDs and exact message schemas.

| Proposed closed descriptor family | Rows | Included surface |
|---|---:|---|
| agents | 197 | Agents/branches/drafts/versions/procedures/merge/deployments, conversations/feedback/audio, knowledge base/RAG/crawls, tests/invocations, tools/MCP/integrations/telephony/WhatsApp, realtime, analytics and environments. |
| studio | 33 | Studio/projects/chapters/snapshots, productions/orders/media/deliverables. Sales/request authorization is retained. |
| dictionaries | 10 | Pronunciation dictionary file/rule creation, versions/download, rules and metadata. |
| dubbing | 36 | New projects/languages/transcripts/segments and legacy/resource/render/transcribe/translate/dub operations. |
| workspace | 34 | Workspace/admin/user/subscription/usage-related paths selected by documented path. |
| voices | 45 | Listing/library/similarity/settings/samples/collections, IVC/PVC/design/remix/train/verify and legacy paths. Mutations remain protected. |
| audio | 8 | Isolation, effects catalog and sound generation. |
| music | 13 | Compose/stream/detailed/plan, video-to-music, upload/stems and finetunes. |
| flows | 11 | Image/video/TTS asynchronous generations and template runs/catalog. |
| administration | 44 | Remaining schema operations including Reception/SMB/reseller and documentation/administrative paths; each exact operation remains closed. |
| speech-engine | 7 | CRUD/duplicate/list plus reverse upstream WebSocket contract. |
| speech | 15 | TTS/dialogue HTTP/timestamps/streams, single/multi-context sockets and remaining speech paths. |
| history | 7 | Saved generation/history/audio/download operations. |
| transcriptions | 5 | Batch Scribe/create/get/delete, realtime Scribe socket and forced alignment. |
| models | 1 | Model catalog listing. |

Family names are proposed plugin organization, not vendor API taxonomy. Exact IDs/schemas are authoritative. Full API support cannot mean a user-supplied URL, method, raw body or arbitrary HTTP command. The proposed 15 Blueprint descriptors use a finite operation discriminator and exact closed schema binding; current flat converter/eventSource schemas cannot represent the complete API. That is an external Loom contract gap, not permission to use `convert` as a paid generation node.

Each operation has a source-bound schema, cost status and cancellation/progress/preview statement. Lexical lifecycle hints are explicitly navigation aids; exact response schema and saved protocol/prose govern. No time-based fake progress or generic “job complete” interpretation is supplied. Publicly unspecified authorization, prices or cancellation stay unspecified. Schema `{}`/`Any` or open-string models are vendor uncertainty, not a fabricated schema guarantee. The checker rejects omissions relative to those primary declarations; it does not turn weak vendor constraints into safe executable adapters.

## Models, protocols and authorization

The overview names current `eleven_v4`, `eleven_v4_turbo`, `eleven_v3`, `eleven_v3_conversational`, `eleven_ttv_v3`, `eleven_multilingual_v2`, Flash v2/v2.5, multilingual/English STS, multilingual TTV, Scribe v2/v2 realtime/v2 medical, Realtime v1 mini/max, sound v2 and Music v1/v2/v2.5. Turbo v2/v2.5 and Scribe v1 are explicitly deprecated there. Static schema defaults/enums additionally document legacy IDs, sound v3, third-party image/video IDs, agent LLMs, embedding/turn models and model-family selectors. These are preserved with their **original schema context**, not sent indiscriminately to every endpoint. Overview absence does not become an unsupported/deprecated claim.

Source model character-limit table: v4 10,000; v3 5,000; Flash v2.5 40,000; Flash v2 30,000; Multilingual v2 10,000. Other limits/defaults/languages are in the exact source table/sections and schemas, not extrapolated. v4 overview explicitly links Text to Dialogue; it is not proof that an arbitrary TTS model string is accepted. The API model listing is account-dependent and was not called. Open-string/finetune IDs and future live account catalogs cannot be exhaustively enumerated without changing this research boundary.

HTTP audio is raw bytes or timestamp JSON according to the operation; streaming is HTTP chunked audio or its documented structured response. WebSocket session setup/commit/flush/end/keepalive are separate schemas. Scribe emits partial versus committed transcripts; committed segment is not a whole session completion. Speech Engine upstream reverses the normal client connection: ElevenLabs connects to the owner's configured WebSocket server, which must validate JWT. Realtime translation is Enterprise-only. None of these protocols is assumed to exist in the current plugin fetch API. [Sources: streaming](https://elevenlabs.io/docs/api-reference/streaming.md), [Scribe realtime](https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime.md), [upstream](https://elevenlabs.io/docs/api-reference/speech-engine/speech-engine-upstream.md), [translation](https://elevenlabs.io/docs/api-reference/realtime-translation/v-1-translation-realtime.md).

Voice Library API excludes free tier. Billing says cloning Starter+; PVC creation Creator+. Voice design returns previews separately from persistent creation; prompt/style/reference audio are model-specific. All existing voices/settings remain immutable, and design/cloning creation needs separate owner approval. Default voice expiry warning is recorded, not acted on. [Voices](https://elevenlabs.io/docs/overview/capabilities/voices.md), [billing](https://elevenlabs.io/docs/overview/administration/billing.md), [design](https://elevenlabs.io/docs/api-reference/text-to-voice/design.md).

Image/video **does have documented API operations**, with Pro+ requirement, explicit ByteDance approval, Enterprise admin model approval and regional restrictions. The much broader visual display catalog includes names not safely mapped to the static API enums. Those remain visible catalog-only records with no invented API ID or endpoint; this is not an assertion that they are website-only. [Primary capability/account restrictions](https://elevenlabs.io/docs/overview/capabilities/image-video.md).

Music has distinct model-specific composition plan types, style lists, lyrics, audio reference/source chunks, inpainting upload and finetunes. An overview “+ Reference” website button is not an extra API endpoint. Actual upload is documented and paid; copyright rejection still charges half. Finetune creation/train is not a free listing. [Music overview](https://elevenlabs.io/docs/overview/capabilities/music.md), [upload](https://elevenlabs.io/docs/api-reference/music/upload.md), [finetunes](https://elevenlabs.io/docs/api-reference/music/finetunes/create.md).

## Prices, usage and limits

Fresh public advertised rates are captured verbatim in [pricing-browser.txt](evidence/pricing-browser.txt), normalized as integer `usd_micro` per explicit unit in [contracts.json](contracts.json). Examples: v4/v3/Multilingual $0.08 per1K characters; v4 Turbo/v3 Conversational/Flash-Turbo $0.04 per1K; Scribe v2/Medical $0.22/hour; realtime Scribe $0.39/hour; Music $0.15/minute; isolator/changer/effects $0.12/minute; dubbing v1 $0.33/minute, v2 $2.20/minute. Realtime Mini/Max $0.08/minute **plus LLM usage**. These are public advertised base prices, excluding taxes, not a safe authenticated account quote or permission to spend. [Pricing retrieved 2026-10-29](https://elevenlabs.io/pricing/api).

Watt's latest decision requires a **safe fresh estimate before every paid studio or pipeline submission**. Public tariffs provide deterministic-estimator candidates for character/duration operations; actual account tariff, exact inputs, surcharges, minimum durations, model/voice premiums, safe upper bound and expiry must be established first. This snapshot proves **no delivered safe full-operation estimator**. Two API methods calculate expected LLM usage/cost, not the entire agent/generation cost. All other absent estimates remain “No pricing from provider”, listed but unavailable. Missing/stale/unsafe price cannot be waived by owner confirmation. Studio: disabled “Price unavailable” and free “Check again”. Pipeline: “Waiting for a price”, free “Check price again”, no approval until fresh safe amount/unit. Then “Approve N units for this step”, exact operation only. Cancellation during submit is `Canceling…` then `Status unknown` until confirmed, never an inferred refund.

Scribe cost is not simply duration × base tariff: edit +30%/minimum10s; keyterms +20% and >100 terms minimum20s; speaker roles +10%; multichannel bills each channel for full duration. File upload <5GB and >=100ms; legacy HTTPS cloud URL <2GB. Exact interactions and language/channel/entity/diarization constraints are retained. No public URL workaround establishes the selected binary upload/security path. [Create transcript](https://elevenlabs.io/docs/api-reference/speech-to-text/convert.md).

Billing distinguishes subscription quota and PAYG, changing model/product/plan/API multipliers and rollover; credits were formerly called characters, but that does not establish one credit per input character for every model. Subscription/usage/limits endpoints are inventoried; actual balance, quota, subscription and concurrency remain unqueried. Public concurrency/model guidance remains saved in `evidence/models.md`; no higher cap or paid scale test occurred. Do not sum dollars/credits/characters or declare a zero account balance. [Billing](https://elevenlabs.io/docs/overview/administration/billing.md), [PAYG](https://elevenlabs.io/docs/overview/administration/pay-as-you-go.md), [models/concurrency](https://elevenlabs.io/docs/overview/models.md).

## Source conflicts and honest gaps

- Music endpoint permits `music_length_ms` 3000–600000; pricing advertises five-minute limit. Ten-minute account availability is not proved.
- TTD socket page says one voice for v4/v3 Conversational; comparison guide says ten for v4 and one for v4 Turbo. Preserve both; restrictive bound pending vendor clarification, no universal claim.
- Finetune training progress prose says0..1, example says1.1. The example is not a valid oracle.
- Source SDK package version1.16.1 does not prove the merged later contracts were published under it. No guessed minimum host1.18.
- Trusted agent `onSurfaceCall` context does not authorize `ct.invoke` UI calls or a Blueprint run/budget; those gaps are distinct.
- Current text-only AgentTaskInput cannot prove media-aware review; no filename-string substitute.
- Complete documented schema/catalog coverage does not establish live account catalog contents, entitlement, safe tariff, optional website-feature API equivalence or production support. These are explicit unavailable/unknown records, not silently dropped features.

All conflicts and external prerequisites are bounded findings. Research does not wait for host releases or paid probes. [PLATFORM-GAPS.md](PLATFORM-GAPS.md) names current source contracts, confinement audits, owner/action and ready trigger for each dependency.

## Verification and handoff

Authorized command: `node elevenlabs/scripts/check-research.mjs`. Its observable pass condition is exact source/hash/index/OpenAPI/AsyncAPI/model reconciliation, no absent/duplicate IDs or source/schema/default/limit/cost/lifecycle/coverage holes, <=32 finite descriptor families and task-local $0 ledger. It is offline. Exact execution result is recorded in the Worker report after the finished batch.

The research gate is not an implementation test, vendor pricing quote, schema validation proof against a live account, runtime Blueprint proof, media playback proof, published SDK or Iris UI approval. **UNRUN:** all builds, host/native/JS tests, vendor account/live calls, paid tests, real plugin UI, screenshots, media export/playback, Blueprint execution and Scribe selection. Only the authorized offline research gate runs here. Fixture oracles for the future implementation and HIG-11's single final candidate wave are in `contracts.json`; no fixture stub claims media consumption.

The build-oriented research pass is bounded to60 minutes. It delivers the finite source snapshot and explicit API/platform/pricing gaps now; later implementation is the catalog-driven service task. Watt reviews/real-merges the lane. Elgar owns external host releases, Lens reviews them, Iris owns actual UI approval, HIG-11 owns final release/min-host/live acceptance. No publication/tag/deployment authority is exercised here.
