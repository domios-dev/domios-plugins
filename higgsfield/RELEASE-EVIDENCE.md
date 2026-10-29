# Higgsfield package preparation evidence

Date: 2026-10-29. Owner: Cedar, HIG-5 / task_s88b3t. Final integration/acceptance: **HIG-11 / task_3xiri2**. Watt reviews/integrates; Elgar retains the release/ready decision. This document records prepared inputs, not release evidence sufficient for shipping.

## Prepared inputs and assumptions

| Input | Candidate / source fact | Remaining authority |
|---|---|---|
| Identity/version | `higgsfield`; package, plugin and own channel row 0.1.0 | HIG-11 final consistency after all serial root/ElevenLabs edits; other plugin versions preserved |
| Minimum host | Plugin/channel target `1.18.0`, host API 2 | Exact oldest compatible released/installed host **unknown**; not-yet-merged/not-yet-released dependency evidence is not proof |
| SDK | Root package supplies type-only `@codeterm/plugin-sdk` from `file:../codeterm/packages/plugin-sdk`; no invented npm version or new install | Exact merged SDK SHA, published version and native/JS parity **unknown**; HIG-11 must pin actual delivery |
| UI source | `ui/src/main.tsx`; imports reusable `media-shared/ui/src` | Production media adapter/default wiring, compiled final output and Iris final acceptance pending |
| Logic source | `src/commands.ts`, `service.ts`, `adapters.ts`, `contributions.ts`, `blueprint.ts` | `src/plugin.ts` production default entry absent at preparation; HIG-11 supplies actual trusted ports/exports |
| Generated artifacts | `plugin.js` and split hashed `ui/app-*.js` absent; existing `ui/index.html` is a source preview input | HIG-11 alone builds/commits both plugins after all planned edits; no bundle hash invented or generated output hand-edited |
| License/docs/icon | Repository Apache-2.0 copied to `LICENSE`; README/guide/this handoff; native SVG | Icon Iris verdict recorded below; final built candidate remains separate |

Concrete integration issue from source reading: `scripts/build-plugin.mjs` emits `<div id="ct-root">`, while `higgsfield/ui/src/main.tsx` mounts `document.getElementById('root')`. HIG-11 must align the real production mount before its sole final build and prove the stable rendered DOM. No builder/UI source was changed in HIG-5.

## Exact candidate grants and withheld declarations

`plugin.json` carries `view:true`, the exact `studio` surface contribution from `src/contributions.ts` (14 verbs from `src/commands.ts`, agentBound, stateInvalidation, restore relaunch), nine media MIME types accepted by `ui/src/media.ts`, and `copyText`, `saveAs`, `reveal`. These declare candidate needs, not working producers or released SDK support. No `video/ogg`, picker/input declaration or binaryTransfer producer is guessed from newer host source. HIG-11 must reconcile each delivered contract with actual consumer wiring.

Permissions are exactly `network.allow:["api.higgsfield.ai"]`, `secrets:true`, `agentCommands:true`, `surfaces:true`. API origin comes from accepted `RESEARCH.md` and `src/client.ts`; credentials are confined to that origin, redirects/retries refused by the source transport policy. Real output/upload host allowlists remain unknown. No wildcard, example CDN, arbitrary URL, subprocess, project-file, spawn-agent, webhook or broad network grant is added. Manifest permissions do not authorize this task to inspect a secret or call an API.

`graphNodes` is intentionally absent: `src/blueprint.ts` contains source registries using nested JSON Schema, expressly not registerable flat host NodeSchema. All four families and 105 mappings remain intact in source and docs. HIG-11 owns accepted typed descriptor/runtime integration; omission here does not waive full API/node acceptance. The Scribe selectable transcriber path belongs to combined acceptance; Higgsfield does not advertise an invented standalone audio/transcriber implementation.

## Focused evidence and preparation verification

Accepted source proof is recorded in `COMMANDS.md`: correction selector `node --import tsx --test higgsfield/tests/commands.test.ts higgsfield/tests/blueprint.test.ts` raw exit 0, 21 passed / 0 failed / 0 skipped; `node higgsfield/scripts/check-coverage.mjs` raw exit 0, 105 source rows and four negative mutations rejected. Those are historical accepted source results, not runs in this lane. Source selectors and coverage inputs are unchanged by this docs/assets/metadata batch, so they are not repeated. Only coverage is an authorized gate here; it is unnecessary for these unchanged obligations. No new machine check, build, typecheck, full suite, icon gate, install, server, QuickJS or live proof ran.

