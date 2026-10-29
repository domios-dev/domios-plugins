"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// higgsfield/src/plugin.ts
var plugin_exports = {};
__export(plugin_exports, {
  default: () => plugin_default
});
module.exports = __toCommonJS(plugin_exports);

// media-shared/src/contracts.ts
function bindingOf(request) {
  return JSON.stringify(request);
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function sameOwner(a, b) {
  return a.owner === b.owner && a.workspace === b.workspace;
}
function visible(scope, job) {
  return sameOwner(scope, job.scope) && (scope.human || scope.actorId === job.scope.actorId && scope.runId === job.scope.runId);
}
function sameIntent(scope, job) {
  return sameOwner(scope, job.scope) && scope.actorId === job.scope.actorId && scope.runId === job.scope.runId;
}

// media-shared/src/cost.ts
function validAmount(value) {
  return ["usd_micro", "credit_milli", "characters"].includes(value.unit) && Number.isSafeInteger(value.amount) && value.amount >= 0;
}
function quoteState(quote, binding, unit, now) {
  if (!Number.isFinite(now) || !quote || !validAmount(quote) || quote.unit !== unit || quote.binding !== binding || quote.safe !== true || !quote.basis || !quote.tariffRevision || !Number.isFinite(quote.issuedAt) || !Number.isFinite(quote.validUntilMs) || quote.issuedAt > now || quote.validUntilMs <= quote.issuedAt) return "unavailable";
  return now >= quote.validUntilMs ? "stale" : "ready";
}
function totals(jobs, runId) {
  const result = { spent: {}, reserved: {}, unknown: 0 };
  for (const job of jobs.filter((j) => j.scope.runId === runId)) {
    if (job.accounting === "unknown") result.unknown++;
    if (!job.reservation || !job.accounting) continue;
    const bucket = job.accounting === "spent" ? result.spent : result.reserved;
    const sum = (bucket[job.reservation.unit] ?? 0) + job.reservation.amount;
    if (!Number.isSafeInteger(sum)) throw new Error("unsafe_ledger");
    bucket[job.reservation.unit] = sum;
  }
  return result;
}
function waitReason(data, job, now) {
  const state = quoteState(job.quote, job.binding, job.request.unit, now);
  if (state !== "ready") return state === "stale" ? "price_stale" : "price_unavailable";
  const ledger = totals(data.jobs.filter((j) => j !== job), job.scope.runId);
  if (ledger.unknown) return "unknown_reservation";
  const price = job.quote;
  if (!job.approval || !validAmount(job.approval) || job.approval.unit !== price.unit || job.approval.amount < price.amount)
    return "owner_confirmation";
  const ceiling = data.ceilings[price.unit];
  const projected = (ledger.spent[price.unit] ?? 0) + (ledger.reserved[price.unit] ?? 0) + price.amount;
  if (!Number.isSafeInteger(projected)) return "ceiling";
  if (!job.ceilingException && (ceiling === void 0 || !Number.isSafeInteger(ceiling) || ceiling < 0 || projected > ceiling)) return "ceiling";
  return void 0;
}

// media-shared/src/core.ts
var MediaCore = class {
  constructor(store, now, maxHistory, kind, validate) {
    this.store = store;
    this.now = now;
    this.maxHistory = maxHistory;
    this.kind = kind;
    this.validate = validate;
    if (!Number.isSafeInteger(maxHistory) || maxHistory < 1) throw new Error("invalid_bounds");
  }
  transaction(owner, workspace, edit) {
    const result = this.store.transact(owner, workspace, edit);
    if (result && typeof result.then === "function") throw new Error("synchronous_storage_required");
    return clone(result);
  }
  authorize(access) {
    if (access.current !== true || !access.scope.owner || !access.scope.workspace || !access.scope.actorId) throw new Error("stale_authority");
  }
  owned(d, access, id2) {
    const job = d.jobs.find((j) => j.id === id2 && visible(access.scope, j));
    if (!job) throw new Error("job_unavailable");
    return job;
  }
  token(job) {
    job.epoch = (job.epoch ?? 0) + 1;
    return { owner: job.scope.owner, workspace: job.scope.workspace, id: job.id, binding: job.binding, epoch: job.epoch };
  }
  continued(token, edit) {
    return this.transaction(token.owner, token.workspace, (d) => {
      const job = d.jobs.find((j) => j.id === token.id);
      if (!job || job.binding !== token.binding || job.epoch !== token.epoch) throw new Error("stale_continuation");
      const result = edit(d, job);
      job.updatedAt = this.now();
      return result;
    });
  }
  resumeAuthority(access, token, inputs = false) {
    if (access.scope.owner !== token.owner || access.scope.workspace !== token.workspace) throw new Error("job_unavailable");
    this.continued(token, (d) => {
      this.owned(d, access, token.id);
      return true;
    });
    if (access.current !== true || inputs && access.inputsAuthorized !== true) {
      this.releasePreflight(token);
      throw new Error(access.current !== true ? "stale_authority" : "input_unavailable");
    }
  }
  history(access) {
    this.authorize(access);
    return this.transaction(access.scope.owner, access.scope.workspace, (d) => d.jobs.filter((j) => visible(access.scope, j)).slice(-this.maxHistory));
  }
  intent(access, id2, request) {
    this.authorize(access);
    if (!id2 || id2.length > 255 || !["usd_micro", "credit_milli", "characters"].includes(request.unit) || !Array.isArray(request.inputs) || request.inputs.some((ref) => !["artifact", "run-media"].includes(ref.kind))) throw new Error("invalid_request");
    if (request.inputs.length && access.inputsAuthorized !== true) throw new Error("input_unavailable");
    const immutable = clone(request);
    if (this.validate(immutable) !== true) throw new Error("invalid_request");
    const binding = bindingOf(immutable);
    return this.transaction(access.scope.owner, access.scope.workspace, (d) => {
      const prior = d.jobs.find((j) => j.id === id2);
      if (prior) {
        if (!sameIntent(access.scope, prior) || prior.binding !== binding) throw new Error("intent_conflict");
        return prior;
      }
      if (d.jobs.length >= this.maxHistory) throw new Error("history_capacity");
      const at = this.now();
      const job = {
        id: id2,
        scope: clone(access.scope),
        request: immutable,
        binding,
        at,
        updatedAt: at,
        state: "waiting",
        waitReason: "price_unavailable",
        outputs: []
      };
      d.jobs.push(job);
      return job;
    });
  }
  beginEstimate(access, id2, available) {
    this.authorize(access);
    if (!available) throw new Error("estimate_unavailable");
    return this.transaction(access.scope.owner, access.scope.workspace, (d) => {
      const job = this.owned(d, access, id2);
      if (job.state !== "waiting" || job.lease) throw new Error("intent_busy");
      job.lease = "estimate";
      job.quote = void 0;
      job.approval = void 0;
      job.ceilingException = void 0;
      job.waitReason = "price_unavailable";
      return { job, continuation: this.token(job) };
    });
  }
  estimated(access, token, quote) {
    this.authorize(access);
    return this.continued(token, (d, job) => {
      this.owned(d, access, token.id);
      if (job.state !== "waiting" || job.lease !== "estimate" || bindingOf(job.request) !== token.binding) throw new Error("stale_estimate");
      job.quote = quote ? clone(quote) : void 0;
      job.lease = void 0;
      job.approval = void 0;
      job.ceilingException = void 0;
      job.waitReason = waitReason(d, job, this.now());
      return job;
    });
  }
  estimateFailed(token) {
    return this.continued(token, (_d, job) => {
      if (job.lease !== "estimate") throw new Error("stale_continuation");
      job.lease = void 0;
      return job;
    });
  }
  approve(access, id2, maximum, ceilingException = false) {
    this.authorize(access);
    if (!access.scope.human || !validAmount(maximum)) throw new Error("owner_approval_required");
    return this.transaction(access.scope.owner, access.scope.workspace, (d) => {
      const job = this.owned(d, access, id2);
      if (job.state !== "waiting" || job.lease || quoteState(job.quote, job.binding, job.request.unit, this.now()) !== "ready" || maximum.unit !== job.quote.unit || maximum.amount < job.quote.amount) throw new Error("price_not_approvable");
      job.approval = clone(maximum);
      job.ceilingException = ceilingException;
      job.waitReason = waitReason(d, job, this.now());
      return job;
    });
  }
  beginStart(access, id2, outputAvailable) {
    this.authorize(access);
    return this.transaction(access.scope.owner, access.scope.workspace, (d) => {
      const job = this.owned(d, access, id2);
      if (job.state !== "waiting") return { job };
      if (job.lease) throw new Error("intent_busy");
      job.waitReason = waitReason(d, job, this.now());
      if (job.waitReason) return { job };
      if (!outputAvailable) throw new Error("output_storage_unavailable");
      job.state = "starting";
      job.phase = "preflight";
      job.lease = "preflight";
      return { job, continuation: this.token(job) };
    });
  }
  reserve(access, token) {
    this.resumeAuthority(access, token, true);
    return this.continued(token, (d, job) => {
      if (job.phase !== "preflight" || job.lease !== "preflight" || bindingOf(job.request) !== token.binding) throw new Error("intent_conflict");
      job.waitReason = waitReason(d, job, this.now());
      if (job.waitReason) return this.waiting(job);
      job.reservation = { amount: job.quote.amount, unit: job.quote.unit };
      job.accounting = "reserved";
      job.phase = "reserved";
      job.lease = void 0;
      return job;
    });
  }
  /** Called synchronously at the host's last authorized boundary; returned action is dispatched without awaiting. */
  enter(access, token) {
    this.resumeAuthority(access, token, true);
    return this.continued(token, (d, job) => {
      if (job.phase !== "reserved" || bindingOf(job.request) !== token.binding) throw new Error("intent_conflict");
      job.waitReason = waitReason(d, job, this.now());
      if (job.waitReason) return { job: this.waiting(job) };
      job.phase = "submitting";
      if (this.kind === "stream") job.state = "generating";
      return { job, action: { kind: this.kind, intentId: job.id, request: job.request, continuation: token } };
    });
  }
  waiting(job) {
    job.state = "waiting";
    job.phase = void 0;
    job.lease = void 0;
    job.reservation = void 0;
    job.accounting = void 0;
    return job;
  }
  releasePreflight(token) {
    return this.continued(token, (d, job) => {
      if (job.state === "waiting" && !job.phase) return job;
      if (!["preflight", "reserved"].includes(job.phase ?? "")) throw new Error("effect_already_entered");
      this.waiting(job);
      job.waitReason = waitReason(d, job, this.now());
      return job;
    });
  }
  /** HOST receipt path: durable effect evidence must survive expiry of the initiating UI authority. */
  unknown(token) {
    return this.continued(token, (_d, job) => {
      if (!["submitting", "receipt"].includes(job.phase ?? "") && job.lease !== "reconcile" && job.lease !== "cancel") throw new Error("effect_not_entered");
      job.state = "unknown";
      job.accounting = "unknown";
      job.phase = void 0;
      job.lease = void 0;
      return job;
    });
  }
  observation(token, receipt2, deferFinish = false) {
    return this.continued(token, (_d, job) => {
      if (job.phase !== "submitting" && job.lease !== "reconcile") throw new Error("effect_not_entered");
      if (!receipt2.jobId || job.jobId && job.jobId !== receipt2.jobId) {
        job.state = "unknown";
        job.accounting = "unknown";
        job.phase = void 0;
        job.lease = void 0;
        return { job, saveOutputs: false };
      }
      job.jobId = receipt2.jobId;
      const { jobId: _id, ...header } = receipt2;
      job.pendingReceipt = clone(header);
      job.phase = "receipt";
      if (receipt2.state !== "generated" && !deferFinish) this.finish(job, []);
      return { job, saveOutputs: receipt2.state === "generated" };
    });
  }
  beginOutput(token) {
    return this.continued(token, (_d, job) => {
      if (job.phase !== "submitting" || this.kind === "async") throw new Error("effect_not_entered");
      job.phase = "receipt";
      return job;
    });
  }
  complete(token, artifacts) {
    return this.continued(token, (_d, job) => {
      const outputsRequired = !job.pendingReceipt || job.pendingReceipt.state === "generated";
      if (job.phase !== "receipt" || outputsRequired && !artifacts.length || !outputsRequired && artifacts.length > 0 || artifacts.length > 64 || artifacts.some((a) => a.kind !== "artifact" || !a.id || !a.contentType)) throw new Error("invalid_outputs");
      this.finish(job, artifacts);
      return job;
    });
  }
  finish(job, artifacts) {
    const receipt2 = job.pendingReceipt;
    job.state = receipt2?.state ?? "generated";
    job.outputs = clone(artifacts);
    job.providerState = receipt2?.providerState;
    const progress = receipt2?.progress;
    job.progress = typeof progress === "number" && Number.isFinite(progress) && progress >= 0 && progress <= 1 ? progress : void 0;
    if (receipt2?.charged && validAmount(receipt2.charged) && receipt2.charged.unit === job.request.unit) {
      job.reservation = clone(receipt2.charged);
      job.accounting = "spent";
    }
    job.phase = void 0;
    job.lease = void 0;
    job.pendingReceipt = void 0;
    if (["generated", "failed", "canceled"].includes(job.state)) job.cancelRequested = false;
  }
  beginReconcile(access, id2) {
    this.authorize(access);
    if (this.kind !== "async") throw new Error("reconcile_unavailable");
    return this.transaction(access.scope.owner, access.scope.workspace, (d) => {
      const job = this.owned(d, access, id2);
      if (!job.jobId || job.lease || job.state === "starting") throw new Error("reconcile_unavailable");
      job.lease = "reconcile";
      return { job, continuation: this.token(job) };
    });
  }
  beginCancel(access, id2, capabilities) {
    this.authorize(access);
    if (this.kind !== "async" || !capabilities) throw new Error("cancel_unavailable");
    return this.transaction(access.scope.owner, access.scope.workspace, (d) => {
      const job = this.owned(d, access, id2);
      if (!job.jobId || job.lease || job.cancelRequested || !(job.state === "queued" && capabilities.queued || job.state === "generating" && capabilities.running)) throw new Error("cancel_unavailable");
      job.cancelRequested = true;
      job.lease = "cancel";
      return { job, continuation: this.token(job) };
    });
  }
  recover(access) {
    this.authorize(access);
    return this.transaction(access.scope.owner, access.scope.workspace, (d) => {
      for (const job of d.jobs.filter((j) => visible(access.scope, j))) {
        if (job.phase === "preflight" || job.phase === "reserved" || job.lease === "preflight") {
          this.waiting(job);
          job.waitReason = waitReason(d, job, this.now());
          job.epoch = (job.epoch ?? 0) + 1;
        } else if (job.phase || job.state === "starting" || job.state === "generating" && !job.jobId || job.lease === "reconcile" || job.lease === "cancel") {
          job.state = "unknown";
          job.accounting = "unknown";
          job.phase = void 0;
          job.pendingReceipt = void 0;
          job.epoch = (job.epoch ?? 0) + 1;
        }
        if (job.lease === "estimate") job.epoch = (job.epoch ?? 0) + 1;
        job.lease = void 0;
      }
      return d.jobs.filter((j) => visible(access.scope, j));
    });
  }
};

// higgsfield/models.json
var models_default = {
  snapshotDate: "2026-10-29",
  models: [
    {
      id: "higgsfield/ads-studio/v1.0",
      title: "Ads Studio \u2014 Generate ads API",
      category: "image",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/ads-studio/generate.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:57.637763+00:00",
        snapshot: "evidence/docs-models__ads-studio__generate.md",
        sha256: "89519aa4f76664cc5e0d03fc5ba58c0defbce09d5663c66412ccd367512f9436"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/higgsfield/ads-studio/v1.0",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        required: [
          "prompt"
        ],
        properties: {
          niche: {
            type: "string",
            default: "",
            maxLength: 1e3
          },
          prompt: {
            type: "string",
            pattern: "\\S",
            maxLength: 8e3,
            minLength: 1
          },
          language: {
            type: "string",
            default: "",
            maxLength: 80
          },
          batch_size: {
            type: "integer",
            default: 1,
            maximum: 8,
            minimum: 1
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              pattern: "^https?://",
              maxLength: 8192,
              minLength: 1
            },
            default: [],
            maxItems: 10
          },
          aspect_ratio: {
            enum: [
              "1:1",
              "4:5",
              "5:4",
              "16:9",
              "9:16",
              "4:3",
              "3:4",
              "21:9",
              "3:2",
              "2:3",
              "2:1",
              "1:2",
              "3:1",
              "1:3"
            ],
            type: "string",
            default: "1:1"
          },
          target_audience: {
            type: "string",
            default: "",
            maxLength: 2e3
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "niche",
        "prompt",
        "language",
        "batch_size",
        "image_urls",
        "aspect_ratio",
        "target_audience"
      ],
      usageNotes: "* Submit one request with your brief. Ad concepts are prepared automatically, then rendered as images; no separate preparation or generate call is required.\n* batch\\_size selects 1\u20138 ad concepts. Each concept produces one image, so a fully successful batch returns batch\\_size images.\n* Rendering uses GPT Image 2.5 Flare with fixed 2k resolution and high quality. Exact dimensions depend on aspect\\_ratio. quality, resolution, renderer and fallback model are not public inputs.\n* All outputs in a batch use the requested aspect\\_ratio. Omitting it selects 1:1. The value auto is not supported.\n* Set HF\\_API\\_KEY\\_ID and HF\\_API\\_KEY\\_SECRET to your API credentials. Set a unique IDEMPOTENCY\\_KEY for each intended generation; reuse it only when retrying that same request.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "image",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns one request handle for the entire batch:\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA fully successful two-image batch returns two indexed images:\n\n```json Completed theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel",\n  "status": "completed",\n  "images": [\n    {"index": 0, "url": "https://example.com/ad-1.png"},\n    {"index": 1, "url": "https://example.com/ad-2.png"}\n  ],\n  "errors": []\n}\n```\n\nProcess every returned image rather than only `images[0]`. Use its zero-based `index` to identify its batch slot and inspect `errors` for unsuccessful slots. After `subscribe` returns, extend the Python quick start with:\n\n```python theme={"theme":{"light":"github-light","dark":"github-dark"}}\nfor image in result.get("images", []):\n    print(image["index"], image["url"])\nfor error in result.get("errors", []):\n    print(error)\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/ads-studio/generate.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:57.637763+00:00",
          snapshot: "evidence/docs-models__ads-studio__generate.md",
          sha256: "89519aa4f76664cc5e0d03fc5ba58c0defbce09d5663c66412ccd367512f9436"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [
        "Console generic template says Authorization: Bearer while shared docs use Key pair; generic template is not current full schema/auth proof. Vendor clarification required."
      ],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "image",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/higgsfield/ads-studio/v1.0/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-7ba35a60ded4.txt",
        sha256: "06bba894fe0ffde22af54ae33a7e1f1d81eab8d859bb76cd40d7e3f0a9bad79c"
      },
      consoleObservation: "reference captured",
      consoleSchemaStatus: "parameter-table-not-present; docs schema retained as dated documentation only",
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "higgsfield/cinema-studio/4.0",
      title: "Cinema Studio 4.0 \u2014 Generate API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/cinema-studio-4/generate.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:58.836831+00:00",
        snapshot: "evidence/docs-models__cinema-studio-4__generate.md",
        sha256: "f30c51a0624568cfad94a7dc1f6a4b327c48764d9cdcaf1c6ec4a6efcde78990"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/higgsfield/cinema-studio/4.0",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        required: [
          "prompt"
        ],
        properties: {
          era: {
            enum: [
              "1960s",
              "1980s",
              "1990s",
              "2000s",
              "2020s"
            ],
            type: "string"
          },
          genre: {
            enum: [
              "epic",
              "drama",
              "noir",
              "comedy",
              "horror",
              "action"
            ],
            type: "string"
          },
          light: {
            enum: [
              "silhouette",
              "practicals",
              "window",
              "overhead-fall",
              "contre-jour",
              "soft-cross"
            ],
            type: "string"
          },
          pacing: {
            enum: [
              "chaotic",
              "dynamic",
              "calm",
              "single-shot"
            ],
            type: "string"
          },
          prompt: {
            type: "string",
            pattern: "\\S",
            minLength: 1
          },
          duration: {
            type: "integer",
            default: 5,
            maximum: 30,
            minimum: 4
          },
          audio_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            maxItems: 10
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            maxItems: 30
          },
          resolution: {
            enum: [
              "480p",
              "720p"
            ],
            type: "string",
            default: "720p"
          },
          video_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            maxItems: 10
          },
          camera_lens: {
            enum: [
              "clean-sharp",
              "anamorphic",
              "vintage-anamorphic",
              "warm-vintage",
              "halation-vintage"
            ],
            type: "string"
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "4:3",
              "1:1",
              "3:4",
              "9:16",
              "21:9"
            ],
            type: "string",
            default: "16:9"
          },
          camera_model: {
            enum: [
              "modern",
              "35mm-film",
              "8mm-film",
              "dv-camcorder"
            ],
            type: "string"
          },
          color_palette: {
            enum: [
              "static-noon",
              "twilight-fable",
              "back-row-kissing-seats",
              "on-the-other-side-of-the-porthole",
              "the-emerald-ambush",
              "highway-standoff",
              "the-faded-fresco",
              "oil-ochre",
              "the-mountain-convent",
              "ghost-in-the-code",
              "pink-velvet",
              "two-days-to-the-horizon",
              "industrial-fog",
              "stairs-go-up",
              "field-post",
              "home-is-the-next-gas-station",
              "glossy-flesh",
              "the-crimson-ballet",
              "neon-rain-at-midnight",
              "the-morning-after-rain",
              "the-iron-borough",
              "the-ground",
              "the-investigation",
              "turquoise-mirage",
              "a-dream-in-color",
              "breakfast-on-schedule",
              "favela-gold",
              "a-hotel-for-one",
              "after-dark",
              "crimson-vigi",
              "the-neighbors-saw-everything",
              "the-grey-channel",
              "mirage-at-noon",
              "bubblegum-boulevard",
              "yellow-room",
              "the-earth-keeps-things-reluctantly",
              "tropic-fever-dream",
              "bioluminescent-night",
              "dont-turn-it-off-im-watching",
              "the-silk-curtain-falls",
              "the-butterfly",
              "playtime",
              "wallpaper-romance",
              "overtime",
              "the-way-home-is-longer",
              "everyone-speaks-in-whispers",
              "runaway-summer",
              "amber-wasteland",
              "the-circus",
              "gasoline-sunset"
            ],
            type: "string"
          },
          generate_audio: {
            type: "boolean",
            default: true
          },
          camera_aperture: {
            enum: [
              "f14-wide-open",
              "f4-moderate",
              "f11-deep-focus"
            ],
            type: "string"
          },
          camera_movement: {
            enum: [
              "snorricam",
              "robot-arm",
              "tilt-up",
              "rack-focus",
              "tilt-down",
              "pov",
              "pan-left",
              "crane-up",
              "pan-right",
              "crane-down",
              "side-tracking",
              "pedestal-up",
              "pedestal-down",
              "handheld",
              "tracking",
              "drone-orbit",
              "dolly-zoom",
              "aerial-pullback",
              "static-shot",
              "bullet-time",
              "whip-pan",
              "slow-zoom-in",
              "arc-left",
              "slow-zoom-out",
              "arc-right",
              "truck-right",
              "dolly-in",
              "truck-left",
              "dolly-out",
              "slider-right",
              "crush-zoom",
              "slider-left",
              "helicopter-shot"
            ],
            type: "string"
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "era",
        "genre",
        "light",
        "pacing",
        "prompt",
        "duration",
        "audio_urls",
        "image_urls",
        "resolution",
        "video_urls",
        "camera_lens",
        "aspect_ratio",
        "camera_model",
        "color_palette",
        "generate_audio",
        "camera_aperture",
        "camera_movement"
      ],
      usageNotes: '* This is the public Cinema Studio 4.0 workflow. It uses text-to-video when references are absent and reference-to-video when any media array is nonempty.\n* Omit creative-control fields to let the director choose them automatically; the literal value "auto" is not accepted for these enum fields.\n* Optional prompt references use one-based tokens such as \\<\\<\\<image\\_1>>>, \\<\\<\\<video\\_1>>> and \\<\\<\\<audio\\_1>>>. Each token must refer to an attached item of the same media type.\n* This endpoint produces a new video. Editing and extension use the separate Seedance 2.5 endpoints.\n* Reference media are limited to 30 images, 10 videos and 10 audio files, with at most 50 items total. Video and audio may be normalized to separate 30-second total budgets.',
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/cinema-studio-4/generate.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:58.836831+00:00",
          snapshot: "evidence/docs-models__cinema-studio-4__generate.md",
          sha256: "f30c51a0624568cfad94a7dc1f6a4b327c48764d9cdcaf1c6ec4a6efcde78990"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [
        "Console generic template says Authorization: Bearer while shared docs use Key pair; generic template is not current full schema/auth proof. Vendor clarification required."
      ],
      nativeAudio: {
        inputFields: {
          audio_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            maxItems: 10
          }
        },
        controlFields: {
          generate_audio: {
            type: "boolean",
            default: true
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: '* This is the public Cinema Studio 4.0 workflow. It uses text-to-video when references are absent and reference-to-video when any media array is nonempty.\n* Omit creative-control fields to let the director choose them automatically; the literal value "auto" is not accepted for these enum fields.\n* Optional prompt references use one-based tokens such as \\<\\<\\<image\\_1>>>, \\<\\<\\<video\\_1>>> and \\<\\<\\<audio\\_1>>>. Each token must refer to an attached item of the same media type.\n* This endpoint produces a new video. Editing and extension use the separate Seedance 2.5 endpoints.\n* Reference media are limited to 30 images, 10 videos and 10 audio files, with at most 50 items total. Video and audio may be normalized to separate 30-second total budgets.'
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/higgsfield/cinema-studio/4.0/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-06805306f62e.txt",
        sha256: "e3f060fa9c4d9d8a8bcd18a2260598d2d98a3f7b0415081786e06433918a5989"
      },
      consoleObservation: "reference captured",
      consoleSchemaStatus: "parameter-table-not-present; docs schema retained as dated documentation only",
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "higgsfield/genjutsu/motion-transfer/v1.0",
      title: "Genjutsu \u2014 Motion transfer API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/genjutsu/motion-transfer.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:57.236563+00:00",
        snapshot: "evidence/docs-models__genjutsu__motion-transfer.md",
        sha256: "9157437a523dfcc39af2d0d79a8941d9e97a9d65be381f0bf470b222610064e4"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/higgsfield/genjutsu/motion-transfer/v1.0",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "MotionTransferParams",
        required: [
          "video_url",
          "image_urls"
        ],
        properties: {
          prompt: {
            type: "string",
            title: "Prompt",
            default: "",
            maxLength: 1e4
          },
          video_url: {
            type: "string",
            title: "Video Url",
            format: "uri",
            maxLength: 2083,
            minLength: 1
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri",
              maxLength: 2083,
              minLength: 1
            },
            title: "Image Urls",
            maxItems: 8,
            minItems: 1
          },
          resolution: {
            enum: [
              "720p",
              "480p",
              "1080p"
            ],
            type: "string",
            title: "Resolution",
            default: "720p"
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "prompt",
        "video_url",
        "image_urls",
        "resolution"
      ],
      usageNotes: "* Use higgsfield/genjutsu/motion-transfer/v1.0 for new integrations. The legacy endpoint higgsfiled/genjutsu/motion-transfer/v1.0 remains callable for existing clients but is hidden from model discovery.\n* The source video must be at least 4 seconds. Videos longer than 30 seconds are trimmed to 30 seconds; output duration follows the prepared source video.\n* Provide 1\u20138 image references. The prompt is optional and defaults to an empty string.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/genjutsu/motion-transfer.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:57.236563+00:00",
          snapshot: "evidence/docs-models__genjutsu__motion-transfer.md",
          sha256: "9157437a523dfcc39af2d0d79a8941d9e97a9d65be381f0bf470b222610064e4"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/higgsfield/genjutsu/motion-transfer/v1.0/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-b26743c8299c.txt",
        sha256: "d0037548ef174374dee479d890aea0a56ed35eed2e861abfbb3b620188786fa3"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	No	""	Prompt. Maximum length: 10000.\nvideo_url	string	Yes	\u2014	Video Url. Minimum length: 1. Maximum length: 2083.\nimage_urls	array[string]	Yes	\u2014	Image Urls.\nresolution	string	No	"720p"	Resolution. Options: 720p, 480p, 1080p.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "higgsfield/genjutsu/object-swap/v1.0",
      title: "Genjutsu \u2014 Object swap API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/genjutsu/object-swap.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:58.852094+00:00",
        snapshot: "evidence/docs-models__genjutsu__object-swap.md",
        sha256: "1300eb34fecef1d772923fe204630374cabe4c8f758715e03f61be04aa8c09c0"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/higgsfield/genjutsu/object-swap/v1.0",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "ObjectSwapParams",
        required: [
          "video_url",
          "image_urls"
        ],
        properties: {
          prompt: {
            type: "string",
            title: "Prompt",
            default: "",
            maxLength: 1e4
          },
          video_url: {
            type: "string",
            title: "Video Url",
            format: "uri",
            maxLength: 2083,
            minLength: 1
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri",
              maxLength: 2083,
              minLength: 1
            },
            title: "Image Urls",
            maxItems: 8,
            minItems: 1
          },
          resolution: {
            enum: [
              "720p",
              "480p",
              "1080p"
            ],
            type: "string",
            title: "Resolution",
            default: "720p"
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "prompt",
        "video_url",
        "image_urls",
        "resolution"
      ],
      usageNotes: "* Use higgsfield/genjutsu/object-swap/v1.0 for new integrations. The legacy endpoint higgsfiled/genjutsu/object-swap/v1.0 remains callable for existing clients but is hidden from model discovery.\n* The source video must be at least 4 seconds. Videos longer than 30 seconds are trimmed to 30 seconds; output duration follows the prepared source video.\n* Provide 1\u20138 image references. The prompt is optional and defaults to an empty string.\n* The source video must contain at least 409,600 pixels per frame (width \xD7 height).",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/genjutsu/object-swap.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:58.852094+00:00",
          snapshot: "evidence/docs-models__genjutsu__object-swap.md",
          sha256: "1300eb34fecef1d772923fe204630374cabe4c8f758715e03f61be04aa8c09c0"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/higgsfield/genjutsu/object-swap/v1.0/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-6282d9ccdad0.txt",
        sha256: "3871cdd93692694abe0d6a05738a5e05e9d37ec232bedb76a7b72b81b9430997"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	No	""	Prompt. Maximum length: 10000.\nvideo_url	string	Yes	\u2014	Video Url. Minimum length: 1. Maximum length: 2083.\nimage_urls	array[string]	Yes	\u2014	Image Urls.\nresolution	string	No	"720p"	Resolution. Options: 720p, 480p, 1080p.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "higgsfield/genjutsu/restyle/v1.0",
      title: "Genjutsu \u2014 Restyle API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/genjutsu/restyle.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:57.201543+00:00",
        snapshot: "evidence/docs-models__genjutsu__restyle.md",
        sha256: "52ffdd8900780fea190fd3d13aa8fceb1fb5e6f2e4d272d7cf7dd6f664e783e8"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/higgsfield/genjutsu/restyle/v1.0",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Genjutsu Restyle",
        required: [
          "video_url",
          "preset_id"
        ],
        properties: {
          prompt: {
            type: "string",
            title: "Prompt",
            default: "",
            maxLength: 1e4
          },
          preset_id: {
            type: "string",
            title: "Style preset",
            format: "uuid"
          },
          video_url: {
            type: "string",
            title: "Source video",
            format: "uri",
            minLength: 1,
            description: "Source video, 4\u201330 seconds. Longer videos are trimmed to 30 seconds."
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri",
              minLength: 1
            },
            title: "Character images",
            default: [],
            maxItems: 5,
            description: "Optional character references. Leave empty to restyle the source frame."
          },
          resolution: {
            enum: [
              "480p",
              "720p",
              "1080p"
            ],
            type: "string",
            title: "Resolution",
            default: "720p"
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "prompt",
        "preset_id",
        "video_url",
        "image_urls",
        "resolution"
      ],
      usageNotes: "* Restyle changes the visual style of a source video while retaining its motion, shot composition, and source audio. Each request produces one video.\n* Select a current style from GET /models/higgsfield/genjutsu/restyle/v1.0/presets and send its UUID as preset\\_id. The example UUID below is illustrative of a published preset; fetch the current catalog before submitting.\n* The source must be at least 4 seconds and no larger than 200 MiB. Videos longer than 30 seconds are trimmed to their first 30 seconds, including audio.\n* Character references are optional: omit image\\_urls or send \\[] to restyle the existing source subjects. Supply up to 5 character images to guide their appearance.\n* Defaults apply to omitted optional fields. Use \\[] or an empty string where appropriate; null is not accepted.\n* Output framing is derived from the source and animation cadence can depend on the selected style. Exact output duration and FPS may differ from the source.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/genjutsu/restyle.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:57.201543+00:00",
          snapshot: "evidence/docs-models__genjutsu__restyle.md",
          sha256: "52ffdd8900780fea190fd3d13aa8fceb1fb5e6f2e4d272d7cf7dd6f664e783e8"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        indicativeRates: {
          "480p": "0.318",
          "720p": "0.681",
          "1080p": "1.632"
        },
        rateUnit: "USD per source-video second rounded up after <=30s trim",
        priceSource: "https://docs.higgsfield.ai/docs/models/genjutsu/restyle.md",
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          indicativeRates: {
            "480p": "0.318",
            "720p": "0.681",
            "1080p": "1.632"
          },
          rateUnit: "USD per source-video second rounded up after <=30s trim",
          priceSource: "https://docs.higgsfield.ai/docs/models/genjutsu/restyle.md",
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* Restyle changes the visual style of a source video while retaining its motion, shot composition, and source audio. Each request produces one video.\n* Select a current style from GET /models/higgsfield/genjutsu/restyle/v1.0/presets and send its UUID as preset\\_id. The example UUID below is illustrative of a published preset; fetch the current catalog before submitting.\n* The source must be at least 4 seconds and no larger than 200 MiB. Videos longer than 30 seconds are trimmed to their first 30 seconds, including audio.\n* Character references are optional: omit image\\_urls or send \\[] to restyle the existing source subjects. Supply up to 5 character images to guide their appearance.\n* Defaults apply to omitted optional fields. Use \\[] or an empty string where appropriate; null is not accepted.\n* Output framing is derived from the source and animation cadence can depend on the selected style. Exact output duration and FPS may differ from the source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/higgsfield/genjutsu/restyle/v1.0/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-c04601ce6070.txt",
        sha256: "06b2e9b7909c806528d24ec3b4dd491bb0b4d209c19a5b0e89b0a1eed3895f43"
      },
      consoleObservation: "reference captured",
      consoleSchemaStatus: "parameter-table-not-present; docs schema retained as dated documentation only",
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "xai/grok-imagine-image-2.0",
      title: "Grok Image 2.0 \u2014 Generate and edit API",
      category: "image",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/grok-image-2/generate-and-edit.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:58.848570+00:00",
        snapshot: "evidence/docs-models__grok-image-2__generate-and-edit.md",
        sha256: "02423f33cbd0f90d00784778c4e66b951339f06210dc20c2e70e04ee1fed46ae"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/xai/grok-imagine-image-2.0",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Grok Imagine 2.0 Playground",
        required: [
          "prompt"
        ],
        properties: {
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          quality: {
            enum: [
              "low",
              "medium"
            ],
            type: "string",
            title: "Quality",
            default: "medium"
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              title: "Image",
              format: "uri"
            },
            title: "Input Images",
            maxItems: 10,
            minItems: 0
          },
          resolution: {
            enum: [
              "1k",
              "2k"
            ],
            type: "string",
            title: "Resolution",
            default: "1k"
          },
          aspect_ratio: {
            enum: [
              "auto",
              "1:1",
              "1:2",
              "2:1",
              "3:2",
              "2:3",
              "4:3",
              "3:4",
              "16:9",
              "9:16"
            ],
            type: "string",
            default: "auto"
          }
        }
      },
      parameterNames: [
        "prompt",
        "quality",
        "image_urls",
        "resolution",
        "aspect_ratio"
      ],
      usageNotes: "* Supports both text-to-image and editing: omit image\\_urls for generation, or supply up to 10 references for editing.\n* quality accepts low or medium only; resolution accepts 1k or 2k. aspect\\_ratio defaults to auto.\n* Reference images may be resized during preprocessing before submission. The request produces one image; no batch count is declared.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "image",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "images": [\n    {\n      "url": "https://example.com/output.png"\n    }\n  ]\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/grok-image-2/generate-and-edit.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:58.848570+00:00",
          snapshot: "evidence/docs-models__grok-image-2__generate-and-edit.md",
          sha256: "02423f33cbd0f90d00784778c4e66b951339f06210dc20c2e70e04ee1fed46ae"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "image",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/xai/grok-imagine-image-2.0/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-cd71548a1b9f.txt",
        sha256: "34ff6520195048eb1c7cfde2502031a7816ba3df14ed4c6c8921d93892a81915"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	Yes	\u2014	Prompt.\nquality	string	No	"medium"	Quality. Options: low, medium.\nimage_urls	array[string]	No	\u2014	Input Images.\nresolution	string	No	"1k"	Resolution. Options: 1k, 2k.\naspect_ratio	string	No	"auto"	Options: auto, 1:1, 1:2, 2:1, 3:2, 2:3, 4:3, 3:4, 16:9, 9:16.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "xai/grok-imagine-video/v1.5/reference-to-video",
      title: "Grok Imagine Video 1.5 \u2014 Reference to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/grok-video-1-5/reference-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:05.790664+00:00",
        snapshot: "evidence/docs-models__grok-video-1-5__reference-to-video.md",
        sha256: "3a98b775ee24f349451dd0a223b76ed9e16619ff45849f600acd6e3ff92bff56"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/xai/grok-imagine-video/v1.5/reference-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Grok Imagine Video 1.5 Reference Playground",
        required: [
          "prompt"
        ],
        properties: {
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 15,
            minimum: 1
          },
          audio_url: {
            type: "string",
            title: "Reference audio",
            format: "uri"
          },
          image_url: {
            type: "string",
            title: "First-frame image",
            format: "uri"
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              title: "Image",
              format: "uri"
            },
            title: "Reference images",
            maxItems: 7,
            minItems: 0
          },
          resolution: {
            enum: [
              "480p",
              "720p",
              "1080p"
            ],
            type: "string",
            title: "Resolution",
            default: "480p"
          },
          aspect_ratio: {
            enum: [
              "auto",
              "1:1",
              "16:9",
              "9:16",
              "4:3",
              "3:4",
              "3:2",
              "2:3"
            ],
            type: "string",
            default: "auto"
          }
        }
      },
      parameterNames: [
        "prompt",
        "duration",
        "audio_url",
        "image_url",
        "image_urls",
        "resolution",
        "aspect_ratio"
      ],
      usageNotes: "* This endpoint also accepts text-only requests or one first-frame image. Choose either image\\_url or reference media (image\\_urls/audio\\_url); do not combine these modes.\n* When image\\_urls or audio\\_url is provided, resolution must be 480p or 720p. The shared schema also lists 1080p, which is rejected in reference mode.\n* Input images must decode as JPEG, PNG, WebP or GIF; SVG and XML are unsupported.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/grok-video-1-5/reference-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:05.790664+00:00",
          snapshot: "evidence/docs-models__grok-video-1-5__reference-to-video.md",
          sha256: "3a98b775ee24f349451dd0a223b76ed9e16619ff45849f600acd6e3ff92bff56"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {
          audio_url: {
            type: "string",
            title: "Reference audio",
            format: "uri"
          }
        },
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* This endpoint also accepts text-only requests or one first-frame image. Choose either image\\_url or reference media (image\\_urls/audio\\_url); do not combine these modes.\n* When image\\_urls or audio\\_url is provided, resolution must be 480p or 720p. The shared schema also lists 1080p, which is rejected in reference mode.\n* Input images must decode as JPEG, PNG, WebP or GIF; SVG and XML are unsupported."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/xai/grok-imagine-video/v1.5/reference-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-550421b4ab67.txt",
        sha256: "87dccb8dfa8662497134199c6bea728cc68253261c9621c5f0bce1a0e55cbc28"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	Duration. Minimum: 1. Maximum: 15.\naudio_url	string	No	\u2014	Reference audio.\nimage_url	string	No	\u2014	First-frame image.\nimage_urls	array[string]	No	\u2014	Reference images.\nresolution	string	No	"480p"	Resolution. Options: 480p, 720p, 1080p.\naspect_ratio	string	No	"auto"	Options: auto, 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "minimax/hailuo-2.3/standard/image-to-video",
      title: "Hailuo 2.3 \u2014 Standard image to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/hailuo-2-3/standard-image-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:08.597193+00:00",
        snapshot: "evidence/docs-models__hailuo-2-3__standard-image-to-video.md",
        sha256: "897d306256e8851ceb442b7af01bc5ea2d5f64543fd91e4ba3a661ee8747611a"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/minimax/hailuo-2.3/standard/image-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Minimax Hailuo 2.3 Playground",
        required: [
          "prompt",
          "image_url"
        ],
        properties: {
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            enum: [
              6,
              10
            ],
            type: "integer",
            title: "Duration",
            default: 6
          },
          image_url: {
            type: "string",
            title: "Image URL",
            format: "uri"
          },
          prompt_optimizer: {
            type: "boolean",
            title: "Prompt optimizer",
            default: true
          }
        }
      },
      parameterNames: [
        "prompt",
        "duration",
        "image_url",
        "prompt_optimizer"
      ],
      usageNotes: "* This Standard endpoint uses a fixed 768P output resolution; resolution is not a configurable field in the production schema.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/hailuo-2-3/standard-image-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:08.597193+00:00",
          snapshot: "evidence/docs-models__hailuo-2-3__standard-image-to-video.md",
          sha256: "897d306256e8851ceb442b7af01bc5ea2d5f64543fd91e4ba3a661ee8747611a"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/minimax/hailuo-2.3/standard/image-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-5f5a7aa80f91.txt",
        sha256: "ff8e25c347389d3781c623dd75c6c94f335c83aa41a7ac447583d4fe143e1b32"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: "prompt	string	Yes	\u2014	Prompt.\nduration	integer	No	6	Duration. Options: 6, 10.\nimage_url	string	Yes	\u2014	Image URL.\nprompt_optimizer	boolean	No	true	Prompt optimizer.",
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "minimax/hailuo-2.3/standard/text-to-video",
      title: "Hailuo 2.3 \u2014 Standard text to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/hailuo-2-3/standard-text-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:09.611731+00:00",
        snapshot: "evidence/docs-models__hailuo-2-3__standard-text-to-video.md",
        sha256: "e99d0fa006f81cf0f15d288f17b950603cad6beab0513d971d74a667aa9e8c14"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/minimax/hailuo-2.3/standard/text-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Minimax Hailuo 2.3 Playground",
        required: [
          "prompt"
        ],
        properties: {
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            enum: [
              6,
              10
            ],
            type: "integer",
            title: "Duration",
            default: 6
          },
          prompt_optimizer: {
            type: "boolean",
            title: "Prompt optimizer",
            default: true
          }
        }
      },
      parameterNames: [
        "prompt",
        "duration",
        "prompt_optimizer"
      ],
      usageNotes: "* This Standard endpoint uses a fixed 768P output resolution; resolution is not a configurable field in the production schema.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/hailuo-2-3/standard-text-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:09.611731+00:00",
          snapshot: "evidence/docs-models__hailuo-2-3__standard-text-to-video.md",
          sha256: "e99d0fa006f81cf0f15d288f17b950603cad6beab0513d971d74a667aa9e8c14"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/minimax/hailuo-2.3/standard/text-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-00a50416e97f.txt",
        sha256: "b2f175d43091e59ef530b25c4da0009b51695a042ea934052d4dd18bf3f7237f"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: "prompt	string	Yes	\u2014	Prompt.\nduration	integer	No	6	Duration. Options: 6, 10.\nprompt_optimizer	boolean	No	true	Prompt optimizer.",
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "alibaba/happy-horse/v1.1/image-to-video",
      title: "HappyHorse 1.1 \u2014 Image to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/happy-horse-1-1/image-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:57.222178+00:00",
        snapshot: "evidence/docs-models__happy-horse-1-1__image-to-video.md",
        sha256: "28e1ab89042e3af1736a47a52fa63c7bfedb9f19211331d26f46ea6ed7c574d0"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/alibaba/happy-horse/v1.1/image-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Happy horse",
        required: [
          "image_url"
        ],
        properties: {
          seed: {
            type: "integer",
            maximum: 2147483646,
            minimum: 1
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 15,
            minimum: 2
          },
          image_url: {
            type: "string",
            title: "Image URL",
            format: "uri"
          },
          resolution: {
            enum: [
              "720p",
              "1080p"
            ],
            type: "string",
            default: "1080p"
          }
        }
      },
      parameterNames: [
        "seed",
        "prompt",
        "duration",
        "image_url",
        "resolution"
      ],
      usageNotes: "* The prompt is optional. This endpoint accepts one first-frame image; it does not support a last-frame image.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/happy-horse-1-1/image-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:57.222178+00:00",
          snapshot: "evidence/docs-models__happy-horse-1-1__image-to-video.md",
          sha256: "28e1ab89042e3af1736a47a52fa63c7bfedb9f19211331d26f46ea6ed7c574d0"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/alibaba/happy-horse/v1.1/image-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-eb5d7e5e0c32.txt",
        sha256: "9cf76c015b2ced789e6917c5f0fcfd73422528b45072297f5a73427d92bfaa84"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'seed	integer	No	\u2014	Minimum: 1. Maximum: 2147483646.\nprompt	string	No	\u2014	Prompt.\nduration	integer	No	5	Duration. Minimum: 2. Maximum: 15.\nimage_url	string	Yes	\u2014	Image URL.\nresolution	string	No	"1080p"	Options: 720p, 1080p.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "alibaba/happy-horse/v1.1/reference-to-video",
      title: "HappyHorse 1.1 \u2014 Reference to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/happy-horse-1-1/reference-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:57.222178+00:00",
        snapshot: "evidence/docs-models__happy-horse-1-1__reference-to-video.md",
        sha256: "3f3ba7bcdb6082d078fc614494daafcf490a30c418934b8fa123a967b2e663dd"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/alibaba/happy-horse/v1.1/reference-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Happy horse",
        required: [
          "image_urls",
          "prompt"
        ],
        properties: {
          seed: {
            type: "integer",
            maximum: 2147483646,
            minimum: 1
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 15,
            minimum: 2
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              title: "Image URL",
              format: "uri"
            }
          },
          resolution: {
            enum: [
              "720p",
              "1080p"
            ],
            type: "string",
            default: "1080p"
          }
        }
      },
      parameterNames: [
        "seed",
        "prompt",
        "duration",
        "image_urls",
        "resolution"
      ],
      usageNotes: "* Provide 1\u20139 reference images. This limit is enforced at submission even though the stored JSON Schema does not set minItems or maxItems. Reference videos are unsupported.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/happy-horse-1-1/reference-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:57.222178+00:00",
          snapshot: "evidence/docs-models__happy-horse-1-1__reference-to-video.md",
          sha256: "3f3ba7bcdb6082d078fc614494daafcf490a30c418934b8fa123a967b2e663dd"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/alibaba/happy-horse/v1.1/reference-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-26d88e7bc0fe.txt",
        sha256: "2937d725f7ac303c912532c9fc560a7b55d7a01d8c52c63bbded1e653e5540da"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'seed	integer	No	\u2014	Minimum: 1. Maximum: 2147483646.\nprompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	Duration. Minimum: 2. Maximum: 15.\nimage_urls	array[string]	Yes	\u2014	\nresolution	string	No	"1080p"	Options: 720p, 1080p.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "alibaba/happy-horse/v1.1/text-to-video",
      title: "HappyHorse 1.1 \u2014 Text to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/happy-horse-1-1/text-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:59.985968+00:00",
        snapshot: "evidence/docs-models__happy-horse-1-1__text-to-video.md",
        sha256: "326210c0623e77f2baf12eeaa4643ec2e5aa188661a4d7ed98e5d717759ed322"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/alibaba/happy-horse/v1.1/text-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Happy Horse",
        required: [
          "prompt"
        ],
        properties: {
          seed: {
            type: "integer",
            maximum: 2147483646,
            minimum: 1
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 15,
            minimum: 3
          },
          resolution: {
            enum: [
              "720p",
              "1080p"
            ],
            type: "string",
            default: "1080p"
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "9:16",
              "1:1",
              "4:3",
              "3:4"
            ],
            type: "string",
            title: "Aspect Ratio",
            default: "16:9"
          }
        }
      },
      parameterNames: [
        "seed",
        "prompt",
        "duration",
        "resolution",
        "aspect_ratio"
      ],
      usageNotes: "* The prompt must contain text; an empty string is rejected during submission.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/happy-horse-1-1/text-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:59.985968+00:00",
          snapshot: "evidence/docs-models__happy-horse-1-1__text-to-video.md",
          sha256: "326210c0623e77f2baf12eeaa4643ec2e5aa188661a4d7ed98e5d717759ed322"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/alibaba/happy-horse/v1.1/text-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-7b0108ecdd02.txt",
        sha256: "454c7cf01d1261a35e3317994df354d1a5ac948f242d331bc75246341b2ada64"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'seed	integer	No	\u2014	Minimum: 1. Maximum: 2147483646.\nprompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	Duration. Minimum: 3. Maximum: 15.\nresolution	string	No	"1080p"	Options: 720p, 1080p.\naspect_ratio	string	No	"16:9"	Aspect Ratio. Options: 16:9, 9:16, 1:1, 4:3, 3:4.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "alibaba/happy-horse/image-to-video",
      title: "Happy Horse 1.0 \u2014 Image to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/happy-horse-1/image-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:57.188166+00:00",
        snapshot: "evidence/docs-models__happy-horse-1__image-to-video.md",
        sha256: "590eea418b6865c4ecc65cdde1ff255d1cc87fa12e909cb88d98a717a21c5e13"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/alibaba/happy-horse/image-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Happy horse",
        required: [
          "image_url"
        ],
        properties: {
          seed: {
            type: "integer",
            maximum: 2147483646,
            minimum: 1
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 15,
            minimum: 2
          },
          image_url: {
            type: "string",
            title: "Image URL",
            format: "uri"
          },
          resolution: {
            enum: [
              "720p",
              "1080p"
            ],
            type: "string",
            default: "720p"
          }
        }
      },
      parameterNames: [
        "seed",
        "prompt",
        "duration",
        "image_url",
        "resolution"
      ],
      usageNotes: "* The prompt is optional. This endpoint accepts one first-frame image; it does not support a last-frame image.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/happy-horse-1/image-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:57.188166+00:00",
          snapshot: "evidence/docs-models__happy-horse-1__image-to-video.md",
          sha256: "590eea418b6865c4ecc65cdde1ff255d1cc87fa12e909cb88d98a717a21c5e13"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/alibaba/happy-horse/image-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-da5bcc812729.txt",
        sha256: "83dfbb89ea515b89101f43003e7266d9ae899fed257afdc970fe539846e36cbd"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'seed	integer	No	\u2014	Minimum: 1. Maximum: 2147483646.\nprompt	string	No	\u2014	Prompt.\nduration	integer	No	5	Duration. Minimum: 2. Maximum: 15.\nimage_url	string	Yes	\u2014	Image URL.\nresolution	string	No	"720p"	Options: 720p, 1080p.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "alibaba/happy-horse/reference-to-video",
      title: "Happy Horse 1.0 \u2014 Reference to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/happy-horse-1/reference-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:57.211811+00:00",
        snapshot: "evidence/docs-models__happy-horse-1__reference-to-video.md",
        sha256: "97cca3ced69d0fc216c7fb9a1ad8ee3dfac2694a164b68d50d1ae9e5b3b60b9f"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/alibaba/happy-horse/reference-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Happy horse",
        required: [
          "image_urls",
          "prompt"
        ],
        properties: {
          seed: {
            type: "integer",
            maximum: 2147483646,
            minimum: 1
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 15,
            minimum: 2
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              title: "Image URL",
              format: "uri"
            }
          },
          resolution: {
            enum: [
              "720p",
              "1080p"
            ],
            type: "string",
            default: "720p"
          }
        }
      },
      parameterNames: [
        "seed",
        "prompt",
        "duration",
        "image_urls",
        "resolution"
      ],
      usageNotes: "* Provide 1\u20139 reference images. This limit is enforced at submission even though the stored JSON Schema does not set minItems or maxItems. Reference videos are unsupported.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/happy-horse-1/reference-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:57.211811+00:00",
          snapshot: "evidence/docs-models__happy-horse-1__reference-to-video.md",
          sha256: "97cca3ced69d0fc216c7fb9a1ad8ee3dfac2694a164b68d50d1ae9e5b3b60b9f"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/alibaba/happy-horse/reference-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-fe3724c32d52.txt",
        sha256: "4bfd2194df0395b0dc48d0ee753b02ea2d73295835c5277f1d507ab745e39d86"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'seed	integer	No	\u2014	Minimum: 1. Maximum: 2147483646.\nprompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	Duration. Minimum: 2. Maximum: 15.\nimage_urls	array[string]	Yes	\u2014	\nresolution	string	No	"720p"	Options: 720p, 1080p.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "alibaba/happy-horse/text-to-video",
      title: "Happy Horse 1.0 \u2014 Text to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/happy-horse-1/text-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:58.870738+00:00",
        snapshot: "evidence/docs-models__happy-horse-1__text-to-video.md",
        sha256: "f4f5637b01c9135f7bb42a07c0a4ceea9b50d5d1fd1e7ca235216f5ff2f85fb1"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/alibaba/happy-horse/text-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Happy Horse",
        required: [
          "prompt"
        ],
        properties: {
          seed: {
            type: "integer",
            maximum: 2147483646,
            minimum: 1
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 15,
            minimum: 3
          },
          resolution: {
            enum: [
              "720p",
              "1080p"
            ],
            type: "string",
            default: "720p"
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "9:16",
              "1:1",
              "4:3",
              "3:4"
            ],
            type: "string",
            title: "Aspect Ratio",
            default: "16:9"
          }
        }
      },
      parameterNames: [
        "seed",
        "prompt",
        "duration",
        "resolution",
        "aspect_ratio"
      ],
      usageNotes: "* The prompt must contain text; an empty string is rejected during submission.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/happy-horse-1/text-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:58.870738+00:00",
          snapshot: "evidence/docs-models__happy-horse-1__text-to-video.md",
          sha256: "f4f5637b01c9135f7bb42a07c0a4ceea9b50d5d1fd1e7ca235216f5ff2f85fb1"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/alibaba/happy-horse/text-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-0cb8c0c5fc4c.txt",
        sha256: "353e0107539b3544f2a72fe0eb5c49d15567efd72636083724bbce784ec40a18"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'seed	integer	No	\u2014	Minimum: 1. Maximum: 2147483646.\nprompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	Duration. Minimum: 3. Maximum: 15.\nresolution	string	No	"720p"	Options: 720p, 1080p.\naspect_ratio	string	No	"16:9"	Aspect Ratio. Options: 16:9, 9:16, 1:1, 4:3, 3:4.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "ideogram/v4.0",
      title: "Ideogram 4.0 \u2014 Generate API",
      category: "image",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/ideogram-4/generate.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:05.718098+00:00",
        snapshot: "evidence/docs-models__ideogram-4__generate.md",
        sha256: "da26f9ef09af47052f152a459aacc2d9c6b1dbab71a910950d672ab8f28bf4ae"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/ideogram/v4.0",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Ideogram 4.0 Playground",
        required: [
          "prompt"
        ],
        properties: {
          prompt: {
            type: "string",
            title: "Prompt",
            maxLength: 2048,
            minLength: 2,
            description: "Write your prompt here"
          },
          image_url: {
            type: "string",
            title: "Input image",
            format: "uri"
          },
          aspect_ratio: {
            enum: [
              "1:1",
              "1:2",
              "2:1",
              "2:3",
              "3:2",
              "4:5",
              "5:4",
              "9:16",
              "16:9",
              "5:8",
              "8:5",
              "3:4",
              "4:3",
              "9:22",
              "22:9",
              "9:23",
              "23:9",
              "3:8",
              "8:3",
              "5:12",
              "12:5",
              "1:3",
              "3:1"
            ],
            type: "string",
            title: "Aspect ratio",
            default: "1:1"
          },
          image_weight: {
            type: "integer",
            title: "Image weight",
            maximum: 100,
            minimum: 1,
            description: "How strongly the output should preserve the input image."
          },
          rendering_speed: {
            enum: [
              "TURBO",
              "DEFAULT",
              "QUALITY"
            ],
            type: "string",
            title: "Rendering speed",
            default: "DEFAULT"
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "prompt",
        "image_url",
        "aspect_ratio",
        "image_weight",
        "rendering_speed"
      ],
      usageNotes: "* Omit image\\_url for text-to-image; provide image\\_url for remix/editing.\n* image\\_weight controls preservation of the input image and applies to editing requests only; values are integers from 1 to 100.\n* The square 1:1 aspect ratio is applied by default, including when an input image is supplied.\n* rendering\\_speed values are case-sensitive: TURBO, DEFAULT, QUALITY. prompt must contain 2\u20132048 characters.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "image",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "images": [\n    {\n      "url": "https://example.com/output.png"\n    }\n  ]\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/ideogram-4/generate.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:05.718098+00:00",
          snapshot: "evidence/docs-models__ideogram-4__generate.md",
          sha256: "da26f9ef09af47052f152a459aacc2d9c6b1dbab71a910950d672ab8f28bf4ae"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "image",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/ideogram/v4.0/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-75636eaa9dc8.txt",
        sha256: "897deb4382f120102bab53423c1249e22dee81c6f123612f36e6855b89f46436"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	Yes	\u2014	Prompt. Minimum length: 2. Maximum length: 2048.\nimage_url	string	No	\u2014	Input image.\naspect_ratio	string	No	"1:1"	Aspect ratio. Options: 1:1, 1:2, 2:1, 2:3, 3:2, 4:5, 5:4, 9:16, 16:9, 5:8, 8:5, 3:4, 4:3, 9:22, 22:9, 9:23, 23:9, 3:8, 8:3, 5:12, 12:5, 1:3, 3:1.\nimage_weight	integer	No	\u2014	How strongly the output should preserve the input image. Minimum: 1. Maximum: 100.\nrendering_speed	string	No	"DEFAULT"	Rendering speed. Options: TURBO, DEFAULT, QUALITY.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/v2.5-turbo/pro/image-to-video",
      title: "Kling 2.5 Turbo \u2014 Pro image to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/kling-2-5-turbo/pro-image-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:05.924091+00:00",
        snapshot: "evidence/docs-models__kling-2-5-turbo__pro-image-to-video.md",
        sha256: "632c1fa5815a2f86396b3111bab843fb071eb39a37d7b3078f385dcac84b0a14"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/v2.5-turbo/pro/image-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Kling 2.5 Playground",
        required: [
          "prompt",
          "image_url"
        ],
        properties: {
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            enum: [
              5,
              10
            ],
            type: "integer",
            title: "Duration",
            default: 5
          },
          cfg_scale: {
            type: "number",
            title: "CFG Scale",
            default: 0.5,
            maximum: 1,
            minimum: 0,
            multipleOf: 0.01
          },
          image_url: {
            type: "string",
            title: "Image URL",
            format: "uri"
          },
          negative_prompt: {
            type: "string",
            title: "Negative Prompt",
            default: ""
          }
        }
      },
      parameterNames: [
        "prompt",
        "duration",
        "cfg_scale",
        "image_url",
        "negative_prompt"
      ],
      usageNotes: "* duration accepts 5 or 10 seconds; 5 is the default.\n* This endpoint does not expose a sound or aspect\\_ratio field.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/kling-2-5-turbo/pro-image-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:05.924091+00:00",
          snapshot: "evidence/docs-models__kling-2-5-turbo__pro-image-to-video.md",
          sha256: "632c1fa5815a2f86396b3111bab843fb071eb39a37d7b3078f385dcac84b0a14"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* duration accepts 5 or 10 seconds; 5 is the default.\n* This endpoint does not expose a sound or aspect\\_ratio field.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/kling-video/v2.5-turbo/pro/image-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-7027c958db8f.txt",
        sha256: "21a537eb657c6dd0b1097ba518dcdece069d4f6d21c76f8c890d294f305c2c5b"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	Duration. Options: 5, 10.\ncfg_scale	number	No	0.5	CFG Scale. Minimum: 0. Maximum: 1.\nimage_url	string	Yes	\u2014	Image URL.\nnegative_prompt	string	No	""	Negative Prompt.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/v2.5-turbo/pro/text-to-video",
      title: "Kling 2.5 Turbo \u2014 Pro text to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/kling-2-5-turbo/pro-text-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:08.680530+00:00",
        snapshot: "evidence/docs-models__kling-2-5-turbo__pro-text-to-video.md",
        sha256: "745d92dd95a6b0a5a4105a23b74446760f0e1e411599b5dea181ef7cbdc0ba26"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/v2.5-turbo/pro/text-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Kling 2.5 Playground",
        required: [
          "prompt"
        ],
        properties: {
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            enum: [
              5,
              10
            ],
            type: "integer",
            title: "Duration",
            default: 5
          },
          cfg_scale: {
            type: "number",
            title: "CFG Scale",
            default: 0.5,
            maximum: 1,
            minimum: 0,
            multipleOf: 0.01
          },
          negative_prompt: {
            type: "string",
            title: "Negative Prompt",
            default: ""
          }
        }
      },
      parameterNames: [
        "prompt",
        "duration",
        "cfg_scale",
        "negative_prompt"
      ],
      usageNotes: "* duration accepts 5 or 10 seconds; 5 is the default.\n* This endpoint does not expose a sound or aspect\\_ratio field.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/kling-2-5-turbo/pro-text-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:08.680530+00:00",
          snapshot: "evidence/docs-models__kling-2-5-turbo__pro-text-to-video.md",
          sha256: "745d92dd95a6b0a5a4105a23b74446760f0e1e411599b5dea181ef7cbdc0ba26"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* duration accepts 5 or 10 seconds; 5 is the default.\n* This endpoint does not expose a sound or aspect\\_ratio field."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/kling-video/v2.5-turbo/pro/text-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-de4a16e37856.txt",
        sha256: "7f45f59b64c5f68a3c1884057473e040301132e846e63591e83f8306eb8c0ac9"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	Duration. Options: 5, 10.\ncfg_scale	number	No	0.5	CFG Scale. Minimum: 0. Maximum: 1.\nnegative_prompt	string	No	""	Negative Prompt.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/v2.5-turbo/standard/image-to-video",
      title: "Kling 2.5 Turbo \u2014 Standard image to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/kling-2-5-turbo/standard-image-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:05.995910+00:00",
        snapshot: "evidence/docs-models__kling-2-5-turbo__standard-image-to-video.md",
        sha256: "06a329c8d51ed3dd0a7b68beaa6b523579648cba55ceb4f130cf4ca096ebbe55"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/v2.5-turbo/standard/image-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Kling 2.5 Playground",
        required: [
          "prompt",
          "image_url"
        ],
        properties: {
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            enum: [
              5,
              10
            ],
            type: "integer",
            title: "Duration",
            default: 5
          },
          cfg_scale: {
            type: "number",
            title: "CFG Scale",
            default: 0.5,
            maximum: 1,
            minimum: 0,
            multipleOf: 0.01
          },
          image_url: {
            type: "string",
            title: "Image URL",
            format: "uri"
          },
          negative_prompt: {
            type: "string",
            title: "Negative Prompt",
            default: ""
          }
        }
      },
      parameterNames: [
        "prompt",
        "duration",
        "cfg_scale",
        "image_url",
        "negative_prompt"
      ],
      usageNotes: "* duration accepts 5 or 10 seconds; 5 is the default.\n* This endpoint does not expose a sound or aspect\\_ratio field.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/kling-2-5-turbo/standard-image-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:05.995910+00:00",
          snapshot: "evidence/docs-models__kling-2-5-turbo__standard-image-to-video.md",
          sha256: "06a329c8d51ed3dd0a7b68beaa6b523579648cba55ceb4f130cf4ca096ebbe55"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* duration accepts 5 or 10 seconds; 5 is the default.\n* This endpoint does not expose a sound or aspect\\_ratio field.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/kling-video/v2.5-turbo/standard/image-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-9c5279679139.txt",
        sha256: "9525e9a53da0500c72ba06e2cac9d935201e0f37eca705175652de79d4a03fe2"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	Duration. Options: 5, 10.\ncfg_scale	number	No	0.5	CFG Scale. Minimum: 0. Maximum: 1.\nimage_url	string	Yes	\u2014	Image URL.\nnegative_prompt	string	No	""	Negative Prompt.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/motion-control/pro",
      title: "Kling 2.6 Motion Control \u2014 Pro API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/kling-2-6-motion-control/pro.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:08.578645+00:00",
        snapshot: "evidence/docs-models__kling-2-6-motion-control__pro.md",
        sha256: "f29955eed8fd0a3226a8287bc06af2db20e842157b96a63fba03d070a26a6796"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/motion-control/pro",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Kling Motion Control Playground",
        required: [
          "image_url",
          "video_url"
        ],
        properties: {
          prompt: {
            type: "string",
            title: "Prompt",
            default: "",
            description: "Write your prompt here"
          },
          image_url: {
            type: "string",
            title: "Image URL",
            format: "uri"
          },
          video_url: {
            type: "string",
            title: "Video URL",
            format: "uri"
          },
          keep_original_sound: {
            enum: [
              "yes",
              "no"
            ],
            type: "string",
            title: "Keep original sound",
            default: "yes"
          },
          character_orientation: {
            enum: [
              "image",
              "video"
            ],
            type: "string",
            title: "Character orientation",
            default: "video",
            description: "Generate the orientation of the characters in the video, which can be selected to match the image or the video"
          }
        }
      },
      parameterNames: [
        "prompt",
        "image_url",
        "video_url",
        "keep_original_sound",
        "character_orientation"
      ],
      usageNotes: "* Use a motion-reference video from 3 to 30 seconds long. The output duration follows the source video; do not send a separate duration field.\n* Use a character image up to 10 MB with each dimension between 300 and 65,536 pixels. Images outside the 0.4\u20132.5 width-to-height range are adjusted before generation.\n* Videos larger than 100 MB are compressed before generation.\n* Set character\\_orientation to image or video. keep\\_original\\_sound uses the strings yes and no, with yes as the default.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/kling-2-6-motion-control/pro.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:08.578645+00:00",
          snapshot: "evidence/docs-models__kling-2-6-motion-control__pro.md",
          sha256: "f29955eed8fd0a3226a8287bc06af2db20e842157b96a63fba03d070a26a6796"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          keep_original_sound: {
            enum: [
              "yes",
              "no"
            ],
            type: "string",
            title: "Keep original sound",
            default: "yes"
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* Use a motion-reference video from 3 to 30 seconds long. The output duration follows the source video; do not send a separate duration field.\n* Use a character image up to 10 MB with each dimension between 300 and 65,536 pixels. Images outside the 0.4\u20132.5 width-to-height range are adjusted before generation.\n* Videos larger than 100 MB are compressed before generation.\n* Set character\\_orientation to image or video. keep\\_original\\_sound uses the strings yes and no, with yes as the default.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/kling-video/motion-control/pro/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-eb444256b811.txt",
        sha256: "7f4c186be1b13c641a47c95e8c8b9c2b780bfe10780308c1cf1f669ae2c6bd92"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	No	""	Prompt.\nimage_url	string	Yes	\u2014	Image URL.\nvideo_url	string	Yes	\u2014	Video URL.\nkeep_original_sound	string	No	"yes"	Keep original sound. Options: yes, no.\ncharacter_orientation	string	No	"video"	Generate the orientation of the characters in the video, which can be selected to match the image or the video. Options: image, video.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/motion-control/std",
      title: "Kling 2.6 Motion Control \u2014 Standard API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/kling-2-6-motion-control/std.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:08.633420+00:00",
        snapshot: "evidence/docs-models__kling-2-6-motion-control__std.md",
        sha256: "182687444aab0fda20721cbf22471becf333f498cb7e16d6afd9a28cd62936bc"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/motion-control/std",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Kling Motion Control Playground",
        required: [
          "image_url",
          "video_url"
        ],
        properties: {
          prompt: {
            type: "string",
            title: "Prompt",
            default: "",
            description: "Write your prompt here"
          },
          image_url: {
            type: "string",
            title: "Image URL",
            format: "uri"
          },
          video_url: {
            type: "string",
            title: "Video URL",
            format: "uri"
          },
          keep_original_sound: {
            enum: [
              "yes",
              "no"
            ],
            type: "string",
            title: "Keep original sound",
            default: "yes"
          },
          character_orientation: {
            enum: [
              "image",
              "video"
            ],
            type: "string",
            title: "Character orientation",
            default: "video",
            description: "Generate the orientation of the characters in the video, which can be selected to match the image or the video"
          }
        }
      },
      parameterNames: [
        "prompt",
        "image_url",
        "video_url",
        "keep_original_sound",
        "character_orientation"
      ],
      usageNotes: "* Use a motion-reference video from 3 to 30 seconds long. The output duration follows the source video; do not send a separate duration field.\n* Use a character image up to 10 MB with each dimension between 300 and 65,536 pixels. Images outside the 0.4\u20132.5 width-to-height range are adjusted before generation.\n* Videos larger than 100 MB are compressed before generation.\n* Set character\\_orientation to image or video. keep\\_original\\_sound uses the strings yes and no, with yes as the default.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/kling-2-6-motion-control/std.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:08.633420+00:00",
          snapshot: "evidence/docs-models__kling-2-6-motion-control__std.md",
          sha256: "182687444aab0fda20721cbf22471becf333f498cb7e16d6afd9a28cd62936bc"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          keep_original_sound: {
            enum: [
              "yes",
              "no"
            ],
            type: "string",
            title: "Keep original sound",
            default: "yes"
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* Use a motion-reference video from 3 to 30 seconds long. The output duration follows the source video; do not send a separate duration field.\n* Use a character image up to 10 MB with each dimension between 300 and 65,536 pixels. Images outside the 0.4\u20132.5 width-to-height range are adjusted before generation.\n* Videos larger than 100 MB are compressed before generation.\n* Set character\\_orientation to image or video. keep\\_original\\_sound uses the strings yes and no, with yes as the default.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/kling-video/motion-control/std/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-6dd0ff86519c.txt",
        sha256: "bf4a07f48a7db46cd604314c819d6e6e3ddec95577343dd1f5b5b056fd705b55"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	No	""	Prompt.\nimage_url	string	Yes	\u2014	Image URL.\nvideo_url	string	Yes	\u2014	Video URL.\nkeep_original_sound	string	No	"yes"	Keep original sound. Options: yes, no.\ncharacter_orientation	string	No	"video"	Generate the orientation of the characters in the video, which can be selected to match the image or the video. Options: image, video.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/v2.6/pro/image-to-video",
      title: "Kling 2.6 \u2014 Pro image to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/kling-2-6/pro-image-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:08.569595+00:00",
        snapshot: "evidence/docs-models__kling-2-6__pro-image-to-video.md",
        sha256: "b53fc9b34669ba1371f842bd81b7e929a53bfaa4064b040ae24b7a5fb2b12bbe"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/v2.6/pro/image-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Kling 2.6 Playground",
        required: [
          "prompt",
          "image_url"
        ],
        properties: {
          sound: {
            enum: [
              "on",
              "off"
            ],
            type: "string",
            title: "Generate sound",
            default: "on"
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            enum: [
              5,
              10
            ],
            type: "integer",
            title: "Duration",
            default: 5
          },
          cfg_scale: {
            type: "number",
            title: "CFG Scale",
            default: 0.5,
            maximum: 1,
            minimum: 0,
            multipleOf: 0.01
          },
          image_url: {
            type: "string",
            title: "Image URL",
            format: "uri"
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "9:16",
              "1:1"
            ],
            type: "string",
            title: "Aspect ratio"
          }
        }
      },
      parameterNames: [
        "sound",
        "prompt",
        "duration",
        "cfg_scale",
        "image_url",
        "aspect_ratio"
      ],
      usageNotes: "* duration accepts 5 or 10 seconds; 5 is the default.\n* Native audio uses sound: on or off and defaults to on.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/kling-2-6/pro-image-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:08.569595+00:00",
          snapshot: "evidence/docs-models__kling-2-6__pro-image-to-video.md",
          sha256: "b53fc9b34669ba1371f842bd81b7e929a53bfaa4064b040ae24b7a5fb2b12bbe"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          sound: {
            enum: [
              "on",
              "off"
            ],
            type: "string",
            title: "Generate sound",
            default: "on"
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* duration accepts 5 or 10 seconds; 5 is the default.\n* Native audio uses sound: on or off and defaults to on.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/kling-video/v2.6/pro/image-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-5601d5591a24.txt",
        sha256: "b7c86c2c146f6abac5dc77b872d8d7d26d5a894ec96bef80a124d39f76824e85"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'sound	string	No	"on"	Generate sound. Options: on, off.\nprompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	Duration. Options: 5, 10.\ncfg_scale	number	No	0.5	CFG Scale. Minimum: 0. Maximum: 1.\nimage_url	string	Yes	\u2014	Image URL.\naspect_ratio	string	No	\u2014	Aspect ratio. Options: 16:9, 9:16, 1:1.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/v2.6/pro/text-to-video",
      title: "Kling 2.6 \u2014 Pro text to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/kling-2-6/pro-text-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:06.147531+00:00",
        snapshot: "evidence/docs-models__kling-2-6__pro-text-to-video.md",
        sha256: "ba7bb25fc2ed9fc34a80c3662fee41e6f34fbd1fae794a8b936cee78a2a9ecb1"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/v2.6/pro/text-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Kling 2.6 Playground",
        required: [
          "prompt"
        ],
        properties: {
          sound: {
            enum: [
              "on",
              "off"
            ],
            type: "string",
            title: "Generate sound",
            default: "on"
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            enum: [
              5,
              10
            ],
            type: "integer",
            title: "Duration",
            default: 5
          },
          cfg_scale: {
            type: "number",
            title: "CFG Scale",
            default: 0.5,
            maximum: 1,
            minimum: 0,
            multipleOf: 0.01
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "9:16",
              "1:1"
            ],
            type: "string",
            title: "Aspect ratio",
            default: "16:9"
          }
        }
      },
      parameterNames: [
        "sound",
        "prompt",
        "duration",
        "cfg_scale",
        "aspect_ratio"
      ],
      usageNotes: "* duration accepts 5 or 10 seconds; 5 is the default.\n* Native audio uses sound: on or off and defaults to on.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/kling-2-6/pro-text-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:06.147531+00:00",
          snapshot: "evidence/docs-models__kling-2-6__pro-text-to-video.md",
          sha256: "ba7bb25fc2ed9fc34a80c3662fee41e6f34fbd1fae794a8b936cee78a2a9ecb1"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          sound: {
            enum: [
              "on",
              "off"
            ],
            type: "string",
            title: "Generate sound",
            default: "on"
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* duration accepts 5 or 10 seconds; 5 is the default.\n* Native audio uses sound: on or off and defaults to on."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/kling-video/v2.6/pro/text-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-bcc2f87f454e.txt",
        sha256: "6076e24fbea24ab18354096d290adac6970f10db6ee0adb3507a6d2f8269ab47"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'sound	string	No	"on"	Generate sound. Options: on, off.\nprompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	Duration. Options: 5, 10.\ncfg_scale	number	No	0.5	CFG Scale. Minimum: 0. Maximum: 1.\naspect_ratio	string	No	"16:9"	Aspect ratio. Options: 16:9, 9:16, 1:1.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/v3/motion-control/pro",
      title: "Kling 3.0 Motion Control \u2014 Pro API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/kling-3-motion-control/pro.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:08.724841+00:00",
        snapshot: "evidence/docs-models__kling-3-motion-control__pro.md",
        sha256: "758538a10ccf87615c0ae0a7a1197d461604156a86caa801c7d5593b98507bb6"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/v3/motion-control/pro",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Kling V3 Motion Control Playground",
        required: [
          "image_url",
          "video_url"
        ],
        properties: {
          prompt: {
            type: "string",
            title: "Prompt",
            default: "",
            description: "Write your prompt here"
          },
          image_url: {
            type: "string",
            title: "Image URL",
            format: "uri"
          },
          video_url: {
            type: "string",
            title: "Video URL",
            format: "uri"
          },
          keep_original_sound: {
            enum: [
              "yes",
              "no"
            ],
            type: "string",
            title: "Keep original sound",
            default: "yes"
          },
          character_orientation: {
            enum: [
              "image",
              "video"
            ],
            type: "string",
            title: "Character orientation",
            default: "video",
            description: "Generate the orientation of the characters in the video, which can be selected to match the image or the video"
          }
        }
      },
      parameterNames: [
        "prompt",
        "image_url",
        "video_url",
        "keep_original_sound",
        "character_orientation"
      ],
      usageNotes: "* Use a motion-reference video from 3 to 30 seconds long. The output duration follows the source video; do not send a separate duration field.\n* Use a character image up to 10 MB with each dimension between 300 and 65,536 pixels. Images outside the 0.4\u20132.5 width-to-height range are adjusted before generation.\n* Videos larger than 100 MB are compressed before generation.\n* Set character\\_orientation to image or video. keep\\_original\\_sound uses the strings yes and no, with yes as the default.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/kling-3-motion-control/pro.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:08.724841+00:00",
          snapshot: "evidence/docs-models__kling-3-motion-control__pro.md",
          sha256: "758538a10ccf87615c0ae0a7a1197d461604156a86caa801c7d5593b98507bb6"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          keep_original_sound: {
            enum: [
              "yes",
              "no"
            ],
            type: "string",
            title: "Keep original sound",
            default: "yes"
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* Use a motion-reference video from 3 to 30 seconds long. The output duration follows the source video; do not send a separate duration field.\n* Use a character image up to 10 MB with each dimension between 300 and 65,536 pixels. Images outside the 0.4\u20132.5 width-to-height range are adjusted before generation.\n* Videos larger than 100 MB are compressed before generation.\n* Set character\\_orientation to image or video. keep\\_original\\_sound uses the strings yes and no, with yes as the default.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/kling-video/v3/motion-control/pro/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-13679b2036a9.txt",
        sha256: "d43fd79c6f286e6c645f9cd615b6296d4a657e4a6137815684194f205427dcd0"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	No	""	Prompt.\nimage_url	string	Yes	\u2014	Image URL.\nvideo_url	string	Yes	\u2014	Video URL.\nkeep_original_sound	string	No	"yes"	Keep original sound. Options: yes, no.\ncharacter_orientation	string	No	"video"	Generate the orientation of the characters in the video, which can be selected to match the image or the video. Options: image, video.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/v3/motion-control/std",
      title: "Kling 3.0 Motion Control \u2014 Standard API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/kling-3-motion-control/std.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:09.565259+00:00",
        snapshot: "evidence/docs-models__kling-3-motion-control__std.md",
        sha256: "7ab0e9e286a260c5fdc7890d70b3ab16c800c65584f76f47cf530a430c1c10d5"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/v3/motion-control/std",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Kling V3 Motion Control Playground",
        required: [
          "image_url",
          "video_url"
        ],
        properties: {
          prompt: {
            type: "string",
            title: "Prompt",
            default: "",
            description: "Write your prompt here"
          },
          image_url: {
            type: "string",
            title: "Image URL",
            format: "uri"
          },
          video_url: {
            type: "string",
            title: "Video URL",
            format: "uri"
          },
          keep_original_sound: {
            enum: [
              "yes",
              "no"
            ],
            type: "string",
            title: "Keep original sound",
            default: "yes"
          },
          character_orientation: {
            enum: [
              "image",
              "video"
            ],
            type: "string",
            title: "Character orientation",
            default: "video",
            description: "Generate the orientation of the characters in the video, which can be selected to match the image or the video"
          }
        }
      },
      parameterNames: [
        "prompt",
        "image_url",
        "video_url",
        "keep_original_sound",
        "character_orientation"
      ],
      usageNotes: "* Use a motion-reference video from 3 to 30 seconds long. The output duration follows the source video; do not send a separate duration field.\n* Use a character image up to 10 MB with each dimension between 300 and 65,536 pixels. Images outside the 0.4\u20132.5 width-to-height range are adjusted before generation.\n* Videos larger than 100 MB are compressed before generation.\n* Set character\\_orientation to image or video. keep\\_original\\_sound uses the strings yes and no, with yes as the default.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/kling-3-motion-control/std.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:09.565259+00:00",
          snapshot: "evidence/docs-models__kling-3-motion-control__std.md",
          sha256: "7ab0e9e286a260c5fdc7890d70b3ab16c800c65584f76f47cf530a430c1c10d5"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          keep_original_sound: {
            enum: [
              "yes",
              "no"
            ],
            type: "string",
            title: "Keep original sound",
            default: "yes"
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* Use a motion-reference video from 3 to 30 seconds long. The output duration follows the source video; do not send a separate duration field.\n* Use a character image up to 10 MB with each dimension between 300 and 65,536 pixels. Images outside the 0.4\u20132.5 width-to-height range are adjusted before generation.\n* Videos larger than 100 MB are compressed before generation.\n* Set character\\_orientation to image or video. keep\\_original\\_sound uses the strings yes and no, with yes as the default.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/kling-video/v3/motion-control/std/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-adb68f0a0cf1.txt",
        sha256: "4716f64556a91905498d7358a6dd7d7537cd8e25515120d4e5aa933ff434d749"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	No	""	Prompt.\nimage_url	string	Yes	\u2014	Image URL.\nvideo_url	string	Yes	\u2014	Video URL.\nkeep_original_sound	string	No	"yes"	Keep original sound. Options: yes, no.\ncharacter_orientation	string	No	"video"	Generate the orientation of the characters in the video, which can be selected to match the image or the video. Options: image, video.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/v3.0/4k/image-to-video",
      title: "Kling 3.0 \u2014 4K \xB7 Image to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/kling-3/4k-image-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:08.595687+00:00",
        snapshot: "evidence/docs-models__kling-3__4k-image-to-video.md",
        sha256: "ee186c22d80fe17f85432298e737432671cea451cd4b85120539fe7a61cb0bca"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/v3.0/4k/image-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Kling 3.0 Playground",
        required: [
          "image_url"
        ],
        properties: {
          sound: {
            enum: [
              "on",
              "off"
            ],
            type: "string",
            title: "Generate sound",
            default: "on"
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 15,
            minimum: 3
          },
          elements: {
            type: "array",
            items: {
              type: "string"
            }
          },
          cfg_scale: {
            type: "number",
            title: "CFG Scale",
            default: 0.5,
            maximum: 1,
            minimum: 0,
            multipleOf: 0.01
          },
          image_url: {
            type: "string",
            title: "Image URL",
            format: "uri"
          },
          multi_shots: {
            type: "boolean",
            default: false
          },
          multi_prompt: {
            type: "array",
            items: {
              type: "object",
              properties: {
                prompt: {
                  type: "string",
                  maxLength: 512
                },
                duration: {
                  type: "integer",
                  maximum: 15,
                  minimum: 1
                }
              }
            },
            maxItems: 6,
            minItems: 0
          },
          last_image_url: {
            type: "string",
            title: "Image URL",
            format: "uri"
          }
        }
      },
      parameterNames: [
        "sound",
        "prompt",
        "duration",
        "elements",
        "cfg_scale",
        "image_url",
        "multi_shots",
        "multi_prompt",
        "last_image_url"
      ],
      usageNotes: "* image\\_url is the first frame; last\\_image\\_url optionally sets the final frame.\n* Always include a non-empty top-level prompt, including when using multi\\_prompt. Keep it within 2,500 characters; longer prompts are truncated.\n* For custom shots, set multi\\_shots to true and provide 1\u20136 multi\\_prompt objects. Each object needs prompt (at most 512 characters) and duration (a positive integer from 1 to 15 seconds).\n* Custom-shot durations are summed for generation and billing; the top-level duration does not override that sum. With multi\\_shots enabled and no custom shots, the top-level duration is retained.\n* Native audio uses sound: on or off and defaults to on.\n* elements contains Kling element IDs as decimal strings. Each ID must belong to the account making the request; arbitrary provider IDs are rejected.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/kling-3/4k-image-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:08.595687+00:00",
          snapshot: "evidence/docs-models__kling-3__4k-image-to-video.md",
          sha256: "ee186c22d80fe17f85432298e737432671cea451cd4b85120539fe7a61cb0bca"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          sound: {
            enum: [
              "on",
              "off"
            ],
            type: "string",
            title: "Generate sound",
            default: "on"
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* image\\_url is the first frame; last\\_image\\_url optionally sets the final frame.\n* Always include a non-empty top-level prompt, including when using multi\\_prompt. Keep it within 2,500 characters; longer prompts are truncated.\n* For custom shots, set multi\\_shots to true and provide 1\u20136 multi\\_prompt objects. Each object needs prompt (at most 512 characters) and duration (a positive integer from 1 to 15 seconds).\n* Custom-shot durations are summed for generation and billing; the top-level duration does not override that sum. With multi\\_shots enabled and no custom shots, the top-level duration is retained.\n* Native audio uses sound: on or off and defaults to on.\n* elements contains Kling element IDs as decimal strings. Each ID must belong to the account making the request; arbitrary provider IDs are rejected.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/kling-video/v3.0/4k/image-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-cf60cc890409.txt",
        sha256: "d566fb8822e6748205d7f2b1284f8f4bf7b3031384dbb9db7439d59c8d3f9742"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'sound	string	No	"on"	Generate sound. Options: on, off.\nprompt	string	No	\u2014	Prompt.\nduration	integer	No	5	Duration. Minimum: 3. Maximum: 15.\nelements	array[string]	No	\u2014	\ncfg_scale	number	No	0.5	CFG Scale. Minimum: 0. Maximum: 1.\nimage_url	string	Yes	\u2014	Image URL.\nmulti_shots	boolean	No	false	\nmulti_prompt	array[object]	No	\u2014	\nlast_image_url	string	No	\u2014	Image URL.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/v3.0/4k/text-to-video",
      title: "Kling 3.0 \u2014 4K \xB7 Text to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/kling-3/4k-text-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:06.278441+00:00",
        snapshot: "evidence/docs-models__kling-3__4k-text-to-video.md",
        sha256: "ef1e9257639efc4a0516b237127a78f5c8ac62af53302ffe2b2bccec5c9fcac1"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/v3.0/4k/text-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Kling 3.0 Playground",
        properties: {
          sound: {
            enum: [
              "on",
              "off"
            ],
            type: "string",
            title: "Generate sound",
            default: "on"
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 15,
            minimum: 3
          },
          elements: {
            type: "array",
            items: {
              type: "string"
            }
          },
          cfg_scale: {
            type: "number",
            title: "CFG Scale",
            default: 0.5,
            maximum: 1,
            minimum: 0,
            multipleOf: 0.01
          },
          multi_shots: {
            type: "boolean",
            default: false
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "9:16",
              "1:1"
            ],
            type: "string",
            title: "Aspect ratio",
            default: "16:9"
          },
          multi_prompt: {
            type: "array",
            items: {
              type: "object",
              properties: {
                prompt: {
                  type: "string",
                  maxLength: 512
                },
                duration: {
                  type: "integer",
                  maximum: 15,
                  minimum: 1
                }
              }
            },
            maxItems: 6,
            minItems: 0
          }
        }
      },
      parameterNames: [
        "sound",
        "prompt",
        "duration",
        "elements",
        "cfg_scale",
        "multi_shots",
        "aspect_ratio",
        "multi_prompt"
      ],
      usageNotes: "* Always include a non-empty top-level prompt, including when using multi\\_prompt. Keep it within 2,500 characters; longer prompts are truncated.\n* For custom shots, set multi\\_shots to true and provide 1\u20136 multi\\_prompt objects. Each object needs prompt (at most 512 characters) and duration (a positive integer from 1 to 15 seconds).\n* Custom-shot durations are summed for generation and billing; the top-level duration does not override that sum. With multi\\_shots enabled and no custom shots, the top-level duration is retained.\n* Native audio uses sound: on or off and defaults to on.\n* elements contains Kling element IDs as decimal strings. Each ID must belong to the account making the request; arbitrary provider IDs are rejected.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/kling-3/4k-text-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:06.278441+00:00",
          snapshot: "evidence/docs-models__kling-3__4k-text-to-video.md",
          sha256: "ef1e9257639efc4a0516b237127a78f5c8ac62af53302ffe2b2bccec5c9fcac1"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          sound: {
            enum: [
              "on",
              "off"
            ],
            type: "string",
            title: "Generate sound",
            default: "on"
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* Always include a non-empty top-level prompt, including when using multi\\_prompt. Keep it within 2,500 characters; longer prompts are truncated.\n* For custom shots, set multi\\_shots to true and provide 1\u20136 multi\\_prompt objects. Each object needs prompt (at most 512 characters) and duration (a positive integer from 1 to 15 seconds).\n* Custom-shot durations are summed for generation and billing; the top-level duration does not override that sum. With multi\\_shots enabled and no custom shots, the top-level duration is retained.\n* Native audio uses sound: on or off and defaults to on.\n* elements contains Kling element IDs as decimal strings. Each ID must belong to the account making the request; arbitrary provider IDs are rejected."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/kling-video/v3.0/4k/text-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-adf7c9b875cb.txt",
        sha256: "97716e763c478f1c6545f93ad35553d4af221fe285ac9d25d42040232e0c3f1c"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'sound	string	No	"on"	Generate sound. Options: on, off.\nprompt	string	No	\u2014	Prompt.\nduration	integer	No	5	Duration. Minimum: 3. Maximum: 15.\nelements	array[string]	No	\u2014	\ncfg_scale	number	No	0.5	CFG Scale. Minimum: 0. Maximum: 1.\nmulti_shots	boolean	No	false	\naspect_ratio	string	No	"16:9"	Aspect ratio. Options: 16:9, 9:16, 1:1.\nmulti_prompt	array[object]	No	\u2014',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/v3.0/pro/image-to-video",
      title: "Kling 3.0 \u2014 Pro \xB7 Image to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/kling-3/pro-image-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:08.677404+00:00",
        snapshot: "evidence/docs-models__kling-3__pro-image-to-video.md",
        sha256: "90a28d60e4efa79fe4a407838dccf157a021e03e61a7443d5522f37e06f15dd5"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/v3.0/pro/image-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Kling 3.0 Playground",
        required: [
          "image_url"
        ],
        properties: {
          sound: {
            enum: [
              "on",
              "off"
            ],
            type: "string",
            title: "Generate sound",
            default: "on"
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 15,
            minimum: 3
          },
          elements: {
            type: "array",
            items: {
              type: "string"
            }
          },
          cfg_scale: {
            type: "number",
            title: "CFG Scale",
            default: 0.5,
            maximum: 1,
            minimum: 0,
            multipleOf: 0.01
          },
          image_url: {
            type: "string",
            title: "Image URL",
            format: "uri"
          },
          multi_shots: {
            type: "boolean",
            default: false
          },
          multi_prompt: {
            type: "array",
            items: {
              type: "object",
              properties: {
                prompt: {
                  type: "string",
                  maxLength: 512
                },
                duration: {
                  type: "integer",
                  maximum: 15,
                  minimum: 1
                }
              }
            },
            maxItems: 6,
            minItems: 0
          },
          last_image_url: {
            type: "string",
            title: "Image URL",
            format: "uri"
          }
        }
      },
      parameterNames: [
        "sound",
        "prompt",
        "duration",
        "elements",
        "cfg_scale",
        "image_url",
        "multi_shots",
        "multi_prompt",
        "last_image_url"
      ],
      usageNotes: "* image\\_url is the first frame; last\\_image\\_url optionally sets the final frame.\n* Always include a non-empty top-level prompt, including when using multi\\_prompt. Keep it within 2,500 characters; longer prompts are truncated.\n* For custom shots, set multi\\_shots to true and provide 1\u20136 multi\\_prompt objects. Each object needs prompt (at most 512 characters) and duration (a positive integer from 1 to 15 seconds).\n* Custom-shot durations are summed for generation and billing; the top-level duration does not override that sum. With multi\\_shots enabled and no custom shots, the top-level duration is retained.\n* Native audio uses sound: on or off and defaults to on.\n* elements contains Kling element IDs as decimal strings. Each ID must belong to the account making the request; arbitrary provider IDs are rejected.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/kling-3/pro-image-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:08.677404+00:00",
          snapshot: "evidence/docs-models__kling-3__pro-image-to-video.md",
          sha256: "90a28d60e4efa79fe4a407838dccf157a021e03e61a7443d5522f37e06f15dd5"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          sound: {
            enum: [
              "on",
              "off"
            ],
            type: "string",
            title: "Generate sound",
            default: "on"
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* image\\_url is the first frame; last\\_image\\_url optionally sets the final frame.\n* Always include a non-empty top-level prompt, including when using multi\\_prompt. Keep it within 2,500 characters; longer prompts are truncated.\n* For custom shots, set multi\\_shots to true and provide 1\u20136 multi\\_prompt objects. Each object needs prompt (at most 512 characters) and duration (a positive integer from 1 to 15 seconds).\n* Custom-shot durations are summed for generation and billing; the top-level duration does not override that sum. With multi\\_shots enabled and no custom shots, the top-level duration is retained.\n* Native audio uses sound: on or off and defaults to on.\n* elements contains Kling element IDs as decimal strings. Each ID must belong to the account making the request; arbitrary provider IDs are rejected.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/kling-video/v3.0/pro/image-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-11fd3e7c1f92.txt",
        sha256: "cd18d9455114315b06090ff5b3e3a90e547ec300874b00f03717ac4024be5b87"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'sound	string	No	"on"	Generate sound. Options: on, off.\nprompt	string	No	\u2014	Prompt.\nduration	integer	No	5	Duration. Minimum: 3. Maximum: 15.\nelements	array[string]	No	\u2014	\ncfg_scale	number	No	0.5	CFG Scale. Minimum: 0. Maximum: 1.\nimage_url	string	Yes	\u2014	Image URL.\nmulti_shots	boolean	No	false	\nmulti_prompt	array[object]	No	\u2014	\nlast_image_url	string	No	\u2014	Image URL.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/v3.0/pro/text-to-video",
      title: "Kling 3.0 \u2014 Pro \xB7 Text to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/kling-3/pro-text-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:09.347567+00:00",
        snapshot: "evidence/docs-models__kling-3__pro-text-to-video.md",
        sha256: "dd56f251b3919a6dd30950b64180d26c6ba60094682ff63e9be0bdeb522d406b"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/v3.0/pro/text-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Kling 3.0 Playground",
        properties: {
          sound: {
            enum: [
              "on",
              "off"
            ],
            type: "string",
            title: "Generate sound",
            default: "on"
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 15,
            minimum: 3
          },
          elements: {
            type: "array",
            items: {
              type: "string"
            }
          },
          cfg_scale: {
            type: "number",
            title: "CFG Scale",
            default: 0.5,
            maximum: 1,
            minimum: 0,
            multipleOf: 0.01
          },
          multi_shots: {
            type: "boolean",
            default: false
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "9:16",
              "1:1"
            ],
            type: "string",
            title: "Aspect ratio",
            default: "16:9"
          },
          multi_prompt: {
            type: "array",
            items: {
              type: "object",
              properties: {
                prompt: {
                  type: "string",
                  maxLength: 512
                },
                duration: {
                  type: "integer",
                  maximum: 15,
                  minimum: 1
                }
              }
            },
            maxItems: 6,
            minItems: 0
          }
        }
      },
      parameterNames: [
        "sound",
        "prompt",
        "duration",
        "elements",
        "cfg_scale",
        "multi_shots",
        "aspect_ratio",
        "multi_prompt"
      ],
      usageNotes: "* Always include a non-empty top-level prompt, including when using multi\\_prompt. Keep it within 2,500 characters; longer prompts are truncated.\n* For custom shots, set multi\\_shots to true and provide 1\u20136 multi\\_prompt objects. Each object needs prompt (at most 512 characters) and duration (a positive integer from 1 to 15 seconds).\n* Custom-shot durations are summed for generation and billing; the top-level duration does not override that sum. With multi\\_shots enabled and no custom shots, the top-level duration is retained.\n* Native audio uses sound: on or off and defaults to on.\n* elements contains Kling element IDs as decimal strings. Each ID must belong to the account making the request; arbitrary provider IDs are rejected.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/kling-3/pro-text-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:09.347567+00:00",
          snapshot: "evidence/docs-models__kling-3__pro-text-to-video.md",
          sha256: "dd56f251b3919a6dd30950b64180d26c6ba60094682ff63e9be0bdeb522d406b"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          sound: {
            enum: [
              "on",
              "off"
            ],
            type: "string",
            title: "Generate sound",
            default: "on"
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* Always include a non-empty top-level prompt, including when using multi\\_prompt. Keep it within 2,500 characters; longer prompts are truncated.\n* For custom shots, set multi\\_shots to true and provide 1\u20136 multi\\_prompt objects. Each object needs prompt (at most 512 characters) and duration (a positive integer from 1 to 15 seconds).\n* Custom-shot durations are summed for generation and billing; the top-level duration does not override that sum. With multi\\_shots enabled and no custom shots, the top-level duration is retained.\n* Native audio uses sound: on or off and defaults to on.\n* elements contains Kling element IDs as decimal strings. Each ID must belong to the account making the request; arbitrary provider IDs are rejected."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/kling-video/v3.0/pro/text-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-47e3fdc93422.txt",
        sha256: "22fcee0148a9459f926c02dfea40d8d62c8cc453fc30ca6267734613e1a4e780"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'sound	string	No	"on"	Generate sound. Options: on, off.\nprompt	string	No	\u2014	Prompt.\nduration	integer	No	5	Duration. Minimum: 3. Maximum: 15.\nelements	array[string]	No	\u2014	\ncfg_scale	number	No	0.5	CFG Scale. Minimum: 0. Maximum: 1.\nmulti_shots	boolean	No	false	\naspect_ratio	string	No	"16:9"	Aspect ratio. Options: 16:9, 9:16, 1:1.\nmulti_prompt	array[object]	No	\u2014',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/v3.0/std/image-to-video",
      title: "Kling 3.0 \u2014 Standard \xB7 Image to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/kling-3/standard-image-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:09.281783+00:00",
        snapshot: "evidence/docs-models__kling-3__standard-image-to-video.md",
        sha256: "ad34e71c8a07ea4359b49bd41654ea8f9605d14e188a705d8f10d575ec9c5dcd"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/v3.0/std/image-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Kling 3.0 Playground",
        required: [
          "image_url"
        ],
        properties: {
          sound: {
            enum: [
              "on",
              "off"
            ],
            type: "string",
            title: "Generate sound",
            default: "on"
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 15,
            minimum: 3
          },
          elements: {
            type: "array",
            items: {
              type: "string"
            }
          },
          cfg_scale: {
            type: "number",
            title: "CFG Scale",
            default: 0.5,
            maximum: 1,
            minimum: 0,
            multipleOf: 0.01
          },
          image_url: {
            type: "string",
            title: "Image URL",
            format: "uri"
          },
          multi_shots: {
            type: "boolean",
            default: false
          },
          multi_prompt: {
            type: "array",
            items: {
              type: "object",
              properties: {
                prompt: {
                  type: "string",
                  maxLength: 512
                },
                duration: {
                  type: "integer",
                  maximum: 15,
                  minimum: 1
                }
              }
            },
            maxItems: 6,
            minItems: 1
          },
          last_image_url: {
            type: "string",
            title: "Image URL",
            format: "uri"
          }
        }
      },
      parameterNames: [
        "sound",
        "prompt",
        "duration",
        "elements",
        "cfg_scale",
        "image_url",
        "multi_shots",
        "multi_prompt",
        "last_image_url"
      ],
      usageNotes: "* image\\_url is the first frame; last\\_image\\_url optionally sets the final frame.\n* Always include a non-empty top-level prompt, including when using multi\\_prompt. Keep it within 2,500 characters; longer prompts are truncated.\n* For custom shots, set multi\\_shots to true and provide 1\u20136 multi\\_prompt objects. Each object needs prompt (at most 512 characters) and duration (a positive integer from 1 to 15 seconds).\n* Custom-shot durations are summed for generation and billing; the top-level duration does not override that sum. With multi\\_shots enabled and no custom shots, the top-level duration is retained.\n* Native audio uses sound: on or off and defaults to on.\n* elements contains Kling element IDs as decimal strings. Each ID must belong to the account making the request; arbitrary provider IDs are rejected.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/kling-3/standard-image-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:09.281783+00:00",
          snapshot: "evidence/docs-models__kling-3__standard-image-to-video.md",
          sha256: "ad34e71c8a07ea4359b49bd41654ea8f9605d14e188a705d8f10d575ec9c5dcd"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          sound: {
            enum: [
              "on",
              "off"
            ],
            type: "string",
            title: "Generate sound",
            default: "on"
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* image\\_url is the first frame; last\\_image\\_url optionally sets the final frame.\n* Always include a non-empty top-level prompt, including when using multi\\_prompt. Keep it within 2,500 characters; longer prompts are truncated.\n* For custom shots, set multi\\_shots to true and provide 1\u20136 multi\\_prompt objects. Each object needs prompt (at most 512 characters) and duration (a positive integer from 1 to 15 seconds).\n* Custom-shot durations are summed for generation and billing; the top-level duration does not override that sum. With multi\\_shots enabled and no custom shots, the top-level duration is retained.\n* Native audio uses sound: on or off and defaults to on.\n* elements contains Kling element IDs as decimal strings. Each ID must belong to the account making the request; arbitrary provider IDs are rejected.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/kling-video/v3.0/std/image-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-9482e4b0a165.txt",
        sha256: "5bb7b74232047654537f70949be2ad53e1d8b5d3f7169590fe8d2a9a1e6a6033"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'sound	string	No	"on"	Generate sound. Options: on, off.\nprompt	string	No	\u2014	Prompt.\nduration	integer	No	5	Duration. Minimum: 3. Maximum: 15.\nelements	array[string]	No	\u2014	\ncfg_scale	number	No	0.5	CFG Scale. Minimum: 0. Maximum: 1.\nimage_url	string	Yes	\u2014	Image URL.\nmulti_shots	boolean	No	false	\nmulti_prompt	array[object]	No	\u2014	\nlast_image_url	string	No	\u2014	Image URL.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/v3.0/std/text-to-video",
      title: "Kling 3.0 \u2014 Standard \xB7 Text to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/kling-3/standard-text-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:09.228016+00:00",
        snapshot: "evidence/docs-models__kling-3__standard-text-to-video.md",
        sha256: "21c2b8bdcbcd3cbd54d76e518053fc4bd890e19c3a4b646319be1d496c1515ed"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/v3.0/std/text-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Kling 3.0 Playground",
        properties: {
          sound: {
            enum: [
              "on",
              "off"
            ],
            type: "string",
            title: "Generate sound",
            default: "on"
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 15,
            minimum: 3
          },
          elements: {
            type: "array",
            items: {
              type: "string"
            }
          },
          cfg_scale: {
            type: "number",
            title: "CFG Scale",
            default: 0.5,
            maximum: 1,
            minimum: 0,
            multipleOf: 0.01
          },
          multi_shots: {
            type: "boolean",
            default: false
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "9:16",
              "1:1"
            ],
            type: "string",
            title: "Aspect ratio",
            default: "16:9"
          },
          multi_prompt: {
            type: "array",
            items: {
              type: "object",
              properties: {
                prompt: {
                  type: "string",
                  maxLength: 512
                },
                duration: {
                  type: "integer",
                  maximum: 15,
                  minimum: 1
                }
              }
            },
            maxItems: 6,
            minItems: 1
          }
        }
      },
      parameterNames: [
        "sound",
        "prompt",
        "duration",
        "elements",
        "cfg_scale",
        "multi_shots",
        "aspect_ratio",
        "multi_prompt"
      ],
      usageNotes: "* Always include a non-empty top-level prompt, including when using multi\\_prompt. Keep it within 2,500 characters; longer prompts are truncated.\n* For custom shots, set multi\\_shots to true and provide 1\u20136 multi\\_prompt objects. Each object needs prompt (at most 512 characters) and duration (a positive integer from 1 to 15 seconds).\n* Custom-shot durations are summed for generation and billing; the top-level duration does not override that sum. With multi\\_shots enabled and no custom shots, the top-level duration is retained.\n* Native audio uses sound: on or off and defaults to on.\n* elements contains Kling element IDs as decimal strings. Each ID must belong to the account making the request; arbitrary provider IDs are rejected.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/kling-3/standard-text-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:09.228016+00:00",
          snapshot: "evidence/docs-models__kling-3__standard-text-to-video.md",
          sha256: "21c2b8bdcbcd3cbd54d76e518053fc4bd890e19c3a4b646319be1d496c1515ed"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          sound: {
            enum: [
              "on",
              "off"
            ],
            type: "string",
            title: "Generate sound",
            default: "on"
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* Always include a non-empty top-level prompt, including when using multi\\_prompt. Keep it within 2,500 characters; longer prompts are truncated.\n* For custom shots, set multi\\_shots to true and provide 1\u20136 multi\\_prompt objects. Each object needs prompt (at most 512 characters) and duration (a positive integer from 1 to 15 seconds).\n* Custom-shot durations are summed for generation and billing; the top-level duration does not override that sum. With multi\\_shots enabled and no custom shots, the top-level duration is retained.\n* Native audio uses sound: on or off and defaults to on.\n* elements contains Kling element IDs as decimal strings. Each ID must belong to the account making the request; arbitrary provider IDs are rejected."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/kling-video/v3.0/std/text-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-bddf5efcf238.txt",
        sha256: "dd0c8da1facc3844c13eaf62c7bd9ee89ef50f5c153fcde6047fa4555f9a24b0"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'sound	string	No	"on"	Generate sound. Options: on, off.\nprompt	string	No	\u2014	Prompt.\nduration	integer	No	5	Duration. Minimum: 3. Maximum: 15.\nelements	array[string]	No	\u2014	\ncfg_scale	number	No	0.5	CFG Scale. Minimum: 0. Maximum: 1.\nmulti_shots	boolean	No	false	\naspect_ratio	string	No	"16:9"	Aspect ratio. Options: 16:9, 9:16, 1:1.\nmulti_prompt	array[object]	No	\u2014',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/v3.0-turbo/image-to-video",
      title: "Kling 3.0 \u2014 Turbo \xB7 Image to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/kling-3/turbo-image-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:06.381360+00:00",
        snapshot: "evidence/docs-models__kling-3__turbo-image-to-video.md",
        sha256: "1dbd40bca3c5425a8f7fba234354407419cc2de16097e354530baa6925b7cd93"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/v3.0-turbo/image-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Kling 3.0 Turbo",
        required: [
          "prompt",
          "image_url"
        ],
        properties: {
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 15,
            minimum: 3
          },
          image_url: {
            type: "string",
            title: "Image URL",
            format: "uri"
          },
          resolution: {
            enum: [
              "720p",
              "1080p"
            ],
            type: "string",
            title: "Resolution",
            default: "720p"
          }
        }
      },
      parameterNames: [
        "prompt",
        "duration",
        "image_url",
        "resolution"
      ],
      usageNotes: "* duration accepts integers from 3 to 15 seconds. resolution accepts 720p or 1080p and defaults to 720p.\n* This endpoint has no sound, multi\\_shots, elements, or last-frame field.\n* Keep prompt within 2,500 characters; longer prompts are truncated.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/kling-3/turbo-image-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:06.381360+00:00",
          snapshot: "evidence/docs-models__kling-3__turbo-image-to-video.md",
          sha256: "1dbd40bca3c5425a8f7fba234354407419cc2de16097e354530baa6925b7cd93"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* duration accepts integers from 3 to 15 seconds. resolution accepts 720p or 1080p and defaults to 720p.\n* This endpoint has no sound, multi\\_shots, elements, or last-frame field.\n* Keep prompt within 2,500 characters; longer prompts are truncated.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/kling-video/v3.0-turbo/image-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-727ddc68d8d6.txt",
        sha256: "8b0b748f13401e97953a4cbea405953d28569621816bc364d0ee9779213f136f"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	Duration. Minimum: 3. Maximum: 15.\nimage_url	string	Yes	\u2014	Image URL.\nresolution	string	No	"720p"	Resolution. Options: 720p, 1080p.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/v3.0-turbo/text-to-video",
      title: "Kling 3.0 \u2014 Turbo \xB7 Text to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/kling-3/turbo-text-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:09.111587+00:00",
        snapshot: "evidence/docs-models__kling-3__turbo-text-to-video.md",
        sha256: "9146aa0283fb04baaf33c6aec13bf067feee9282d7baa086bd1278c86e066ed5"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/v3.0-turbo/text-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Kling 3.0 Turbo",
        required: [
          "prompt"
        ],
        properties: {
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 15,
            minimum: 3
          },
          resolution: {
            enum: [
              "720p",
              "1080p"
            ],
            type: "string",
            title: "Resolution",
            default: "720p"
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "9:16",
              "1:1"
            ],
            type: "string",
            title: "Aspect ratio",
            default: "16:9"
          }
        }
      },
      parameterNames: [
        "prompt",
        "duration",
        "resolution",
        "aspect_ratio"
      ],
      usageNotes: "* duration accepts integers from 3 to 15 seconds. resolution accepts 720p or 1080p and defaults to 720p.\n* This endpoint has no sound, multi\\_shots, elements, or last-frame field.\n* aspect\\_ratio accepts 16:9, 9:16, or 1:1 and defaults to 16:9.\n* Keep prompt within 3,072 characters; longer prompts are truncated.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/kling-3/turbo-text-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:09.111587+00:00",
          snapshot: "evidence/docs-models__kling-3__turbo-text-to-video.md",
          sha256: "9146aa0283fb04baaf33c6aec13bf067feee9282d7baa086bd1278c86e066ed5"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* duration accepts integers from 3 to 15 seconds. resolution accepts 720p or 1080p and defaults to 720p.\n* This endpoint has no sound, multi\\_shots, elements, or last-frame field.\n* aspect\\_ratio accepts 16:9, 9:16, or 1:1 and defaults to 16:9.\n* Keep prompt within 3,072 characters; longer prompts are truncated."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/kling-video/v3.0-turbo/text-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-efff958f4d8e.txt",
        sha256: "22cbdce7b9a9291cd4f0433f73a9ca6924bba0c6642821a3345658d812152f0a"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	Duration. Minimum: 3. Maximum: 15.\nresolution	string	No	"720p"	Resolution. Options: 720p, 1080p.\naspect_ratio	string	No	"16:9"	Aspect ratio. Options: 16:9, 9:16, 1:1.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/o3/first-last-frame",
      title: "Kling O3 \u2014 First last frame API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/kling-o3/first-last-frame.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:06.601213+00:00",
        snapshot: "evidence/docs-models__kling-o3__first-last-frame.md",
        sha256: "d79418feec38c2512377062ac0c658eff0631a03058e0fed61bfda61b4a395ad"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/o3/first-last-frame",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        if: {
          properties: {
            multi_shots: {
              const: true
            }
          }
        },
        else: {
          required: [
            "prompt",
            "first_frame_url"
          ]
        },
        then: {
          required: [
            "multi_prompt",
            "first_frame_url"
          ]
        },
        type: "object",
        title: "Kling O3 Playground",
        properties: {
          mode: {
            enum: [
              "std",
              "pro",
              "4k"
            ],
            type: "string",
            default: "pro"
          },
          sound: {
            enum: [
              "on",
              "off"
            ],
            type: "string",
            default: "off"
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 15,
            minimum: 3
          },
          multi_shots: {
            type: "boolean",
            default: false
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "9:16",
              "1:1"
            ],
            type: "string"
          },
          multi_prompt: {
            type: "array",
            items: {
              type: "object",
              properties: {
                prompt: {
                  type: "string",
                  maxLength: 512
                },
                duration: {
                  type: "integer",
                  maximum: 15,
                  minimum: 1
                }
              }
            },
            maxItems: 6,
            minItems: 1
          },
          last_frame_url: {
            type: "string",
            title: "Last frame URL",
            format: "uri"
          },
          first_frame_url: {
            type: "string",
            title: "First frame URL",
            format: "uri"
          }
        }
      },
      parameterNames: [
        "mode",
        "sound",
        "prompt",
        "duration",
        "multi_shots",
        "aspect_ratio",
        "multi_prompt",
        "last_frame_url",
        "first_frame_url"
      ],
      usageNotes: "* first\\_frame\\_url supplies the starting frame; last\\_frame\\_url is optional. These names differ from the image\\_url and last\\_image\\_url fields on Kling 3.0 image-to-video.\n* For a single shot, set multi\\_shots to false and provide prompt. For multiple shots, set multi\\_shots to true and provide 1\u20136 multi\\_prompt objects, each containing prompt and a positive integer duration.\n* Always include a non-empty top-level prompt, including when using multi\\_prompt.\n* Each shot prompt is limited to 512 characters. Custom-shot durations are summed for generation and billing; the top-level duration does not override that sum.\n* Native audio uses sound: on or off and defaults to off.\n* Keep the top-level prompt within 2,500 characters; longer prompts are truncated.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/kling-o3/first-last-frame.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:06.601213+00:00",
          snapshot: "evidence/docs-models__kling-o3__first-last-frame.md",
          sha256: "d79418feec38c2512377062ac0c658eff0631a03058e0fed61bfda61b4a395ad"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          sound: {
            enum: [
              "on",
              "off"
            ],
            type: "string",
            default: "off"
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* first\\_frame\\_url supplies the starting frame; last\\_frame\\_url is optional. These names differ from the image\\_url and last\\_image\\_url fields on Kling 3.0 image-to-video.\n* For a single shot, set multi\\_shots to false and provide prompt. For multiple shots, set multi\\_shots to true and provide 1\u20136 multi\\_prompt objects, each containing prompt and a positive integer duration.\n* Always include a non-empty top-level prompt, including when using multi\\_prompt.\n* Each shot prompt is limited to 512 characters. Custom-shot durations are summed for generation and billing; the top-level duration does not override that sum.\n* Native audio uses sound: on or off and defaults to off.\n* Keep the top-level prompt within 2,500 characters; longer prompts are truncated.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/kling-video/o3/first-last-frame/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-5ae2bc6076c9.txt",
        sha256: "ccf6eec5e8a4e44cc5a96ec146c5adc5e8dbeaf5935f1cdb1c1702d0d618be16"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'mode	string	No	"pro"	Options: std, pro, 4k.\nsound	string	No	"off"	Options: on, off.\nprompt	string	No	\u2014	Prompt.\nduration	integer	No	5	Duration. Minimum: 3. Maximum: 15.\nmulti_shots	boolean	No	false	\naspect_ratio	string	No	\u2014	Options: 16:9, 9:16, 1:1.\nmulti_prompt	array[object]	No	\u2014	\nlast_frame_url	string	No	\u2014	Last frame URL.\nfirst_frame_url	string	No	\u2014	First frame URL.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/o3/image-reference",
      title: "Kling O3 \u2014 Image reference API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/kling-o3/image-reference.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:59.222705+00:00",
        snapshot: "evidence/docs-models__kling-o3__image-reference.md",
        sha256: "06e8702d4eac63db133bcfc4c586de55ab1f3e311e758f2399c8f38a0e33e0f2"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/o3/image-reference",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        if: {
          properties: {
            multi_shots: {
              const: true
            }
          }
        },
        else: {
          required: [
            "prompt"
          ]
        },
        then: {
          required: [
            "multi_prompt"
          ]
        },
        type: "object",
        title: "Kling Omni Playground",
        properties: {
          mode: {
            enum: [
              "std",
              "pro",
              "4k"
            ],
            type: "string",
            default: "std"
          },
          sound: {
            enum: [
              "on",
              "off"
            ],
            type: "string",
            default: "off"
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 15,
            minimum: 3
          },
          elements: {
            type: "array",
            items: {
              type: "string"
            }
          },
          shot_type: {
            enum: [
              "customize",
              "intelligent"
            ],
            type: "string",
            default: "customize"
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              title: "Image URL",
              format: "uri"
            }
          },
          multi_shots: {
            type: "boolean",
            default: false
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "9:16",
              "1:1"
            ],
            type: "string"
          },
          multi_prompt: {
            type: "array",
            items: {
              type: "object",
              properties: {
                prompt: {
                  type: "string",
                  maxLength: 512
                },
                duration: {
                  type: "integer",
                  maximum: 15,
                  minimum: 0
                }
              }
            },
            maxItems: 6,
            minItems: 1
          },
          last_frame_url: {
            type: "string",
            title: "Last frame URL",
            format: "uri"
          },
          first_frame_url: {
            type: "string",
            title: "First frame URL",
            format: "uri"
          }
        }
      },
      parameterNames: [
        "mode",
        "sound",
        "prompt",
        "duration",
        "elements",
        "shot_type",
        "image_urls",
        "multi_shots",
        "aspect_ratio",
        "multi_prompt",
        "last_frame_url",
        "first_frame_url"
      ],
      usageNotes: "* Supply image\\_urls for visual references. Reference images are optional in the schema.\n* For a single shot, set multi\\_shots to false and provide prompt. For multiple shots, set multi\\_shots to true and provide 1\u20136 multi\\_prompt objects, each containing prompt and a positive integer duration.\n* Always include a non-empty top-level prompt, including when using multi\\_prompt.\n* Each shot prompt is limited to 512 characters. Custom-shot durations are summed for generation and billing; the top-level duration does not override that sum.\n* Native audio uses sound: on or off and defaults to off.\n* A multi\\_prompt shot must last at least 1 second; zero-second shots are rejected even though the schema permits zero.\n* When multi\\_shots is true, multi\\_prompt is required even with shot\\_type set to intelligent.\n* Keep the top-level prompt within 2,500 characters; longer prompts are truncated.\n* elements contains Kling element IDs as decimal strings. Each ID must belong to the account making the request; arbitrary provider IDs are rejected.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/kling-o3/image-reference.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:59.222705+00:00",
          snapshot: "evidence/docs-models__kling-o3__image-reference.md",
          sha256: "06e8702d4eac63db133bcfc4c586de55ab1f3e311e758f2399c8f38a0e33e0f2"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          sound: {
            enum: [
              "on",
              "off"
            ],
            type: "string",
            default: "off"
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* Supply image\\_urls for visual references. Reference images are optional in the schema.\n* For a single shot, set multi\\_shots to false and provide prompt. For multiple shots, set multi\\_shots to true and provide 1\u20136 multi\\_prompt objects, each containing prompt and a positive integer duration.\n* Always include a non-empty top-level prompt, including when using multi\\_prompt.\n* Each shot prompt is limited to 512 characters. Custom-shot durations are summed for generation and billing; the top-level duration does not override that sum.\n* Native audio uses sound: on or off and defaults to off.\n* A multi\\_prompt shot must last at least 1 second; zero-second shots are rejected even though the schema permits zero.\n* When multi\\_shots is true, multi\\_prompt is required even with shot\\_type set to intelligent.\n* Keep the top-level prompt within 2,500 characters; longer prompts are truncated.\n* elements contains Kling element IDs as decimal strings. Each ID must belong to the account making the request; arbitrary provider IDs are rejected.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/kling-video/o3/image-reference/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-4d6db6d5acfa.txt",
        sha256: "11b82457b16467b6ce6add71d3276fbe9bee9fb70b65421f996ca736e4427792"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'mode	string	No	"std"	Options: std, pro, 4k.\nsound	string	No	"off"	Options: on, off.\nprompt	string	No	\u2014	Prompt.\nduration	integer	No	5	Duration. Minimum: 3. Maximum: 15.\nelements	array[string]	No	\u2014	\nshot_type	string	No	"customize"	Options: customize, intelligent.\nimage_urls	array[string]	No	\u2014	\nmulti_shots	boolean	No	false	\naspect_ratio	string	No	\u2014	Options: 16:9, 9:16, 1:1.\nmulti_prompt	array[object]	No	\u2014	\nlast_frame_url	string	No	\u2014	Last frame URL.\nfirst_frame_url	string	No	\u2014	First frame URL.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/o3/video-edit",
      title: "Kling O3 \u2014 Video edit API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/kling-o3/video-edit.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:06.626480+00:00",
        snapshot: "evidence/docs-models__kling-o3__video-edit.md",
        sha256: "65a2a4c4742ba0f6fec7f299d04a8275d5b52ef2ecfbe1949ee344fa75e88388"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/o3/video-edit",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Kling O3 Playground",
        required: [
          "prompt",
          "video_urls"
        ],
        properties: {
          mode: {
            enum: [
              "std",
              "pro",
              "4k"
            ],
            type: "string",
            default: "pro"
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          elements: {
            type: "array",
            items: {
              type: "string"
            },
            maxItems: 4,
            minItems: 0
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              title: "Image URL",
              format: "uri"
            },
            maxItems: 4,
            minItems: 0
          },
          video_urls: {
            type: "array",
            items: {
              type: "string",
              title: "Video URL",
              format: "uri"
            },
            maxItems: 1,
            minItems: 1
          }
        }
      },
      parameterNames: [
        "mode",
        "prompt",
        "elements",
        "image_urls",
        "video_urls"
      ],
      usageNotes: "* Supply exactly one source video from 3 to 15.5 seconds long and no larger than 200 MB. Duration is derived from the video; do not send a separate duration field.\n* You may also supply up to four image\\_urls and up to four elements.\n* Keep the top-level prompt within 2,500 characters; longer prompts are truncated.\n* elements contains Kling element IDs as decimal strings. Each ID must belong to the account making the request; arbitrary provider IDs are rejected.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/kling-o3/video-edit.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:06.626480+00:00",
          snapshot: "evidence/docs-models__kling-o3__video-edit.md",
          sha256: "65a2a4c4742ba0f6fec7f299d04a8275d5b52ef2ecfbe1949ee344fa75e88388"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/kling-video/o3/video-edit/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-1b43b0aa3efd.txt",
        sha256: "8641573194ec4ee9a6ee5148074bdad9783e35aa709fa796cd02e3e82341c339"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'mode	string	No	"pro"	Options: std, pro, 4k.\nprompt	string	Yes	\u2014	Prompt.\nelements	array[string]	No	\u2014	\nimage_urls	array[string]	No	\u2014	\nvideo_urls	array[string]	Yes	\u2014',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/o3/video-reference",
      title: "Kling O3 \u2014 Video reference API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/kling-o3/video-reference.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:59.260804+00:00",
        snapshot: "evidence/docs-models__kling-o3__video-reference.md",
        sha256: "534c4da49b8f8369e3e5a7df5090d71b5049d750dd3eece4029824f6754ef022"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/o3/video-reference",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Kling O3 Playground",
        required: [
          "prompt",
          "video_urls"
        ],
        properties: {
          mode: {
            enum: [
              "std",
              "pro"
            ],
            type: "string",
            default: "pro"
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 10,
            minimum: 3
          },
          elements: {
            type: "array",
            items: {
              type: "string"
            },
            maxItems: 4,
            minItems: 0
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              title: "Image URL",
              format: "uri"
            },
            maxItems: 4,
            minItems: 0
          },
          video_urls: {
            type: "array",
            items: {
              type: "string",
              title: "Video URL",
              format: "uri"
            },
            maxItems: 1,
            minItems: 1
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "9:16",
              "1:1"
            ],
            type: "string"
          }
        }
      },
      parameterNames: [
        "mode",
        "prompt",
        "duration",
        "elements",
        "image_urls",
        "video_urls",
        "aspect_ratio"
      ],
      usageNotes: "* Supply exactly one video reference. duration controls the generated clip and accepts integer values from 3 to 10 seconds.\n* You may also supply up to four image\\_urls and up to four elements.\n* Keep the top-level prompt within 2,500 characters; longer prompts are truncated.\n* elements contains Kling element IDs as decimal strings. Each ID must belong to the account making the request; arbitrary provider IDs are rejected.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/kling-o3/video-reference.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:59.260804+00:00",
          snapshot: "evidence/docs-models__kling-o3__video-reference.md",
          sha256: "534c4da49b8f8369e3e5a7df5090d71b5049d750dd3eece4029824f6754ef022"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* Supply exactly one video reference. duration controls the generated clip and accepts integer values from 3 to 10 seconds.\n* You may also supply up to four image\\_urls and up to four elements.\n* Keep the top-level prompt within 2,500 characters; longer prompts are truncated.\n* elements contains Kling element IDs as decimal strings. Each ID must belong to the account making the request; arbitrary provider IDs are rejected.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/kling-video/o3/video-reference/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-6d7cd0b55aee.txt",
        sha256: "cd6caf3792476bb2f44a5ff87456419c7fc6e10b4943aea75526b215f2a2c30f"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'mode	string	No	"pro"	Options: std, pro.\nprompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	Duration. Minimum: 3. Maximum: 10.\nelements	array[string]	No	\u2014	\nimage_urls	array[string]	No	\u2014	\nvideo_urls	array[string]	Yes	\u2014	\naspect_ratio	string	No	\u2014	Options: 16:9, 9:16, 1:1.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/omni/first-last-frame",
      title: "Kling Omni \u2014 First last frame API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/kling-omni/first-last-frame.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:09.082019+00:00",
        snapshot: "evidence/docs-models__kling-omni__first-last-frame.md",
        sha256: "32642a3a150343cd77f43df19565a4b6177348effe37507879be10c5a9be6da0"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/omni/first-last-frame",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Kling Omni Playground",
        required: [
          "prompt",
          "first_frame_url"
        ],
        properties: {
          mode: {
            enum: [
              "std",
              "pro"
            ],
            type: "string",
            default: "pro"
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            enum: [
              5,
              10
            ],
            type: "integer",
            title: "Duration",
            default: 5
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "9:16",
              "1:1"
            ],
            type: "string",
            default: "16:9"
          },
          last_frame_url: {
            type: "string",
            title: "Last frame URL",
            format: "uri"
          },
          first_frame_url: {
            type: "string",
            title: "First frame URL",
            format: "uri"
          }
        }
      },
      parameterNames: [
        "mode",
        "prompt",
        "duration",
        "aspect_ratio",
        "last_frame_url",
        "first_frame_url"
      ],
      usageNotes: "* first\\_frame\\_url supplies the starting frame; last\\_frame\\_url is optional. These names differ from the image\\_url and last\\_image\\_url fields on Kling 3.0 image-to-video.\n* Keep the top-level prompt within 2,500 characters; longer prompts are truncated.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/kling-omni/first-last-frame.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:09.082019+00:00",
          snapshot: "evidence/docs-models__kling-omni__first-last-frame.md",
          sha256: "32642a3a150343cd77f43df19565a4b6177348effe37507879be10c5a9be6da0"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/kling-video/omni/first-last-frame/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-4d49a405859e.txt",
        sha256: "b99d4ab99ee7ca0429ca832b1f3dc6092e363da2fd3a216a20e33fb82461f93c"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'mode	string	No	"pro"	Options: std, pro.\nprompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	Duration. Options: 5, 10.\naspect_ratio	string	No	"16:9"	Options: 16:9, 9:16, 1:1.\nlast_frame_url	string	No	\u2014	Last frame URL.\nfirst_frame_url	string	Yes	\u2014	First frame URL.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/omni/image-reference",
      title: "Kling Omni \u2014 Image reference API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/kling-omni/image-reference.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:06.613779+00:00",
        snapshot: "evidence/docs-models__kling-omni__image-reference.md",
        sha256: "4c5d55925b05694189db576c2abfe6a1cc2ce36e3ea8ed2fcfa1410b51c432f2"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/omni/image-reference",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Kling Omni Playground",
        required: [
          "prompt"
        ],
        properties: {
          mode: {
            enum: [
              "std",
              "pro"
            ],
            type: "string",
            default: "pro"
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 10,
            minimum: 3
          },
          elements: {
            type: "array",
            items: {
              type: "string"
            }
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              title: "Image URL",
              format: "uri"
            }
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "9:16",
              "1:1"
            ],
            type: "string",
            default: "16:9"
          }
        }
      },
      parameterNames: [
        "mode",
        "prompt",
        "duration",
        "elements",
        "image_urls",
        "aspect_ratio"
      ],
      usageNotes: "* Supply image\\_urls for visual references. Reference images are optional in the schema.\n* Keep the top-level prompt within 2,500 characters; longer prompts are truncated.\n* elements contains Kling element IDs as decimal strings. Each ID must belong to the account making the request; arbitrary provider IDs are rejected.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/kling-omni/image-reference.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:06.613779+00:00",
          snapshot: "evidence/docs-models__kling-omni__image-reference.md",
          sha256: "4c5d55925b05694189db576c2abfe6a1cc2ce36e3ea8ed2fcfa1410b51c432f2"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/kling-video/omni/image-reference/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-da7d3f0653b6.txt",
        sha256: "32d5c81656da61a8fd7ccaabc881c17598eac1748a506226f98bc6ae0566e3ee"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'mode	string	No	"pro"	Options: std, pro.\nprompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	Duration. Minimum: 3. Maximum: 10.\nelements	array[string]	No	\u2014	\nimage_urls	array[string]	No	\u2014	\naspect_ratio	string	No	"16:9"	Options: 16:9, 9:16, 1:1.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/omni/video-edit",
      title: "Kling Omni \u2014 Video edit API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/kling-omni/video-edit.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:09.263903+00:00",
        snapshot: "evidence/docs-models__kling-omni__video-edit.md",
        sha256: "242c36f9687b7d231de72d46f56c6030905602d535f25f606eae986d188b42e0"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/omni/video-edit",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Kling Omni Playground",
        required: [
          "prompt",
          "video_urls"
        ],
        properties: {
          mode: {
            enum: [
              "std",
              "pro"
            ],
            type: "string",
            default: "pro"
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          elements: {
            type: "array",
            items: {
              type: "string"
            },
            maxItems: 4,
            minItems: 0
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              title: "Image URL",
              format: "uri"
            },
            maxItems: 4,
            minItems: 0
          },
          video_urls: {
            type: "array",
            items: {
              type: "string",
              title: "Video URL",
              format: "uri"
            },
            maxItems: 1,
            minItems: 1
          }
        }
      },
      parameterNames: [
        "mode",
        "prompt",
        "elements",
        "image_urls",
        "video_urls"
      ],
      usageNotes: "* Supply exactly one source video from 3 to 10 seconds long and no larger than 200 MB. Duration is derived from the video; do not send a separate duration field.\n* You may also supply up to four image\\_urls and up to four elements.\n* Keep the top-level prompt within 2,500 characters; longer prompts are truncated.\n* elements contains Kling element IDs as decimal strings. Each ID must belong to the account making the request; arbitrary provider IDs are rejected.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/kling-omni/video-edit.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:09.263903+00:00",
          snapshot: "evidence/docs-models__kling-omni__video-edit.md",
          sha256: "242c36f9687b7d231de72d46f56c6030905602d535f25f606eae986d188b42e0"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/kling-video/omni/video-edit/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-a1146fc0126c.txt",
        sha256: "89c7b38c6f21078cd5c1893fb6fe85f969bef73c91d6a8ad8614e0b47b03ed8c"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'mode	string	No	"pro"	Options: std, pro.\nprompt	string	Yes	\u2014	Prompt.\nelements	array[string]	No	\u2014	\nimage_urls	array[string]	No	\u2014	\nvideo_urls	array[string]	Yes	\u2014',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/omni/video-reference",
      title: "Kling Omni \u2014 Video reference API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/kling-omni/video-reference.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:07.561769+00:00",
        snapshot: "evidence/docs-models__kling-omni__video-reference.md",
        sha256: "9dd14310df0cfae2d16ed4ae3de43b6a7c58058b6f8ff588d1cb61fd9cf45bf6"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/omni/video-reference",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Kling Omni Playground",
        required: [
          "prompt",
          "video_urls"
        ],
        properties: {
          mode: {
            enum: [
              "std",
              "pro"
            ],
            type: "string",
            default: "pro"
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            mode: {
              enum: [
                "std",
                "pro"
              ],
              type: "string",
              default: "pro"
            },
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 10,
            minimum: 3
          },
          elements: {
            type: "array",
            items: {
              type: "string"
            },
            maxItems: 4,
            minItems: 0
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              title: "Image URL",
              format: "uri"
            },
            maxItems: 4,
            minItems: 0
          },
          video_urls: {
            type: "array",
            items: {
              type: "string",
              title: "Video URL",
              format: "uri"
            },
            maxItems: 1,
            minItems: 1
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "9:16",
              "1:1"
            ],
            type: "string",
            default: "16:9"
          }
        }
      },
      parameterNames: [
        "mode",
        "prompt",
        "duration",
        "elements",
        "image_urls",
        "video_urls",
        "aspect_ratio"
      ],
      usageNotes: "* Supply exactly one video reference. duration controls the generated clip and accepts integer values from 3 to 10 seconds.\n* You may also supply up to four image\\_urls and up to four elements.\n* Keep the top-level prompt within 2,500 characters; longer prompts are truncated.\n* elements contains Kling element IDs as decimal strings. Each ID must belong to the account making the request; arbitrary provider IDs are rejected.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/kling-omni/video-reference.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:07.561769+00:00",
          snapshot: "evidence/docs-models__kling-omni__video-reference.md",
          sha256: "9dd14310df0cfae2d16ed4ae3de43b6a7c58058b6f8ff588d1cb61fd9cf45bf6"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* Supply exactly one video reference. duration controls the generated clip and accepts integer values from 3 to 10 seconds.\n* You may also supply up to four image\\_urls and up to four elements.\n* Keep the top-level prompt within 2,500 characters; longer prompts are truncated.\n* elements contains Kling element IDs as decimal strings. Each ID must belong to the account making the request; arbitrary provider IDs are rejected.\n* The example.com media URLs are placeholders. Replace them with public HTTPS URLs to your own media before submitting."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/kling-video/omni/video-reference/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-b743bed7861a.txt",
        sha256: "5ea734046e1f304d605e95030f3b9b3914c108cf859b2a4d991d37675859cd3c"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'mode	string	No	"pro"	Options: std, pro.\nprompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	Duration. Minimum: 3. Maximum: 10.\nelements	array[string]	No	\u2014	\nimage_urls	array[string]	No	\u2014	\nvideo_urls	array[string]	Yes	\u2014	\naspect_ratio	string	No	"16:9"	Options: 16:9, 9:16, 1:1.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "lightricks/ltx-2.5/image-to-video/fast",
      title: "LTX-2.5 \u2014 Image to video fast API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/ltx-2-5/image-to-video-fast.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:09.310672+00:00",
        snapshot: "evidence/docs-models__ltx-2-5__image-to-video-fast.md",
        sha256: "eec3f833ac2b95580cfbb05386888618ad5ec522bd4a4633e58c46feaced9ed4"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/lightricks/ltx-2.5/image-to-video/fast",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "LTX-2.5 Fast Image to Video Playground",
        required: [
          "prompt",
          "duration",
          "image_url"
        ],
        properties: {
          fps: {
            enum: [
              24,
              25,
              48,
              50
            ],
            type: "integer",
            title: "Frames per second",
            default: 25
          },
          prompt: {
            type: "string",
            title: "Prompt",
            maxLength: 5e3,
            minLength: 2,
            description: "Write your prompt here"
          },
          duration: {
            enum: [
              6,
              8,
              10
            ],
            type: "integer",
            title: "Duration",
            default: 6
          },
          image_url: {
            type: "string",
            title: "First frame",
            format: "uri"
          },
          resolution: {
            enum: [
              "720p",
              "1080p",
              "2k",
              "4k"
            ],
            type: "string",
            title: "Resolution",
            default: "720p"
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "9:16"
            ],
            type: "string",
            title: "Aspect ratio",
            default: "16:9"
          },
          end_image_url: {
            type: "string",
            title: "Last frame",
            format: "uri"
          },
          generate_audio: {
            type: "boolean",
            title: "Generate audio",
            default: true
          },
          camera_movement: {
            enum: [
              "dolly_in",
              "dolly_out",
              "dolly_left",
              "dolly_right",
              "jib_up",
              "jib_down",
              "static",
              "focus_shift"
            ],
            type: "string",
            title: "Camera movement"
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "fps",
        "prompt",
        "duration",
        "image_url",
        "resolution",
        "aspect_ratio",
        "end_image_url",
        "generate_audio",
        "camera_movement"
      ],
      usageNotes: "* duration is marked required in the schema and has default 6; the API applies this top-level default before validation. The example includes it explicitly.\n* Fast supports 720p, 1080p, 2k or 4k and 24, 25, 48 or 50 fps.\n* image\\_url is the required first frame; end\\_image\\_url is an optional last frame. aspect\\_ratio explicitly controls output dimensions.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/ltx-2-5/image-to-video-fast.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:09.310672+00:00",
          snapshot: "evidence/docs-models__ltx-2-5__image-to-video-fast.md",
          sha256: "eec3f833ac2b95580cfbb05386888618ad5ec522bd4a4633e58c46feaced9ed4"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          generate_audio: {
            type: "boolean",
            title: "Generate audio",
            default: true
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/lightricks/ltx-2.5/image-to-video/fast/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-dc011c843f91.txt",
        sha256: "1931b7a89143ded9290a8a163a14e43a40b7c0474c03c65b3662b953d27158ea"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'fps	integer	No	25	Frames per second. Options: 24, 25, 48, 50.\nprompt	string	Yes	\u2014	Prompt. Minimum length: 2. Maximum length: 5000.\nduration	integer	Yes	6	Duration. Options: 6, 8, 10.\nimage_url	string	Yes	\u2014	First frame.\nresolution	string	No	"720p"	Resolution. Options: 720p, 1080p, 2k, 4k.\naspect_ratio	string	No	"16:9"	Aspect ratio. Options: 16:9, 9:16.\nend_image_url	string	No	\u2014	Last frame.\ngenerate_audio	boolean	No	true	Generate audio.\ncamera_movement	string	No	\u2014	Camera movement. Options: dolly_in, dolly_out, dolly_left, dolly_right, jib_up, jib_down, static, focus_shift.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "lightricks/ltx-2.5/image-to-video/pro",
      title: "LTX-2.5 \u2014 Image to video pro API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/ltx-2-5/image-to-video-pro.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:09.191129+00:00",
        snapshot: "evidence/docs-models__ltx-2-5__image-to-video-pro.md",
        sha256: "29c889ef56e04317b8a87427bda03a427205924c0e26c5685cc3bdc6797bc24f"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/lightricks/ltx-2.5/image-to-video/pro",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "LTX-2.5 Pro Image to Video Playground",
        required: [
          "prompt",
          "duration",
          "image_url"
        ],
        properties: {
          fps: {
            enum: [
              24,
              25,
              50
            ],
            type: "integer",
            title: "Frames per second",
            default: 25
          },
          prompt: {
            type: "string",
            title: "Prompt",
            maxLength: 5e3,
            minLength: 2,
            description: "Write your prompt here"
          },
          duration: {
            enum: [
              6,
              8,
              10
            ],
            type: "integer",
            title: "Duration",
            default: 6
          },
          image_url: {
            type: "string",
            title: "First frame",
            format: "uri"
          },
          resolution: {
            enum: [
              "720p",
              "1080p"
            ],
            type: "string",
            title: "Resolution",
            default: "720p"
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "9:16"
            ],
            type: "string",
            title: "Aspect ratio",
            default: "16:9"
          },
          end_image_url: {
            type: "string",
            title: "Last frame",
            format: "uri"
          },
          generate_audio: {
            type: "boolean",
            title: "Generate audio",
            default: true
          },
          camera_movement: {
            enum: [
              "dolly_in",
              "dolly_out",
              "dolly_left",
              "dolly_right",
              "jib_up",
              "jib_down",
              "static",
              "focus_shift"
            ],
            type: "string",
            title: "Camera movement"
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "fps",
        "prompt",
        "duration",
        "image_url",
        "resolution",
        "aspect_ratio",
        "end_image_url",
        "generate_audio",
        "camera_movement"
      ],
      usageNotes: "* duration is marked required in the schema and has default 6; the API applies this top-level default before validation. The example includes it explicitly.\n* Pro supports 720p or 1080p and 24, 25 or 50 fps. Use the Fast endpoint for 2k, 4k or 48 fps.\n* image\\_url is the required first frame; end\\_image\\_url is an optional last frame. aspect\\_ratio explicitly controls output dimensions.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/ltx-2-5/image-to-video-pro.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:09.191129+00:00",
          snapshot: "evidence/docs-models__ltx-2-5__image-to-video-pro.md",
          sha256: "29c889ef56e04317b8a87427bda03a427205924c0e26c5685cc3bdc6797bc24f"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          generate_audio: {
            type: "boolean",
            title: "Generate audio",
            default: true
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/lightricks/ltx-2.5/image-to-video/pro/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-21463b62dcce.txt",
        sha256: "b46a8d9764a75517aa72516ab5ac88120286357dff28b6d7218c78df0ce3132a"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'fps	integer	No	25	Frames per second. Options: 24, 25, 50.\nprompt	string	Yes	\u2014	Prompt. Minimum length: 2. Maximum length: 5000.\nduration	integer	Yes	6	Duration. Options: 6, 8, 10.\nimage_url	string	Yes	\u2014	First frame.\nresolution	string	No	"720p"	Resolution. Options: 720p, 1080p.\naspect_ratio	string	No	"16:9"	Aspect ratio. Options: 16:9, 9:16.\nend_image_url	string	No	\u2014	Last frame.\ngenerate_audio	boolean	No	true	Generate audio.\ncamera_movement	string	No	\u2014	Camera movement. Options: dolly_in, dolly_out, dolly_left, dolly_right, jib_up, jib_down, static, focus_shift.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "lightricks/ltx-2.5/text-to-video/fast",
      title: "LTX-2.5 \u2014 Text to video fast API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/ltx-2-5/text-to-video-fast.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:09.920979+00:00",
        snapshot: "evidence/docs-models__ltx-2-5__text-to-video-fast.md",
        sha256: "a2cfbbc75e3cff5b06fd682b37b91f4987efb7d339019dd6aadffa7f379cab08"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/lightricks/ltx-2.5/text-to-video/fast",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "LTX-2.5 Fast Text to Video Playground",
        required: [
          "prompt",
          "duration"
        ],
        properties: {
          fps: {
            enum: [
              24,
              25,
              48,
              50
            ],
            type: "integer",
            title: "Frames per second",
            default: 25
          },
          prompt: {
            type: "string",
            title: "Prompt",
            maxLength: 5e3,
            minLength: 2,
            description: "Write your prompt here"
          },
          duration: {
            enum: [
              6,
              8,
              10
            ],
            type: "integer",
            title: "Duration",
            default: 6
          },
          resolution: {
            enum: [
              "720p",
              "1080p",
              "2k",
              "4k"
            ],
            type: "string",
            title: "Resolution",
            default: "720p"
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "9:16"
            ],
            type: "string",
            title: "Aspect ratio",
            default: "16:9"
          },
          generate_audio: {
            type: "boolean",
            title: "Generate audio",
            default: true
          },
          camera_movement: {
            enum: [
              "dolly_in",
              "dolly_out",
              "dolly_left",
              "dolly_right",
              "jib_up",
              "jib_down",
              "static",
              "focus_shift"
            ],
            type: "string",
            title: "Camera movement"
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "fps",
        "prompt",
        "duration",
        "resolution",
        "aspect_ratio",
        "generate_audio",
        "camera_movement"
      ],
      usageNotes: "* duration is marked required in the schema and has default 6; the API applies this top-level default before validation. The example includes it explicitly.\n* Fast supports 720p, 1080p, 2k or 4k and 24, 25, 48 or 50 fps.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/ltx-2-5/text-to-video-fast.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:09.920979+00:00",
          snapshot: "evidence/docs-models__ltx-2-5__text-to-video-fast.md",
          sha256: "a2cfbbc75e3cff5b06fd682b37b91f4987efb7d339019dd6aadffa7f379cab08"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          generate_audio: {
            type: "boolean",
            title: "Generate audio",
            default: true
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/lightricks/ltx-2.5/text-to-video/fast/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-0fb71746e4a6.txt",
        sha256: "a4411998c37988759c72639539b1369e99a1bce2c1d919d635f218538679b28a"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'fps	integer	No	25	Frames per second. Options: 24, 25, 48, 50.\nprompt	string	Yes	\u2014	Prompt. Minimum length: 2. Maximum length: 5000.\nduration	integer	Yes	6	Duration. Options: 6, 8, 10.\nresolution	string	No	"720p"	Resolution. Options: 720p, 1080p, 2k, 4k.\naspect_ratio	string	No	"16:9"	Aspect ratio. Options: 16:9, 9:16.\ngenerate_audio	boolean	No	true	Generate audio.\ncamera_movement	string	No	\u2014	Camera movement. Options: dolly_in, dolly_out, dolly_left, dolly_right, jib_up, jib_down, static, focus_shift.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "lightricks/ltx-2.5/text-to-video/pro",
      title: "LTX-2.5 \u2014 Text to video pro API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/ltx-2-5/text-to-video-pro.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:09.953992+00:00",
        snapshot: "evidence/docs-models__ltx-2-5__text-to-video-pro.md",
        sha256: "9e19347d7b3c5fd75fd5eb575e1059c4d12e98405e2539bfda4dadce932b4132"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/lightricks/ltx-2.5/text-to-video/pro",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "LTX-2.5 Pro Text to Video Playground",
        required: [
          "prompt",
          "duration"
        ],
        properties: {
          fps: {
            enum: [
              24,
              25,
              50
            ],
            type: "integer",
            title: "Frames per second",
            default: 25
          },
          prompt: {
            type: "string",
            title: "Prompt",
            maxLength: 5e3,
            minLength: 2,
            description: "Write your prompt here"
          },
          duration: {
            enum: [
              6,
              8,
              10
            ],
            type: "integer",
            title: "Duration",
            default: 6
          },
          resolution: {
            enum: [
              "720p",
              "1080p"
            ],
            type: "string",
            title: "Resolution",
            default: "720p"
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "9:16"
            ],
            type: "string",
            title: "Aspect ratio",
            default: "16:9"
          },
          generate_audio: {
            type: "boolean",
            title: "Generate audio",
            default: true
          },
          camera_movement: {
            enum: [
              "dolly_in",
              "dolly_out",
              "dolly_left",
              "dolly_right",
              "jib_up",
              "jib_down",
              "static",
              "focus_shift"
            ],
            type: "string",
            title: "Camera movement"
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "fps",
        "prompt",
        "duration",
        "resolution",
        "aspect_ratio",
        "generate_audio",
        "camera_movement"
      ],
      usageNotes: "* duration is marked required in the schema and has default 6; the API applies this top-level default before validation. The example includes it explicitly.\n* Pro supports 720p or 1080p and 24, 25 or 50 fps. Use the Fast endpoint for 2k, 4k or 48 fps.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/ltx-2-5/text-to-video-pro.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:09.953992+00:00",
          snapshot: "evidence/docs-models__ltx-2-5__text-to-video-pro.md",
          sha256: "9e19347d7b3c5fd75fd5eb575e1059c4d12e98405e2539bfda4dadce932b4132"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          generate_audio: {
            type: "boolean",
            title: "Generate audio",
            default: true
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/lightricks/ltx-2.5/text-to-video/pro/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-e56ce6aee4a2.txt",
        sha256: "1855a2edfec01daff40e5948965ce1bf3b7c740b8278237a7a23305240b8f2eb"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'fps	integer	No	25	Frames per second. Options: 24, 25, 50.\nprompt	string	Yes	\u2014	Prompt. Minimum length: 2. Maximum length: 5000.\nduration	integer	Yes	6	Duration. Options: 6, 8, 10.\nresolution	string	No	"720p"	Resolution. Options: 720p, 1080p.\naspect_ratio	string	No	"16:9"	Aspect ratio. Options: 16:9, 9:16.\ngenerate_audio	boolean	No	true	Generate audio.\ncamera_movement	string	No	\u2014	Camera movement. Options: dolly_in, dolly_out, dolly_left, dolly_right, jib_up, jib_down, static, focus_shift.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "marketing-studio/image/flare",
      title: "Marketing Studio Image \u2014 2.5 Flare API",
      category: "image",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/marketing-studio-image/flare.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:06.613779+00:00",
        snapshot: "evidence/docs-models__marketing-studio-image__flare.md",
        sha256: "92cea02ce99545b97ca348e9b43183fcacc6bf79763ed42f2da4f97ea1c4402a"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/marketing-studio/image/flare",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        allOf: [
          {
            if: {
              required: [
                "enhance_prompt"
              ],
              properties: {
                enhance_prompt: {
                  const: true
                }
              }
            },
            then: {
              required: [
                "preset_id",
                "image_urls"
              ],
              properties: {
                image_urls: {
                  maxItems: 2,
                  minItems: 1
                }
              }
            }
          }
        ],
        title: "Marketing Studio Image 2.5 Flare",
        required: [
          "prompt"
        ],
        properties: {
          prompt: {
            type: "string",
            title: "Prompt",
            maxLength: 5e3,
            minLength: 1,
            description: "Write your prompt here"
          },
          quality: {
            enum: [
              "low",
              "medium",
              "high",
              "xhigh",
              "max"
            ],
            type: "string",
            title: "Quality",
            default: "high"
          },
          preset_id: {
            type: "string",
            title: "Preset ID",
            format: "uuid"
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            title: "Image URLs",
            maxItems: 16,
            minItems: 0
          },
          moderation: {
            enum: [
              "auto",
              "low"
            ],
            type: "string",
            default: "auto"
          },
          resolution: {
            enum: [
              "1k",
              "2k",
              "4k"
            ],
            type: "string",
            title: "Resolution",
            default: "2k"
          },
          aspect_ratio: {
            enum: [
              "auto",
              "1:1",
              "3:2",
              "2:3",
              "4:3",
              "3:4",
              "16:9",
              "9:16",
              "21:9"
            ],
            type: "string",
            title: "Aspect Ratio",
            default: "auto"
          },
          enhance_prompt: {
            type: "boolean",
            title: "Enhance prompt",
            default: false
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "prompt",
        "quality",
        "preset_id",
        "image_urls",
        "moderation",
        "resolution",
        "aspect_ratio",
        "enhance_prompt"
      ],
      usageNotes: "* Omit image\\_urls for text-to-image; provide up to 16 URLs for editing when enhance\\_prompt=false.\n* enhance\\_prompt=true requires an existing preset\\_id and 1\u20132 image URLs: product first, optional person/model reference second. Discover presets with GET /marketing-studio/image/presets.\n* Reference images must be valid JPEG, PNG, or WebP. Oversized supported images are normalized before rendering.\n* With enhancement enabled, aspect\\_ratio=auto uses the preset ratio. With enhancement disabled, current production mappings use square output for auto.\n* The 1k/2k/4k values are resolution tiers; exact pixel dimensions depend on the aspect ratio.\n* quality accepts low, medium, high, xhigh, max and remains selectable with enhancement enabled.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "image",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "images": [\n    {\n      "url": "https://example.com/output.png"\n    }\n  ]\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/marketing-studio-image/flare.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:06.613779+00:00",
          snapshot: "evidence/docs-models__marketing-studio-image__flare.md",
          sha256: "92cea02ce99545b97ca348e9b43183fcacc6bf79763ed42f2da4f97ea1c4402a"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "image",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/marketing-studio/image/flare/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-f0c364017bca.txt",
        sha256: "6560d142c038863ed21937249a3f6177f2ecb72390c65775a30e4a0a126025b4"
      },
      consoleObservation: "reference captured",
      consoleSchemaStatus: "parameter-table-not-present; docs schema retained as dated documentation only",
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "marketing-studio/image",
      title: "Marketing Studio Image \u2014 2.0 Alpha API",
      category: "image",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/marketing-studio-image/generate-and-edit.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:06.784452+00:00",
        snapshot: "evidence/docs-models__marketing-studio-image__generate-and-edit.md",
        sha256: "38ebd9491c05c2f5a3f3df26a2163d9434d6c50c751a571714857c59f8688b91"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/marketing-studio/image",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        allOf: [
          {
            if: {
              required: [
                "enhance_prompt"
              ],
              properties: {
                enhance_prompt: {
                  const: true
                }
              }
            },
            then: {
              required: [
                "preset_id",
                "image_urls"
              ],
              properties: {
                quality: {
                  const: "high"
                },
                image_urls: {
                  maxItems: 2,
                  minItems: 1
                }
              }
            }
          }
        ],
        title: "Marketing Studio Image 2.0 Alpha",
        required: [
          "prompt"
        ],
        properties: {
          prompt: {
            type: "string",
            title: "Prompt",
            maxLength: 5e3,
            minLength: 1,
            description: "Write your prompt here"
          },
          quality: {
            enum: [
              "low",
              "medium",
              "high"
            ],
            type: "string",
            default: "high"
          },
          preset_id: {
            type: "string",
            title: "Preset ID",
            format: "uuid"
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            title: "Image URLs",
            maxItems: 16,
            minItems: 0
          },
          moderation: {
            enum: [
              "auto",
              "low"
            ],
            type: "string",
            default: "auto"
          },
          resolution: {
            enum: [
              "1k",
              "2k",
              "4k"
            ],
            type: "string",
            title: "Resolution",
            default: "2k"
          },
          aspect_ratio: {
            enum: [
              "auto",
              "1:1",
              "3:2",
              "2:3",
              "4:3",
              "3:4",
              "16:9",
              "9:16",
              "21:9"
            ],
            type: "string",
            title: "Aspect Ratio",
            default: "auto"
          },
          enhance_prompt: {
            type: "boolean",
            title: "Enhance prompt",
            default: false
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "prompt",
        "quality",
        "preset_id",
        "image_urls",
        "moderation",
        "resolution",
        "aspect_ratio",
        "enhance_prompt"
      ],
      usageNotes: "* Omit image\\_urls for text-to-image; provide up to 16 URLs for editing when enhance\\_prompt=false.\n* enhance\\_prompt=true requires an existing preset\\_id and 1\u20132 image URLs: product first, optional person/model reference second. Discover presets with GET /marketing-studio/image/presets.\n* Reference images must be valid JPEG, PNG, or WebP. Oversized supported images are normalized before rendering.\n* With enhancement enabled, aspect\\_ratio=auto uses the preset ratio. With enhancement disabled, current production mappings use square output for auto.\n* The 1k/2k/4k values are resolution tiers; exact pixel dimensions depend on the aspect ratio.\n* With enhance\\_prompt=true, quality must be high. This endpoint accepts low, medium, or high for unenhanced requests.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "image",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "images": [\n    {\n      "url": "https://example.com/output.png"\n    }\n  ]\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/marketing-studio-image/generate-and-edit.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:06.784452+00:00",
          snapshot: "evidence/docs-models__marketing-studio-image__generate-and-edit.md",
          sha256: "38ebd9491c05c2f5a3f3df26a2163d9434d6c50c751a571714857c59f8688b91"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "image",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/marketing-studio/image/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-d640e9603784.txt",
        sha256: "598b9f0564d6d7bda9d7035409ef22999f32630b56bbb8fe684e5c783e2c6ebc"
      },
      consoleObservation: "reference captured",
      consoleSchemaStatus: "parameter-table-not-present; docs schema retained as dated documentation only",
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "marketing-studio/image/sunburst",
      title: "Marketing Studio Image \u2014 2.5 Sunburst API",
      category: "image",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/marketing-studio-image/sunburst.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:06.795965+00:00",
        snapshot: "evidence/docs-models__marketing-studio-image__sunburst.md",
        sha256: "c2f20e02fdddab36370eab2b616fc302be40865ae2ee767c39333d9b759406e7"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/marketing-studio/image/sunburst",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        allOf: [
          {
            if: {
              required: [
                "enhance_prompt"
              ],
              properties: {
                enhance_prompt: {
                  const: true
                }
              }
            },
            then: {
              required: [
                "preset_id",
                "image_urls"
              ],
              properties: {
                image_urls: {
                  maxItems: 2,
                  minItems: 1
                }
              }
            }
          }
        ],
        title: "Marketing Studio Image 2.5 Sunburst",
        required: [
          "prompt"
        ],
        properties: {
          prompt: {
            type: "string",
            title: "Prompt",
            maxLength: 5e3,
            minLength: 1,
            description: "Write your prompt here"
          },
          quality: {
            enum: [
              "low",
              "medium",
              "high",
              "xhigh",
              "max"
            ],
            type: "string",
            title: "Quality",
            default: "high"
          },
          preset_id: {
            type: "string",
            title: "Preset ID",
            format: "uuid"
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            title: "Image URLs",
            maxItems: 16,
            minItems: 0
          },
          moderation: {
            enum: [
              "auto",
              "low"
            ],
            type: "string",
            default: "auto"
          },
          resolution: {
            enum: [
              "1k",
              "2k",
              "4k"
            ],
            type: "string",
            title: "Resolution",
            default: "2k"
          },
          aspect_ratio: {
            enum: [
              "auto",
              "1:1",
              "3:2",
              "2:3",
              "4:3",
              "3:4",
              "16:9",
              "9:16",
              "21:9"
            ],
            type: "string",
            title: "Aspect Ratio",
            default: "auto"
          },
          enhance_prompt: {
            type: "boolean",
            title: "Enhance prompt",
            default: false
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "prompt",
        "quality",
        "preset_id",
        "image_urls",
        "moderation",
        "resolution",
        "aspect_ratio",
        "enhance_prompt"
      ],
      usageNotes: "* Omit image\\_urls for text-to-image; provide up to 16 URLs for editing when enhance\\_prompt=false.\n* enhance\\_prompt=true requires an existing preset\\_id and 1\u20132 image URLs: product first, optional person/model reference second. Discover presets with GET /marketing-studio/image/presets.\n* Reference images must be valid JPEG, PNG, or WebP. Oversized supported images are normalized before rendering.\n* With enhancement enabled, aspect\\_ratio=auto uses the preset ratio. With enhancement disabled, current production mappings use square output for auto.\n* The 1k/2k/4k values are resolution tiers; exact pixel dimensions depend on the aspect ratio.\n* quality accepts low, medium, high, xhigh, max and remains selectable with enhancement enabled.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "image",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "images": [\n    {\n      "url": "https://example.com/output.png"\n    }\n  ]\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/marketing-studio-image/sunburst.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:06.795965+00:00",
          snapshot: "evidence/docs-models__marketing-studio-image__sunburst.md",
          sha256: "c2f20e02fdddab36370eab2b616fc302be40865ae2ee767c39333d9b759406e7"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "image",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/marketing-studio/image/sunburst/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-d9b8ab95d64d.txt",
        sha256: "ce3fd952d9d5481b818bb0ff4f1ae960f128f5d737e7023bcffeb0eeb0d07798"
      },
      consoleObservation: "reference captured",
      consoleSchemaStatus: "parameter-table-not-present; docs schema retained as dated documentation only",
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "minimax/h3/image-to-video",
      title: "MiniMax H3 \u2014 Image to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/minimax-h3/image-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:20.693653+00:00",
        snapshot: "evidence/docs-models__minimax-h3__image-to-video.md",
        sha256: "9737299eabf84af82a5eead2b355d09780cec1f3ed693ace192f83e0f13e8302"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/minimax/h3/image-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "MiniMax H3 Image to Video Playground",
        required: [
          "prompt",
          "image_url"
        ],
        properties: {
          prompt: {
            type: "string",
            title: "Prompt",
            minLength: 1,
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 15,
            minimum: 5
          },
          image_url: {
            type: "string",
            title: "First frame URL",
            format: "uri"
          },
          resolution: {
            enum: [
              "2K"
            ],
            type: "string",
            title: "Resolution",
            default: "2K"
          },
          aspect_ratio: {
            enum: [
              "auto",
              "adaptive",
              "21:9",
              "16:9",
              "4:3",
              "1:1",
              "3:4",
              "9:16"
            ],
            type: "string",
            title: "Aspect ratio",
            default: "auto"
          },
          end_image_url: {
            type: "string",
            title: "Last frame URL",
            format: "uri"
          },
          aigc_watermark: {
            type: "boolean",
            title: "AIGC watermark",
            default: false
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "prompt",
        "duration",
        "image_url",
        "resolution",
        "aspect_ratio",
        "end_image_url",
        "aigc_watermark"
      ],
      usageNotes: '* Resolution is fixed to the case-sensitive schema value "2K". The prompt must contain non-whitespace text; the current provider serializer uses only its first 7,000 characters.\n* The output aspect ratio follows the input keyframe even when aspect\\_ratio is supplied. end\\_image\\_url is an optional last frame.',
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/minimax-h3/image-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:20.693653+00:00",
          snapshot: "evidence/docs-models__minimax-h3__image-to-video.md",
          sha256: "9737299eabf84af82a5eead2b355d09780cec1f3ed693ace192f83e0f13e8302"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/minimax/h3/image-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-ca247701e41d.txt",
        sha256: "866f8da35d9ae40a6319ac0a0945fd698371356e56b33691b0a27aae885c6c1b"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	Yes	\u2014	Prompt. Minimum length: 1.\nduration	integer	No	5	Duration. Minimum: 5. Maximum: 15.\nimage_url	string	Yes	\u2014	First frame URL.\nresolution	string	No	"2K"	Resolution. Options: 2K.\naspect_ratio	string	No	"auto"	Aspect ratio. Options: auto, adaptive, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16.\nend_image_url	string	No	\u2014	Last frame URL.\naigc_watermark	boolean	No	false	AIGC watermark.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "minimax/h3/reference-to-video",
      title: "MiniMax H3 \u2014 Reference to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/minimax-h3/reference-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:09.695182+00:00",
        snapshot: "evidence/docs-models__minimax-h3__reference-to-video.md",
        sha256: "0405660e9063cfd2383db32ac10b789a602e82002c643dbe11418c51013fe622"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/minimax/h3/reference-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        if: {
          required: [
            "image_urls"
          ]
        },
        else: {
          required: [
            "video_urls"
          ]
        },
        type: "object",
        title: "MiniMax H3 Reference to Video Playground",
        required: [
          "prompt"
        ],
        properties: {
          prompt: {
            type: "string",
            title: "Prompt",
            minLength: 1,
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 15,
            minimum: 5
          },
          audio_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            title: "Reference audio URLs",
            maxItems: 3,
            minItems: 0
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            title: "Reference image URLs",
            maxItems: 9,
            minItems: 1
          },
          resolution: {
            enum: [
              "2K"
            ],
            type: "string",
            title: "Resolution",
            default: "2K"
          },
          video_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            title: "Reference video URLs",
            maxItems: 3,
            minItems: 1
          },
          aspect_ratio: {
            enum: [
              "auto",
              "adaptive",
              "21:9",
              "16:9",
              "4:3",
              "1:1",
              "3:4",
              "9:16"
            ],
            type: "string",
            title: "Aspect ratio",
            default: "auto"
          },
          aigc_watermark: {
            type: "boolean",
            title: "AIGC watermark",
            default: false
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "prompt",
        "duration",
        "audio_urls",
        "image_urls",
        "resolution",
        "video_urls",
        "aspect_ratio",
        "aigc_watermark"
      ],
      usageNotes: `* Resolution is fixed to the case-sensitive schema value "2K". The prompt must contain non-whitespace text; the current provider serializer uses only its first 7,000 characters.
* Provide at least one image or video reference. Audio references require an image or video reference and cannot be used alone.
* Reference media may be cropped, resized, transcoded and trimmed. Video duration and audio duration are each normalized to fit within the provider's 15-second total budget.`,
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/minimax-h3/reference-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:09.695182+00:00",
          snapshot: "evidence/docs-models__minimax-h3__reference-to-video.md",
          sha256: "0405660e9063cfd2383db32ac10b789a602e82002c643dbe11418c51013fe622"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {
          audio_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            title: "Reference audio URLs",
            maxItems: 3,
            minItems: 0
          }
        },
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: `* Resolution is fixed to the case-sensitive schema value "2K". The prompt must contain non-whitespace text; the current provider serializer uses only its first 7,000 characters.
* Provide at least one image or video reference. Audio references require an image or video reference and cannot be used alone.
* Reference media may be cropped, resized, transcoded and trimmed. Video duration and audio duration are each normalized to fit within the provider's 15-second total budget.`
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/minimax/h3/reference-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-47726725af4e.txt",
        sha256: "0ff101f207017adcc7f6b8cd8d0474019d34c9465b789f98a114aa7b3242a52a"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	Yes	\u2014	Prompt. Minimum length: 1.\nduration	integer	No	5	Duration. Minimum: 5. Maximum: 15.\naudio_urls	array[string]	No	\u2014	Reference audio URLs.\nimage_urls	array[string]	No	\u2014	Reference image URLs.\nresolution	string	No	"2K"	Resolution. Options: 2K.\nvideo_urls	array[string]	No	\u2014	Reference video URLs.\naspect_ratio	string	No	"auto"	Aspect ratio. Options: auto, adaptive, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16.\naigc_watermark	boolean	No	false	AIGC watermark.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "minimax/h3/text-to-video",
      title: "MiniMax H3 \u2014 Text to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/minimax-h3/text-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:09.786856+00:00",
        snapshot: "evidence/docs-models__minimax-h3__text-to-video.md",
        sha256: "9102b4371c02f8b040f46774928c0c0c8d8b81aeb5572dae590a6458d17c50ec"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/minimax/h3/text-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "MiniMax H3 Text to Video Playground",
        required: [
          "prompt"
        ],
        properties: {
          prompt: {
            type: "string",
            title: "Prompt",
            minLength: 1,
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 15,
            minimum: 5
          },
          resolution: {
            enum: [
              "2K"
            ],
            type: "string",
            title: "Resolution",
            default: "2K"
          },
          aspect_ratio: {
            enum: [
              "auto",
              "adaptive",
              "21:9",
              "16:9",
              "4:3",
              "1:1",
              "3:4",
              "9:16"
            ],
            type: "string",
            title: "Aspect ratio",
            default: "auto"
          },
          aigc_watermark: {
            type: "boolean",
            title: "AIGC watermark",
            default: false
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "prompt",
        "duration",
        "resolution",
        "aspect_ratio",
        "aigc_watermark"
      ],
      usageNotes: '* Resolution is fixed to the case-sensitive schema value "2K". The prompt must contain non-whitespace text; the current provider serializer uses only its first 7,000 characters.\n* For text-only requests, aspect\\_ratio="auto" or "adaptive" resolves to 16:9.',
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/minimax-h3/text-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:09.786856+00:00",
          snapshot: "evidence/docs-models__minimax-h3__text-to-video.md",
          sha256: "9102b4371c02f8b040f46774928c0c0c8d8b81aeb5572dae590a6458d17c50ec"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/minimax/h3/text-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-5558e9d91202.txt",
        sha256: "14c176da3049a00046251fd511e8e4f37cd74034eddf05a8e258407e7207242f"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	Yes	\u2014	Prompt. Minimum length: 1.\nduration	integer	No	5	Duration. Minimum: 5. Maximum: 15.\nresolution	string	No	"2K"	Resolution. Options: 2K.\naspect_ratio	string	No	"auto"	Aspect ratio. Options: auto, adaptive, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16.\naigc_watermark	boolean	No	false	AIGC watermark.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "pixverse/v6/image-to-video",
      title: "PixVerse V6 \u2014 Image to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/pixverse-v6/image-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:20.832134+00:00",
        snapshot: "evidence/docs-models__pixverse-v6__image-to-video.md",
        sha256: "46e51042b7c7662f7da8c4ccccaeced4e5a11df4d902d393c90f43b4feace3bb"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/pixverse/v6/image-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "PixVerse V6 Image to Video Playground",
        required: [
          "prompt",
          "image_url"
        ],
        properties: {
          seed: {
            type: "integer",
            title: "Seed",
            maximum: 2147483647,
            minimum: 0
          },
          prompt: {
            type: "string",
            title: "Prompt",
            maxLength: 5e3,
            minLength: 1,
            description: "Write your prompt here"
          },
          duration: {
            type: "number",
            title: "Duration",
            default: 5,
            maximum: 15,
            minimum: 1
          },
          image_url: {
            type: "string",
            title: "First frame",
            format: "uri"
          },
          resolution: {
            enum: [
              "360p",
              "540p",
              "720p",
              "1080p"
            ],
            type: "string",
            title: "Resolution",
            default: "720p"
          },
          end_image_url: {
            type: "string",
            title: "Last frame",
            format: "uri"
          },
          generate_audio: {
            type: "boolean",
            title: "Generate audio",
            default: true
          },
          negative_prompt: {
            type: "string",
            title: "Negative prompt",
            maxLength: 2048,
            minLength: 1
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "seed",
        "prompt",
        "duration",
        "image_url",
        "resolution",
        "end_image_url",
        "generate_audio",
        "negative_prompt"
      ],
      usageNotes: "* duration is a number from 1 to 15, so the schema allows fractional values. If negative\\_prompt is supplied, it must contain 1\u20132,048 characters.\n* Use image\\_url for the first frame and optional end\\_image\\_url for the last frame. This endpoint has no aspect\\_ratio parameter; framing comes from the input image.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/pixverse-v6/image-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:20.832134+00:00",
          snapshot: "evidence/docs-models__pixverse-v6__image-to-video.md",
          sha256: "46e51042b7c7662f7da8c4ccccaeced4e5a11df4d902d393c90f43b4feace3bb"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          generate_audio: {
            type: "boolean",
            title: "Generate audio",
            default: true
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/pixverse/v6/image-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-4b248fc9c1cf.txt",
        sha256: "f095aedc84f7f78398b910714a91cab8bdcf6a9fc1ab72d51a3f8b925c84aed3"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'seed	integer	No	\u2014	Seed. Minimum: 0. Maximum: 2147483647.\nprompt	string	Yes	\u2014	Prompt. Minimum length: 1. Maximum length: 5000.\nduration	number	No	5	Duration. Minimum: 1. Maximum: 15.\nimage_url	string	Yes	\u2014	First frame.\nresolution	string	No	"720p"	Resolution. Options: 360p, 540p, 720p, 1080p.\nend_image_url	string	No	\u2014	Last frame.\ngenerate_audio	boolean	No	true	Generate audio.\nnegative_prompt	string	No	\u2014	Negative prompt. Minimum length: 1. Maximum length: 2048.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "pixverse/v6/text-to-video",
      title: "PixVerse V6 \u2014 Text to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/pixverse-v6/text-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:20.859767+00:00",
        snapshot: "evidence/docs-models__pixverse-v6__text-to-video.md",
        sha256: "3c83fe5c1574e34946e0aa54be9c6222ec2c87c0ea4133fd3ebc57b6f7433b29"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/pixverse/v6/text-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "PixVerse V6 Text to Video Playground",
        required: [
          "prompt"
        ],
        properties: {
          seed: {
            type: "integer",
            title: "Seed",
            maximum: 2147483647,
            minimum: 0
          },
          prompt: {
            type: "string",
            title: "Prompt",
            maxLength: 5e3,
            minLength: 1,
            description: "Write your prompt here"
          },
          duration: {
            type: "number",
            title: "Duration",
            default: 5,
            maximum: 15,
            minimum: 1
          },
          resolution: {
            enum: [
              "360p",
              "540p",
              "720p",
              "1080p"
            ],
            type: "string",
            title: "Resolution",
            default: "720p"
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "4:3",
              "1:1",
              "3:4",
              "9:16"
            ],
            type: "string",
            title: "Aspect ratio",
            default: "16:9"
          },
          generate_audio: {
            type: "boolean",
            title: "Generate audio",
            default: true
          },
          negative_prompt: {
            type: "string",
            title: "Negative prompt",
            maxLength: 2048,
            minLength: 1
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "seed",
        "prompt",
        "duration",
        "resolution",
        "aspect_ratio",
        "generate_audio",
        "negative_prompt"
      ],
      usageNotes: "* duration is a number from 1 to 15, so the schema allows fractional values. If negative\\_prompt is supplied, it must contain 1\u20132,048 characters.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/pixverse-v6/text-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:20.859767+00:00",
          snapshot: "evidence/docs-models__pixverse-v6__text-to-video.md",
          sha256: "3c83fe5c1574e34946e0aa54be9c6222ec2c87c0ea4133fd3ebc57b6f7433b29"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          generate_audio: {
            type: "boolean",
            title: "Generate audio",
            default: true
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/pixverse/v6/text-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-af37fd632f64.txt",
        sha256: "27a6f4e0607856720ee187821bdd75700958f7523d9a760790bb1bd0e5941746"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'seed	integer	No	\u2014	Seed. Minimum: 0. Maximum: 2147483647.\nprompt	string	Yes	\u2014	Prompt. Minimum length: 1. Maximum length: 5000.\nduration	number	No	5	Duration. Minimum: 1. Maximum: 15.\nresolution	string	No	"720p"	Resolution. Options: 360p, 540p, 720p, 1080p.\naspect_ratio	string	No	"16:9"	Aspect ratio. Options: 16:9, 4:3, 1:1, 3:4, 9:16.\ngenerate_audio	boolean	No	true	Generate audio.\nnegative_prompt	string	No	\u2014	Negative prompt. Minimum length: 1. Maximum length: 2048.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "alibaba/qwen-image-3/edit",
      title: "Qwen Image 3 \u2014 Edit images API",
      category: "image",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/qwen-image-3/edit.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:07.138037+00:00",
        snapshot: "evidence/docs-models__qwen-image-3__edit.md",
        sha256: "703a91a9603b1d3c2facb4ccb43ab2ed1f8f4d656b336486d7ac6e1d84bbdcff"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/alibaba/qwen-image-3/edit",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        allOf: [
          {
            if: {
              required: [
                "enable_thinking"
              ],
              properties: {
                enable_thinking: {
                  const: true
                }
              }
            },
            then: {
              required: [
                "prompt_extend"
              ],
              properties: {
                prompt_extend: {
                  const: true
                }
              }
            }
          }
        ],
        title: "Qwen Image 3 Edit",
        required: [
          "prompt",
          "image_urls"
        ],
        properties: {
          seed: {
            type: "integer",
            maximum: 2147483647,
            minimum: 0,
            description: "Optional random seed for similar, reproducible results."
          },
          prompt: {
            type: "string",
            minLength: 1,
            description: "Positive prompt or editing instruction in Chinese or English. Alibaba recommends at most 4,500 tokens."
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            maxItems: 3,
            minItems: 1,
            description: "One to three ordered public image URLs used as editing references."
          },
          resolution: {
            enum: [
              "1k",
              "2k"
            ],
            type: "string",
            default: "1k",
            description: "Output resolution tier. Both tiers produce PNG images."
          },
          aspect_ratio: {
            enum: [
              "1:1",
              "2:3",
              "3:2",
              "3:4",
              "4:3",
              "7:9",
              "9:7",
              "9:16",
              "16:9",
              "21:9"
            ],
            type: "string",
            default: "1:1",
            description: "Output aspect ratio. Exact provider-recommended dimensions are selected automatically."
          },
          prompt_extend: {
            type: "boolean",
            default: true,
            description: "Improve the prompt before generation. Required when thinking mode is enabled."
          },
          enable_thinking: {
            type: "boolean",
            default: true,
            description: "Use model reasoning to improve image quality. Requires prompt enhancement."
          },
          negative_prompt: {
            type: "string",
            description: "Content, styles, or artifacts to avoid in the output."
          },
          prompt_extend_mode: {
            enum: [
              "direct"
            ],
            type: "string",
            default: "direct",
            description: "Direct enhancement is available for every request; agent enhancement is text-to-image only."
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "seed",
        "prompt",
        "image_urls",
        "resolution",
        "aspect_ratio",
        "prompt_extend",
        "enable_thinking",
        "negative_prompt",
        "prompt_extend_mode"
      ],
      usageNotes: "* Provide 1\u20133 ordered reference image URLs. The list is required and cannot be empty.\n* enable\\_thinking defaults to true and requires prompt\\_extend=true. Set both to false to disable enhancement.\n* prompt\\_extend\\_mode accepts only direct; agent enhancement is unavailable on editing requests.\n* prompt must contain non-whitespace text. The 2k square output tier maps to 1536 by 1536 pixels.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "image",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "images": [\n    {\n      "url": "https://example.com/output.png"\n    }\n  ]\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/qwen-image-3/edit.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:07.138037+00:00",
          snapshot: "evidence/docs-models__qwen-image-3__edit.md",
          sha256: "703a91a9603b1d3c2facb4ccb43ab2ed1f8f4d656b336486d7ac6e1d84bbdcff"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "image",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/alibaba/qwen-image-3/edit/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-6583cb5f9485.txt",
        sha256: "67d2bcd9ab4625c114764d69dbdf676ca001836ee8e6be05bfd1d90b12374727"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'seed	integer	No	\u2014	Optional random seed for similar, reproducible results. Minimum: 0. Maximum: 2147483647.\nprompt	string	Yes	\u2014	Positive prompt or editing instruction in Chinese or English. Alibaba recommends at most 4,500 tokens. Minimum length: 1.\nimage_urls	array[string]	Yes	\u2014	One to three ordered public image URLs used as editing references.\nresolution	string	No	"1k"	Output resolution tier. Both tiers produce PNG images. Options: 1k, 2k.\naspect_ratio	string	No	"1:1"	Output aspect ratio. Exact provider-recommended dimensions are selected automatically. Options: 1:1, 2:3, 3:2, 3:4, 4:3, 7:9, 9:7, 9:16, 16:9, 21:9.\nprompt_extend	boolean	No	true	Improve the prompt before generation. Required when thinking mode is enabled.\nenable_thinking	boolean	No	true	Use model reasoning to improve image quality. Requires prompt enhancement.\nnegative_prompt	string	No	\u2014	Content, styles, or artifacts to avoid in the output.\nprompt_extend_mode	string	No	"direct"	Direct enhancement is available for every request; agent enhancement is text-to-image only. Options: direct.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "alibaba/qwen-image-3/text-to-image",
      title: "Qwen Image 3 \u2014 Text to image API",
      category: "image",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/qwen-image-3/text-to-image.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:07.083078+00:00",
        snapshot: "evidence/docs-models__qwen-image-3__text-to-image.md",
        sha256: "7a8de1a4137c3a3d7aea731e3cec7f7b204f3bfe3a128adc2ae4e9e26b420554"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/alibaba/qwen-image-3/text-to-image",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        allOf: [
          {
            if: {
              required: [
                "enable_thinking"
              ],
              properties: {
                enable_thinking: {
                  const: true
                }
              }
            },
            then: {
              required: [
                "prompt_extend"
              ],
              properties: {
                prompt_extend: {
                  const: true
                }
              }
            }
          }
        ],
        title: "Qwen Image 3 Text to Image",
        required: [
          "prompt"
        ],
        properties: {
          seed: {
            type: "integer",
            maximum: 2147483647,
            minimum: 0,
            description: "Optional random seed for similar, reproducible results."
          },
          prompt: {
            type: "string",
            minLength: 1,
            description: "Positive prompt or editing instruction in Chinese or English. Alibaba recommends at most 4,500 tokens."
          },
          resolution: {
            enum: [
              "1k",
              "2k"
            ],
            type: "string",
            default: "1k",
            description: "Output resolution tier. Both tiers produce PNG images."
          },
          aspect_ratio: {
            enum: [
              "1:1",
              "2:3",
              "3:2",
              "3:4",
              "4:3",
              "7:9",
              "9:7",
              "9:16",
              "16:9",
              "21:9"
            ],
            type: "string",
            default: "1:1",
            description: "Output aspect ratio. Exact provider-recommended dimensions are selected automatically."
          },
          prompt_extend: {
            type: "boolean",
            default: true,
            description: "Improve the prompt before generation. Required when thinking mode is enabled."
          },
          enable_thinking: {
            type: "boolean",
            default: true,
            description: "Use model reasoning to improve image quality. Requires prompt enhancement."
          },
          negative_prompt: {
            type: "string",
            description: "Content, styles, or artifacts to avoid in the output."
          },
          prompt_extend_mode: {
            enum: [
              "direct",
              "agent"
            ],
            type: "string",
            default: "direct",
            description: "Direct enhancement is available for every request; agent enhancement is text-to-image only."
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "seed",
        "prompt",
        "resolution",
        "aspect_ratio",
        "prompt_extend",
        "enable_thinking",
        "negative_prompt",
        "prompt_extend_mode"
      ],
      usageNotes: "* prompt must contain non-whitespace text. The schema imposes no character maximum; its 4,500-token guidance is advisory.\n* enable\\_thinking defaults to true and requires prompt\\_extend=true. Set both to false to disable enhancement.\n* prompt\\_extend\\_mode supports direct or agent. No reference images are accepted by this endpoint.\n* resolution is a tier; 2k square maps to 1536 by 1536 pixels, not 2048 by 2048.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "image",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "images": [\n    {\n      "url": "https://example.com/output.png"\n    }\n  ]\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/qwen-image-3/text-to-image.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:07.083078+00:00",
          snapshot: "evidence/docs-models__qwen-image-3__text-to-image.md",
          sha256: "7a8de1a4137c3a3d7aea731e3cec7f7b204f3bfe3a128adc2ae4e9e26b420554"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "image",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/alibaba/qwen-image-3/text-to-image/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-e37dead9d7a6.txt",
        sha256: "c095c983e7380c0aa093b2fdb40ed4eac4bd5fe70634f7dc75ef9943283f34b3"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'seed	integer	No	\u2014	Optional random seed for similar, reproducible results. Minimum: 0. Maximum: 2147483647.\nprompt	string	Yes	\u2014	Positive prompt or editing instruction in Chinese or English. Alibaba recommends at most 4,500 tokens. Minimum length: 1.\nresolution	string	No	"1k"	Output resolution tier. Both tiers produce PNG images. Options: 1k, 2k.\naspect_ratio	string	No	"1:1"	Output aspect ratio. Exact provider-recommended dimensions are selected automatically. Options: 1:1, 2:3, 3:2, 3:4, 4:3, 7:9, 9:7, 9:16, 16:9, 21:9.\nprompt_extend	boolean	No	true	Improve the prompt before generation. Required when thinking mode is enabled.\nenable_thinking	boolean	No	true	Use model reasoning to improve image quality. Requires prompt enhancement.\nnegative_prompt	string	No	\u2014	Content, styles, or artifacts to avoid in the output.\nprompt_extend_mode	string	No	"direct"	Direct enhancement is available for every request; agent enhancement is text-to-image only. Options: direct, agent.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "recraft/v4.1/pro/text-to-image",
      title: "Recraft V4.1 Pro \u2014 Text to image API",
      category: "image",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/recraft-v4-1-pro/generate.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:57.788574+00:00",
        snapshot: "evidence/docs-models__recraft-v4-1-pro__generate.md",
        sha256: "1672114acb6f563035d0dcf50ca424007eb3f49db0a4b4504715cbfdf864f55b"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/recraft/v4.1/pro/text-to-image",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Recraft V4.1 Pro Playground",
        required: [
          "prompt"
        ],
        properties: {
          colors: {
            type: "array",
            items: {
              type: "object",
              required: [
                "rgb"
              ],
              properties: {
                rgb: {
                  type: "array",
                  items: {
                    type: "integer",
                    maximum: 255,
                    minimum: 0
                  },
                  maxItems: 3,
                  minItems: 3
                }
              }
            },
            title: "Colors"
          },
          prompt: {
            type: "string",
            title: "Prompt",
            maxLength: 1e4,
            minLength: 1,
            description: "Write your prompt here"
          },
          resolution: {
            enum: [
              "2k"
            ],
            type: "string",
            title: "Resolution",
            default: "2k"
          },
          aspect_ratio: {
            enum: [
              "1:1",
              "2:1",
              "1:2",
              "3:2",
              "2:3",
              "4:3",
              "3:4",
              "5:4",
              "4:5",
              "6:10",
              "14:10",
              "10:14",
              "16:9",
              "9:16"
            ],
            type: "string",
            title: "Aspect ratio",
            default: "1:1"
          },
          output_format: {
            enum: [
              "jpg",
              "png",
              "webp"
            ],
            type: "string",
            title: "Output format",
            default: "jpg"
          },
          background_color: {
            type: "object",
            title: "Background color",
            required: [
              "rgb"
            ],
            properties: {
              rgb: {
                type: "array",
                items: {
                  type: "integer",
                  maximum: 255,
                  minimum: 0
                },
                maxItems: 3,
                minItems: 3
              }
            }
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "colors",
        "prompt",
        "resolution",
        "aspect_ratio",
        "output_format",
        "background_color"
      ],
      usageNotes: '* This variant accepts only resolution=2k; use the separate standard/Pro endpoint for the other resolution tier.\n* colors is an array of objects shaped as \\{"rgb": \\[R, G, B]}; background\\_color is one such object. Every RGB value is an integer 0\u2013255, with exactly three entries.\n* output\\_format is jpg, png, or webp; default is jpg. No reference-image input is declared.\n* prompt must contain 1\u201310000 characters. Fourteen aspect-ratio values are listed in the schema, including 6:10, 14:10, and 10:14.',
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "image",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "images": [\n    {\n      "url": "https://example.com/output.png"\n    }\n  ]\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/recraft-v4-1-pro/generate.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:57.788574+00:00",
          snapshot: "evidence/docs-models__recraft-v4-1-pro__generate.md",
          sha256: "1672114acb6f563035d0dcf50ca424007eb3f49db0a4b4504715cbfdf864f55b"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "image",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/recraft/v4.1/pro/text-to-image/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-9efbf6229599.txt",
        sha256: "bf2b119781ba934ad0f35dbd58f2e3af3045d8e24da5520a976d62a17442f159"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'colors	array[object]	No	\u2014	Colors.\nprompt	string	Yes	\u2014	Prompt. Minimum length: 1. Maximum length: 10000.\nresolution	string	No	"2k"	Resolution. Options: 2k.\naspect_ratio	string	No	"1:1"	Aspect ratio. Options: 1:1, 2:1, 1:2, 3:2, 2:3, 4:3, 3:4, 5:4, 4:5, 6:10, 14:10, 10:14, 16:9, 9:16.\noutput_format	string	No	"jpg"	Output format. Options: jpg, png, webp.\nbackground_color	object	No	\u2014	Background color.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "recraft/v4.1/utility/pro/text-to-image",
      title: "Recraft V4.1 Utility Pro \u2014 Text to image API",
      category: "image",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/recraft-v4-1-utility-pro/text-to-image.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:57.738251+00:00",
        snapshot: "evidence/docs-models__recraft-v4-1-utility-pro__text-to-image.md",
        sha256: "419e5573506285b005d19a4f4e21696b5e2ad43d8dd42441bf16efcbcedd7454"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/recraft/v4.1/utility/pro/text-to-image",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Recraft V4.1 Utility Pro Playground",
        required: [
          "prompt"
        ],
        properties: {
          colors: {
            type: "array",
            items: {
              type: "object",
              required: [
                "rgb"
              ],
              properties: {
                rgb: {
                  type: "array",
                  items: {
                    type: "integer",
                    maximum: 255,
                    minimum: 0
                  },
                  maxItems: 3,
                  minItems: 3
                }
              }
            },
            title: "Colors"
          },
          prompt: {
            type: "string",
            title: "Prompt",
            maxLength: 1e4,
            minLength: 1,
            description: "Write your prompt here"
          },
          resolution: {
            enum: [
              "2k"
            ],
            type: "string",
            title: "Resolution",
            default: "2k"
          },
          aspect_ratio: {
            enum: [
              "1:1",
              "2:1",
              "1:2",
              "3:2",
              "2:3",
              "4:3",
              "3:4",
              "5:4",
              "4:5",
              "6:10",
              "14:10",
              "10:14",
              "16:9",
              "9:16"
            ],
            type: "string",
            title: "Aspect ratio",
            default: "1:1"
          },
          output_format: {
            enum: [
              "jpg",
              "png",
              "webp"
            ],
            type: "string",
            title: "Output format",
            default: "jpg"
          },
          background_color: {
            type: "object",
            title: "Background color",
            required: [
              "rgb"
            ],
            properties: {
              rgb: {
                type: "array",
                items: {
                  type: "integer",
                  maximum: 255,
                  minimum: 0
                },
                maxItems: 3,
                minItems: 3
              }
            }
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "colors",
        "prompt",
        "resolution",
        "aspect_ratio",
        "output_format",
        "background_color"
      ],
      usageNotes: '* This variant accepts only resolution=2k; use the separate standard/Pro endpoint for the other resolution tier.\n* colors is an array of objects shaped as \\{"rgb": \\[R, G, B]}; background\\_color is one such object. Every RGB value is an integer 0\u2013255, with exactly three entries.\n* output\\_format is jpg, png, or webp; default is jpg. No reference-image input is declared.\n* prompt must contain 1\u201310000 characters. Fourteen aspect-ratio values are listed in the schema, including 6:10, 14:10, and 10:14.',
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "image",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "images": [\n    {\n      "url": "https://example.com/output.png"\n    }\n  ]\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/recraft-v4-1-utility-pro/text-to-image.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:57.738251+00:00",
          snapshot: "evidence/docs-models__recraft-v4-1-utility-pro__text-to-image.md",
          sha256: "419e5573506285b005d19a4f4e21696b5e2ad43d8dd42441bf16efcbcedd7454"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "image",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/recraft/v4.1/utility/pro/text-to-image/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-b5ed6c6eb3e1.txt",
        sha256: "8b6fc60dddc266e74a49a805e44e559eb715fa152a6a513a3684ac03dc06867f"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'colors	array[object]	No	\u2014	Colors.\nprompt	string	Yes	\u2014	Prompt. Minimum length: 1. Maximum length: 10000.\nresolution	string	No	"2k"	Resolution. Options: 2k.\naspect_ratio	string	No	"1:1"	Aspect ratio. Options: 1:1, 2:1, 1:2, 3:2, 2:3, 4:3, 3:4, 5:4, 4:5, 6:10, 14:10, 10:14, 16:9, 9:16.\noutput_format	string	No	"jpg"	Output format. Options: jpg, png, webp.\nbackground_color	object	No	\u2014	Background color.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "recraft/v4.1/utility/text-to-image",
      title: "Recraft V4.1 Utility \u2014 Text to image API",
      category: "image",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/recraft-v4-1-utility/text-to-image.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:57.746357+00:00",
        snapshot: "evidence/docs-models__recraft-v4-1-utility__text-to-image.md",
        sha256: "849e1dcd96ed08d07bed8600e00c86e3756e09191972831b7d51c703326b7e3f"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/recraft/v4.1/utility/text-to-image",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Recraft V4.1 Utility Playground",
        required: [
          "prompt"
        ],
        properties: {
          colors: {
            type: "array",
            items: {
              type: "object",
              required: [
                "rgb"
              ],
              properties: {
                rgb: {
                  type: "array",
                  items: {
                    type: "integer",
                    maximum: 255,
                    minimum: 0
                  },
                  maxItems: 3,
                  minItems: 3
                }
              }
            },
            title: "Colors"
          },
          prompt: {
            type: "string",
            title: "Prompt",
            maxLength: 1e4,
            minLength: 1,
            description: "Write your prompt here"
          },
          resolution: {
            enum: [
              "1k"
            ],
            type: "string",
            title: "Resolution",
            default: "1k"
          },
          aspect_ratio: {
            enum: [
              "1:1",
              "2:1",
              "1:2",
              "3:2",
              "2:3",
              "4:3",
              "3:4",
              "5:4",
              "4:5",
              "6:10",
              "14:10",
              "10:14",
              "16:9",
              "9:16"
            ],
            type: "string",
            title: "Aspect ratio",
            default: "1:1"
          },
          output_format: {
            enum: [
              "jpg",
              "png",
              "webp"
            ],
            type: "string",
            title: "Output format",
            default: "jpg"
          },
          background_color: {
            type: "object",
            title: "Background color",
            required: [
              "rgb"
            ],
            properties: {
              rgb: {
                type: "array",
                items: {
                  type: "integer",
                  maximum: 255,
                  minimum: 0
                },
                maxItems: 3,
                minItems: 3
              }
            }
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "colors",
        "prompt",
        "resolution",
        "aspect_ratio",
        "output_format",
        "background_color"
      ],
      usageNotes: '* This variant accepts only resolution=1k; use the separate standard/Pro endpoint for the other resolution tier.\n* colors is an array of objects shaped as \\{"rgb": \\[R, G, B]}; background\\_color is one such object. Every RGB value is an integer 0\u2013255, with exactly three entries.\n* output\\_format is jpg, png, or webp; default is jpg. No reference-image input is declared.\n* prompt must contain 1\u201310000 characters. Fourteen aspect-ratio values are listed in the schema, including 6:10, 14:10, and 10:14.',
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "image",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "images": [\n    {\n      "url": "https://example.com/output.png"\n    }\n  ]\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/recraft-v4-1-utility/text-to-image.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:57.746357+00:00",
          snapshot: "evidence/docs-models__recraft-v4-1-utility__text-to-image.md",
          sha256: "849e1dcd96ed08d07bed8600e00c86e3756e09191972831b7d51c703326b7e3f"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "image",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/recraft/v4.1/utility/text-to-image/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-673cf1734314.txt",
        sha256: "d7963da8d71d9539391660711385f1dcbaf4cde197b3df1253ab82d1a41dfe27"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'colors	array[object]	No	\u2014	Colors.\nprompt	string	Yes	\u2014	Prompt. Minimum length: 1. Maximum length: 10000.\nresolution	string	No	"1k"	Resolution. Options: 1k.\naspect_ratio	string	No	"1:1"	Aspect ratio. Options: 1:1, 2:1, 1:2, 3:2, 2:3, 4:3, 3:4, 5:4, 4:5, 6:10, 14:10, 10:14, 16:9, 9:16.\noutput_format	string	No	"jpg"	Output format. Options: jpg, png, webp.\nbackground_color	object	No	\u2014	Background color.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "recraft/v4.1/text-to-image",
      title: "Recraft V4.1 \u2014 Text to image API",
      category: "image",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/recraft-v4-1/text-to-image.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:59.667548+00:00",
        snapshot: "evidence/docs-models__recraft-v4-1__text-to-image.md",
        sha256: "46a2f8d593348278623da2eba00f9a2aec35a834242b3c7941246b0cc11fde74"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/recraft/v4.1/text-to-image",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Recraft V4.1 Playground",
        required: [
          "prompt"
        ],
        properties: {
          colors: {
            type: "array",
            items: {
              type: "object",
              required: [
                "rgb"
              ],
              properties: {
                rgb: {
                  type: "array",
                  items: {
                    type: "integer",
                    maximum: 255,
                    minimum: 0
                  },
                  maxItems: 3,
                  minItems: 3
                }
              }
            },
            title: "Colors"
          },
          prompt: {
            type: "string",
            title: "Prompt",
            maxLength: 1e4,
            minLength: 1,
            description: "Write your prompt here"
          },
          resolution: {
            enum: [
              "1k"
            ],
            type: "string",
            title: "Resolution",
            default: "1k"
          },
          aspect_ratio: {
            enum: [
              "1:1",
              "2:1",
              "1:2",
              "3:2",
              "2:3",
              "4:3",
              "3:4",
              "5:4",
              "4:5",
              "6:10",
              "14:10",
              "10:14",
              "16:9",
              "9:16"
            ],
            type: "string",
            title: "Aspect ratio",
            default: "1:1"
          },
          output_format: {
            enum: [
              "jpg",
              "png",
              "webp"
            ],
            type: "string",
            title: "Output format",
            default: "jpg"
          },
          background_color: {
            type: "object",
            title: "Background color",
            required: [
              "rgb"
            ],
            properties: {
              rgb: {
                type: "array",
                items: {
                  type: "integer",
                  maximum: 255,
                  minimum: 0
                },
                maxItems: 3,
                minItems: 3
              }
            }
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "colors",
        "prompt",
        "resolution",
        "aspect_ratio",
        "output_format",
        "background_color"
      ],
      usageNotes: '* This variant accepts only resolution=1k; use the separate standard/Pro endpoint for the other resolution tier.\n* colors is an array of objects shaped as \\{"rgb": \\[R, G, B]}; background\\_color is one such object. Every RGB value is an integer 0\u2013255, with exactly three entries.\n* output\\_format is jpg, png, or webp; default is jpg. No reference-image input is declared.\n* prompt must contain 1\u201310000 characters. Fourteen aspect-ratio values are listed in the schema, including 6:10, 14:10, and 10:14.',
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "image",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "images": [\n    {\n      "url": "https://example.com/output.png"\n    }\n  ]\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/recraft-v4-1/text-to-image.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:59.667548+00:00",
          snapshot: "evidence/docs-models__recraft-v4-1__text-to-image.md",
          sha256: "46a2f8d593348278623da2eba00f9a2aec35a834242b3c7941246b0cc11fde74"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "image",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/recraft/v4.1/text-to-image/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-8d000a35726b.txt",
        sha256: "68db1661023dfc23a1fc738b4b1825656eebdb55e89cccf0e97764324dd19d04"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'colors	array[object]	No	\u2014	Colors.\nprompt	string	Yes	\u2014	Prompt. Minimum length: 1. Maximum length: 10000.\nresolution	string	No	"1k"	Resolution. Options: 1k.\naspect_ratio	string	No	"1:1"	Aspect ratio. Options: 1:1, 2:1, 1:2, 3:2, 2:3, 4:3, 3:4, 5:4, 4:5, 6:10, 14:10, 10:14, 16:9, 9:16.\noutput_format	string	No	"jpg"	Output format. Options: jpg, png, webp.\nbackground_color	object	No	\u2014	Background color.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "bytedance/seedance-2.5/image-to-video",
      title: "Seedance 2.5 \u2014 Image to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/seedance-2-5/image-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:00.176458+00:00",
        snapshot: "evidence/docs-models__seedance-2-5__image-to-video.md",
        sha256: "ab3fb9153ac06a0b2ea71aa4a10d33327dd5f51ac77ac9a472b0a774a3bc0355"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/bytedance/seedance-2.5/image-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        required: [
          "image_url"
        ],
        properties: {
          prompt: {
            type: "string",
            minLength: 1,
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            default: 5,
            maximum: 30,
            minimum: 4
          },
          image_url: {
            type: "string",
            format: "uri"
          },
          resolution: {
            enum: [
              "480p",
              "720p",
              "1080p"
            ],
            type: "string",
            default: "720p"
          },
          bitrate_mode: {
            enum: [
              "standard",
              "high"
            ],
            type: "string",
            default: "high"
          },
          end_image_url: {
            type: "string",
            format: "uri"
          },
          generate_audio: {
            type: "boolean",
            default: true
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "prompt",
        "duration",
        "image_url",
        "resolution",
        "bitrate_mode",
        "end_image_url",
        "generate_audio"
      ],
      usageNotes: "* Use publicly accessible media URLs; asset:// references are rejected for these endpoints.\n* The prompt is optional. Output framing follows image\\_url; end\\_image\\_url is the optional last frame.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/seedance-2-5/image-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:00.176458+00:00",
          snapshot: "evidence/docs-models__seedance-2-5__image-to-video.md",
          sha256: "ab3fb9153ac06a0b2ea71aa4a10d33327dd5f51ac77ac9a472b0a774a3bc0355"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [
        "Console vs docs parameter/default differences recorded in evidence/source-conflicts.json; resolve before claiming runtime parity."
      ],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          generate_audio: {
            type: "boolean",
            default: true
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/bytedance/seedance-2.5/image-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-f7612b24c261.txt",
        sha256: "15f932381344d229f0768a8dfa939013dcfd2e518a24c44e5fedc627a1553f00"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	No	\u2014	Minimum length: 1.\nduration	integer	No	5	Minimum: 4. Maximum: 30.\nimage_url	string	Yes	\u2014	\nresolution	string	No	"720p"	Options: 480p, 720p, 1080p.\nend_image_url	string	No	\u2014	\noutput_format	string	No	"mp4"	Options: mp4, mov.\ngenerate_audio	boolean	No	true',
      sourceConflicts: [
        {
          kind: "docs-fields-absent-from-console-table",
          fields: [
            "bitrate_mode"
          ]
        },
        {
          kind: "console-fields-absent-from-docs-schema",
          fields: [
            "output_format"
          ]
        }
      ],
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "bytedance/seedance-2.5/reference-to-video",
      title: "Seedance 2.5 \u2014 Reference to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/seedance-2-5/reference-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:57.751873+00:00",
        snapshot: "evidence/docs-models__seedance-2-5__reference-to-video.md",
        sha256: "46c8fb14dce0db63645a4fa580edc6ec6e314924460468fa7797358b70c4c9a4"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/bytedance/seedance-2.5/reference-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        if: {
          required: [
            "image_urls"
          ]
        },
        else: {
          if: {
            required: [
              "video_urls"
            ]
          },
          else: {
            required: [
              "audio_urls"
            ]
          }
        },
        type: "object",
        required: [],
        properties: {
          prompt: {
            type: "string",
            minLength: 1,
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            default: 5,
            maximum: 30,
            minimum: 4
          },
          audio_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            maxItems: 10,
            minItems: 1
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            maxItems: 30,
            minItems: 1
          },
          resolution: {
            enum: [
              "480p",
              "720p",
              "1080p"
            ],
            type: "string",
            default: "720p"
          },
          video_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            maxItems: 10,
            minItems: 1
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "4:3",
              "1:1",
              "3:4",
              "9:16",
              "21:9"
            ],
            type: "string",
            default: "16:9"
          },
          bitrate_mode: {
            enum: [
              "standard",
              "high"
            ],
            type: "string",
            default: "high"
          },
          generate_audio: {
            type: "boolean",
            default: true
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "prompt",
        "duration",
        "audio_urls",
        "image_urls",
        "resolution",
        "video_urls",
        "aspect_ratio",
        "bitrate_mode",
        "generate_audio"
      ],
      usageNotes: "* Use publicly accessible media URLs; asset:// references are rejected for these endpoints.\n* Provide at least one nonempty reference array: image\\_urls, video\\_urls or audio\\_urls. Audio-only references are supported by this schema and preprocessing path.\n* Reference media are limited to 30 images, 10 videos and 10 audio files, with at most 50 items total. Video duration and audio duration are normalized separately to at most 30 seconds total per media type.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/seedance-2-5/reference-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:57.751873+00:00",
          snapshot: "evidence/docs-models__seedance-2-5__reference-to-video.md",
          sha256: "46c8fb14dce0db63645a4fa580edc6ec6e314924460468fa7797358b70c4c9a4"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [
        "Console vs docs parameter/default differences recorded in evidence/source-conflicts.json; resolve before claiming runtime parity."
      ],
      nativeAudio: {
        inputFields: {
          audio_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            maxItems: 10,
            minItems: 1
          }
        },
        controlFields: {
          generate_audio: {
            type: "boolean",
            default: true
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* Use publicly accessible media URLs; asset:// references are rejected for these endpoints.\n* Provide at least one nonempty reference array: image\\_urls, video\\_urls or audio\\_urls. Audio-only references are supported by this schema and preprocessing path.\n* Reference media are limited to 30 images, 10 videos and 10 audio files, with at most 50 items total. Video duration and audio duration are normalized separately to at most 30 seconds total per media type."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/bytedance/seedance-2.5/reference-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-c61919c585c7.txt",
        sha256: "6a8d93329f0234f1dcb06a176063fe91ca8af55469b4ff6aadda491127d27680"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	No	\u2014	Minimum length: 1.\nduration	integer	No	5	Minimum: 4. Maximum: 30.\naudio_urls	array[string]	No	\u2014	\nimage_urls	array[string]	No	\u2014	\nresolution	string	No	"720p"	Options: 480p, 720p, 1080p.\nvideo_urls	array[string]	No	\u2014	\naspect_ratio	string	No	"16:9"	Options: 16:9, 4:3, 1:1, 3:4, 9:16, 21:9.\noutput_format	string	No	"mp4"	Options: mp4, mov.\ngenerate_audio	boolean	No	true',
      sourceConflicts: [
        {
          kind: "docs-fields-absent-from-console-table",
          fields: [
            "bitrate_mode"
          ]
        },
        {
          kind: "console-fields-absent-from-docs-schema",
          fields: [
            "output_format"
          ]
        }
      ],
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "bytedance/seedance-2.5/text-to-video",
      title: "Seedance 2.5 \u2014 Text to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/seedance-2-5/text-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:59.936360+00:00",
        snapshot: "evidence/docs-models__seedance-2-5__text-to-video.md",
        sha256: "4c24fe51251e8c482acc10ec30a192132a101b1948f1af887e7fc8a0eb2c8a9d"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/bytedance/seedance-2.5/text-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        required: [
          "prompt"
        ],
        properties: {
          prompt: {
            type: "string",
            minLength: 1,
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            default: 5,
            maximum: 30,
            minimum: 4
          },
          resolution: {
            enum: [
              "480p",
              "720p",
              "1080p"
            ],
            type: "string",
            default: "720p"
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "4:3",
              "1:1",
              "3:4",
              "9:16",
              "21:9"
            ],
            type: "string",
            default: "16:9"
          },
          bitrate_mode: {
            enum: [
              "standard",
              "high"
            ],
            type: "string",
            default: "high"
          },
          output_format: {
            enum: [
              "mp4",
              "mov"
            ],
            type: "string",
            default: "mp4"
          },
          generate_audio: {
            type: "boolean",
            default: true
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "prompt",
        "duration",
        "resolution",
        "aspect_ratio",
        "bitrate_mode",
        "output_format",
        "generate_audio"
      ],
      usageNotes: "* Use publicly accessible media URLs; asset:// references are rejected for these endpoints.\n* Provide a nonblank prompt. This endpoint does not use media inputs; use the image-to-video or reference-to-video endpoint instead.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/seedance-2-5/text-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:59.936360+00:00",
          snapshot: "evidence/docs-models__seedance-2-5__text-to-video.md",
          sha256: "4c24fe51251e8c482acc10ec30a192132a101b1948f1af887e7fc8a0eb2c8a9d"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [
        "Console vs docs parameter/default differences recorded in evidence/source-conflicts.json; resolve before claiming runtime parity."
      ],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          generate_audio: {
            type: "boolean",
            default: true
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/bytedance/seedance-2.5/text-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-a68563276755.txt",
        sha256: "7848470073b267b227d9c8a70ee1ef271fbb7dffe887e2220c010606200ee51e"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	Yes	\u2014	Minimum length: 1.\nduration	integer	No	5	Minimum: 4. Maximum: 30.\nresolution	string	No	"720p"	Options: 480p, 720p, 1080p.\naspect_ratio	string	No	"16:9"	Options: 16:9, 4:3, 1:1, 3:4, 9:16, 21:9.\noutput_format	string	No	"mp4"	Options: mp4, mov.\ngenerate_audio	boolean	No	true',
      sourceConflicts: [
        {
          kind: "docs-fields-absent-from-console-table",
          fields: [
            "bitrate_mode"
          ]
        }
      ],
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "bytedance/seedance-2.5/video-edit",
      title: "Seedance 2.5 \u2014 Video edit API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/seedance-2-5/video-edit.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:00.748654+00:00",
        snapshot: "evidence/docs-models__seedance-2-5__video-edit.md",
        sha256: "49c6adb72759843db9fa96ca0cdbc822bff6270772074a6af3e3e84974694b96"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/bytedance/seedance-2.5/video-edit",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        required: [
          "prompt",
          "video_url"
        ],
        properties: {
          prompt: {
            type: "string",
            minLength: 1,
            description: "Write your prompt here"
          },
          video_url: {
            type: "string",
            format: "uri"
          },
          audio_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            maxItems: 10,
            minItems: 1
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            maxItems: 30,
            minItems: 1
          },
          resolution: {
            enum: [
              "480p",
              "720p",
              "1080p"
            ],
            type: "string",
            default: "720p"
          },
          video_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            maxItems: 10,
            minItems: 1
          },
          bitrate_mode: {
            enum: [
              "standard",
              "high"
            ],
            type: "string",
            default: "high"
          },
          generate_audio: {
            type: "boolean",
            default: true
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "prompt",
        "video_url",
        "audio_urls",
        "image_urls",
        "resolution",
        "video_urls",
        "bitrate_mode",
        "generate_audio"
      ],
      usageNotes: "* Use publicly accessible media URLs; asset:// references are rejected for these endpoints.\n* The source video\\_url counts toward the 10-video limit, so include at most 9 additional video\\_urls. At most 50 media items are accepted across the source video and all reference arrays.\n* Videos and audio may be trimmed or padded during preprocessing to fit their respective 30-second total budgets. Output framing follows the source video.\n* Do not send duration: this endpoint derives output duration from the processed source video. The main video is normalized to at least 4 seconds.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/seedance-2-5/video-edit.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:00.748654+00:00",
          snapshot: "evidence/docs-models__seedance-2-5__video-edit.md",
          sha256: "49c6adb72759843db9fa96ca0cdbc822bff6270772074a6af3e3e84974694b96"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [
        "Console vs docs parameter/default differences recorded in evidence/source-conflicts.json; resolve before claiming runtime parity."
      ],
      nativeAudio: {
        inputFields: {
          audio_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            maxItems: 10,
            minItems: 1
          }
        },
        controlFields: {
          generate_audio: {
            type: "boolean",
            default: true
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* Use publicly accessible media URLs; asset:// references are rejected for these endpoints.\n* The source video\\_url counts toward the 10-video limit, so include at most 9 additional video\\_urls. At most 50 media items are accepted across the source video and all reference arrays.\n* Videos and audio may be trimmed or padded during preprocessing to fit their respective 30-second total budgets. Output framing follows the source video.\n* Do not send duration: this endpoint derives output duration from the processed source video. The main video is normalized to at least 4 seconds."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/bytedance/seedance-2.5/video-edit/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-1ecbe2ff7314.txt",
        sha256: "7978bcf66b1553a079e29c9526f20dd98674dfc019b017903a29ad2832bef46c"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	Yes	\u2014	Minimum length: 1.\nvideo_url	string	Yes	\u2014	\naudio_urls	array[string]	No	\u2014	\nimage_urls	array[string]	No	\u2014	\nresolution	string	No	"720p"	Options: 480p, 720p, 1080p.\nvideo_urls	array[string]	No	\u2014	\noutput_format	string	No	"mp4"	Options: mp4, mov.\ngenerate_audio	boolean	No	true',
      sourceConflicts: [
        {
          kind: "docs-fields-absent-from-console-table",
          fields: [
            "bitrate_mode"
          ]
        },
        {
          kind: "console-fields-absent-from-docs-schema",
          fields: [
            "output_format"
          ]
        }
      ],
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "bytedance/seedance-2.5/video-extend",
      title: "Seedance 2.5 \u2014 Video extend API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/seedance-2-5/video-extend.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:59.876029+00:00",
        snapshot: "evidence/docs-models__seedance-2-5__video-extend.md",
        sha256: "a05b78c79ce9bbe4ea6745d8d0c45df53e7f79b82fac64256fe742acb3d7f547"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/bytedance/seedance-2.5/video-extend",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        required: [
          "prompt",
          "video_url"
        ],
        properties: {
          prompt: {
            type: "string",
            minLength: 1,
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            default: 5,
            maximum: 30,
            minimum: 4
          },
          video_url: {
            type: "string",
            format: "uri"
          },
          audio_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            maxItems: 10,
            minItems: 1
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            maxItems: 30,
            minItems: 1
          },
          resolution: {
            enum: [
              "480p",
              "720p",
              "1080p"
            ],
            type: "string",
            default: "720p"
          },
          video_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            maxItems: 10,
            minItems: 1
          },
          bitrate_mode: {
            enum: [
              "standard",
              "high"
            ],
            type: "string",
            default: "high"
          },
          generate_audio: {
            type: "boolean",
            default: true
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "prompt",
        "duration",
        "video_url",
        "audio_urls",
        "image_urls",
        "resolution",
        "video_urls",
        "bitrate_mode",
        "generate_audio"
      ],
      usageNotes: "* Use publicly accessible media URLs; asset:// references are rejected for these endpoints.\n* The source video\\_url counts toward the 10-video limit, so include at most 9 additional video\\_urls. At most 50 media items are accepted across the source video and all reference arrays.\n* Videos and audio may be trimmed or padded during preprocessing to fit their respective 30-second total budgets. Output framing follows the source video.\n* duration is an integer from 4 to 30 seconds, with default 5.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/seedance-2-5/video-extend.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:59.876029+00:00",
          snapshot: "evidence/docs-models__seedance-2-5__video-extend.md",
          sha256: "a05b78c79ce9bbe4ea6745d8d0c45df53e7f79b82fac64256fe742acb3d7f547"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [
        "Console vs docs parameter/default differences recorded in evidence/source-conflicts.json; resolve before claiming runtime parity."
      ],
      nativeAudio: {
        inputFields: {
          audio_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            maxItems: 10,
            minItems: 1
          }
        },
        controlFields: {
          generate_audio: {
            type: "boolean",
            default: true
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* Use publicly accessible media URLs; asset:// references are rejected for these endpoints.\n* The source video\\_url counts toward the 10-video limit, so include at most 9 additional video\\_urls. At most 50 media items are accepted across the source video and all reference arrays.\n* Videos and audio may be trimmed or padded during preprocessing to fit their respective 30-second total budgets. Output framing follows the source video.\n* duration is an integer from 4 to 30 seconds, with default 5."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/bytedance/seedance-2.5/video-extend/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-e2653d1cb0a0.txt",
        sha256: "b0a474a3969cec3a447916ac8b23dc66e8d91e69c06d4df0c4f01e67f5a4c22f"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	Yes	\u2014	Minimum length: 1.\nduration	integer	No	5	Minimum: 4. Maximum: 30.\nvideo_url	string	Yes	\u2014	\naudio_urls	array[string]	No	\u2014	\nimage_urls	array[string]	No	\u2014	\nresolution	string	No	"720p"	Options: 480p, 720p, 1080p.\nvideo_urls	array[string]	No	\u2014	\noutput_format	string	No	"mp4"	Options: mp4, mov.\ngenerate_audio	boolean	No	true',
      sourceConflicts: [
        {
          kind: "docs-fields-absent-from-console-table",
          fields: [
            "bitrate_mode"
          ]
        },
        {
          kind: "console-fields-absent-from-docs-schema",
          fields: [
            "output_format"
          ]
        }
      ],
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "bytedance/seedance-2.0/image-to-video",
      title: "Seedance 2.0 \u2014 Image to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/seedance-2/image-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:00.431866+00:00",
        snapshot: "evidence/docs-models__seedance-2__image-to-video.md",
        sha256: "026067892fda5b6af49c99b3a2e44fec99a0b5eeaae7b3c28a390b3b3294b8ed"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/bytedance/seedance-2.0/image-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        required: [
          "image_url"
        ],
        properties: {
          prompt: {
            type: "string",
            minLength: 1,
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            default: 5,
            maximum: 15,
            minimum: 4
          },
          image_url: {
            type: "string",
            format: "uri"
          },
          resolution: {
            enum: [
              "480p",
              "720p",
              "1080p",
              "4k"
            ],
            type: "string",
            default: "720p"
          },
          end_image_url: {
            type: "string",
            format: "uri"
          },
          generate_audio: {
            type: "boolean",
            default: true
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "prompt",
        "duration",
        "image_url",
        "resolution",
        "end_image_url",
        "generate_audio"
      ],
      usageNotes: "* Use publicly accessible media URLs; asset:// references are rejected for these endpoints.\n* The prompt is optional. Output framing follows image\\_url; end\\_image\\_url is the optional last frame.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/seedance-2/image-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:00.431866+00:00",
          snapshot: "evidence/docs-models__seedance-2__image-to-video.md",
          sha256: "026067892fda5b6af49c99b3a2e44fec99a0b5eeaae7b3c28a390b3b3294b8ed"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          generate_audio: {
            type: "boolean",
            default: true
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/bytedance/seedance-2.0/image-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-060af9436ed1.txt",
        sha256: "5565a48975c8168d081eefe37767d09e7f8916efc221030c14babb485e10a019"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	No	\u2014	Minimum length: 1.\nduration	integer	No	5	Minimum: 4. Maximum: 15.\nimage_url	string	Yes	\u2014	\nresolution	string	No	"720p"	Options: 480p, 720p, 1080p, 4k.\nend_image_url	string	No	\u2014	\ngenerate_audio	boolean	No	true',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "bytedance/seedance-2.0/reference-to-video",
      title: "Seedance 2.0 \u2014 Reference to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/seedance-2/reference-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:57.728398+00:00",
        snapshot: "evidence/docs-models__seedance-2__reference-to-video.md",
        sha256: "edc7bbc8a455f4cd91f14c0632e8584e563d1a5369affbd9c2d46372df6d92dd"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/bytedance/seedance-2.0/reference-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        if: {
          required: [
            "image_urls"
          ]
        },
        else: {
          required: [
            "video_urls"
          ]
        },
        type: "object",
        required: [],
        properties: {
          prompt: {
            type: "string",
            minLength: 1,
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            default: 5,
            maximum: 15,
            minimum: 4
          },
          audio_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            maxItems: 3,
            minItems: 1
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            maxItems: 9,
            minItems: 1
          },
          resolution: {
            enum: [
              "480p",
              "720p",
              "1080p",
              "4k"
            ],
            type: "string",
            default: "720p"
          },
          video_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            maxItems: 3,
            minItems: 1
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "4:3",
              "1:1",
              "3:4",
              "9:16",
              "21:9"
            ],
            type: "string",
            default: "16:9"
          },
          generate_audio: {
            type: "boolean",
            default: true
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "prompt",
        "duration",
        "audio_urls",
        "image_urls",
        "resolution",
        "video_urls",
        "aspect_ratio",
        "generate_audio"
      ],
      usageNotes: "* Use publicly accessible media URLs; asset:// references are rejected for these endpoints.\n* Provide a nonempty image\\_urls or video\\_urls array. Audio alone does not satisfy the reference requirement. Do not mix reference arrays with image\\_url, end\\_image\\_url or video\\_url.\n* Reference videos may be resized, transcoded and trimmed to 15 seconds each. Reference audio is normalized to 2\u201315 seconds per file and at most 15 seconds total.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/seedance-2/reference-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:57.728398+00:00",
          snapshot: "evidence/docs-models__seedance-2__reference-to-video.md",
          sha256: "edc7bbc8a455f4cd91f14c0632e8584e563d1a5369affbd9c2d46372df6d92dd"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {
          audio_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            maxItems: 3,
            minItems: 1
          }
        },
        controlFields: {
          generate_audio: {
            type: "boolean",
            default: true
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* Use publicly accessible media URLs; asset:// references are rejected for these endpoints.\n* Provide a nonempty image\\_urls or video\\_urls array. Audio alone does not satisfy the reference requirement. Do not mix reference arrays with image\\_url, end\\_image\\_url or video\\_url.\n* Reference videos may be resized, transcoded and trimmed to 15 seconds each. Reference audio is normalized to 2\u201315 seconds per file and at most 15 seconds total."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/bytedance/seedance-2.0/reference-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-dd7f6ba0ed10.txt",
        sha256: "6b40250581ab4584470461e0f1efbacf8d2de887087b6437cd86e1096c54a683"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	No	\u2014	Minimum length: 1.\nduration	integer	No	5	Minimum: 4. Maximum: 15.\naudio_urls	array[string]	No	\u2014	\nimage_urls	array[string]	No	\u2014	\nresolution	string	No	"720p"	Options: 480p, 720p, 1080p, 4k.\nvideo_urls	array[string]	No	\u2014	\naspect_ratio	string	No	"16:9"	Options: 16:9, 4:3, 1:1, 3:4, 9:16, 21:9.\ngenerate_audio	boolean	No	true',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "bytedance/seedance-2.0/text-to-video",
      title: "Seedance 2.0 \u2014 Text to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/seedance-2/text-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:00.475366+00:00",
        snapshot: "evidence/docs-models__seedance-2__text-to-video.md",
        sha256: "f6aa68aa28da33afe53dee000f79ae00d35c58bc02eb0bf3f3cb7f1f483e931f"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/bytedance/seedance-2.0/text-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        required: [
          "prompt"
        ],
        properties: {
          prompt: {
            type: "string",
            minLength: 1,
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            default: 5,
            maximum: 15,
            minimum: 4
          },
          resolution: {
            enum: [
              "480p",
              "720p",
              "1080p",
              "4k"
            ],
            type: "string",
            default: "720p"
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "4:3",
              "1:1",
              "3:4",
              "9:16",
              "21:9"
            ],
            type: "string",
            default: "16:9"
          },
          generate_audio: {
            type: "boolean",
            default: true
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "prompt",
        "duration",
        "resolution",
        "aspect_ratio",
        "generate_audio"
      ],
      usageNotes: "* Use publicly accessible media URLs; asset:// references are rejected for these endpoints.\n* Provide a nonblank prompt. This endpoint does not use media inputs; use the image-to-video or reference-to-video endpoint instead.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/seedance-2/text-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:00.475366+00:00",
          snapshot: "evidence/docs-models__seedance-2__text-to-video.md",
          sha256: "f6aa68aa28da33afe53dee000f79ae00d35c58bc02eb0bf3f3cb7f1f483e931f"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          generate_audio: {
            type: "boolean",
            default: true
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/bytedance/seedance-2.0/text-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-746ee8a23f8c.txt",
        sha256: "e55e51902e0d518af6331083dba87a69bde83386e15ee3b551b61d3373005be5"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	Yes	\u2014	Minimum length: 1.\nduration	integer	No	5	Minimum: 4. Maximum: 15.\nresolution	string	No	"720p"	Options: 480p, 720p, 1080p, 4k.\naspect_ratio	string	No	"16:9"	Options: 16:9, 4:3, 1:1, 3:4, 9:16, 21:9.\ngenerate_audio	boolean	No	true',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "higgsfield-ai/soul/v2/standard",
      title: "SOUL V2 \u2014 Text to image API",
      category: "image",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/soul-2/generate.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:04.823319+00:00",
        snapshot: "evidence/docs-models__soul-2__generate.md",
        sha256: "038864f4f4d00ccf134d4925544f97ecbcec7c302c3261800d3b442d8b081926"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/higgsfield-ai/soul/v2/standard",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        properties: {
          prompt: {
            title: "Prompt",
            type: "string"
          },
          aspect_ratio: {
            default: "1:1",
            enum: [
              "9:16",
              "16:9",
              "4:3",
              "3:4",
              "1:1",
              "2:3",
              "3:2"
            ],
            title: "Aspect Ratio",
            type: "string"
          },
          resolution: {
            default: "720p",
            enum: [
              "720p",
              "1080p"
            ],
            title: "Resolution",
            type: "string"
          },
          enhance_prompt: {
            default: false,
            title: "Enhance Prompt",
            type: "boolean"
          },
          custom_reference_id: {
            anyOf: [
              {
                format: "uuid",
                type: "string"
              },
              {
                type: "null"
              }
            ],
            default: null,
            title: "Custom Reference Id"
          },
          custom_reference_strength: {
            default: 1,
            maximum: 1,
            minimum: 0,
            title: "Custom Reference Strength",
            type: "number"
          },
          style_id: {
            default: "3db34ab5-3439-4317-9e03-08dc30852e69",
            format: "uuid",
            title: "Style Id",
            type: "string"
          },
          style_strength: {
            default: 1,
            maximum: 1,
            minimum: 0,
            title: "Style Strength",
            type: "number"
          },
          seed: {
            maximum: 1e6,
            minimum: 1,
            title: "Seed",
            type: "integer"
          },
          batch_size: {
            default: 1,
            enum: [
              1,
              4
            ],
            title: "Batch Size",
            type: "integer"
          }
        },
        required: [
          "prompt"
        ],
        title: "SoulV2ParamsSchema",
        type: "object"
      },
      parameterNames: [
        "prompt",
        "aspect_ratio",
        "resolution",
        "enhance_prompt",
        "custom_reference_id",
        "custom_reference_strength",
        "style_id",
        "style_strength",
        "seed",
        "batch_size"
      ],
      usageNotes: "* batch\\_size is 1 or 4 only. A custom\\_reference\\_id must belong to the calling account and have completed training.\n* aspect\\_ratio defaults to 1:1 and enhance\\_prompt defaults to false. seed defaults to a random integer from 1 to 1000000; explicit null is invalid.\n* style\\_id defaults to 3db34ab5-3439-4317-9e03-08dc30852e69. style\\_strength is accepted by the request schema but currently has no effect on generation.\n* Short prompts using the general style can be enhanced automatically even when enhance\\_prompt=false.\n* When using custom\\_reference\\_id, set custom\\_reference\\_strength to a value greater than 0 and no greater than 1. The schema accepts 0, but the current runtime fails to process it for a character reference.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "image",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "images": [\n    {\n      "url": "https://example.com/output.png"\n    }\n  ]\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/soul-2/generate.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:04.823319+00:00",
          snapshot: "evidence/docs-models__soul-2__generate.md",
          sha256: "038864f4f4d00ccf134d4925544f97ecbcec7c302c3261800d3b442d8b081926"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "documented-endpoint-no-authenticated-quote",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [
        "Console vs docs parameter/default differences recorded in evidence/source-conflicts.json; resolve before claiming runtime parity."
      ],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "image",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "documented-endpoint-no-authenticated-quote",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/higgsfield-ai/soul/v2/standard/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-b0e570d39bad.txt",
        sha256: "f62774f2f2ab6c3dc3386b00a5cdfed95df682927d69aa2af500c0ee8ea7ff2d"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'seed	integer	No	null	Seed. Minimum: 1. Maximum: 1000000.\nprompt	string	Yes	\u2014	Prompt.\nstyle_id	string	No	\u2014	Soul Style.\ncustom_reference_id	string (UUID) or null	No	null	Completed Soul ID trained for Soul 2 in the same API account. See Custom references below.\ncustom_reference_strength	number	No	1.0	Soul ID strength, from 0 to 1. Used with custom_reference_id.\nbatch_size	integer	No	1	Result images. Options: 1, 4.\nresolution	string	No	"720p"	Resolution. Options: 720p, 1080p.\naspect_ratio	string	No	"4:3"	Aspect Ratio. Options: 9:16, 16:9, 4:3, 3:4, 1:1, 2:3, 3:2.\nenhance_prompt	boolean	No	true	Enhance Prompt.',
      sourceConflicts: [
        {
          kind: "docs-fields-absent-from-console-table",
          fields: [
            "style_strength"
          ]
        },
        {
          kind: "null-default-on-nonnullable-schema",
          field: "seed"
        },
        {
          kind: "default-conflict",
          field: "aspect_ratio",
          docs: "1:1",
          consoleDisplay: '"4:3"'
        },
        {
          kind: "default-conflict",
          field: "enhance_prompt",
          docs: false,
          consoleDisplay: "true"
        }
      ],
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "higgsfield-ai/soul/cinema",
      title: "SOUL Cinema \u2014 Text to image API",
      category: "image",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/soul-cinema/generate.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:00.646389+00:00",
        snapshot: "evidence/docs-models__soul-cinema__generate.md",
        sha256: "576b374dfcd39558755a96f421394abc069cd75c83ec7986eafa16de8d06ac20"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/higgsfield-ai/soul/cinema",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        properties: {
          prompt: {
            title: "Prompt",
            type: "string"
          },
          aspect_ratio: {
            default: "1:1",
            enum: [
              "9:16",
              "16:9",
              "4:3",
              "3:4",
              "1:1",
              "2:3",
              "3:2"
            ],
            title: "Aspect Ratio",
            type: "string"
          },
          enhance_prompt: {
            default: false,
            title: "Enhance Prompt",
            type: "boolean"
          },
          resolution: {
            default: "720p",
            enum: [
              "720p",
              "1080p"
            ],
            title: "Resolution",
            type: "string"
          },
          custom_reference_id: {
            anyOf: [
              {
                format: "uuid",
                type: "string"
              },
              {
                type: "null"
              }
            ],
            default: null,
            title: "Custom Reference Id"
          },
          custom_reference_strength: {
            default: 1,
            maximum: 1,
            minimum: 0,
            title: "Custom Reference Strength",
            type: "number"
          },
          seed: {
            maximum: 1e6,
            minimum: 1,
            title: "Seed",
            type: "integer"
          },
          batch_size: {
            default: 1,
            enum: [
              1,
              4
            ],
            title: "Batch Size",
            type: "integer"
          }
        },
        required: [
          "prompt"
        ],
        title: "SoulCinemaParamsSchema",
        type: "object"
      },
      parameterNames: [
        "prompt",
        "aspect_ratio",
        "enhance_prompt",
        "resolution",
        "custom_reference_id",
        "custom_reference_strength",
        "seed",
        "batch_size"
      ],
      usageNotes: "* batch\\_size is 1 or 4 only. A custom\\_reference\\_id must belong to the calling account and have completed training.\n* aspect\\_ratio defaults to 1:1 and enhance\\_prompt defaults to false. seed defaults to a random integer from 1 to 1000000; explicit null is invalid.\n* Providing a custom\\_reference\\_id enables prompt enhancement for the character reference, even if enhance\\_prompt is false.\n* Cinema uses a fixed style; client-supplied style\\_id is ignored.\n* This model may be absent from model discovery; authorized requests can use the endpoint ID directly.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "image",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "images": [\n    {\n      "url": "https://example.com/output.png"\n    }\n  ]\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/soul-cinema/generate.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:00.646389+00:00",
          snapshot: "evidence/docs-models__soul-cinema__generate.md",
          sha256: "576b374dfcd39558755a96f421394abc069cd75c83ec7986eafa16de8d06ac20"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [
        "Documented schema exists, but public console target has no model View docs link; current availability/account access unknown. Do not call it web-only or silently replace it."
      ],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "image",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/higgsfield-ai/soul/cinema/playground",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-9226f37ad978.txt",
        sha256: "4d775c79ca608794a9a47cf19e77db2b07a317faf9f19b2e393f5eb3658ee3e8"
      },
      consoleObservation: "no View docs link in public page; see stable snapshot, account access unverified",
      consoleSchemaStatus: "parameter-table-not-present; docs schema retained as dated documentation only",
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "soul-id",
      title: "Soul ID \u2014 Create character API",
      category: "reference",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/soul-id/create-character.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:57.790097+00:00",
        snapshot: "evidence/docs-models__soul-id__create-character.md",
        sha256: "a6c6a35afcfad8f2351f16d81d4af50ee1a420b7acc3d68df609723b881773c2"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/v1/custom-references",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        $defs: {
          ImageUrlInputImageSchema: {
            properties: {
              type: {
                const: "image_url",
                title: "Type",
                type: "string"
              },
              image_url: {
                format: "uri",
                maxLength: 2083,
                minLength: 1,
                title: "Image Url",
                type: "string"
              }
            },
            required: [
              "type",
              "image_url"
            ],
            title: "ImageUrlInputImageSchema",
            type: "object"
          },
          SoulModelVersion: {
            enum: [
              "v1",
              "v2",
              "cinema"
            ],
            title: "SoulModelVersion",
            type: "string"
          }
        },
        properties: {
          name: {
            maxLength: 100,
            title: "Name",
            type: "string"
          },
          model_version: {
            $ref: "#/$defs/SoulModelVersion",
            default: "v1"
          },
          input_images: {
            items: {
              $ref: "#/$defs/ImageUrlInputImageSchema"
            },
            maxItems: 100,
            minItems: 1,
            title: "Input Images",
            type: "array"
          }
        },
        required: [
          "name",
          "input_images"
        ],
        title: "CreateCustomReferenceSchema",
        type: "object"
      },
      parameterNames: [
        "name",
        "model_version",
        "input_images"
      ],
      usageNotes: '* Soul ID trains a reusable character reference. This is not an image-generation endpoint; do not POST to /soul-id.\n* Use POST /v1/custom-references with application/json. name has a maximum length of 100; input\\_images must contain 1\u2013100 \\{"type":"image\\_url","image\\_url":"..."} objects.\n* model\\_version accepts v1, v2, cinema; its default is v1. Choose the matching generation family.\n* The creation response returns id and status. Poll GET /v1/custom-references/\\{id}; statuses are not\\_ready, queued, in\\_progress, completed, and failed.\n* After completion, pass the returned id as custom\\_reference\\_id to the matching Soul generation endpoint. References are scoped to the account that created them.\n* When the account already has the maximum number of references in training, creation returns 429 Too Many Requests with a Retry-After header. Retry after that delay; nothing is charged for the rejected request.',
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "reference",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: "The response is a character reference with `id`, `name`, `model_version`, `status`, `thumbnail_url`, `created_at`, `in_progress_at` and `fail_reason`.\n\nPoll `GET https://api.higgsfield.ai/v1/custom-references/{id}` with the same API credentials. Training states are `not_ready`, `queued`, `in_progress`, `completed` and `failed`.\n\nAfter `completed`, pass the reference `id` as `custom_reference_id` to the matching SOUL generation workflow. The reference must belong to your account. Training does not return `request_id` or generated `images`."
      },
      variants: [
        {
          id: "soul-id:v1",
          params: {
            model_version: "v1"
          }
        },
        {
          id: "soul-id:v2",
          params: {
            model_version: "v2"
          }
        },
        {
          id: "soul-id:cinema",
          params: {
            model_version: "cinema"
          }
        }
      ],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/soul-id/create-character.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:57.790097+00:00",
          snapshot: "evidence/docs-models__soul-id__create-character.md",
          sha256: "a6c6a35afcfad8f2351f16d81d4af50ee1a420b7acc3d68df609723b881773c2"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous reference-training",
      lifecycleRef: "referenceTraining",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "training cancellation not documented",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "reference",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "higgsfield-ai/soul/standard",
      title: "SOUL \u2014 Text to image API",
      category: "image",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/soul-standard/generate.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:00.686644+00:00",
        snapshot: "evidence/docs-models__soul-standard__generate.md",
        sha256: "91c0bc0737d84eec3e28db70c3e514e95c5549ad364418516a7f64d3c04a13cc"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/higgsfield-ai/soul/standard",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        properties: {
          prompt: {
            title: "Prompt",
            type: "string"
          },
          aspect_ratio: {
            default: "4:3",
            enum: [
              "9:16",
              "16:9",
              "4:3",
              "3:4",
              "1:1",
              "2:3",
              "3:2"
            ],
            title: "Aspect Ratio",
            type: "string"
          },
          enhance_prompt: {
            default: false,
            title: "Enhance Prompt",
            type: "boolean"
          },
          style_id: {
            default: "464ea177-8d40-4940-8d9d-b438bab269c7",
            format: "uuid",
            title: "Style Id",
            type: "string"
          },
          style_strength: {
            default: 1,
            maximum: 1,
            minimum: 0,
            title: "Style Strength",
            type: "number"
          },
          resolution: {
            default: "720p",
            enum: [
              "720p",
              "1080p"
            ],
            title: "Resolution",
            type: "string"
          },
          seed: {
            anyOf: [
              {
                maximum: 1e6,
                minimum: 1,
                type: "integer"
              },
              {
                type: "null"
              }
            ],
            default: null,
            title: "Seed"
          },
          custom_reference_id: {
            anyOf: [
              {
                format: "uuid",
                type: "string"
              },
              {
                type: "null"
              }
            ],
            default: null,
            title: "Custom Reference Id"
          },
          custom_reference_strength: {
            default: 1,
            maximum: 1,
            minimum: 0,
            title: "Custom Reference Strength",
            type: "number"
          },
          image_reference_url: {
            anyOf: [
              {
                format: "uri",
                maxLength: 2083,
                minLength: 1,
                type: "string"
              },
              {
                type: "null"
              }
            ],
            default: null,
            title: "Image Reference Url"
          },
          batch_size: {
            default: 1,
            enum: [
              1,
              4
            ],
            title: "Batch Size",
            type: "integer"
          }
        },
        required: [
          "prompt"
        ],
        title: "SoulParamsSchema",
        type: "object"
      },
      parameterNames: [
        "prompt",
        "aspect_ratio",
        "enhance_prompt",
        "style_id",
        "style_strength",
        "resolution",
        "seed",
        "custom_reference_id",
        "custom_reference_strength",
        "image_reference_url",
        "batch_size"
      ],
      usageNotes: "* batch\\_size is 1 or 4 only. A custom\\_reference\\_id must belong to the calling account and have completed training.\n* aspect\\_ratio defaults to 4:3; enhance\\_prompt defaults to false; style\\_id defaults to 464ea177-8d40-4940-8d9d-b438bab269c7.\n* Optional image\\_reference\\_url guides prompt enhancement; it is distinct from custom\\_reference\\_id for a trained character.\n* seed may be omitted or null; generation selects a random seed when it is absent.\n* Short prompts using the general style can be enhanced automatically even when enhance\\_prompt=false.\n* custom\\_reference\\_strength=0 uses the selected style's default character strength; it does not disable the character reference.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "image",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "images": [\n    {\n      "url": "https://example.com/output.png"\n    }\n  ]\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/soul-standard/generate.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:00.686644+00:00",
          snapshot: "evidence/docs-models__soul-standard__generate.md",
          sha256: "91c0bc0737d84eec3e28db70c3e514e95c5549ad364418516a7f64d3c04a13cc"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [
        "Console vs docs parameter/default differences recorded in evidence/source-conflicts.json; resolve before claiming runtime parity."
      ],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "image",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/higgsfield-ai/soul/standard/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-b7e436a96854.txt",
        sha256: "84209f8a5e8f8a6b81c08e1b5f1cfe5550ac564e785286f61b008130a7c7b39e"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'seed	integer	No	null	Seed. Minimum: 1. Maximum: 1000000.\nprompt	string	Yes	\u2014	Prompt.\nstyle_id	string	No	null	Soul Style.\nbatch_size	integer	No	1	Result images. Options: 1, 4.\nresolution	string	No	"720p"	Resolution. Options: 720p, 1080p.\naspect_ratio	string	No	"4:3"	Aspect Ratio. Options: 9:16, 16:9, 4:3, 3:4, 1:1, 2:3, 3:2.\nenhance_prompt	boolean	No	true	Enhance Prompt.\nstyle_strength	number	No	1	Style strength. Minimum: 0. Maximum: 1.',
      sourceConflicts: [
        {
          kind: "docs-fields-absent-from-console-table",
          fields: [
            "custom_reference_id",
            "custom_reference_strength",
            "image_reference_url"
          ]
        },
        {
          kind: "default-conflict",
          field: "enhance_prompt",
          docs: false,
          consoleDisplay: "true"
        }
      ],
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "wan/v2.6/image-to-video",
      title: "Wan 2.6 \u2014 Image to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/wan-2-6/image-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:00.992380+00:00",
        snapshot: "evidence/docs-models__wan-2-6__image-to-video.md",
        sha256: "cf027ebd7af648af69cf185e8c5b34b4154d1b5ae3819604ecab116567ba01cc"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/wan/v2.6/image-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Wan 2.6 Playground",
        required: [
          "prompt",
          "image_url"
        ],
        properties: {
          seed: {
            type: "integer",
            maximum: 1e7,
            minimum: -1
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            enum: [
              5,
              10,
              15
            ],
            type: "integer",
            title: "Duration",
            default: 5
          },
          audio_url: {
            type: "string",
            title: "Audio URL",
            format: "uri"
          },
          image_url: {
            type: "string",
            title: "Image URL",
            format: "uri"
          },
          resolution: {
            enum: [
              "480p",
              "720p",
              "1080p"
            ],
            type: "string",
            default: "720p"
          },
          multi_shots: {
            type: "boolean",
            default: false
          },
          prompt_extend: {
            type: "boolean",
            default: false
          },
          negative_prompt: {
            type: "string",
            title: "Negative prompt",
            default: ""
          }
        }
      },
      parameterNames: [
        "seed",
        "prompt",
        "duration",
        "audio_url",
        "image_url",
        "resolution",
        "multi_shots",
        "prompt_extend",
        "negative_prompt"
      ],
      usageNotes: "* Setting multi\\_shots=true also enables prompt\\_extend, even if prompt\\_extend was false.\n* Input images may be resized to fit a 1,440-pixel maximum dimension before generation. A last-frame input is unsupported.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/wan-2-6/image-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:00.992380+00:00",
          snapshot: "evidence/docs-models__wan-2-6__image-to-video.md",
          sha256: "cf027ebd7af648af69cf185e8c5b34b4154d1b5ae3819604ecab116567ba01cc"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {
          audio_url: {
            type: "string",
            title: "Audio URL",
            format: "uri"
          }
        },
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/wan/v2.6/image-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-5eda0326c892.txt",
        sha256: "52edd5466784e210807b31d795a326f2717381c3417550504ab398b09c0ba5eb"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'seed	integer	No	\u2014	Minimum: -1. Maximum: 10000000.\nprompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	Duration. Options: 5, 10, 15.\naudio_url	string	No	\u2014	Audio URL.\nimage_url	string	Yes	\u2014	Image URL.\nresolution	string	No	"720p"	Options: 480p, 720p, 1080p.\nmulti_shots	boolean	No	false	\nprompt_extend	boolean	No	false	\nnegative_prompt	string	No	""	Negative prompt.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "wan/v2.6/reference-to-video",
      title: "Wan 2.6 \u2014 Reference to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/wan-2-6/reference-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:58.041731+00:00",
        snapshot: "evidence/docs-models__wan-2-6__reference-to-video.md",
        sha256: "16c0d4a1608d1c573b42ef7e9e44bc22b30c987f3d2cd9f563c56f5f2b3ca69b"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/wan/v2.6/reference-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Wan 2.6 Playground",
        required: [
          "prompt",
          "video_urls"
        ],
        properties: {
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            enum: [
              5,
              10
            ],
            type: "integer",
            title: "Duration",
            default: 5
          },
          resolution: {
            enum: [
              "720p",
              "1080p"
            ],
            type: "string",
            title: "Resolution",
            default: "720p"
          },
          video_urls: {
            type: "array",
            items: {
              type: "string",
              title: "Video URL",
              format: "uri"
            },
            maxItems: 3,
            minItems: 1
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "9:16",
              "1:1",
              "4:3",
              "3:4"
            ],
            type: "string",
            default: "16:9"
          }
        }
      },
      parameterNames: [
        "prompt",
        "duration",
        "resolution",
        "video_urls",
        "aspect_ratio"
      ],
      usageNotes: "* Supply 1\u20133 reference videos. This endpoint supports only 5 or 10 seconds, unlike the text and image endpoints that also support 15 seconds.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/wan-2-6/reference-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:58.041731+00:00",
          snapshot: "evidence/docs-models__wan-2-6__reference-to-video.md",
          sha256: "16c0d4a1608d1c573b42ef7e9e44bc22b30c987f3d2cd9f563c56f5f2b3ca69b"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/wan/v2.6/reference-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-408f1aca7332.txt",
        sha256: "8f922ab0bfdafa319b6c6831430ddffedc072e9f1d052a095ba36de2269591d5"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'prompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	Duration. Options: 5, 10.\nresolution	string	No	"720p"	Resolution. Options: 720p, 1080p.\nvideo_urls	array[string]	Yes	\u2014	\naspect_ratio	string	No	"16:9"	Options: 16:9, 9:16, 1:1, 4:3, 3:4.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "wan/v2.6/text-to-video",
      title: "Wan 2.6 \u2014 Text to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/wan-2-6/text-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:01.157535+00:00",
        snapshot: "evidence/docs-models__wan-2-6__text-to-video.md",
        sha256: "bdfb887110799ee442cabb4c8028b819462f09f3a30edc1cfeb0d54f1a179619"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/wan/v2.6/text-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Wan 2.6 Playground",
        required: [
          "prompt"
        ],
        properties: {
          seed: {
            type: "integer",
            maximum: 1e7,
            minimum: -1
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            enum: [
              5,
              10,
              15
            ],
            type: "integer",
            title: "Duration",
            default: 5
          },
          audio_url: {
            type: "string",
            title: "Audio URL",
            format: "uri"
          },
          resolution: {
            enum: [
              "720p",
              "1080p"
            ],
            type: "string",
            default: "720p"
          },
          multi_shots: {
            type: "boolean",
            default: false
          },
          prompt_extend: {
            type: "boolean",
            default: false
          }
        }
      },
      parameterNames: [
        "seed",
        "prompt",
        "duration",
        "audio_url",
        "resolution",
        "multi_shots",
        "prompt_extend"
      ],
      usageNotes: "* Setting multi\\_shots=true also enables prompt\\_extend, even if prompt\\_extend was false.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/wan-2-6/text-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:01.157535+00:00",
          snapshot: "evidence/docs-models__wan-2-6__text-to-video.md",
          sha256: "bdfb887110799ee442cabb4c8028b819462f09f3a30edc1cfeb0d54f1a179619"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {
          audio_url: {
            type: "string",
            title: "Audio URL",
            format: "uri"
          }
        },
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/wan/v2.6/text-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-f15fc7c95f03.txt",
        sha256: "9431e1d53267cefdbae505f196e9a8265e9f004f33f4c6640da519d52685eec1"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'seed	integer	No	\u2014	Minimum: -1. Maximum: 10000000.\nprompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	Duration. Options: 5, 10, 15.\naudio_url	string	No	\u2014	Audio URL.\nresolution	string	No	"720p"	Options: 720p, 1080p.\nmulti_shots	boolean	No	false	\nprompt_extend	boolean	No	false',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "wan/v2.7/image-to-video",
      title: "Wan 2.7 \u2014 Image to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/wan-2-7/image-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:01.147981+00:00",
        snapshot: "evidence/docs-models__wan-2-7__image-to-video.md",
        sha256: "2d2a930c5e8e7bb381905a58fcde92644157dc9879f28de0ec5baec9237b7267"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/wan/v2.7/image-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Wan 2.6 Playground",
        required: [
          "image_url"
        ],
        properties: {
          seed: {
            type: "integer",
            maximum: 2147483646,
            minimum: 1
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 15,
            minimum: 2
          },
          audio_url: {
            type: "string",
            title: "Audio URL",
            format: "uri"
          },
          image_url: {
            type: "string",
            title: "Image URL",
            format: "uri"
          },
          resolution: {
            enum: [
              "720p",
              "1080p"
            ],
            type: "string",
            default: "720p"
          },
          end_image_url: {
            type: "string",
            title: "Image URL",
            format: "uri"
          },
          prompt_extend: {
            type: "boolean",
            default: false
          },
          negative_prompt: {
            type: "string",
            title: "Negative prompt",
            default: ""
          }
        }
      },
      parameterNames: [
        "seed",
        "prompt",
        "duration",
        "audio_url",
        "image_url",
        "resolution",
        "end_image_url",
        "prompt_extend",
        "negative_prompt"
      ],
      usageNotes: "* The prompt is optional. end\\_image\\_url supplies a last frame, and audio\\_url can supply driving audio.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/wan-2-7/image-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:01.147981+00:00",
          snapshot: "evidence/docs-models__wan-2-7__image-to-video.md",
          sha256: "2d2a930c5e8e7bb381905a58fcde92644157dc9879f28de0ec5baec9237b7267"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {
          audio_url: {
            type: "string",
            title: "Audio URL",
            format: "uri"
          }
        },
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* The prompt is optional. end\\_image\\_url supplies a last frame, and audio\\_url can supply driving audio."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/wan/v2.7/image-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-3d654c6cfdf3.txt",
        sha256: "6762af9ea9851748e99e5c3ceda197df565ee9f07338fdf36b32242021b884ce"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'seed	integer	No	\u2014	Minimum: 1. Maximum: 2147483646.\nprompt	string	No	\u2014	Prompt.\nduration	integer	No	5	Duration. Minimum: 2. Maximum: 15.\naudio_url	string	No	\u2014	Audio URL.\nimage_url	string	Yes	\u2014	Image URL.\nresolution	string	No	"720p"	Options: 720p, 1080p.\nend_image_url	string	No	\u2014	Image URL.\nprompt_extend	boolean	No	false	\nnegative_prompt	string	No	""	Negative prompt.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "wan/v2.7/reference-to-video",
      title: "Wan 2.7 \u2014 Reference to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/wan-2-7/reference-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:57.862668+00:00",
        snapshot: "evidence/docs-models__wan-2-7__reference-to-video.md",
        sha256: "ca591756a9ac85b8e19a24e415bce1380930c401135e5aa432ddce9e047ab297"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/wan/v2.7/reference-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        if: {
          required: [
            "image_urls"
          ],
          properties: {
            image_urls: {
              type: "array",
              minItems: 1
            }
          }
        },
        else: {
          required: [
            "video_urls"
          ],
          properties: {
            video_urls: {
              type: "array",
              minItems: 1
            }
          }
        },
        type: "object",
        title: "Wan 2.7 References",
        required: [
          "prompt"
        ],
        properties: {
          seed: {
            type: "integer",
            maximum: 2147483646,
            minimum: 1
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 10,
            minimum: 2
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              title: "Image",
              format: "uri"
            }
          },
          resolution: {
            enum: [
              "720p",
              "1080p"
            ],
            type: "string",
            default: "720p"
          },
          video_urls: {
            type: "array",
            items: {
              type: "string",
              title: "Video",
              format: "uri"
            }
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "9:16"
            ],
            type: "string",
            title: "Aspect Ratio",
            default: "16:9"
          },
          prompt_extend: {
            type: "boolean",
            default: false
          },
          negative_prompt: {
            type: "string",
            title: "Negative prompt",
            default: ""
          }
        }
      },
      parameterNames: [
        "seed",
        "prompt",
        "duration",
        "image_urls",
        "resolution",
        "video_urls",
        "aspect_ratio",
        "prompt_extend",
        "negative_prompt"
      ],
      usageNotes: "* Provide a nonempty image\\_urls or video\\_urls array. The combined number of image and video references must not exceed 5; this submission limit is not expressed in the stored JSON Schema.\n* Reference generation is limited to 2\u201310 seconds and aspect ratios 16:9 or 9:16.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/wan-2-7/reference-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:57.862668+00:00",
          snapshot: "evidence/docs-models__wan-2-7__reference-to-video.md",
          sha256: "ca591756a9ac85b8e19a24e415bce1380930c401135e5aa432ddce9e047ab297"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/wan/v2.7/reference-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-0bbb3408e2cf.txt",
        sha256: "ac84172b3514c2c84bc73a95ba5b97b6239da582eb1cc6e3f02dfff0c219568c"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'seed	integer	No	\u2014	Minimum: 1. Maximum: 2147483646.\nprompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	Duration. Minimum: 2. Maximum: 10.\nimage_urls	array[string]	No	\u2014	\nresolution	string	No	"720p"	Options: 720p, 1080p.\nvideo_urls	array[string]	No	\u2014	\naspect_ratio	string	No	"16:9"	Aspect Ratio. Options: 16:9, 9:16.\nprompt_extend	boolean	No	false	\nnegative_prompt	string	No	""	Negative prompt.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "wan/v2.7/text-to-video",
      title: "Wan 2.7 \u2014 Text to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/wan-2-7/text-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:01.273479+00:00",
        snapshot: "evidence/docs-models__wan-2-7__text-to-video.md",
        sha256: "aa7d82496ec140028c02a6cdb6d28143b4f9cd04c7fa5ce0986f540f60c73d63"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/wan/v2.7/text-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Wan 2.6 Playground",
        required: [
          "prompt"
        ],
        properties: {
          seed: {
            type: "integer",
            maximum: 2147483646,
            minimum: 1
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration",
            default: 5,
            maximum: 15,
            minimum: 2
          },
          audio_url: {
            type: "string",
            title: "Audio URL",
            format: "uri"
          },
          resolution: {
            enum: [
              "720p",
              "1080p"
            ],
            type: "string",
            default: "720p"
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "9:16",
              "1:1",
              "4:3",
              "3:4"
            ],
            type: "string",
            title: "Aspect Ratio",
            default: "16:9"
          },
          prompt_extend: {
            type: "boolean",
            default: false
          },
          negative_prompt: {
            type: "string",
            title: "Negative prompt",
            default: ""
          }
        }
      },
      parameterNames: [
        "seed",
        "prompt",
        "duration",
        "audio_url",
        "resolution",
        "aspect_ratio",
        "prompt_extend",
        "negative_prompt"
      ],
      usageNotes: "* The prompt must contain text. audio\\_url can supply driving audio.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/wan-2-7/text-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:01.273479+00:00",
          snapshot: "evidence/docs-models__wan-2-7__text-to-video.md",
          sha256: "aa7d82496ec140028c02a6cdb6d28143b4f9cd04c7fa5ce0986f540f60c73d63"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {
          audio_url: {
            type: "string",
            title: "Audio URL",
            format: "uri"
          }
        },
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* The prompt must contain text. audio\\_url can supply driving audio."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/wan/v2.7/text-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-3bb52bb48b33.txt",
        sha256: "6cf716aaa3a5c55be5f82dcc61495b34e194643fb8a8e8985d0034bb56ad1e48"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'seed	integer	No	\u2014	Minimum: 1. Maximum: 2147483646.\nprompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	Duration. Minimum: 2. Maximum: 15.\naudio_url	string	No	\u2014	Audio URL.\nresolution	string	No	"720p"	Options: 720p, 1080p.\naspect_ratio	string	No	"16:9"	Aspect Ratio. Options: 16:9, 9:16, 1:1, 4:3, 3:4.\nprompt_extend	boolean	No	false	\nnegative_prompt	string	No	""	Negative prompt.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "alibaba/wan-3.0-prime/image-to-video",
      title: "Wan 3.0 Prime \u2014 Image to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/wan-3-prime/image-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:07.508211+00:00",
        snapshot: "evidence/docs-models__wan-3-prime__image-to-video.md",
        sha256: "9e739347ec1b4f58df6069d922846a33ed21a7662dd7c5b3f65434e5b65863d8"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/alibaba/wan-3.0-prime/image-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Wan 3.0 Prime Image to Video",
        required: [
          "prompt",
          "image_url"
        ],
        properties: {
          seed: {
            type: "integer",
            title: "Seed",
            maximum: 2147483647,
            minimum: 0
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration (sec)",
            default: 5,
            maximum: 30,
            minimum: 2,
            description: "2-30 seconds."
          },
          image_url: {
            type: "string",
            title: "First Frame",
            format: "uri"
          },
          resolution: {
            enum: [
              "480p",
              "720p",
              "1080p"
            ],
            type: "string",
            title: "Resolution",
            default: "1080p"
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "4:3",
              "1:1",
              "3:4",
              "9:16",
              "adaptive"
            ],
            type: "string",
            title: "Aspect Ratio",
            default: "adaptive"
          },
          end_image_url: {
            type: "string",
            title: "Last Frame",
            format: "uri"
          },
          generate_audio: {
            type: "boolean",
            title: "Sound",
            default: true
          },
          enable_thinking: {
            type: "boolean",
            title: "Deep Thinking",
            default: false
          }
        }
      },
      parameterNames: [
        "seed",
        "prompt",
        "duration",
        "image_url",
        "resolution",
        "aspect_ratio",
        "end_image_url",
        "generate_audio",
        "enable_thinking"
      ],
      usageNotes: "* Use image\\_url for the first frame and optional end\\_image\\_url for the last frame. Reference arrays belong to the reference-to-video endpoint.\n* The schema accepts seed=0, but the current implementation only forwards a nonzero seed.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/wan-3-prime/image-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:07.508211+00:00",
          snapshot: "evidence/docs-models__wan-3-prime__image-to-video.md",
          sha256: "9e739347ec1b4f58df6069d922846a33ed21a7662dd7c5b3f65434e5b65863d8"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          generate_audio: {
            type: "boolean",
            title: "Sound",
            default: true
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/alibaba/wan-3.0-prime/image-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-3cccca5429c9.txt",
        sha256: "3bf9b424edcfea911b1ee17b4a4ecbb4bc95d3c7cedc6d46b713ba3228a87299"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'seed	integer	No	\u2014	Seed. Minimum: 0. Maximum: 2147483647.\nprompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	2-30 seconds. Minimum: 2. Maximum: 30.\nimage_url	string	Yes	\u2014	First Frame.\nresolution	string	No	"1080p"	Resolution. Options: 480p, 720p, 1080p.\naspect_ratio	string	No	"adaptive"	Aspect Ratio. Options: 16:9, 4:3, 1:1, 3:4, 9:16, adaptive.\nend_image_url	string	No	\u2014	Last Frame.\ngenerate_audio	boolean	No	true	Sound.\nenable_thinking	boolean	No	false	Deep Thinking.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "alibaba/wan-3.0-prime/reference-to-video",
      title: "Wan 3.0 Prime \u2014 Reference to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/wan-3-prime/reference-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:02.269831+00:00",
        snapshot: "evidence/docs-models__wan-3-prime__reference-to-video.md",
        sha256: "c8846f7a1a896ffeec1efce20bf2dcc6fb565454d73f054a29e90566e8c52ab2"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/alibaba/wan-3.0-prime/reference-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Wan 3.0 Prime Reference to Video",
        required: [
          "prompt"
        ],
        properties: {
          seed: {
            type: "integer",
            title: "Seed",
            maximum: 2147483647,
            minimum: 0
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration (sec)",
            default: 5,
            maximum: 30,
            minimum: 2,
            description: "2-30 seconds."
          },
          file_url: {
            type: "string",
            title: "Reference Document",
            format: "uri",
            description: "One document (docx/xlsx/pptx/pdf/md). Forces deep thinking."
          },
          link_url: {
            type: "string",
            title: "Reference Web Page",
            format: "uri",
            description: "One public page. Forces deep thinking. Not combinable with file_url."
          },
          audio_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            title: "Reference Audio",
            maxItems: 5,
            description: "Up to 5 files, 30s total. WAV or MP3."
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            title: "Reference Images",
            maxItems: 10
          },
          resolution: {
            enum: [
              "480p",
              "720p",
              "1080p"
            ],
            type: "string",
            title: "Resolution",
            default: "1080p"
          },
          video_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            title: "Reference Videos",
            maxItems: 5,
            description: "Up to 5 clips, 30s total, each 1-30s."
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "4:3",
              "1:1",
              "3:4",
              "9:16",
              "adaptive"
            ],
            type: "string",
            title: "Aspect Ratio",
            default: "adaptive"
          },
          generate_audio: {
            type: "boolean",
            title: "Sound",
            default: true
          },
          enable_thinking: {
            type: "boolean",
            title: "Deep Thinking",
            default: false
          }
        }
      },
      parameterNames: [
        "seed",
        "prompt",
        "duration",
        "file_url",
        "link_url",
        "audio_urls",
        "image_urls",
        "resolution",
        "video_urls",
        "aspect_ratio",
        "generate_audio",
        "enable_thinking"
      ],
      usageNotes: "* Reference media are optional in the stored schema: only prompt is required. The example includes an image to demonstrate reference mode.\n* Send either file\\_url or link\\_url. A document or web-page reference automatically enables thinking; when both are sent, file\\_url takes precedence.\n* Reference video clips must be 1\u201330 seconds each and total at most 30 seconds. Reference audio must be WAV or MP3 and total at most 30 seconds, as specified in the production schema.\n* The schema accepts seed=0, but the current implementation only forwards a nonzero seed.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/wan-3-prime/reference-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:02.269831+00:00",
          snapshot: "evidence/docs-models__wan-3-prime__reference-to-video.md",
          sha256: "c8846f7a1a896ffeec1efce20bf2dcc6fb565454d73f054a29e90566e8c52ab2"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {
          audio_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            title: "Reference Audio",
            maxItems: 5,
            description: "Up to 5 files, 30s total. WAV or MP3."
          }
        },
        controlFields: {
          generate_audio: {
            type: "boolean",
            title: "Sound",
            default: true
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* Reference media are optional in the stored schema: only prompt is required. The example includes an image to demonstrate reference mode.\n* Send either file\\_url or link\\_url. A document or web-page reference automatically enables thinking; when both are sent, file\\_url takes precedence.\n* Reference video clips must be 1\u201330 seconds each and total at most 30 seconds. Reference audio must be WAV or MP3 and total at most 30 seconds, as specified in the production schema.\n* The schema accepts seed=0, but the current implementation only forwards a nonzero seed."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/alibaba/wan-3.0-prime/reference-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-c70bda8526b8.txt",
        sha256: "026459dd163fcbd60de286d125384694a12fa8a86f21b14d0ff73b1e693571d6"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'seed	integer	No	\u2014	Seed. Minimum: 0. Maximum: 2147483647.\nprompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	2-30 seconds. Minimum: 2. Maximum: 30.\nfile_url	string	No	\u2014	One document (docx/xlsx/pptx/pdf/md). Forces deep thinking.\nlink_url	string	No	\u2014	One public page. Forces deep thinking. Not combinable with file_url.\naudio_urls	array[string]	No	\u2014	Up to 5 files, 30s total. WAV or MP3.\nimage_urls	array[string]	No	\u2014	Reference Images.\nresolution	string	No	"1080p"	Resolution. Options: 480p, 720p, 1080p.\nvideo_urls	array[string]	No	\u2014	Up to 5 clips, 30s total, each 1-30s.\naspect_ratio	string	No	"adaptive"	Aspect Ratio. Options: 16:9, 4:3, 1:1, 3:4, 9:16, adaptive.\ngenerate_audio	boolean	No	true	Sound.\nenable_thinking	boolean	No	false	Deep Thinking.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "alibaba/wan-3.0-prime/text-to-video",
      title: "Wan 3.0 Prime \u2014 Text to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/wan-3-prime/text-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:07.304390+00:00",
        snapshot: "evidence/docs-models__wan-3-prime__text-to-video.md",
        sha256: "5b6c5b4bae8378efaed7d7ec1fc8511bca523735fd59b87146511cf3cd6c7b79"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/alibaba/wan-3.0-prime/text-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Wan 3.0 Prime Text to Video",
        required: [
          "prompt"
        ],
        properties: {
          seed: {
            type: "integer",
            title: "Seed",
            maximum: 2147483647,
            minimum: 0
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration (sec)",
            default: 5,
            maximum: 30,
            minimum: 2,
            description: "2-30 seconds."
          },
          resolution: {
            enum: [
              "480p",
              "720p",
              "1080p"
            ],
            type: "string",
            title: "Resolution",
            default: "1080p"
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "4:3",
              "1:1",
              "3:4",
              "9:16",
              "adaptive"
            ],
            type: "string",
            title: "Aspect Ratio",
            default: "adaptive"
          },
          generate_audio: {
            type: "boolean",
            title: "Sound",
            default: true
          },
          enable_thinking: {
            type: "boolean",
            title: "Deep Thinking",
            default: false
          }
        }
      },
      parameterNames: [
        "seed",
        "prompt",
        "duration",
        "resolution",
        "aspect_ratio",
        "generate_audio",
        "enable_thinking"
      ],
      usageNotes: "* This endpoint generates from text; use the separate image or reference endpoint for media inputs.\n* The schema accepts seed=0, but the current implementation only forwards a nonzero seed.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/wan-3-prime/text-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:07.304390+00:00",
          snapshot: "evidence/docs-models__wan-3-prime__text-to-video.md",
          sha256: "5b6c5b4bae8378efaed7d7ec1fc8511bca523735fd59b87146511cf3cd6c7b79"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          generate_audio: {
            type: "boolean",
            title: "Sound",
            default: true
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/alibaba/wan-3.0-prime/text-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-147460da03b7.txt",
        sha256: "aafaf63d871f6982eb133ab90fd9588f0a94a9e9d47788d2aeb2374ee158462d"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'seed	integer	No	\u2014	Seed. Minimum: 0. Maximum: 2147483647.\nprompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	2-30 seconds. Minimum: 2. Maximum: 30.\nresolution	string	No	"1080p"	Resolution. Options: 480p, 720p, 1080p.\naspect_ratio	string	No	"adaptive"	Aspect Ratio. Options: 16:9, 4:3, 1:1, 3:4, 9:16, adaptive.\ngenerate_audio	boolean	No	true	Sound.\nenable_thinking	boolean	No	false	Deep Thinking.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "alibaba/wan-3.0/image-to-video",
      title: "Wan 3.0 \u2014 Image to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/wan-3/image-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:01.844874+00:00",
        snapshot: "evidence/docs-models__wan-3__image-to-video.md",
        sha256: "9e20eec5f1fff3607d6db3eca00caa17ad9a1c5b346bdcbd41bebbf30d9ff70f"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/alibaba/wan-3.0/image-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Wan 3.0 Image to Video",
        required: [
          "prompt",
          "image_url"
        ],
        properties: {
          seed: {
            type: "integer",
            title: "Seed",
            maximum: 2147483647,
            minimum: 0
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration (sec)",
            default: 5,
            maximum: 30,
            minimum: 2,
            description: "2-30 seconds."
          },
          image_url: {
            type: "string",
            title: "First Frame",
            format: "uri"
          },
          resolution: {
            enum: [
              "480p",
              "720p",
              "1080p"
            ],
            type: "string",
            title: "Resolution",
            default: "1080p"
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "4:3",
              "1:1",
              "3:4",
              "9:16",
              "adaptive"
            ],
            type: "string",
            title: "Aspect Ratio",
            default: "adaptive"
          },
          end_image_url: {
            type: "string",
            title: "Last Frame",
            format: "uri"
          },
          generate_audio: {
            type: "boolean",
            title: "Sound",
            default: true
          },
          enable_thinking: {
            type: "boolean",
            title: "Deep Thinking",
            default: false
          }
        }
      },
      parameterNames: [
        "seed",
        "prompt",
        "duration",
        "image_url",
        "resolution",
        "aspect_ratio",
        "end_image_url",
        "generate_audio",
        "enable_thinking"
      ],
      usageNotes: "* Use image\\_url for the first frame and optional end\\_image\\_url for the last frame. Reference arrays belong to the reference-to-video endpoint.\n* The schema accepts seed=0, but the current implementation only forwards a nonzero seed.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/wan-3/image-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:01.844874+00:00",
          snapshot: "evidence/docs-models__wan-3__image-to-video.md",
          sha256: "9e20eec5f1fff3607d6db3eca00caa17ad9a1c5b346bdcbd41bebbf30d9ff70f"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          generate_audio: {
            type: "boolean",
            title: "Sound",
            default: true
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/alibaba/wan-3.0/image-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-14b423f33505.txt",
        sha256: "a32cd5525fc012398313f53373bd15fa78d12f26b50b16f3f471a8a235f3f997"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'seed	integer	No	\u2014	Seed. Minimum: 0. Maximum: 2147483647.\nprompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	2-30 seconds. Minimum: 2. Maximum: 30.\nimage_url	string	Yes	\u2014	First Frame.\nresolution	string	No	"1080p"	Resolution. Options: 480p, 720p, 1080p.\naspect_ratio	string	No	"adaptive"	Aspect Ratio. Options: 16:9, 4:3, 1:1, 3:4, 9:16, adaptive.\nend_image_url	string	No	\u2014	Last Frame.\ngenerate_audio	boolean	No	true	Sound.\nenable_thinking	boolean	No	false	Deep Thinking.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "alibaba/wan-3.0/reference-to-video",
      title: "Wan 3.0 \u2014 Reference to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/wan-3/reference-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:58.276319+00:00",
        snapshot: "evidence/docs-models__wan-3__reference-to-video.md",
        sha256: "ac0d4d91168458d9a6ed91f9a6078a09c8af59970bd0b72f86e727a20d9a9b95"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/alibaba/wan-3.0/reference-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Wan 3.0 Reference to Video",
        required: [
          "prompt"
        ],
        properties: {
          seed: {
            type: "integer",
            title: "Seed",
            maximum: 2147483647,
            minimum: 0
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration (sec)",
            default: 5,
            maximum: 30,
            minimum: 2,
            description: "2-30 seconds."
          },
          file_url: {
            type: "string",
            title: "Reference Document",
            format: "uri",
            description: "One document (docx/xlsx/pptx/pdf/md). Forces deep thinking."
          },
          link_url: {
            type: "string",
            title: "Reference Web Page",
            format: "uri",
            description: "One public page. Forces deep thinking. Not combinable with file_url."
          },
          audio_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            title: "Reference Audio",
            maxItems: 5,
            description: "Up to 5 files, 30s total. WAV or MP3."
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            title: "Reference Images",
            maxItems: 10
          },
          resolution: {
            enum: [
              "480p",
              "720p",
              "1080p"
            ],
            type: "string",
            title: "Resolution",
            default: "1080p"
          },
          video_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            title: "Reference Videos",
            maxItems: 5,
            description: "Up to 5 clips, 30s total, each 1-30s."
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "4:3",
              "1:1",
              "3:4",
              "9:16",
              "adaptive"
            ],
            type: "string",
            title: "Aspect Ratio",
            default: "adaptive"
          },
          generate_audio: {
            type: "boolean",
            title: "Sound",
            default: true
          },
          enable_thinking: {
            type: "boolean",
            title: "Deep Thinking",
            default: false
          }
        }
      },
      parameterNames: [
        "seed",
        "prompt",
        "duration",
        "file_url",
        "link_url",
        "audio_urls",
        "image_urls",
        "resolution",
        "video_urls",
        "aspect_ratio",
        "generate_audio",
        "enable_thinking"
      ],
      usageNotes: "* Reference media are optional in the stored schema: only prompt is required. The example includes an image to demonstrate reference mode.\n* Send either file\\_url or link\\_url. A document or web-page reference automatically enables thinking; when both are sent, file\\_url takes precedence.\n* Reference video clips must be 1\u201330 seconds each and total at most 30 seconds. Reference audio must be WAV or MP3 and total at most 30 seconds, as specified in the production schema.\n* The schema accepts seed=0, but the current implementation only forwards a nonzero seed.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/wan-3/reference-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:20:58.276319+00:00",
          snapshot: "evidence/docs-models__wan-3__reference-to-video.md",
          sha256: "ac0d4d91168458d9a6ed91f9a6078a09c8af59970bd0b72f86e727a20d9a9b95"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {
          audio_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri"
            },
            title: "Reference Audio",
            maxItems: 5,
            description: "Up to 5 files, 30s total. WAV or MP3."
          }
        },
        controlFields: {
          generate_audio: {
            type: "boolean",
            title: "Sound",
            default: true
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "* Reference media are optional in the stored schema: only prompt is required. The example includes an image to demonstrate reference mode.\n* Send either file\\_url or link\\_url. A document or web-page reference automatically enables thinking; when both are sent, file\\_url takes precedence.\n* Reference video clips must be 1\u201330 seconds each and total at most 30 seconds. Reference audio must be WAV or MP3 and total at most 30 seconds, as specified in the production schema.\n* The schema accepts seed=0, but the current implementation only forwards a nonzero seed."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/alibaba/wan-3.0/reference-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-6f9f38b07d8e.txt",
        sha256: "2f4892a2d66834be8b2a53e26c2ad882f2a37063e8649d0034897c0a7c05a6e5"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'seed	integer	No	\u2014	Seed. Minimum: 0. Maximum: 2147483647.\nprompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	2-30 seconds. Minimum: 2. Maximum: 30.\nfile_url	string	No	\u2014	One document (docx/xlsx/pptx/pdf/md). Forces deep thinking.\nlink_url	string	No	\u2014	One public page. Forces deep thinking. Not combinable with file_url.\naudio_urls	array[string]	No	\u2014	Up to 5 files, 30s total. WAV or MP3.\nimage_urls	array[string]	No	\u2014	Reference Images.\nresolution	string	No	"1080p"	Resolution. Options: 480p, 720p, 1080p.\nvideo_urls	array[string]	No	\u2014	Up to 5 clips, 30s total, each 1-30s.\naspect_ratio	string	No	"adaptive"	Aspect Ratio. Options: 16:9, 4:3, 1:1, 3:4, 9:16, adaptive.\ngenerate_audio	boolean	No	true	Sound.\nenable_thinking	boolean	No	false	Deep Thinking.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "alibaba/wan-3.0/text-to-video",
      title: "Wan 3.0 \u2014 Text to video API",
      category: "video",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/wan-3/text-to-video.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:01.649058+00:00",
        snapshot: "evidence/docs-models__wan-3__text-to-video.md",
        sha256: "981887b9c320103a066344a539877fecc7fc4089c0d5c8e70cca32ed6e8d22b4"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/alibaba/wan-3.0/text-to-video",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Wan 3.0 Text to Video",
        required: [
          "prompt"
        ],
        properties: {
          seed: {
            type: "integer",
            title: "Seed",
            maximum: 2147483647,
            minimum: 0
          },
          prompt: {
            type: "string",
            title: "Prompt",
            description: "Write your prompt here"
          },
          duration: {
            type: "integer",
            title: "Duration (sec)",
            default: 5,
            maximum: 30,
            minimum: 2,
            description: "2-30 seconds."
          },
          resolution: {
            enum: [
              "480p",
              "720p",
              "1080p"
            ],
            type: "string",
            title: "Resolution",
            default: "1080p"
          },
          aspect_ratio: {
            enum: [
              "16:9",
              "4:3",
              "1:1",
              "3:4",
              "9:16",
              "adaptive"
            ],
            type: "string",
            title: "Aspect Ratio",
            default: "adaptive"
          },
          generate_audio: {
            type: "boolean",
            title: "Sound",
            default: true
          },
          enable_thinking: {
            type: "boolean",
            title: "Deep Thinking",
            default: false
          }
        }
      },
      parameterNames: [
        "seed",
        "prompt",
        "duration",
        "resolution",
        "aspect_ratio",
        "generate_audio",
        "enable_thinking"
      ],
      usageNotes: "* This endpoint generates from text; use the separate image or reference endpoint for media inputs.\n* The schema accepts seed=0, but the current implementation only forwards a nonzero seed.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "video",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "video": {\n    "url": "https://example.com/output.mp4"\n  }\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/wan-3/text-to-video.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:01.649058+00:00",
          snapshot: "evidence/docs-models__wan-3__text-to-video.md",
          sha256: "981887b9c320103a066344a539877fecc7fc4089c0d5c8e70cca32ed6e8d22b4"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {
          generate_audio: {
            type: "boolean",
            title: "Sound",
            default: true
          }
        },
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/alibaba/wan-3.0/text-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-7608dcbf62d8.txt",
        sha256: "5ba45ae157470c9ba7cfd48f3674c00cebe64917eab5c4bbeda61b00ceb4743f"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'seed	integer	No	\u2014	Seed. Minimum: 0. Maximum: 2147483647.\nprompt	string	Yes	\u2014	Prompt.\nduration	integer	No	5	2-30 seconds. Minimum: 2. Maximum: 30.\nresolution	string	No	"1080p"	Resolution. Options: 480p, 720p, 1080p.\naspect_ratio	string	No	"adaptive"	Aspect Ratio. Options: 16:9, 4:3, 1:1, 3:4, 9:16, adaptive.\ngenerate_audio	boolean	No	true	Sound.\nenable_thinking	boolean	No	false	Deep Thinking.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "z-image/turbo",
      title: "Z-Image Turbo \u2014 Generate API",
      category: "image",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/z-image-turbo/generate.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:07.247463+00:00",
        snapshot: "evidence/docs-models__z-image-turbo__generate.md",
        sha256: "fa35660c591cfb85169e74fc31d06b0ca521c378c6992f39587c4084d799d9ae"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/z-image/turbo",
      schemaStatus: "complete-primary-json-schema",
      schema: {
        type: "object",
        title: "Z-Image Turbo",
        required: [
          "prompt"
        ],
        properties: {
          seed: {
            type: "integer",
            maximum: 2147483647,
            minimum: 0,
            description: "Optional random seed for similar, reproducible results."
          },
          prompt: {
            type: "string",
            maxLength: 800,
            minLength: 1,
            description: "Positive prompt describing the desired content, style, and composition."
          },
          resolution: {
            enum: [
              "1k",
              "2k"
            ],
            type: "string",
            default: "1k",
            description: "Output resolution tier. Both tiers produce PNG images."
          },
          aspect_ratio: {
            enum: [
              "1:1",
              "2:3",
              "3:2",
              "3:4",
              "4:3",
              "7:9",
              "9:7",
              "9:16",
              "16:9",
              "21:9"
            ],
            type: "string",
            default: "1:1",
            description: "Output aspect ratio. Exact provider-recommended dimensions are selected automatically."
          },
          prompt_extend: {
            type: "boolean",
            default: false,
            description: "Rewrite and reason over the prompt before generation; this uses the enhanced price tier."
          }
        },
        additionalProperties: false
      },
      parameterNames: [
        "seed",
        "prompt",
        "resolution",
        "aspect_ratio",
        "prompt_extend"
      ],
      usageNotes: "* Text-to-image only. prompt must contain non-whitespace text and at most 800 characters.\n* prompt\\_extend defaults to false; enabling it uses the enhanced pricing tier.\n* The schema accepts 1k and 2k tiers, ten aspect ratios, and an optional integer seed from 0 to 2147483647.",
      limitsSource: "source snapshot Input schema and Usage notes; omitted bounds are not documented",
      output: {
        kind: "image",
        sourceSection: "Response",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise",
        documentedResponseText: 'Submission returns a request handle. Poll `status_url` until `status` is `completed`, or use [webhooks](https://docs.higgsfield.ai/docs/how-to/webhooks.md).\n\n```json Accepted theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "queued",\n  "request_id": "REQUEST_ID",\n  "status_url": "https://api.higgsfield.ai/requests/REQUEST_ID/status",\n  "cancel_url": "https://api.higgsfield.ai/requests/REQUEST_ID/cancel"\n}\n```\n\nA completed response includes the following output fields:\n\n```json theme={"theme":{"light":"github-light","dark":"github-dark"}}\n{\n  "status": "completed",\n  "request_id": "REQUEST_ID",\n  "images": [\n    {\n      "url": "https://example.com/output.png"\n    }\n  ]\n}\n```\n\nSee [idempotent requests](https://docs.higgsfield.ai/docs/concepts/idempotency.md), [polling](https://docs.higgsfield.ai/docs/concepts/polling.md), [request errors](https://docs.higgsfield.ai/docs/concepts/errors.md) and [authentication](https://docs.higgsfield.ai/docs/authentication.md) for shared request handling.'
      },
      variants: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://docs.higgsfield.ai/docs/models/z-image-turbo/generate.md",
          retrievedDate: "2026-10-29",
          retrievedAt: "2026-10-28T23:21:07.247463+00:00",
          snapshot: "evidence/docs-models__z-image-turbo__generate.md",
          sha256: "fa35660c591cfb85169e74fc31d06b0ca521c378c6992f39587c4084d799d9ae"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      limitations: [],
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "image",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      consoleSource: {
        url: "https://open.higgsfield.ai/models/z-image/turbo/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        snapshot: "evidence/console-model-1814b1b348b5.txt",
        sha256: "a5069b17234a16da9bfe644d60cbff0d4c50154a8b62eccd7e641e852f09c5bf"
      },
      consoleObservation: "reference captured",
      consoleParameterTable: 'seed	integer	No	\u2014	Optional random seed for similar, reproducible results. Minimum: 0. Maximum: 2147483647.\nprompt	string	Yes	\u2014	Positive prompt describing the desired content, style, and composition. Minimum length: 1. Maximum length: 800.\nresolution	string	No	"1k"	Output resolution tier. Both tiers produce PNG images. Options: 1k, 2k.\naspect_ratio	string	No	"1:1"	Output aspect ratio. Exact provider-recommended dimensions are selected automatically. Options: 1:1, 2:3, 3:2, 3:4, 4:3, 7:9, 9:7, 9:16, 16:9, 21:9.\nprompt_extend	boolean	No	false	Rewrite and reason over the prompt before generation; this uses the enhanced price tier.',
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/v4.0/text-to-video",
      title: "kling-video/v4.0/text-to-video",
      category: "video",
      source: {
        url: "https://open.higgsfield.ai/models/kling-video/v4.0/text-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        retrievedAt: null,
        snapshot: "evidence/console-kling-4-t2v.txt",
        sha256: "c6c119f56f79b7ac940d30f820fe12160ae5689a9ea79b1496dc036afb1372dc"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/v4.0/text-to-video",
      schemaStatus: "documented-parameter-table",
      schema: {
        type: "object",
        properties: {
          duration: {
            type: "integer",
            default: 10,
            minimum: 3,
            maximum: 30
          },
          resolution: {
            type: "string",
            default: "1080p",
            enum: [
              "720p",
              "1080p"
            ]
          },
          prompt: {
            type: "string",
            minLength: 1
          },
          aspect_ratio: {
            type: "string",
            default: "16:9",
            enum: [
              "21:9",
              "16:9",
              "9:16",
              "1:1"
            ]
          }
        },
        required: [
          "prompt"
        ],
        additionalProperties: true
      },
      parameterNames: [
        "duration",
        "resolution",
        "prompt",
        "aspect_ratio"
      ],
      usageNotes: "Read complete console reference snapshot; table transcription is a plugin contract proposal, not a vendor OpenAPI export. Each video <=2 GiB and >30s trimmed to first 30s where documented for reference/edit; middle-frame limit 8 independent of end frame. Undocumented keys are not controls.",
      limitsSource: "source snapshot Request parameters / Validation notes / Inputs",
      output: {
        kind: "video",
        sourceSection: "Results and polling",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise"
      },
      variants: [],
      limitations: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://open.higgsfield.ai/models/kling-video/v4.0/text-to-video/api-reference#model-api-reference",
          retrievedDate: "2026-10-29",
          retrievedAt: null,
          snapshot: "evidence/console-kling-4-t2v.txt",
          sha256: "c6c119f56f79b7ac940d30f820fe12160ae5689a9ea79b1496dc036afb1372dc"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/v4.0/image-to-video",
      title: "kling-video/v4.0/image-to-video",
      category: "video",
      source: {
        url: "https://open.higgsfield.ai/models/kling-video/v4.0/image-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        retrievedAt: null,
        snapshot: "evidence/console-kling-4-i2v.txt",
        sha256: "de1cc61d5cbe54bda17b35c16f4148ede8515ddc51d02e024fefca78182d24b7"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/v4.0/image-to-video",
      schemaStatus: "documented-parameter-table",
      schema: {
        type: "object",
        properties: {
          duration: {
            type: "integer",
            default: 10,
            minimum: 3,
            maximum: 30
          },
          resolution: {
            type: "string",
            default: "1080p",
            enum: [
              "720p",
              "1080p"
            ]
          },
          prompt: {
            type: "string"
          },
          image_url: {
            type: "string",
            format: "uri",
            minLength: 1
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri",
              minLength: 1
            },
            maxItems: 8
          },
          end_image_url: {
            type: "string",
            format: "uri",
            minLength: 1
          }
        },
        required: [
          "image_url"
        ],
        additionalProperties: true
      },
      parameterNames: [
        "duration",
        "resolution",
        "prompt",
        "image_url",
        "image_urls",
        "end_image_url"
      ],
      usageNotes: "Read complete console reference snapshot; table transcription is a plugin contract proposal, not a vendor OpenAPI export. Each video <=2 GiB and >30s trimmed to first 30s where documented for reference/edit; middle-frame limit 8 independent of end frame. Undocumented keys are not controls.",
      limitsSource: "source snapshot Request parameters / Validation notes / Inputs",
      output: {
        kind: "video",
        sourceSection: "Results and polling",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise"
      },
      variants: [],
      limitations: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://open.higgsfield.ai/models/kling-video/v4.0/image-to-video/api-reference#model-api-reference",
          retrievedDate: "2026-10-29",
          retrievedAt: null,
          snapshot: "evidence/console-kling-4-i2v.txt",
          sha256: "de1cc61d5cbe54bda17b35c16f4148ede8515ddc51d02e024fefca78182d24b7"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/v4.0/reference-to-video",
      title: "kling-video/v4.0/reference-to-video",
      category: "video",
      source: {
        url: "https://open.higgsfield.ai/models/kling-video/v4.0/reference-to-video/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        retrievedAt: null,
        snapshot: "evidence/console-kling-4-r2v.txt",
        sha256: "ce6f06a6f6f76f5e327218ab0b25910bdbfe3a3b92a2c2e7a3e617bfd17a7600"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/v4.0/reference-to-video",
      schemaStatus: "documented-parameter-table",
      schema: {
        type: "object",
        properties: {
          duration: {
            type: "integer",
            default: 10,
            minimum: 3,
            maximum: 30
          },
          resolution: {
            type: "string",
            default: "1080p",
            enum: [
              "720p",
              "1080p"
            ]
          },
          prompt: {
            type: "string",
            minLength: 1
          },
          aspect_ratio: {
            type: "string",
            default: "adaptive",
            enum: [
              "21:9",
              "16:9",
              "9:16",
              "1:1",
              "adaptive"
            ]
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri",
              minLength: 1
            },
            maxItems: 10
          },
          video_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri",
              minLength: 1
            },
            maxItems: 5
          }
        },
        required: [
          "prompt"
        ],
        additionalProperties: true,
        anyOf: [
          {
            required: [
              "image_urls"
            ],
            properties: {
              image_urls: {
                minItems: 1
              }
            }
          },
          {
            required: [
              "video_urls"
            ],
            properties: {
              video_urls: {
                minItems: 1
              }
            }
          }
        ]
      },
      parameterNames: [
        "duration",
        "resolution",
        "prompt",
        "aspect_ratio",
        "image_urls",
        "video_urls"
      ],
      usageNotes: "Read complete console reference snapshot; table transcription is a plugin contract proposal, not a vendor OpenAPI export. Each video <=2 GiB and >30s trimmed to first 30s where documented for reference/edit; middle-frame limit 8 independent of end frame. Undocumented keys are not controls.",
      limitsSource: "source snapshot Request parameters / Validation notes / Inputs",
      output: {
        kind: "video",
        sourceSection: "Results and polling",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise"
      },
      variants: [],
      limitations: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://open.higgsfield.ai/models/kling-video/v4.0/reference-to-video/api-reference#model-api-reference",
          retrievedDate: "2026-10-29",
          retrievedAt: null,
          snapshot: "evidence/console-kling-4-r2v.txt",
          sha256: "ce6f06a6f6f76f5e327218ab0b25910bdbfe3a3b92a2c2e7a3e617bfd17a7600"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "kling-video/v4.0/video-edit",
      title: "kling-video/v4.0/video-edit",
      category: "video",
      source: {
        url: "https://open.higgsfield.ai/models/kling-video/v4.0/video-edit/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        retrievedAt: null,
        snapshot: "evidence/console-kling-4-edit.txt",
        sha256: "3fd07747b76603d455a17fccc74732cce93d7763da062ba8b9a8c7a6496c2bac"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/kling-video/v4.0/video-edit",
      schemaStatus: "documented-parameter-table",
      schema: {
        type: "object",
        properties: {
          duration: {
            type: "integer",
            default: 10,
            minimum: 3,
            maximum: 30
          },
          resolution: {
            type: "string",
            default: "1080p",
            enum: [
              "720p",
              "1080p"
            ]
          },
          prompt: {
            type: "string",
            minLength: 1
          },
          aspect_ratio: {
            type: "string",
            default: "adaptive",
            enum: [
              "21:9",
              "16:9",
              "9:16",
              "1:1",
              "adaptive"
            ]
          },
          image_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri",
              minLength: 1
            },
            maxItems: 10
          },
          video_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri",
              minLength: 1
            },
            maxItems: 5
          },
          video_url: {
            type: "string",
            format: "uri",
            minLength: 1
          }
        },
        required: [
          "prompt",
          "video_url"
        ],
        additionalProperties: true
      },
      parameterNames: [
        "duration",
        "resolution",
        "prompt",
        "aspect_ratio",
        "image_urls",
        "video_urls",
        "video_url"
      ],
      usageNotes: "Read complete console reference snapshot; table transcription is a plugin contract proposal, not a vendor OpenAPI export. Each video <=2 GiB and >30s trimmed to first 30s where documented for reference/edit; middle-frame limit 8 independent of end frame. Undocumented keys are not controls.",
      limitsSource: "source snapshot Request parameters / Validation notes / Inputs",
      output: {
        kind: "video",
        sourceSection: "Results and polling",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise"
      },
      variants: [],
      limitations: [],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://open.higgsfield.ai/models/kling-video/v4.0/video-edit/api-reference#model-api-reference",
          retrievedDate: "2026-10-29",
          retrievedAt: null,
          snapshot: "evidence/console-kling-4-edit.txt",
          sha256: "3fd07747b76603d455a17fccc74732cce93d7763da062ba8b9a8c7a6496c2bac"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "higgsfield-ai/soul/v2/image-to-image",
      title: "higgsfield-ai/soul/v2/image-to-image",
      category: "image",
      source: {
        url: "https://open.higgsfield.ai/models/higgsfield-ai/soul/v2/image-to-image/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        retrievedAt: null,
        snapshot: "evidence/console-soul-2-i2i.txt",
        sha256: "981bfc691233d62d5a01d7af1e59d1ff8dc777aca73f3ffbb59453c8b00176df"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/higgsfield-ai/soul/v2/image-to-image",
      schemaStatus: "documented-parameter-table",
      schema: {
        type: "object",
        properties: {
          seed: {
            type: "integer",
            minimum: 1,
            maximum: 1e6
          },
          image_url: {
            type: "string",
            format: "uri",
            minLength: 1
          },
          prompt: {
            type: "string"
          },
          style_id: {
            type: "string"
          },
          custom_reference_id: {
            type: [
              "string",
              "null"
            ],
            format: "uuid",
            default: null
          },
          custom_reference_strength: {
            type: "number",
            default: 1,
            minimum: 0,
            maximum: 1
          },
          batch_size: {
            type: "integer",
            default: 1,
            enum: [
              1,
              4
            ]
          },
          resolution: {
            type: "string",
            default: "720p",
            enum: [
              "720p",
              "1080p"
            ]
          },
          aspect_ratio: {
            type: "string",
            default: "4:3",
            enum: [
              "9:16",
              "16:9",
              "4:3",
              "3:4",
              "1:1",
              "2:3",
              "3:2"
            ]
          },
          enhance_prompt: {
            type: "boolean",
            default: true
          }
        },
        required: [
          "image_url",
          "prompt"
        ]
      },
      parameterNames: [
        "seed",
        "image_url",
        "prompt",
        "style_id",
        "custom_reference_id",
        "custom_reference_strength",
        "batch_size",
        "resolution",
        "aspect_ratio",
        "enhance_prompt"
      ],
      usageNotes: "Read complete console reference snapshot; table transcription is a plugin contract proposal, not a vendor OpenAPI export.",
      limitsSource: "source snapshot Request parameters / Validation notes / Inputs",
      output: {
        kind: "image",
        sourceSection: "Results and polling",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise"
      },
      variants: [],
      limitations: [
        "Console describes seed as integer but lists null as default. Omit seed or send legal integer; explicit null not established. Reference prompt processing always enabled."
      ],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://open.higgsfield.ai/models/higgsfield-ai/soul/v2/image-to-image/api-reference#model-api-reference",
          retrievedDate: "2026-10-29",
          retrievedAt: null,
          snapshot: "evidence/console-soul-2-i2i.txt",
          sha256: "981bfc691233d62d5a01d7af1e59d1ff8dc777aca73f3ffbb59453c8b00176df"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "image",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "higgsfield/ai-influencer",
      title: "higgsfield/ai-influencer",
      category: "image",
      source: {
        url: "https://open.higgsfield.ai/models/higgsfield/ai-influencer/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        retrievedAt: null,
        snapshot: "evidence/console-ai-influencer.txt",
        sha256: "275760d94558fb47eb98ee4718c277850e29c7fab5fa4ee40eab9428dca1c84c"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/higgsfield/ai-influencer",
      schemaStatus: "documented-parameter-table",
      schema: {
        type: "object",
        properties: {
          tier: {
            type: "string",
            default: "normal",
            enum: [
              "normal",
              "freak",
              "total",
              "insects",
              "frogs",
              "cats",
              "dogs",
              "capybaras",
              "birds"
            ]
          },
          selection: {
            type: "object",
            default: {},
            maxProperties: 18,
            additionalProperties: {
              type: "array",
              items: {
                type: "string"
              }
            }
          },
          image_url: {
            type: [
              "string",
              "null"
            ],
            format: "uri",
            default: null
          },
          item_image_urls: {
            type: "array",
            items: {
              type: "string",
              format: "uri",
              minLength: 1
            },
            maxItems: 3,
            default: []
          },
          brief: {
            type: "string",
            default: "",
            maxLength: 4e3
          },
          seed: {
            type: [
              "integer",
              "null"
            ],
            minimum: 1,
            maximum: 1e6,
            default: null
          },
          variation_index: {
            type: "integer",
            default: 0,
            minimum: 0,
            maximum: 2147483647
          },
          body_color: {
            type: [
              "string",
              "null"
            ],
            pattern: "^#[0-9A-Fa-f]{6}$"
          },
          pinned_species: {
            type: [
              "string",
              "null"
            ],
            minLength: 1,
            maxLength: 64
          },
          trait_variants: {
            anyOf: [
              {
                type: "null"
              },
              {
                type: "object",
                required: [
                  "version",
                  "choices"
                ],
                properties: {
                  version: {
                    type: "string",
                    const: "appearance-v2"
                  },
                  choices: {
                    type: "object",
                    properties: {
                      pr_centaur: {
                        type: "string",
                        enum: [
                          "original",
                          "v1",
                          "v2",
                          "v3",
                          "v4",
                          "v5",
                          "v6",
                          "v7",
                          "v8",
                          "v9",
                          "v10"
                        ]
                      }
                    },
                    additionalProperties: {
                      type: "string",
                      enum: [
                        "original",
                        "v1",
                        "v2",
                        "v3",
                        "v4",
                        "v5"
                      ]
                    }
                  },
                  animal_choices: {
                    type: [
                      "object",
                      "null"
                    ],
                    additionalProperties: {
                      type: "integer",
                      minimum: 0,
                      maximum: 4
                    }
                  }
                }
              }
            ],
            default: null
          }
        },
        required: []
      },
      parameterNames: [
        "tier",
        "selection",
        "image_url",
        "item_image_urls",
        "brief",
        "seed",
        "variation_index",
        "body_color",
        "pinned_species",
        "trait_variants"
      ],
      usageNotes: "Read complete console reference snapshot; table transcription is a plugin contract proposal, not a vendor OpenAPI export. Fixed one 2K 16:9 Medium sheet; $0.05 before account discounts. Nonanimated JPEG/PNG/WebP <=64 MiB per identity/item image. Seed controls trait selection, not pixels; generated seed not returned. Trait overrides require version appearance-v2 and choices; original/v1-v5, pr_centaur v1-v10, animal_choices 0-4.",
      limitsSource: "source snapshot Request parameters / Validation notes / Inputs",
      output: {
        kind: "image",
        sourceSection: "Results and polling",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise"
      },
      variants: [],
      limitations: [
        "selection requires current options catalog tier/max/slot/exclusive validation; trait_variants and pinned_species internal catalogs are not exposed; omit advanced overrides unless valid IDs already available. Human types require variation_index=0 and omit body_color/pinned_species/animal_choices."
      ],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://open.higgsfield.ai/models/higgsfield/ai-influencer/api-reference#model-api-reference",
          retrievedDate: "2026-10-29",
          retrievedAt: null,
          snapshot: "evidence/console-ai-influencer.txt",
          sha256: "275760d94558fb47eb98ee4718c277850e29c7fab5fa4ee40eab9428dca1c84c"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        indicativeAmount: "0.05",
        rateUnit: "USD per sheet before account discounts",
        priceSource: "https://open.higgsfield.ai/models/higgsfield/ai-influencer/api-reference#model-api-reference",
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "candidate-fixed-before-account-discounts; actual-applicability/expiry-unverified",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "image",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          indicativeAmount: "0.05",
          rateUnit: "USD per sheet before account discounts",
          priceSource: "https://open.higgsfield.ai/models/higgsfield/ai-influencer/api-reference#model-api-reference",
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "candidate-fixed-before-account-discounts; actual-applicability/expiry-unverified",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "No additional audio behavior established by this model source."
      },
      submissionDisposition: "no-paid-submit-until-fresh-safe-estimate-and-required-authority"
    },
    {
      id: "higgsfield/genjutsu-light/motion-transfer/v1.0",
      title: "higgsfield/genjutsu-light/motion-transfer/v1.0",
      category: "video",
      source: {
        url: "https://open.higgsfield.ai/models/higgsfield/genjutsu-light/motion-transfer/v1.0/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        retrievedAt: null,
        snapshot: "evidence/console-genjutsu-light-motion.txt",
        sha256: "7267d1341ed5c34cf7af0f73580ffee1f8ff13d32ba6ff24ff4117ba0bf66615"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/higgsfield/genjutsu-light/motion-transfer/v1.0",
      schemaStatus: "unavailable-primary-schema",
      schema: null,
      parameterNames: [],
      usageNotes: "Public description preserves source audio, first 15s; example prompt/video_url/image_urls/resolution is not a full schema. Pricing advertises $0.025\u2013$0.10/source-second depending on tier/discount; no authoritative account quote.",
      limitsSource: "source snapshot Request parameters / Validation notes / Inputs",
      output: {
        kind: "video",
        sourceSection: "Results and polling",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise"
      },
      variants: [],
      limitations: [
        "Public reference contains SDK sample only; full parameter schema/defaults/required fields/media bounds not published there. Header sample says Bearer and @higgsfield-ai/client while top sample/shared docs say @higgsfield/client/v2 and Key pair. Do not submit until vendor clarifies."
      ],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://open.higgsfield.ai/models/higgsfield/genjutsu-light/motion-transfer/v1.0/api-reference#model-api-reference",
          retrievedDate: "2026-10-29",
          retrievedAt: null,
          snapshot: "evidence/console-genjutsu-light-motion.txt",
          sha256: "7267d1341ed5c34cf7af0f73580ffee1f8ff13d32ba6ff24ff4117ba0bf66615"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "Public description preserves source audio, first 15s; example prompt/video_url/image_urls/resolution is not a full schema. Pricing advertises $0.025\u2013$0.10/source-second depending on tier/discount; no authoritative account quote."
      },
      submissionDisposition: "refuse-vendor-clarification-required"
    },
    {
      id: "higgsfield/genjutsu-light/object-swap/v1.0",
      title: "higgsfield/genjutsu-light/object-swap/v1.0",
      category: "video",
      source: {
        url: "https://open.higgsfield.ai/models/higgsfield/genjutsu-light/object-swap/v1.0/api-reference#model-api-reference",
        retrievedDate: "2026-10-29",
        retrievedAt: null,
        snapshot: "evidence/console-genjutsu-light-swap.txt",
        sha256: "884cb425ce5384b71101eb80980079b249be8e9c4e884c083662013af236a713"
      },
      method: "POST",
      endpoint: "https://api.higgsfield.ai/higgsfield/genjutsu-light/object-swap/v1.0",
      schemaStatus: "unavailable-primary-schema",
      schema: null,
      parameterNames: [],
      usageNotes: "Public description preserves source audio, first 15s; example prompt/video_url/image_urls/resolution is not a full schema. Pricing advertises $0.025\u2013$0.10/source-second depending on tier/discount; no authoritative account quote.",
      limitsSource: "source snapshot Request parameters / Validation notes / Inputs",
      output: {
        kind: "video",
        sourceSection: "Results and polling",
        schemaStatus: "model response examples plus shared supplementary RequestStatus; exact model source wins; no undocumented artifact promise"
      },
      variants: [],
      limitations: [
        "Public reference contains SDK sample only; full parameter schema/defaults/required fields/media bounds not published there. Header sample says Bearer and @higgsfield-ai/client while top sample/shared docs say @higgsfield/client/v2 and Key pair. Do not submit until vendor clarifies."
      ],
      availability: {
        status: "documented-api-production-base",
        source: {
          url: "https://open.higgsfield.ai/models/higgsfield/genjutsu-light/object-swap/v1.0/api-reference#model-api-reference",
          retrievedDate: "2026-10-29",
          retrievedAt: null,
          snapshot: "evidence/console-genjutsu-light-swap.txt",
          sha256: "884cb425ce5384b71101eb80980079b249be8e9c4e884c083662013af236a713"
        },
        accountAccess: "not verified; authenticated calling account must have model access",
        maturity: "GA/preview label not established; no environment substitution",
        liveTested: false
      },
      accountLimits: {
        source: "https://docs.higgsfield.ai/docs/concepts/rate-limits.md",
        value: "account/model dependent; console is authoritative; no authenticated account inspected"
      },
      transport: "HTTPS JSON asynchronous generation",
      lifecycleRef: "generation",
      cost: {
        status: "unknown-account-quote",
        basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
        unit: "USD",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        priceSnapshot: "evidence/console-pricing.txt",
        amount: null,
        safePricing: {
          providerEstimate: "not-individually-established",
          deterministicTariff: "none-verified-safe",
          submission: "blocked-until-fresh-safe-estimate",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
        }
      },
      cancel: "queued only, every job queued; 202 empty or 400 if started",
      progress: "documented states only; no percent/ETA/intermediate preview/stream endpoint established",
      preview: "catalog preview assets are not live generation previews",
      nativeAudio: {
        inputFields: {},
        controlFields: {},
        outputKind: "video",
        evidence: "schema controls plus Usage notes; video output does not itself prove an audio track",
        standaloneAudioEndpoint: false,
        apiStatus: "documented-api-production-base",
        cost: {
          status: "unknown-account-quote",
          basis: "model parameters and account-specific authenticated estimate; static advertised prices are indicative",
          unit: "USD",
          source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
          priceSnapshot: "evidence/console-pricing.txt",
          amount: null,
          safePricing: {
            providerEstimate: "not-individually-established",
            deterministicTariff: "none-verified-safe",
            submission: "blocked-until-fresh-safe-estimate",
            source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
          }
        },
        notes: "Public description preserves source audio, first 15s; example prompt/video_url/image_urls/resolution is not a full schema. Pricing advertises $0.025\u2013$0.10/source-second depending on tier/discount; no authoritative account quote."
      },
      submissionDisposition: "refuse-vendor-clarification-required"
    }
  ]
};

// higgsfield/contracts.json
var contracts_default = {
  contractVersion: 1,
  snapshotDate: "2026-10-29",
  snapshotTimezone: "Europe/Riga; retrieval timestamps UTC can be previous date",
  scope: "Dated public docs linked closure + public console image/video catalog, variant references and pricing. Account access not tested.",
  ledger: {
    currency: "USD",
    higgsfield: {
      spent: "0",
      reserved: "0",
      unknown: "0"
    },
    elevenlabs: {
      spent: "0",
      reserved: "0",
      unknown: "0",
      basis: "no requests in this research; other task spending not asserted"
    },
    thisResearchAggregate: {
      spent: "0",
      reserved: "0",
      unknown: "0"
    },
    authenticatedCalls: 0,
    secretReads: 0,
    uploads: 0,
    generations: 0,
    training: 0
  },
  auth: {
    header: "Authorization: Key KEY_ID:KEY_SECRET",
    secretName: "higgsfield-api-key",
    storage: "plugin host-secret bucket, never global-vault assumption",
    provision: "stdin only; no key read/provision performed",
    source: "https://docs.higgsfield.ai/docs/authentication.md",
    legacy: [
      "hf-api-key",
      "hf-secret"
    ],
    conflicts: [
      "Genjutsu Light console Bearer sample conflicts with shared Key auth; unsupported pending clarification"
    ]
  },
  generation: {
    states: [
      "queued",
      "in_progress",
      "completed",
      "failed",
      "nsfw",
      "canceled"
    ],
    terminal: [
      "completed",
      "failed",
      "nsfw",
      "canceled"
    ],
    cancel: "POST returned cancel_url only when every job queued; 202 empty, 400 if started",
    status: "GET returned status_url with same account auth",
    identity: "Persist request_id immediately and write once; local unknown-submission is not provider status",
    retention: "Default 604800s from terminal time; Hf-Expires-After 3600..accountRetention only shortens. expires_at output expiry. Uploaded/reuse input copies independent <=7 days. Default seven-day expiry removes files; explicit deletion/shorter retention also removes prompt/params, billing remains.",
    streaming: "No generation media stream/percent/ETA/live previews documented in this catalog. SDK subscribe means polling, not streaming.",
    sources: [
      "https://docs.higgsfield.ai/docs/concepts/requests.md",
      "https://docs.higgsfield.ai/docs/enterprise/data-retention.md"
    ]
  },
  referenceTraining: {
    states: [
      "not_ready",
      "queued",
      "in_progress",
      "completed",
      "failed"
    ],
    identity: "id distinct from request_id; own account; matching v1/v2/cinema",
    cancel: "not documented",
    retention: "not established for trained reference; do not apply generation expiry without evidence",
    sources: [
      "https://docs.higgsfield.ai/docs/models/soul-id/create-character.md"
    ]
  },
  idempotency: {
    key: "1..255 visible ASCII, no whitespace; account scoped through key rotation",
    binding: [
      "endpoint",
      "JSON body including omission/null/ordered arrays",
      "hf_webhook",
      "Hf-Expires-After"
    ],
    replay: "same request ID; acceptance receipt may still say queued; fetch current status",
    policy: "Never automatically retry uncertain submissions; reconcile/explicit authorized recovery only. No auto-new key on 422. Training/upload/estimate replay protection not established.",
    source: "https://docs.higgsfield.ai/docs/concepts/idempotency.md"
  },
  webhooks: {
    query: "hf_webhook HTTPS public endpoint, JSON POST, <=10s response",
    terminal: [
      "completed",
      "failed",
      "nsfw"
    ],
    signature: "Standard Webhooks; raw body; timestamp \xB15min; webhook-id dedupe; HMAC SHA256 with decoded whsec_ secret; rotation old valid24h; created only on console reveal (not performed)",
    delivery: "2xx after durable record; network/5xx retry <=2h, 4xx permanent; stop after deletion; fallback polling",
    hostLimitation: "Current webhookReceiver kind pebble is not a generic Higgsfield ingress; polling baseline until accepted generic authenticated ingress.",
    source: "https://docs.higgsfield.ai/docs/how-to/webhooks.md"
  },
  costPolicy: {
    authoritative: "authenticated exact-parameter account quote, not indicative catalog/minimum/discount/cashback; decimal USD to exact integer usd_micro only when representable; precision unknown refuses",
    atomicUnits: [
      "usd_micro",
      "credit_milli",
      "characters"
    ],
    sum: "separate ceilings by exact unit; unknown separate; never sum incomparable units",
    approval: "Watt approval required before every paid proof; purpose/model/parameters/basis/max/per-vendor+aggregate ledger; approval maximum never self-authorizes",
    billing: "Successful generations charged; failed/nsfw not charged; queued canceled refunded; balance funds expire1year",
    source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
    submission: "No paid submit studio or pipeline without fresh safe estimate. Provider estimate or source-verified safe bounded deterministic actual tariff with exact inputs/basis/expiry only.",
    unknownUi: {
      studioPrimary: "Price unavailable",
      studioRefresh: "Check again",
      modelUnavailable: "No pricing from provider",
      pipelineState: "Waiting for a price",
      pipelineRefresh: "Check price again",
      pipelineApprove: false,
      freshApproval: "Approve N units for this step",
      aboveBudget: "Above this run\u2019s budget. Later steps still stop for approval.",
      uncertainCancel: [
        "Canceling\u2026",
        "Status unknown"
      ]
    }
  },
  operations: [
    {
      id: "requests.status",
      method: "GET",
      endpoint: "https://api.higgsfield.ai/requests/{request_id}/status",
      source: {
        url: "https://docs.higgsfield.ai/docs/api-reference/requests/get-request-status.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:30.387981+00:00",
        snapshot: "evidence/docs-api-reference__requests__get-request-status.md",
        sha256: "4fc710e2965d7433c094c59c1ca3b2fd5425a0dd6033099cef04a48d53f87dbe"
      },
      schema: {
        type: "object",
        properties: {
          request_id: {
            type: "string",
            format: "uuid"
          }
        },
        required: [
          "request_id"
        ],
        additionalProperties: false
      },
      schemaStatus: "documented-schema-transcription",
      kind: "read",
      notes: "Path parameters only; no JSON body. Use returned status/cancel URL after validating API origin. Delete is terminal-only, returns deleted separately from six generation states.",
      transport: "HTTPS JSON",
      availability: {
        status: "documented-api",
        liveTested: false,
        accountAccess: "same calling account credentials except presigned PUT"
      },
      cost: {
        status: "not-separately-priced-in-public-docs",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
      },
      lifecycle: "synchronous metadata response; no generation unless explicitly stated",
      cancel: "not applicable",
      progress: "no progress contract",
      preview: "none"
    },
    {
      id: "requests.cancel",
      method: "POST",
      endpoint: "https://api.higgsfield.ai/requests/{request_id}/cancel",
      source: {
        url: "https://docs.higgsfield.ai/docs/api-reference/requests/cancel-a-queued-request.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:30.265197+00:00",
        snapshot: "evidence/docs-api-reference__requests__cancel-a-queued-request.md",
        sha256: "94b6437bb7256d8c4ac21229a0d45df55cf1b37c100ea01313e14e06dfa7ad71"
      },
      schema: {
        type: "object",
        properties: {
          request_id: {
            type: "string",
            format: "uuid"
          }
        },
        required: [
          "request_id"
        ],
        additionalProperties: false
      },
      schemaStatus: "documented-schema-transcription",
      kind: "read",
      notes: "Path parameters only; no JSON body. Use returned status/cancel URL after validating API origin. Delete is terminal-only, returns deleted separately from six generation states.",
      transport: "HTTPS JSON",
      availability: {
        status: "documented-api",
        liveTested: false,
        accountAccess: "same calling account credentials except presigned PUT"
      },
      cost: {
        status: "not-separately-priced-in-public-docs",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
      },
      lifecycle: "synchronous metadata response; no generation unless explicitly stated",
      cancel: "not applicable",
      progress: "no progress contract",
      preview: "none"
    },
    {
      id: "requests.delete",
      method: "DELETE",
      endpoint: "https://api.higgsfield.ai/requests/{request_id}",
      source: {
        url: "https://docs.higgsfield.ai/docs/api-reference/requests/delete-request-data.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:30.219410+00:00",
        snapshot: "evidence/docs-api-reference__requests__delete-request-data.md",
        sha256: "83e1070d707800b10f57bd48f9588b343a858291bd08f7b8c0329e5f134fd363"
      },
      schema: {
        type: "object",
        properties: {
          request_id: {
            type: "string",
            format: "uuid"
          }
        },
        required: [
          "request_id"
        ],
        additionalProperties: false
      },
      schemaStatus: "documented-schema-transcription",
      kind: "read",
      notes: "Path parameters only; no JSON body. Use returned status/cancel URL after validating API origin. Delete is terminal-only, returns deleted separately from six generation states.",
      transport: "HTTPS JSON",
      availability: {
        status: "documented-api",
        liveTested: false,
        accountAccess: "same calling account credentials except presigned PUT"
      },
      cost: {
        status: "not-separately-priced-in-public-docs",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
      },
      lifecycle: "synchronous metadata response; no generation unless explicitly stated",
      cancel: "not applicable",
      progress: "no progress contract",
      preview: "none"
    },
    {
      id: "estimate.model",
      method: "POST",
      endpoint: "https://api.higgsfield.ai/estimate/{model_id}",
      source: {
        url: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:28.736506+00:00",
        snapshot: "evidence/docs-concepts__billing-and-retention.md",
        sha256: "f0b784c236eebf607c45b5b95ad8005c1fd39a1e720c210dc3c970d50eb57d7f"
      },
      schema: null,
      schemaStatus: "model-schema-reference",
      kind: "read",
      notes: "Body is exact selected generation schema. Public example establishes Soul 2 estimate. Per-model estimate availability/cost units must be confirmed by vendor/account; no paid submit when quote unknown.",
      transport: "HTTPS JSON",
      availability: {
        status: "documented-api",
        liveTested: false,
        accountAccess: "same calling account credentials except presigned PUT"
      },
      cost: {
        status: "not-separately-priced-in-public-docs",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
      },
      lifecycle: "synchronous metadata response; no generation unless explicitly stated",
      cancel: "not applicable",
      progress: "no progress contract",
      preview: "none"
    },
    {
      id: "files.upload-url",
      method: "POST",
      endpoint: "https://api.higgsfield.ai/files/generate-upload-url",
      source: {
        url: "https://docs.higgsfield.ai/docs/concepts/file-uploads.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:28.686169+00:00",
        snapshot: "evidence/docs-concepts__file-uploads.md",
        sha256: "50752840d9367ddf43f5b4b742658b76eb394a2a1115cd5490dc98a4791f82ae"
      },
      schema: {
        type: "object",
        properties: {
          content_type: {
            type: "string",
            enum: [
              "image/jpeg",
              "image/jpg",
              "image/png",
              "image/webp",
              "image/gif",
              "audio/wav",
              "audio/x-wav",
              "video/mp4"
            ]
          }
        },
        required: [
          "content_type"
        ]
      },
      schemaStatus: "documented-schema-transcription",
      kind: "prepare",
      notes: "Returns public_url/upload_url/content_type/upload_headers. URL expires 1h; size limits model-specific, no global size published.",
      transport: "HTTPS JSON",
      availability: {
        status: "documented-api",
        liveTested: false,
        accountAccess: "same calling account credentials except presigned PUT"
      },
      cost: {
        status: "not-separately-priced-in-public-docs",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
      },
      lifecycle: "synchronous metadata response; no generation unless explicitly stated",
      cancel: "not applicable",
      progress: "no progress contract",
      preview: "none"
    },
    {
      id: "files.put",
      method: "PUT",
      endpoint: "{returned_upload_url}",
      source: {
        url: "https://docs.higgsfield.ai/docs/concepts/file-uploads.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:28.686169+00:00",
        snapshot: "evidence/docs-concepts__file-uploads.md",
        sha256: "50752840d9367ddf43f5b4b742658b76eb394a2a1115cd5490dc98a4791f82ae"
      },
      schema: null,
      schemaStatus: "binary-body",
      kind: "upload",
      notes: "Exact bytes, every returned upload_headers, matching content type. Never send Higgsfield Authorization to storage. Validate redirect/host/MIME/size; authenticated uploads not executed.",
      transport: "HTTPS binary PUT to presigned URL",
      availability: {
        status: "documented-api",
        liveTested: false,
        accountAccess: "same calling account credentials except presigned PUT"
      },
      cost: {
        status: "not-separately-priced-in-public-docs",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
      },
      lifecycle: "synchronous metadata response; no generation unless explicitly stated",
      cancel: "not applicable",
      progress: "no progress contract",
      preview: "none"
    },
    {
      id: "styles.soul",
      method: "GET",
      endpoint: "https://api.higgsfield.ai/v1/text2image/soul-styles",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/soul-standard/generate.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:00.686644+00:00",
        snapshot: "evidence/docs-models__soul-standard__generate.md",
        sha256: "91c0bc0737d84eec3e28db70c3e514e95c5549ad364418516a7f64d3c04a13cc"
      },
      schema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false
      },
      schemaStatus: "documented-schema-transcription",
      kind: "read",
      notes: "Authenticated catalog; array id/name/description/preview_url, current account visibility. No parameters documented.",
      transport: "HTTPS JSON",
      availability: {
        status: "documented-api",
        liveTested: false,
        accountAccess: "same calling account credentials except presigned PUT"
      },
      cost: {
        status: "not-separately-priced-in-public-docs",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
      },
      lifecycle: "synchronous metadata response; no generation unless explicitly stated",
      cancel: "not applicable",
      progress: "no progress contract",
      preview: "none"
    },
    {
      id: "styles.soul-v2",
      method: "GET",
      endpoint: "https://api.higgsfield.ai/v1/text2image/soul-styles/v2",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/soul-2/generate.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:04.823319+00:00",
        snapshot: "evidence/docs-models__soul-2__generate.md",
        sha256: "038864f4f4d00ccf134d4925544f97ecbcec7c302c3261800d3b442d8b081926"
      },
      schema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false
      },
      schemaStatus: "documented-schema-transcription",
      kind: "read",
      notes: "Authenticated live catalog; do not hardcode style UUIDs.",
      transport: "HTTPS JSON",
      availability: {
        status: "documented-api",
        liveTested: false,
        accountAccess: "same calling account credentials except presigned PUT"
      },
      cost: {
        status: "not-separately-priced-in-public-docs",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
      },
      lifecycle: "synchronous metadata response; no generation unless explicitly stated",
      cancel: "not applicable",
      progress: "no progress contract",
      preview: "none"
    },
    {
      id: "presets.marketing",
      method: "GET",
      endpoint: "https://api.higgsfield.ai/marketing-studio/image/presets",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/marketing-studio-image/generate-and-edit.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:21:06.784452+00:00",
        snapshot: "evidence/docs-models__marketing-studio-image__generate-and-edit.md",
        sha256: "38ebd9491c05c2f5a3f3df26a2163d9434d6c50c751a571714857c59f8688b91"
      },
      schema: {
        type: "object",
        properties: {
          search: {
            type: "string",
            minLength: 1,
            maxLength: 100
          },
          size: {
            type: "integer",
            default: 50,
            minimum: 1,
            maximum: 100
          },
          cursor: {
            type: "integer",
            default: 0,
            minimum: 0
          }
        },
        required: []
      },
      schemaStatus: "documented-schema-transcription",
      kind: "read",
      notes: "Query parameters; response total/cursor/items; cursor null ends paging. Only visible usable presets. Enhancement requires current preset and 1\u20132 references product first.",
      transport: "HTTPS JSON",
      availability: {
        status: "documented-api",
        liveTested: false,
        accountAccess: "same calling account credentials except presigned PUT"
      },
      cost: {
        status: "not-separately-priced-in-public-docs",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
      },
      lifecycle: "synchronous metadata response; no generation unless explicitly stated",
      cancel: "not applicable",
      progress: "no progress contract",
      preview: "none"
    },
    {
      id: "presets.restyle",
      method: "GET",
      endpoint: "https://api.higgsfield.ai/models/higgsfield/genjutsu/restyle/v1.0/presets",
      source: {
        url: "https://docs.higgsfield.ai/docs/models/genjutsu/restyle.md",
        retrievedDate: "2026-10-29",
        retrievedAt: "2026-10-28T23:20:57.201543+00:00",
        snapshot: "evidence/docs-models__genjutsu__restyle.md",
        sha256: "52ffdd8900780fea190fd3d13aa8fceb1fb5e6f2e4d272d7cf7dd6f664e783e8"
      },
      schema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false
      },
      schemaStatus: "documented-schema-transcription",
      kind: "read",
      notes: "Authenticated + model access. No pagination/query/body. All selectable system presets ordered name/ID; excludes hidden/personal. Empty means no selectable styles.",
      transport: "HTTPS JSON",
      availability: {
        status: "documented-api",
        liveTested: false,
        accountAccess: "same calling account credentials except presigned PUT"
      },
      cost: {
        status: "not-separately-priced-in-public-docs",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
      },
      lifecycle: "synchronous metadata response; no generation unless explicitly stated",
      cancel: "not applicable",
      progress: "no progress contract",
      preview: "none"
    },
    {
      id: "references.get",
      method: "GET",
      endpoint: "https://api.higgsfield.ai/v1/custom-references/{id}",
      source: {
        url: "https://open.higgsfield.ai/models/higgsfield-ai/soul/v2/standard/api-reference",
        retrievedDate: "2026-10-29",
        retrievedAt: null,
        snapshot: "evidence/console-soul-2-t2i.txt",
        sha256: "0107175ede29900462fd968c54e1efb777488454cc5e64ce865b68fcca68629c"
      },
      schema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            format: "uuid"
          }
        },
        required: [
          "id"
        ]
      },
      schemaStatus: "documented-schema-transcription",
      kind: "read",
      notes: "Same account only; list page=1,page_size=20 is documented example, not defaults or proven maximum. Response/list envelope bounds not published in captured source. Reference IDs differ from generation IDs.",
      transport: "HTTPS JSON",
      availability: {
        status: "documented-api",
        liveTested: false,
        accountAccess: "same calling account credentials except presigned PUT"
      },
      cost: {
        status: "not-separately-priced-in-public-docs",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
      },
      lifecycle: "synchronous metadata response; no generation unless explicitly stated",
      cancel: "not applicable",
      progress: "no progress contract",
      preview: "none"
    },
    {
      id: "references.list",
      method: "GET",
      endpoint: "https://api.higgsfield.ai/v1/custom-references/list",
      source: {
        url: "https://open.higgsfield.ai/models/higgsfield-ai/soul/v2/standard/api-reference",
        retrievedDate: "2026-10-29",
        retrievedAt: null,
        snapshot: "evidence/console-soul-2-t2i.txt",
        sha256: "0107175ede29900462fd968c54e1efb777488454cc5e64ce865b68fcca68629c"
      },
      schema: {
        type: "object",
        properties: {
          page: {
            type: "integer"
          },
          page_size: {
            type: "integer"
          }
        },
        required: []
      },
      schemaStatus: "documented-schema-transcription",
      kind: "read",
      notes: "Same account only; list page=1,page_size=20 is documented example, not defaults or proven maximum. Response/list envelope bounds not published in captured source. Reference IDs differ from generation IDs.",
      transport: "HTTPS JSON",
      availability: {
        status: "documented-api",
        liveTested: false,
        accountAccess: "same calling account credentials except presigned PUT"
      },
      cost: {
        status: "not-separately-priced-in-public-docs",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
      },
      lifecycle: "synchronous metadata response; no generation unless explicitly stated",
      cancel: "not applicable",
      progress: "no progress contract",
      preview: "none"
    },
    {
      id: "influencer.options",
      method: "GET",
      endpoint: "https://api.higgsfield.ai/models/higgsfield/ai-influencer/options",
      source: {
        url: "https://open.higgsfield.ai/models/higgsfield/ai-influencer/api-reference",
        retrievedDate: "2026-10-29",
        retrievedAt: null,
        snapshot: "evidence/console-ai-influencer.txt",
        sha256: "275760d94558fb47eb98ee4718c277850e29c7fab5fa4ee40eab9428dca1c84c"
      },
      schema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false
      },
      schemaStatus: "documented-schema-transcription",
      kind: "read",
      notes: "Public when visible, 404 while hidden/unavailable. config_revision/categories; category key,label,tiers,max,options; option key,label,img?,color?,tiers?,slot?,exclusive. Does not expose internal species/trait override catalogs.",
      transport: "HTTPS JSON",
      availability: {
        status: "documented-api",
        liveTested: false,
        accountAccess: "no auth for options when publicly visible; generation requires auth/model access"
      },
      cost: {
        status: "not-separately-priced-in-public-docs",
        source: "https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md"
      },
      lifecycle: "synchronous metadata response; no generation unless explicitly stated",
      cancel: "not applicable",
      progress: "no progress contract",
      preview: "none"
    }
  ],
  catalog: {
    docsDeclared: 84,
    docsImage: 17,
    docsVideo: 67,
    unionModels: 92,
    additionalConsole: 8,
    schemaCompleteness: "84 primary JSON schemas; console typed parameter transcriptions; Genjutsu Light two explicit unavailable schemas, excluded from submissions",
    availabilityNotGlobalClaim: true,
    consoleCrossCheck: {
      linkedGenerationTargets: 83,
      referencePages: 82,
      unavailableModelTarget: [
        "higgsfield-ai/soul/cinema"
      ],
      source: "evidence/console-model-retrievals.json",
      parameterConflicts: 7
    }
  },
  limitations: [
    "Complete production consumption blocked by platform delivery and vendor schema/auth conflicts. Research snapshot is not a production SDK contract.",
    "No verified exact output CDN allowlist: example.com/example CDNs are illustrative, real output hosts unknown. Never allow wildcard remote binary download as proof.",
    "Current console and docs disagree on Soul 2 seed/null/defaults/style_strength; explicit known-legal values only, vendor clarification before claiming parity.",
    "Per-model estimate path coverage and training estimate/cancel/retention not fully documented; unknown quote refuses paid work."
  ],
  platformDependencies: [
    {
      id: "agent-view-verbs",
      owner: "Concierge f32435fc",
      action: "Deliver accepted agentVerbs/onSurfaceCall/invalidation parity and released SDK contract",
      readyTrigger: "Exact delivered capability/SDK/min-host and two-owner runtime refusal proof",
      minimumHost: null,
      releasedSdk: null,
      status: "blocked-for-production-consumption; research-recorded",
      source: "PLATFORM-GAPS.md"
    },
    {
      id: "trusted-view-call-context",
      owner: "Concierge f32435fc with Loom",
      action: "Provide exact-originating-frame trusted view-call owner context, separate from run authority",
      readyTrigger: "Forged/stale/cross-owner invoke contexts refused with native/JS desktop/web parity",
      minimumHost: null,
      releasedSdk: null,
      status: "blocked-for-production-consumption; research-recorded",
      source: "PLATFORM-GAPS.md"
    },
    {
      id: "durable-reconcile",
      owner: "Concierge and Loom 4aaf8843",
      action: "Define host-driven reconcile scheduling/restart/close/deadline contract for long-lived jobs",
      readyTrigger: "Persisted job recovery without paid resubmit and actual no-refresh updates proved",
      minimumHost: null,
      releasedSdk: null,
      status: "blocked-for-production-consumption; research-recorded",
      source: "PLATFORM-GAPS.md"
    },
    {
      id: "confined-media-delivery",
      owner: "Courier b44bfdff COD-2024",
      action: "Supply reviewed delivery/security/parity proof and released capability SDK",
      readyTrigger: "Exact-frame playable audio/video, bounded ranges/expiry/revocation proved on released host",
      minimumHost: null,
      releasedSdk: null,
      status: "blocked-for-production-consumption; research-recorded",
      source: "PLATFORM-GAPS.md"
    },
    {
      id: "gesture-actions",
      owner: "Iris ea6d7585 COD-2025",
      action: "Merge/release typed availability and gesture-owned actions with media integration",
      readyTrigger: "Iris acceptance and delivered desktop/web refusal/export/reacquire proof",
      minimumHost: null,
      releasedSdk: null,
      status: "blocked-for-production-consumption; research-recorded",
      source: "PLATFORM-GAPS.md"
    },
    {
      id: "typed-blueprint-budget",
      owner: "Loom 4aaf8843; external task identity pending",
      action: "Finalize closed schema descriptors and authoritative waiting/budget/reconcile contract",
      readyTrigger: "Reviewed released typed steps with revision/input/quote binding, per-unit ceilings, durable waiting",
      minimumHost: null,
      releasedSdk: null,
      status: "blocked-for-production-consumption; research-recorded",
      source: "PLATFORM-GAPS.md"
    },
    {
      id: "durable-media-review",
      owner: "Loom and Courier; Watt routes ownership",
      action: "Deliver durable scoped media refs and media-aware AgentTaskInput/review consumption",
      readyTrigger: "Actual independent media review, lineage and cross-owner isolation; filename strings insufficient",
      minimumHost: null,
      releasedSdk: null,
      status: "blocked-for-production-consumption; research-recorded",
      source: "PLATFORM-GAPS.md"
    },
    {
      id: "binary-media-acquisition",
      owner: "Courier; Watt assigns generic transport owner if distinct",
      action: "Deliver bounded lossless download-to-file/upload with exact remote allowlist and confinement",
      readyTrigger: "Byte/hash, MIME/path/symlink/redirect/size/deadline/range proofs and released SDK/host",
      minimumHost: null,
      releasedSdk: null,
      status: "blocked-for-production-consumption; research-recorded",
      source: "PLATFORM-GAPS.md"
    }
  ],
  supplementaryResponseSchemas: {
    source: {
      url: "https://docs.higgsfield.ai/docs/openapi.json",
      retrievedDate: "2026-10-29",
      snapshot: "evidence/docs-openapi.json",
      sha256: "3b78b16075b432df9b8a09a9cf93ef47a63731c06bd02b711eac6eff9ce1a44a"
    },
    schemas: {
      RequestStatus: {
        title: "Request",
        type: "object",
        properties: {
          status: {
            enum: [
              "queued",
              "in_progress",
              "nsfw",
              "failed",
              "completed",
              "canceled"
            ],
            title: "Status",
            type: "string"
          },
          request_id: {
            type: "string",
            format: "uuid"
          },
          status_url: {
            type: "string",
            format: "uri"
          },
          cancel_url: {
            type: "string",
            format: "uri"
          },
          error: {
            type: [
              "string",
              "null"
            ]
          },
          images: {
            type: "array",
            items: {
              $ref: "#/components/schemas/MediaOutput"
            }
          },
          video: {
            $ref: "#/components/schemas/MediaOutput"
          },
          audio: {
            $ref: "#/components/schemas/MediaOutput"
          },
          audios: {
            type: "array",
            items: {
              $ref: "#/components/schemas/MediaOutput"
            }
          },
          expires_at: {
            type: [
              "string",
              "null"
            ],
            format: "date-time",
            description: "When the request data is deleted and output URLs stop working. Present once the request has finished."
          }
        },
        required: [
          "status",
          "request_id"
        ]
      },
      MediaOutput: {
        title: "Media output",
        type: "object",
        additionalProperties: false,
        properties: {
          url: {
            type: "string",
            format: "uri"
          }
        },
        required: [
          "url"
        ]
      },
      ErrorResponse: {
        title: "Error response",
        type: "object",
        properties: {
          detail: {
            type: "string"
          }
        },
        required: [
          "detail"
        ]
      },
      DeletedRequest: {
        title: "DeletedRequest",
        type: "object",
        properties: {
          request_id: {
            type: "string",
            format: "uuid"
          },
          status: {
            type: "string",
            enum: [
              "deleted"
            ]
          }
        },
        required: [
          "request_id",
          "status"
        ]
      }
    },
    status: "supplementary, not complete model catalog or exhaustive model-specific output guarantee"
  },
  consoleControls: [
    {
      id: "training-opt-out",
      apiStatus: "console-control-no-public-callable-route-established",
      source: "https://docs.higgsfield.ai/docs/enterprise/model-training.md",
      retrievedDate: "2026-10-29",
      authorization: "selected account setting, off by default",
      commandDisposition: "docs-only destination; no settings mutation"
    },
    {
      id: "api-key-management",
      apiStatus: "console-control-no-public-callable-route-established",
      source: "https://docs.higgsfield.ai/docs/enterprise/access-control.md",
      retrievedDate: "2026-10-29",
      authorization: "organization Admin only",
      commandDisposition: "docs-only destination; no settings mutation"
    },
    {
      id: "webhook-secret-reveal-rotate",
      apiStatus: "console-control-no-public-callable-route-established",
      source: "https://docs.higgsfield.ai/docs/enterprise/webhook-security.md",
      retrievedDate: "2026-10-29",
      authorization: "organization Admin only; revealing creates secret",
      commandDisposition: "docs-only destination; no settings mutation"
    },
    {
      id: "organization-members-sso",
      apiStatus: "console-control-no-public-callable-route-established",
      source: "https://docs.higgsfield.ai/docs/enterprise/organizations.md",
      retrievedDate: "2026-10-29",
      authorization: "admin mutation permissions; members view/use",
      commandDisposition: "docs-only destination; no settings mutation"
    },
    {
      id: "billing-auto-payments",
      apiStatus: "console-control-no-public-callable-route-established",
      source: "https://docs.higgsfield.ai/docs/enterprise/usage-and-billing.md",
      retrievedDate: "2026-10-29",
      authorization: "organization Admin mutations",
      commandDisposition: "docs-only destination; no settings mutation"
    },
    {
      id: "retention-account-policy",
      apiStatus: "console-control-no-public-callable-route-established",
      source: "https://docs.higgsfield.ai/docs/enterprise/data-retention.md",
      retrievedDate: "2026-10-29",
      authorization: "Higgsfield configures account retention on request",
      commandDisposition: "docs-only destination; no settings mutation"
    }
  ]
};

// higgsfield/src/schema.ts
var own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
function matches(schema, value, root = schema, depth = 0, closed = true) {
  if (depth > 32 || !schema || typeof schema !== "object") return false;
  const test = (s, v = value) => matches(s, v, root, depth + 1, false);
  if (schema.$ref) {
    if (!/^#\/\$defs\/[A-Za-z0-9_]+$/.test(schema.$ref)) return false;
    return test(root.$defs?.[schema.$ref.slice(8)]);
  }
  if (schema.enum && !schema.enum.some((v) => JSON.stringify(v) === JSON.stringify(value))) return false;
  if (own(schema, "const") && JSON.stringify(schema.const) !== JSON.stringify(value)) return false;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (types.length && !types.some((t) => t === type || t === "integer" && typeof value === "number" && Number.isSafeInteger(value))) return false;
  if (schema.allOf && !schema.allOf.every((s) => test(s))) return false;
  if (schema.anyOf && !schema.anyOf.some((s) => test(s))) return false;
  if (schema.if && !test(test(schema.if) ? schema.then ?? {} : schema.else ?? {})) return false;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || schema.minimum !== void 0 && value < schema.minimum || schema.maximum !== void 0 && value > schema.maximum) return false;
    if (schema.multipleOf !== void 0 && Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > 1e-8) return false;
  }
  if (typeof value === "string") {
    if (value.length > 65536 || schema.minLength !== void 0 && [...value].length < schema.minLength || schema.maxLength !== void 0 && [...value].length > schema.maxLength) return false;
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return false;
    if (schema.format === "uuid" && !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)) return false;
    if (schema.format === "uri" && !publicHttps(value)) return false;
  }
  if (Array.isArray(value)) {
    if (value.length > 256 || schema.minItems !== void 0 && value.length < schema.minItems || schema.maxItems !== void 0 && value.length > schema.maxItems) return false;
    if (schema.items && !value.every((v) => test(schema.items, v))) return false;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value, props = schema.properties ?? {};
    if (Object.keys(obj).length > 256 || schema.maxProperties !== void 0 && Object.keys(obj).length > schema.maxProperties) return false;
    if (schema.required?.some((k) => !own(obj, k))) return false;
    for (const [k, v] of Object.entries(obj)) {
      if (["__proto__", "constructor", "prototype"].includes(k)) return false;
      if (own(props, k)) {
        if (!test(props[k], v)) return false;
      } else if (closed || schema.additionalProperties === false || schema.type === "object" && schema.properties && typeof schema.additionalProperties !== "object") return false;
      else if (typeof schema.additionalProperties === "object" && !test(schema.additionalProperties, v)) return false;
    }
  }
  return true;
}
function publicHttps(value) {
  if (typeof value !== "string" || value.length > 8192 || /[^\x21-\x7e]|[\\#]/.test(value) || /%(?![a-f\d]{2})/i.test(value)) return false;
  const match = /^https:\/\/([a-z\d.-]+)(?::443)?(?:[/?].*)?$/i.exec(value);
  if (!match) return false;
  const labels = match[1].toLowerCase().split(".");
  return labels.length >= 2 && labels.every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/.test(label)) && /^[a-z][a-z\d-]*$/.test(labels[labels.length - 1]) && !["localhost", "local", "internal", "test", "invalid"].includes(labels[labels.length - 1]);
}

// higgsfield/src/catalog.ts
var revision = "higgsfield-public-2026-10-29";
var models = models_default.models;
var operations = contracts_default.operations;
function model(id2) {
  const row = models.find((m) => m.id === id2);
  if (!row) throw new Error("unknown_model");
  return row;
}
function limitation(id2) {
  const row = model(id2);
  if (id2 === "soul-id") return { available: false, code: "separate_authority_required", source: row.source.url, detail: "Training creates a reference; separate owner authority, safe price and reference lifecycle required." };
  if (!row.schema) return { available: false, code: "schema_auth_unavailable", source: row.source.url, detail: row.limitations.join(" ") };
  if (id2 === "higgsfield/ai-influencer") return { available: false, code: "live_options_required", source: row.source.url, detail: "Current category tier/max/slot/exclusive validation and private override catalogs unavailable." };
  if (id2 === "kling-video/omni/video-reference") return { available: false, code: "source_schema_conflict", source: row.source.url, detail: "Source nests mode inside duration; vendor clarification required." };
  return null;
}
function validateParams(id2, params) {
  const row = model(id2);
  if (!row.schema || !matches(row.schema, params)) return false;
  const walk = (v, key = "") => {
    if (typeof v === "string" && /(?:^|_)urls?$/.test(key)) return publicHttps(v);
    if (Array.isArray(v)) return v.every((x) => walk(x, key));
    if (v && typeof v === "object") return Object.entries(v).every(([k, x]) => walk(x, k));
    return true;
  };
  return walk(params);
}
function validateRequest(request) {
  try {
    return request.revision === revision && request.unit === "usd_micro" && !limitation(request.operation) && JSON.stringify(request).length <= 131072 && validateParams(request.operation, request.params);
  } catch {
    return false;
  }
}
function prepare(id2, params, inputs = []) {
  const request = { operation: id2, revision, params, inputs, unit: "usd_micro" };
  if (!validateRequest(request)) throw new Error("invalid_or_unavailable_model");
  return JSON.parse(JSON.stringify(request));
}
function variation(request, changes) {
  if (Object.keys(changes).some((k) => !["seed", "batch_size"].includes(k))) throw new Error("invalid_variation");
  return prepare(request.operation, { ...request.params, ...changes }, request.inputs);
}
var unavailable = [
  ["speech", "No standalone speech/voice/music/SFX/lip-sync/dubbing API established."],
  ["upscale", "No separate upscale endpoint established; model resolution controls remain model-specific."],
  ["webhooks", "No delivered authenticated generic webhook ingress. Poll exact known request identity."],
  ["stream", "SDK subscribe is polling; no native progress/previews/media stream contract. WSS unsupported."],
  ["usage", "No callable usage/quota endpoint established; remaining balance/capacity unknown."],
  ["admin", "Console-only billing/key/settings mutations are outside authority."]
].map(([id2, detail]) => ({ id: id2, available: false, detail, source: "https://docs.higgsfield.ai/docs/llms.txt" }));

// higgsfield/src/client.ts
var jsonBytes = 262144;
var origin = "https://api.higgsfield.ai";
var plans = /* @__PURE__ */ new WeakSet();
function issued(plan) {
  Object.freeze(plan.headers);
  Object.freeze(plan);
  plans.add(plan);
  return plan;
}
function apiUrl(url) {
  if (typeof url !== "string" || url.length > 8192 || !url.startsWith(origin + "/")) return false;
  const tail = url.slice(origin.length + 1);
  const [path, query, extra] = tail.split("?");
  return extra === void 0 && /^[A-Za-z0-9._/-]+$/.test(path) && !path.split("/").some((segment) => !segment || segment === "." || segment === "..") && (query === void 0 || /^[A-Za-z0-9_.!~*'()%=&-]+$/.test(query) && !/%(?![a-f\d]{2})/i.test(query));
}
function requestUrl(id2, kind) {
  if (typeof id2 !== "string" || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id2)) throw new Error("invalid_provider_identity");
  return `${origin}/requests/${id2}/${kind}`;
}
function validateReturnedUrl(url, id2, kind) {
  if (typeof url !== "string" || url !== requestUrl(id2, kind)) throw new Error("invalid_provider_url");
  return url;
}
function parseJson(response, expected) {
  let bytes = 0;
  for (const point of response.body) {
    const n = point.codePointAt(0);
    bytes += n < 128 ? 1 : n < 2048 ? 2 : n < 65536 ? 3 : 4;
    if (bytes > jsonBytes) break;
  }
  if (response.redirected || response.url !== expected.url || !apiUrl(response.url) || bytes > jsonBytes || !/^application\/json(?:\s*;|$)/i.test(response.contentType)) throw new Error("invalid_response");
  if (response.status < 200 || response.status > 299) throw new Error(`provider_http_${response.status}`);
  try {
    return JSON.parse(response.body);
  } catch {
    throw new Error("invalid_json");
  }
}
function submitPlan(request, intent) {
  const row = model(request.operation);
  if (limitation(row.id) || !validateParams(row.id, request.params) || !/^[\x21-\x7e]{1,255}$/.test(intent)) throw new Error("invalid_submission");
  return issued({ method: "POST", url: row.endpoint, body: JSON.stringify(request.params), headers: { "Content-Type": "application/json", "Idempotency-Key": intent } });
}
function metadataPlan(id2, params) {
  const row = operations.find((o) => o.id === id2);
  if (!row || !row.schema || !matches(row.schema, params) || ["requests.status", "requests.cancel", "requests.delete"].includes(id2)) throw new Error("operation_unavailable");
  let url = row.endpoint;
  const data = params;
  if (id2 === "references.get") url = url.replace("{id}", String(data.id));
  else if (row.method === "GET" && Object.keys(data).length) {
    url += "?" + Object.entries(data).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
  }
  return issued({
    method: row.method,
    url,
    headers: row.method === "POST" ? { "Content-Type": "application/json" } : {},
    ...row.method === "POST" ? { body: JSON.stringify(params) } : {}
  });
}
function lifecyclePlan(jobId, action) {
  return issued({ method: action === "status" ? "GET" : "POST", url: requestUrl(jobId, action), headers: {} });
}
var HiggsfieldClient = class {
  constructor(ports = {}) {
    this.ports = ports;
  }
  /** Synchronous plain response or injected continuation correlation; never a Promise/host job ID. */
  prepareSend(plan) {
    if (!plans.has(plan) || !apiUrl(plan.url) || !["GET", "POST", "DELETE"].includes(plan.method) || Object.keys(plan.headers).some((k) => /authorization|cookie|proxy/i.test(k))) throw new Error("invalid_request_plan");
    if (!this.ports.transport || !this.ports.secret?.pluginBucketVerified) throw new Error("host_transport_or_secret_scope_unavailable");
    try {
      if (this.ports.secret.available("higgsfield-api-key") !== true) throw new Error();
    } catch {
      throw new Error("credential_unavailable");
    }
    const transport = this.ports.transport;
    let used = false;
    return () => {
      if (used) throw new Error("dispatch_already_entered");
      used = true;
      try {
        const result = transport.send(plan, {
          redirect: "error",
          retries: 0,
          maxBytes: jsonBytes,
          credential: { secretName: "higgsfield-api-key", origin: "https://api.higgsfield.ai", scheme: "Key" }
        });
        if (!result || typeof result.then === "function") throw new Error();
        return result;
      } catch {
        throw new Error("transport_uncertain");
      }
    };
  }
  send(plan) {
    return this.prepareSend(plan)();
  }
};
function boundedQuote(request, binding, now, evidence) {
  return quoteState(evidence, binding, request.unit, now) === "ready" ? JSON.parse(JSON.stringify(evidence)) : null;
}
function outputUrl(value, allowed) {
  if (typeof value !== "string" || !publicHttps(value) || !allowed(value)) throw new Error("output_origin_unverified");
  return value;
}

// higgsfield/src/response.ts
var states = ["queued", "in_progress", "completed", "failed", "nsfw", "canceled"];
function identity(value) {
  if (!value || typeof value !== "object") throw new Error("invalid_receipt");
  const v = value;
  requestUrl(v.request_id, "status");
  if (!states.includes(v.status)) throw new Error("invalid_provider_state");
  const mapping = { queued: "queued", in_progress: "generating", completed: "generated", failed: "failed", nsfw: "failed", canceled: "canceled" };
  return { jobId: v.request_id, state: mapping[v.status], providerState: v.status };
}
function receipt(value, allowedAsset, includeAssets = true) {
  const observation = identity(value);
  const v = value;
  const statusUrl = v.status_url === void 0 ? requestUrl(v.request_id, "status") : validateReturnedUrl(v.status_url, v.request_id, "status");
  const cancelUrl = v.cancel_url === void 0 ? requestUrl(v.request_id, "cancel") : validateReturnedUrl(v.cancel_url, v.request_id, "cancel");
  const assets = [];
  for (const field of includeAssets ? ["images", "video", "videos", "audio", "audios", "zip", "mov", "jsx", "fbx", "ply"] : []) {
    if (v[field] === void 0 || v[field] === null) continue;
    const entries = Array.isArray(v[field]) ? v[field] : [v[field]];
    for (const entry of entries) {
      if (assets.length >= 64 || !entry || typeof entry !== "object") throw new Error("invalid_outputs");
      const url = outputUrl(entry.url, allowedAsset);
      if (!assets.some((a) => a.url === url)) assets.push({ url, kind: field, ...Number.isSafeInteger(entry.index) && entry.index >= 0 ? { index: entry.index } : {} });
    }
  }
  if (v.expires_at !== void 0 && v.expires_at !== null && (typeof v.expires_at !== "string" || !Number.isFinite(Date.parse(v.expires_at)))) throw new Error("invalid_expiry");
  return {
    observation,
    statusUrl,
    cancelUrl,
    expiresAt: v.expires_at ?? null,
    assets
  };
}

// higgsfield/src/service.ts
var HiggsfieldService = class {
  constructor(ports) {
    this.ports = ports;
    this.core = new MediaCore(ports.store, ports.now, ports.maxHistory, "async", validateRequest);
  }
  intent(access, id2, operation, params, inputs = []) {
    return this.core.intent(access, id2, prepare(operation, params, inputs));
  }
  estimate(access, id2) {
    const d = this.core.beginEstimate(access, id2, !!this.ports.quote);
    try {
      const quote = this.ports.quote(access, clone(d.job.request), d.job.binding);
      return this.core.estimated(access, d.continuation, boundedQuote(d.job.request, d.job.binding, this.ports.now(), quote));
    } catch {
      this.core.estimateFailed(d.continuation);
      throw new Error("estimate_unavailable");
    }
  }
  approve(access, id2, maximum) {
    return this.core.approve(access, id2, maximum);
  }
  start(access, id2) {
    const d = this.core.beginStart(access, id2, !!this.ports.output);
    if (!d.continuation) return { job: d.job };
    const token = d.continuation;
    let plan;
    let send;
    try {
      if (!this.ports.attest || this.ports.attest(access, clone(d.job.request)) !== true) throw new Error("input_account_schema_unverified");
      plan = submitPlan(d.job.request, d.job.id);
      send = this.ports.client.prepareSend(plan);
      const reserved = this.core.reserve(access, token);
      if (reserved.state === "waiting") return { job: reserved };
    } catch {
      this.core.releasePreflight(token);
      throw new Error("submission_preflight_refused");
    }
    const entered = this.core.enter(access, token);
    if (!entered.action) return { job: entered.job };
    try {
      return { token, scope: d.job.scope, plan, action: "submit", result: send() };
    } catch {
      this.core.unknown(token);
      throw new Error("submission_unknown");
    }
  }
  /** Trusted host callback only. Commit exact vendor identity before parsing/acquiring any outputs. */
  receive(access, effect, response) {
    if (!visible(access.scope, { scope: effect.scope })) throw new Error("receipt_scope_unavailable");
    try {
      if (effect.action === "cancel") {
        if (response.status !== 202 || response.body !== "" || response.redirected || response.url !== effect.plan.url) throw new Error("cancel_not_confirmed");
        return this.core.unknown(effect.token);
      }
      const value = parseJson(response, effect.plan);
      const normalized = identity(value);
      const observed = this.core.observation(effect.token, normalized, true);
      if (observed.job.jobId !== normalized.jobId) return observed.job;
      const head = receipt(value, () => false, false);
      this.ports.facts?.save(effect.token, { requestId: head.observation.jobId, statusUrl: head.statusUrl, cancelUrl: head.cancelUrl, expiresAt: head.expiresAt });
      if (!observed.saveOutputs) return this.core.complete(effect.token, []);
      if (!this.ports.output || !access.current || access.scope.owner !== effect.token.owner || access.scope.workspace !== effect.token.workspace || !this.core.history(access).some((j) => j.id === effect.token.id)) throw new Error("output_unavailable");
      const body = receipt(value, (u) => this.ports.output.allowed(u));
      return this.core.complete(effect.token, this.ports.output.save(access, effect.token.id, body.assets));
    } catch {
      try {
        this.core.unknown(effect.token);
      } catch {
      }
      throw new Error("receipt_unknown");
    }
  }
  inspect(access, id2) {
    const d = this.core.beginReconcile(access, id2);
    const plan = lifecyclePlan(d.job.jobId, "status");
    try {
      return { token: d.continuation, scope: d.job.scope, plan, action: "status", result: this.ports.client.send(plan) };
    } catch {
      this.core.unknown(d.continuation);
      throw new Error("reconciliation_unknown");
    }
  }
  cancel(access, id2) {
    const d = this.core.beginCancel(access, id2, { queued: true, running: false });
    const plan = lifecyclePlan(d.job.jobId, "cancel");
    try {
      return { token: d.continuation, scope: d.job.scope, plan, action: "cancel", result: this.ports.client.send(plan) };
    } catch {
      this.core.unknown(d.continuation);
      throw new Error("cancellation_unknown");
    }
  }
  metadata(access, id2, params) {
    this.core.history(access);
    const plan = metadataPlan(id2, params);
    const result = this.ports.client.send(plan);
    if ("kind" in result) return result;
    return parseJson(result, plan);
  }
  history(access) {
    return this.core.history(access);
  }
  historyCapacity() {
    return this.ports.maxHistory;
  }
  canEstimate(operation) {
    return !!this.ports.quote && (operation === void 0 || (this.ports.quoteSupported ? this.ports.quoteSupported(operation) === true : operation === "higgsfield-ai/soul/v2/standard"));
  }
  recover(access) {
    return this.core.recover(access);
  }
  usage(access) {
    return { ledger: totals(this.core.history(access), access.scope.runId), remaining: null, accountUsage: null, unit: "usd_micro" };
  }
};
function operationDisposition(id2) {
  const row = operations.find((o) => o.id === id2);
  if (!row) return { available: false, code: "unknown_operation" };
  const refused = {
    "requests.delete": "Destructive deletion requires separate owner authorization; unavailable here.",
    "files.put": "Bounded lossless binary upload and verified storage origins unavailable; never forward API secrets.",
    "estimate.model": "Only Soul 2 estimate path established; safe account basis/expiry still required."
  };
  return { id: id2, source: row.source.url, available: !refused[id2], detail: refused[id2] ?? row.notes };
}
var limitations = unavailable;

// higgsfield/src/admission.ts
function proofRequired(job) {
  return job.state === "waiting";
}
function proofAllows(port, access, job) {
  if (!proofRequired(job)) return true;
  const p = port?.(access, job);
  return !!p && !!p.purpose.trim() && !!p.aggregateProof && p.operation === job.id && p.binding === job.binding && validAmount(p.maximum) && validAmount(p.runCeiling) && p.maximum.unit === job.request.unit && p.runCeiling.unit === job.request.unit && !!job.quote && p.maximum.amount >= job.quote.amount;
}

// media-shared/src/presentation.ts
var states2 = {
  starting: ["Starting\u2026", "muted"],
  queued: ["Queued", "muted"],
  generating: ["Generating", "accent"],
  generated: ["Generated", "ok"],
  failed: ["Failed", "error"],
  canceled: ["Canceled", "muted"],
  unknown: ["Status unknown", "warn"],
  price_unavailable: ["Price unavailable", "warn"],
  price_stale: ["Price needs updating", "warn"],
  waiting_ok: ["Waiting for your OK", "warn"]
};
function jobStatus(state, o = {}) {
  let [label, tone] = states2[state];
  if (o.cancelRequested && !["generated", "failed", "canceled", "unknown"].includes(state)) [label, tone] = ["Canceling\u2026", "muted"];
  const seconds = o.elapsedMs !== void 0 && Number.isFinite(o.elapsedMs) && o.elapsedMs >= 0 ? Math.floor(o.elapsedMs / 1e3) : void 0;
  return {
    label,
    tone,
    elapsed: seconds === void 0 ? void 0 : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
    progress: state === "generating" && typeof o.progress === "number" && Number.isFinite(o.progress) && o.progress >= 0 && o.progress <= 1 ? o.progress : void 0
  };
}
function priceGate(quote, expectedUnit, nowMs, names) {
  if (!quote || !Number.isSafeInteger(quote.amount) || quote.amount < 0 || quote.unit !== expectedUnit || !Number.isFinite(nowMs) || !Number.isFinite(quote.validUntilMs)) return { kind: "unavailable" };
  if (nowMs >= quote.validUntilMs) return { kind: "stale" };
  return {
    kind: "ready",
    amount: quote.amount,
    unit: quote.unit,
    text: `${quote.amount.toLocaleString("en-US")} ${quote.amount === 1 ? names.one : names.other}`
  };
}
function jobPrice(job, now, names) {
  const state = quoteState(job.quote, job.binding, job.request.unit, now);
  return state === "ready" ? priceGate(job.quote, job.request.unit, now, names) : { kind: state };
}
function actorLabel(actor) {
  return actor.kind === "you" ? "You" : actor.label;
}
function activityLine(actor, verb, subject, amountText) {
  const bounded = Array.from(subject).slice(0, 48).join("") + (Array.from(subject).length > 48 ? "\u2026" : "");
  return `${actorLabel(actor)} ${verb} ${bounded}${amountText ? ` for ${amountText}` : ""}`;
}

// higgsfield/src/ui.ts
var uiBounds = { args: 4096, snapshot: 256 * 1024, details: 64 * 1024, schema: 128 * 1024, depth: 12, fields: 128 };
function uiJSONBytes(value, maximum = Number.MAX_SAFE_INTEGER) {
  const encoded = JSON.stringify(value);
  if (encoded === void 0) throw new Error("ui_encoding_refused");
  let bytes = 0;
  for (const point of encoded) {
    const cp = point.codePointAt(0);
    bytes += cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4;
    if (bytes > maximum) throw new Error("ui_size_refused");
  }
  return bytes;
}
var unavailable2 = (code) => ({ kind: "unavailable", code, message: "This information cannot be safely displayed in this studio." });
function boundedResponse(value, maximum, code) {
  try {
    uiJSONBytes(value, maximum);
    return value;
  } catch {
    return unavailable2(code);
  }
}
function schemaSupported(schema) {
  let fields = 0;
  const counted = /* @__PURE__ */ new Set();
  const complete = /* @__PURE__ */ new Map();
  const walk = (s, depth, ancestors) => {
    if (!s || typeof s !== "object" || Array.isArray(s) || depth > uiBounds.depth || ancestors.has(s)) return false;
    if (complete.get(s)?.has(depth)) return true;
    if (["oneOf", "not", "patternProperties", "dependentSchemas", "unevaluatedProperties", "prefixItems", "contains"].some((k) => k in s)) return false;
    const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
    if (types.some((t) => !["object", "array", "string", "number", "integer", "boolean", "null"].includes(t))) return false;
    if (!counted.has(s)) {
      fields += Object.keys(s.properties ?? {}).length;
      counted.add(s);
    }
    if (fields > uiBounds.fields) return false;
    const next = new Set(ancestors);
    next.add(s);
    if (s.$ref) {
      if (!/^#\/\$defs\/[A-Za-z0-9_]+$/.test(s.$ref)) return false;
      const ref = schema.$defs?.[s.$ref.slice(8)];
      if (!ref || !walk(ref, depth + 1, next)) return false;
    }
    const children = [...Object.values(s.properties ?? {}), ...Object.values(s.$defs ?? {})];
    if (s.items) children.push(s.items);
    for (const key of ["allOf", "anyOf"]) {
      const branches = s[key];
      if (branches !== void 0) {
        if (!Array.isArray(branches)) return false;
        children.push(...branches);
      }
    }
    for (const key of ["if", "then", "else", "additionalProperties"]) if (s[key] && typeof s[key] === "object") children.push(s[key]);
    if (!children.every((child) => walk(child, depth + 1, next))) return false;
    const depths = complete.get(s) ?? /* @__PURE__ */ new Set();
    depths.add(depth);
    complete.set(s, depths);
    return true;
  };
  return !!schema.properties && !Array.isArray(schema.properties) && (schema.type === void 0 || schema.type === "object") && walk(schema, 0, /* @__PURE__ */ new Set());
}
var unitNames = { one: "microdollar", other: "microdollars" };
function displayUSD(amount) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("invalid_display_amount");
  const whole = Math.floor(amount / 1e6), remainder = amount % 1e6;
  const fraction = String(remainder).padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
  return `$${whole}.${fraction}`;
}
function displayModel(operation) {
  const title = models.find((m) => m.id === operation)?.title;
  return title ? title.split(" \u2014 ")[0].replace(/ API$/, "").replace(/\b[A-Z]{3,}\b/g, (word) => word[0] + word.slice(1).toLowerCase()) : "Model unavailable";
}
function privateActivity(job) {
  const prompt = job.request.params.prompt;
  const subject = typeof prompt === "string" ? prompt.replace(/[\r\n\t]+/g, " ").slice(0, 24) + (prompt.length > 24 ? "\u2026" : "") : "generation";
  return activityLine(documentActor(job), "prepared", `'${subject}' \xB7 ${displayModel(job.request.operation)}`);
}
function documentActor(job) {
  const actor = clone(job.scope.actor);
  if (actor.kind !== "run") return actor;
  const label = typeof actor.label === "string" ? actor.label.trim() : "";
  return { ...actor, label: !label || label === actor.runId || label === job.scope.runId ? "Pipeline run" : label };
}
function privateRunSummary(jobs) {
  const first = jobs[0];
  if (!first || jobs.length < 2 || jobs.length > 8 || first.scope.actor.kind !== "run") return;
  const runId = first.scope.actor.runId;
  if (!jobs.every((job) => job.scope.actor.kind === "run" && job.scope.actor.runId === runId && job.scope.runId === first.scope.runId)) return;
  return `${actorLabel(documentActor(first))} prepared ${jobs.length} jobs`;
}
var id = (v) => typeof v === "string" && /^[A-Za-z0-9_./-]{1,255}$/.test(v);
function validateUIArgs(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((k) => !allowed.includes(k))) throw new Error("ui_refused");
  uiJSONBytes(value, uiBounds.args);
}
function uiItem(job, now) {
  const state = job.state === "waiting" ? job.waitReason === "price_stale" ? "price_stale" : job.waitReason === "price_unavailable" ? "price_unavailable" : "waiting_ok" : job.state;
  const params = job.request.params;
  const gate = jobPrice(job, now, unitNames);
  const price = gate.kind === "ready" ? { ...gate, text: displayUSD(gate.amount) } : gate;
  const charged = job.accounting === "spent" && job.reservation?.unit === "usd_micro" ? job.reservation : void 0;
  const quoted = job.quote && quoteState(job.quote, job.binding, job.request.unit, job.quote.issuedAt) === "ready" ? job.quote : void 0;
  const cost = charged ?? quoted;
  return {
    id: job.id,
    operation: job.request.operation,
    title: typeof params.prompt === "string" ? params.prompt.slice(0, 240) : "Generation",
    at: job.at,
    actor: documentActor(job),
    status: jobStatus(state, {
      cancelRequested: job.cancelRequested,
      progress: job.progress,
      elapsedMs: ["starting", "queued", "generating"].includes(state) ? Math.max(0, now - job.at) : void 0
    }),
    state,
    price,
    priceTTL: job.quote ? Math.max(0, job.quote.validUntilMs - now) : void 0,
    outputs: clone(job.outputs),
    modelLabel: displayModel(job.request.operation),
    recordedCost: cost ? { amount: cost.amount, unit: cost.unit, text: displayUSD(cost.amount), kind: charged ? "charged" : "quoted" } : void 0,
    activity: privateActivity(job),
    startedBy: actorLabel(documentActor(job))
  };
}
function uiSchema(operation) {
  if (!id(operation)) throw new Error("ui_refused");
  const row = models.find((m) => m.id === operation);
  if (!row?.schema) return unavailable2("ui_schema_unsupported");
  try {
    uiJSONBytes(row.schema, uiBounds.schema);
  } catch {
    return unavailable2("ui_schema_too_large");
  }
  if (!schemaSupported(row.schema)) return unavailable2("ui_schema_unsupported");
  return clone(row.schema);
}
function documentUI(service, access, method, value, now, capabilities) {
  const history = service.history(access);
  if (method === "ui.snapshot") {
    validateUIArgs(value, ["offset", "limit"]);
    const offset = value.offset ?? 0, limit = value.limit ?? 20;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1e4 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error("ui_refused");
    const sorted = [...history].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
    const activityJobs = sorted.filter((j) => j.scope.actor.kind !== "you");
    return boundedResponse({
      items: sorted.slice(offset, offset + limit).map((j) => uiItem(j, now)),
      total: sorted.length,
      next: offset + limit < sorted.length ? offset + limit : null,
      capacity: service.historyCapacity(),
      catalog: models.map((m) => ({
        id: m.id,
        label: displayModel(m.id),
        category: m.category.charAt(0).toUpperCase() + m.category.slice(1),
        unavailable: limitation(m.id)?.detail ?? (!service.canEstimate(m.id) ? "no pricing from provider" : null)
      })),
      activity: activityJobs.slice(0, 8).map(privateActivity),
      activitySummary: privateRunSummary(activityJobs),
      capabilities
    }, uiBounds.snapshot, "ui_snapshot_too_large");
  }
  if (method === "ui.schema") {
    validateUIArgs(value, ["operation"]);
    const schema2 = uiSchema(value.operation);
    if ("kind" in schema2) return schema2;
    return boundedResponse({ revision, schema: schema2, unavailable: limitation(value.operation)?.detail ?? null }, uiBounds.schema, "ui_schema_too_large");
  }
  validateUIArgs(value, ["id"]);
  if (method !== "ui.details" || !id(value.id)) throw new Error("ui_refused");
  const job = history.find((j) => j.id === value.id);
  if (!job) throw new Error("ui_refused");
  if (!validateParams(job.request.operation, job.request.params)) return unavailable2("ui_details_unsupported");
  const schema = uiSchema(job.request.operation);
  if ("kind" in schema) return schema;
  return boundedResponse({
    item: uiItem(job, now),
    params: clone(job.request.params),
    schema,
    inputs: job.request.inputs.filter((i) => i.kind === "artifact").map((i) => ({ id: i.id, contentType: i.contentType }))
  }, uiBounds.details, "ui_details_too_large");
}

// higgsfield/src/commands.ts
var verbs = ["open", "close", "catalog", "describe", "prepare", "rerun", "estimate", "usage", "history", "result", "cancel", "reconcile", "submit", "metadata"];
var boundedId = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,255}$/.test(v);
var commandPayloadBytes = 16e3;
var surfaceCallBytes = 32768;
function withinUtf8(value, maximum) {
  let bytes = 0;
  for (const point of value) {
    const n = point.codePointAt(0);
    bytes += n < 128 ? 1 : n < 2048 ? 2 : n < 65536 ? 3 : 4;
    if (bytes > maximum) return false;
  }
  return true;
}
function commandArgs(args) {
  if (!Array.isArray(args) || args.length > 1 || args.some((a) => typeof a !== "string" || !withinUtf8(a, commandPayloadBytes)) || !withinUtf8(JSON.stringify(args), surfaceCallBytes)) throw new Error("invalid_command");
  if (args.length) {
    const payload = JSON.parse(args[0]);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid_command");
  }
  return args;
}
function object(v, keys, required = []) {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).some((k) => !keys.includes(k)) || required.some((k) => !(k in v))) throw new Error("invalid_arguments");
}
function publicJob(job, now) {
  const price = quoteState(job.quote, job.binding, job.request.unit, now) === "ready" ? { amount: job.quote.amount, unit: job.quote.unit } : null;
  return {
    id: job.id,
    operation: job.request.operation,
    state: job.state,
    waitReason: job.waitReason ?? null,
    price,
    outputs: job.outputs.map((a) => ({ kind: a.kind, id: a.id, contentType: a.contentType }))
  };
}
function describe(id2) {
  const row = models.find((m) => m.id === id2);
  if (row) return { id: id2, revision, schema: row.schema, source: row.source, limitation: limitation(id2), docs: row.source.url };
  const op = operations.find((o) => o.id === id2);
  if (op) return { id: id2, revision, schema: op.schema, source: op.source, disposition: operationDisposition(id2), docs: op.source.url };
  throw new Error("unknown_operation");
}
var HiggsfieldCommands = class {
  constructor(service, ports) {
    this.service = service;
    this.ports = ports;
  }
  onAgentCommand(ctx) {
    let args;
    try {
      if (!verbs.includes(ctx.verb) || !Array.isArray(ctx.args) || ctx.body !== void 0 && (typeof ctx.body !== "string" || ctx.args.length > 0)) throw new Error();
      args = commandArgs(ctx.body === void 0 ? ctx.args : [ctx.body]);
    } catch {
      return { error: "invalid_command" };
    }
    try {
      const reply = JSON.parse(this.ports.surface.call(ctx.verb, JSON.stringify(args)));
      return typeof reply.result === "string" ? { result: reply.result } : { error: "surface_unavailable" };
    } catch {
      return { error: "surface_unavailable" };
    }
  }
  onSurfaceCall(context, verb, args) {
    try {
      commandArgs(args);
      return JSON.stringify(this.execute(context, "surface", verb, args.length ? JSON.parse(args[0]) : {}));
    } catch {
      return JSON.stringify({ error: "command_refused" });
    }
  }
  viewCall(method, args, context) {
    if (method.startsWith("ui.")) {
      try {
        if (context.origin !== "document" || !context.frame || !context.surface || !context.instance || !context.tab) throw new Error();
        const access = this.ports.access(context, "view");
        if (!access?.current) throw new Error();
        return documentUI(this.service, access, method, args ?? {}, this.ports.now(), {
          estimate: this.service.canEstimate(),
          submit: !!this.ports.admit && !!this.ports.proof,
          reconcile: !!this.ports.admit,
          cancelQueued: !!this.ports.admit
        });
      } catch {
        return { error: "document_ui_refused" };
      }
    }
    try {
      return this.execute(context, "view", method, args ?? {});
    } catch {
      return { error: "command_refused" };
    }
  }
  execute(context, origin2, verb, args) {
    if (!verbs.includes(verb)) throw new Error();
    const access = this.ports.access(context, origin2);
    if (!access || !access.current) throw new Error();
    this.service.history(access);
    let changed = false, result;
    const job = (id2) => {
      if (!boundedId(id2)) throw new Error();
      const j = this.service.history(access).find((j2) => j2.id === id2);
      if (!j) throw new Error();
      return j;
    };
    switch (verb) {
      case "open":
      case "close":
        object(args, []);
        if (origin2 !== "surface") return { error: "surface_lifecycle_unavailable" };
        return { acknowledged: verb };
      // Authenticated host surface dispatch only; viewCall performs no lifecycle.
      case "catalog":
        object(args, []);
        return {
          revision,
          models: models.map((m) => ({ id: m.id, category: m.category, limitation: limitation(m.id) })),
          operations: operations.map((o) => operationDisposition(o.id)),
          limitations
        };
      case "describe":
        object(args, ["operation"], ["operation"]);
        return describe(args.operation);
      case "metadata": {
        object(args, ["operation", "params"], ["operation", "params"]);
        const disposition = operationDisposition(args.operation);
        if (!disposition.available || ["requests.status", "requests.cancel", "estimate.model"].includes(args.operation)) throw new Error();
        metadataPlan(args.operation, args.params);
        if (!this.ports.metadata) return { error: "metadata_artifact_transport_unavailable", source: disposition.source };
        const result2 = this.ports.metadata(this.service, access, args.operation, args.params);
        if (!boundedId(result2.artifact) || Object.keys(result2).some((k) => k !== "artifact")) throw new Error();
        return result2;
      }
      case "prepare": {
        object(args, ["operation", "params"], ["operation", "params"]);
        const id2 = this.ports.identity(access);
        if (!boundedId(id2)) throw new Error();
        result = publicJob(this.service.intent(access, id2, args.operation, args.params), this.ports.now());
        changed = true;
        break;
      }
      case "rerun": {
        object(args, ["id", "changes"], ["id", "changes"]);
        object(args.changes, ["seed", "batch_size"]);
        const parent = job(args.id), request = variation(parent.request, args.changes);
        const id2 = this.ports.identity(access);
        if (!boundedId(id2) || id2 === parent.id) throw new Error();
        result = {
          job: publicJob(this.service.intent(access, id2, request.operation, request.params, request.inputs), this.ports.now()),
          parent: parent.id,
          lineage: "preparation-only; durable host lineage pending"
        };
        changed = true;
        break;
      }
      case "usage":
        object(args, []);
        return this.service.usage(access);
      case "history":
        object(args, []);
        return this.service.history(access).map((j) => publicJob(j, this.ports.now()));
      case "result":
        object(args, ["id"], ["id"]);
        return publicJob(job(args.id), this.ports.now());
      case "estimate":
        object(args, ["id"], ["id"]);
        job(args.id);
        result = publicJob(this.service.estimate(access, args.id), this.ports.now());
        changed = true;
        break;
      default: {
        object(args, ["id"], ["id"]);
        const prior = job(args.id);
        if (!this.ports.admit) return { error: "durable_admission_unavailable", job: publicJob(prior, this.ports.now()) };
        if (verb === "submit" && !proofAllows(this.ports.proof, access, prior)) return { error: "aggregate_approval_unavailable", job: publicJob(prior, this.ports.now()) };
        result = publicJob(this.ports.admit(this.service, access, prior.id, verb), this.ports.now());
        changed = true;
      }
    }
    if (changed && context.surface && context.instance && context.tab) {
      this.ports.surface.invalidate({ surface: context.surface, instance: context.instance, tab: context.tab });
    }
    return result;
  }
};

// media-shared/src/host-runtime.ts
function documentAccess(plugin, context) {
  const c = context;
  if (!c || c.plugin !== plugin || c.origin !== "document" || c.actor?.kind !== "local" || ![c.owner, c.workspace, c.frame, c.surface, c.instance, c.tab].every((v) => typeof v === "string" && v.length > 0))
    throw new Error("trusted_document_workspace_required");
  return { current: true, inputsAuthorized: false, scope: {
    owner: c.owner,
    workspace: c.workspace,
    actorId: c.owner,
    actor: { kind: "agent", label: "Studio owner" },
    human: false,
    authRevision: c.frame
  } };
}
function hostStore(host2, plugin) {
  if (!/^[a-z][a-z0-9-]*$/.test(plugin)) throw new Error("invalid_plugin");
  const root = host2.dataDir() + "/" + plugin + "/runtime";
  return { transact(owner, workspace, edit) {
    if (!owner || !workspace || !host2.fs.makeDirs(root)) throw new Error("store_unavailable");
    const key = host2.md5(JSON.stringify([owner, workspace]));
    if (!/^[a-f0-9]{32}$/.test(key)) throw new Error("store_unavailable");
    const path = root + "/" + key + ".json";
    const lock = host2.fs.lockFile(path + ".lock");
    if (!lock) throw new Error("store_busy");
    try {
      const exists = host2.fs.fileExists(path);
      const text = exists ? host2.fs.readFileHead(path, 8 * 1024 * 1024 + 1) : null;
      if (exists && (text === null || text.length > 8 * 1024 * 1024)) throw new Error("store_unavailable");
      const envelope = exists ? JSON.parse(text) : { owner, workspace, partition: { jobs: [], ceilings: {} } };
      if (envelope.owner !== owner || envelope.workspace !== workspace || !Array.isArray(envelope.partition?.jobs) || !envelope.partition?.ceilings || typeof envelope.partition.ceilings !== "object") throw new Error("store_corrupt");
      const result = edit(envelope.partition);
      const encoded = JSON.stringify(envelope);
      if (encoded.length > 2 * 1024 * 1024 || !host2.fs.writeFileAtomic(path, encoded)) throw new Error("store_write_unavailable");
      return result;
    } finally {
      host2.fs.unlockFile(lock);
    }
  } };
}
var runtimeLimitations = [
  "Agent SurfaceCallContext has no workspace; MediaCore agent scope cannot be resolved.",
  "Binary transfer has no JSON request body with host-resolved secret credentials.",
  "jobs.admit is observation_only; no studio spend admission or approval linkage is supplied.",
  "Exact-input fresh account pricing and aggregate USD admission are not configured.",
  "Submission, output storage/media registration, reconciliation, cancellation and Scribe are unavailable.",
  "Comments, immutable revision resolution, Blueprint execution and agent media review are unavailable."
];
function runtimeStatus() {
  return {
    state: "unavailable",
    paid: false,
    discovery: true,
    documentHistory: true,
    preparation: false,
    estimate: false,
    submission: false,
    limitations: runtimeLimitations
  };
}

// higgsfield/src/runtime.ts
function createRuntime(host2) {
  const service = new HiggsfieldService({
    store: hostStore(host2, "higgsfield"),
    now: () => host2.unixNowMs(),
    maxHistory: 100,
    client: new HiggsfieldClient()
  });
  const commands = new HiggsfieldCommands(service, {
    surface: host2.surface,
    now: () => host2.unixNowMs(),
    access: (c) => documentAccess("higgsfield", c),
    identity: () => {
      throw new Error("host_intent_unavailable");
    }
  });
  return {
    onAgentCommand(ctx) {
      if (![...verbs, "status"].includes(ctx.verb) || ctx.args.length || (ctx.body?.length ?? 0) > 16e3)
        return { error: "invalid_arguments" };
      return host2.surface.dispatch(ctx.verb, ctx.body ? [ctx.body] : []);
    },
    onSurfaceCall(context, verb, args) {
      try {
        if (context.owner !== context.actor || args.length > 1 || (args[0]?.length ?? 0) > 16e3) throw new Error();
        const body = args.length ? JSON.parse(args[0]) : {};
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
        if (verb === "describe" && Object.keys(body).length === 1 && typeof body.operation === "string")
          return JSON.stringify(describe(body.operation));
        if (Object.keys(body).length) throw new Error();
        if (verb === "catalog") return JSON.stringify({
          revision,
          models: models.map((m) => ({ id: m.id, category: m.category })),
          operations: operations.map((o) => ({ id: o.id })),
          runtime: runtimeStatus()
        });
        if (verb === "open" || verb === "close") return JSON.stringify({ acknowledged: verb });
        return JSON.stringify(runtimeStatus());
      } catch {
        return JSON.stringify({ error: "request_refused" });
      }
    },
    viewCall(method, args, context) {
      if (method === "status") return runtimeStatus();
      return commands.viewCall(method, args, context);
    },
    mediaFile() {
      return null;
    }
  };
}

// higgsfield/src/plugin.ts
var plugin_default = createRuntime(host);