Preparation review reads package/plugin/channel for version, ID/path, host target, verb and exact-grant consistency; checks the copied license against the repository text and reviews the owned diff for unrelated edits. It does not establish host acceptance of the candidate manifest. No API calls, secret access or paid effects: spent/reserved/unknown **0/0/0** in this task.

## External status and final wave handoff

All of the following remain required under **task_3xiri2**; HIG-5 closes independently of that downstream wave. Current dependency source/drafts are bounded research evidence, with merged/released/installed minimum-host status unknown unless HIG-11 obtains exact proof:

- Concierge f32435fc / A: accepted trusted surface/document context, real child/sidebar placement, actor versus owner/delegation, exact-instance invalidation, autonomous durable reconciliation and result authorization. Candidate source alone does not prove two-agent isolation or restart recovery.
- Courier COD-2024: confined binary acquisition/upload, exact production origins and opaque input producer; current result-ID scope, immutable durable media handoff and exact-frame delivery. Real byte fidelity, limits, MIME/signature, redirects, path/reparse confinement, expiry/revocation and Range/HEAD proof remain pending.
- Iris COD-2025: delivered exact-frame gesture-action signatures, availability/refusals and free saved-file access-token reacquisition. New source presence is not released compatibility proof.
- Loom 4aaf8843 (external task identity pending): closed typed operation schemas, durable callback/run identity, independent exact atomic-unit ceilings, waiting/missing/stale/over-ceiling states, submitting/unknown/restart/no-replay, immutable job identity, durable media/lineage and actual authorized media-aware agent review. Text filenames, frame tokens and fixture reviewer stubs are insufficient; obtain delivered review contract or explicit Elgar disposition.
- Lens review and Elgar merge/release for external host contracts; target next/1.18 is an assumption until exact merge, SDK release, platform parity and installed host evidence exist. Host implementation remains external to this repository.

After **all** planned source/metadata edits (including serial ElevenLabs/root work), HIG-11 must integrate both real production consumers of `media-shared`, finalize both min-host declarations and actual SDK assumptions, resolve the mount mismatch, then run the **only final build per plugin** and commit `plugin.js`, hashed UI and generated index outputs. Then execute its approved combined canonical tests, typecheck, icons, whole API/node coverage, generated-output QuickJS and real-host acceptance wave. This document requests no HIG-5 build or additional selector grant.

Combined live acceptance must prove both plugins' real two-agent child/sidebar/activity/delegation/history isolation and no-refresh updates; real video **with audio**, audio/image playback/preview, seek/range and save/reveal; full API/node coverage with sourced limitations; actual typed Blueprint waiting/unknown/budget/restart/durable-media/lineage/review; Scribe through the existing selectable backend without voice/settings mutation; and Iris **Approved** for every changed UI and final candidate. Required screenshot matrices include 380/760/1280 dark/light, focus, lifecycle/cost states and one run/three jobs/one failure/grouped activity/run link/lineage/waiting. Fixture/source evidence never replaces those gates.

## Main/channel provenance procedure for Watt

Use this repository's README release procedure, not the bundled app's release/tag workflow. Review and real-merge the preparation commit with ancestry preserved. Keep it a preparation lane; do not publish this incomplete package or treat a side-branch SHA as a marketplace head. HIG-11 finishes combined evidence and supplies both independent candidate versions; Elgar decides release/ready.

Only after that decision: merge the reviewed complete candidate into default `main`, push through the authorized publication owner, verify remote default-branch SHA, refresh/diff `codeterm-plugins`, install/update through that channel and inspect installed `.codeterm-install.json` and `plugin.json` for version/channel provenance. Confirm lane tip ancestry before deletion. These are future actions, unrun here; no publication/tag/ready claim is made.

## Icon review

Initial H/ring SVG was corrected to Iris's exact proposed geometry: interrupted crossbar, stroke 2. Request delivery initially failed with retained uncertainty; no blind retry. Watt relayed Elgar's confirmation of NOTWRITTEN and authorized one resend after exact-session credential recovery. That resend at 2026-10-29T09:53:09+02:00 returned `bytes_written:true`, `delivery:sent`, and Iris supplied two numbered corrections, both applied. Iris ea6d7585 then explicitly returned **Approved**, verifying the final file's interrupted crossbar, stroke 2 and path/circle-only content. This is icon source approval only; actual 16px/theme/native host rendering and final built candidate approval remain HIG-11 obligations.
