import type { ExecPollResult, HostIoSteps, ViewNode } from "@codeterm/plugin-sdk";
import parakeetWorkerSource from "../runtime/parakeet.py";
import runtimeRequirementsSource from "../runtime/requirements.txt";
import {
  archiveName,
  archiveUrl,
  DEFAULT_MODEL_ID,
  hasExplicitSelection,
  hasModel,
  hasRuntime,
  INSTALL_TIMEOUT_MS,
  modelPath,
  MODELS,
  python,
  root,
  RUNTIME,
  RUNTIME_DISK_ESTIMATE,
  RUNTIME_PYTHON_REQUIREMENT,
  runtimePython,
  selectedModel,
  selectionPath,
  TEST_TIMEOUT_MS,
  WORKER,
  type Model,
} from "./models";

export type SetupOrigin = "agent" | "glance";
export type SetupJobMode = "install" | "test";
export type SetupJobState = "running" | "cancelling" | "completed" | "cancelled" | "failed";
export type SetupProgressStage =
  | "starting"
  | "installing_runtime"
  | "downloading_model"
  | "verifying_and_unpacking"
  | "testing_model"
  | "cancelling"
  | "completed"
  | "cancelled"
  | "failed";

export type SetupFailureCode =
  | "host_refused"
  | "python_missing"
  | "python_unsupported"
  | "disk_space"
  | "network_error"
  | "verification_failed"
  | "lock_busy"
  | "timeout"
  | "worker_stage_failed"
  | "test_no_speech"
  | "test_unsupported_sample"
  | "job_lost"
  | "selection_save_failed"
  | "runtime_error";

export interface SetupFailure {
  code: SetupFailureCode;
  message: string;
  exitCode?: number;
}

export interface SetupProgress {
  stage: SetupProgressStage;
  message: string;
  downloadedMb?: number;
  totalMb?: number;
}

export interface SetupJobSnapshot {
  jobId: string;
  mode: SetupJobMode;
  modelId: Model["id"];
  modelLabel: string;
  origin: SetupOrigin;
  state: SetupJobState;
  startedAtMs: number;
  finishedAtMs?: number;
  progress: SetupProgress;
  output?: string;
  failure?: SetupFailure;
}

export interface DictationModelStatus {
  id: Model["id"];
  label: string;
  languages: string;
  size: string;
  bytes: number;
  sample: string;
  isDefault: boolean;
  installed: boolean;
  selected: boolean;
  ready: boolean;
}

export interface DictationStatusSnapshot {
  ready: boolean;
  runtimeInstalled: boolean;
  runtimeId: string;
  defaultModelId: Model["id"];
  selectedModelId: Model["id"];
  selectedModelLabel: string;
  hasExplicitSelection: boolean;
  platform: string;
  requirements: {
    defaultModelSize: string;
    diskSpace: string;
    python: string;
  };
  models: DictationModelStatus[];
  activeJob: SetupJobSnapshot | null;
  lastJob: SetupJobSnapshot | null;
}

export interface DictationProgressSnapshot {
  state: SetupJobState | "idle";
  activeJob: SetupJobSnapshot | null;
  lastJob: SetupJobSnapshot | null;
  ready: boolean;
  runtimeInstalled: boolean;
  selectedModelId: Model["id"];
}

export type StartInstallResult =
  | { ok: true; outcome: "started" | "already_running"; job: SetupJobSnapshot; status: DictationStatusSnapshot }
  | { ok: true; outcome: "already_installed"; job: SetupJobSnapshot | null; status: DictationStatusSnapshot }
  | { ok: false; outcome: "busy"; activeJob: SetupJobSnapshot | null; message: string }
  | { ok: false; outcome: "failed"; failure: SetupFailure; status: DictationStatusSnapshot };

export type CancelInstallResult =
  | { ok: true; outcome: "cancelling" | "already_cancelling"; job: SetupJobSnapshot; status: DictationStatusSnapshot }
  | { ok: false; outcome: "no_active_install"; lastJob: SetupJobSnapshot | null; message: string }
  | { ok: false; outcome: "not_cancellable"; activeJob: SetupJobSnapshot; message: string }
  | { ok: false; outcome: "failed"; failure: SetupFailure };

export type SelectModelResult =
  | { ok: true; outcome: "selected" | "already_selected"; status: DictationStatusSnapshot }
  | { ok: false; outcome: "busy"; activeJob: SetupJobSnapshot | null; message: string }
  | { ok: false; outcome: "not_installed"; message: string }
  | { ok: false; outcome: "failed"; failure: SetupFailure };

export type StartTestResult =
  | { ok: true; outcome: "started" | "already_running"; job: SetupJobSnapshot; status: DictationStatusSnapshot }
  | { ok: false; outcome: "busy"; activeJob: SetupJobSnapshot | null; message: string }
  | { ok: false; outcome: "not_installed"; message: string }
  | { ok: false; outcome: "failed"; failure: SetupFailure; status: DictationStatusSnapshot };

interface ActiveJob {
  id: string;
  nonce: string;
  mode: SetupJobMode;
  model: Model;
  origin: SetupOrigin;
  startedAtMs: number;
  cancelled: boolean;
}

const MAX_PROGRESS_CHARS = 180;
const MAX_OUTPUT_CHARS = 360;
const MAX_ERROR_CHARS = 400;
const WORKER_VERSION = "0.5.1";

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

const WORKER_TAG = WORKER_VERSION + "-" + fnv1aHex(parakeetWorkerSource + "\0" + runtimeRequirementsSource);
const fs = () => host.io.fs;

let activeJob: ActiveJob | null = null;
let lastJob: SetupJobSnapshot | null = null;
let starting = false;
let glanceNotice: ViewNode | null = null;
let nonceCounter = 0;

function boundText(value: string, maxChars: number): string {
  return String(value || "").replace(/\r\n/g, "\n").trim().slice(0, maxChars);
}

function makeNonce(): string {
  nonceCounter = (nonceCounter + 1) % 1_000_000;
  return (
    host.unixNowMs().toString(36) +
    "-" +
    nonceCounter.toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10)
  );
}

export function isSetupStarting(): boolean {
  return starting;
}

export function currentGlanceNotice(): ViewNode | null {
  return glanceNotice;
}

export function stagedWorkerDir(): string {
  return root() + "/.worker-" + WORKER_TAG;
}

function classifyFailure(rawMessage: string, exitCode: number | undefined, mode: SetupJobMode): SetupFailure {
  const message = boundText(rawMessage, MAX_ERROR_CHARS) || "The local dictation runtime returned an error.";
  const lower = message.toLowerCase();
  let code: SetupFailureCode = "runtime_error";

  if (
    lower.includes("denied") ||
    lower.includes("not in subprocess.allow") ||
    lower.includes("permission denied") ||
    lower.includes("not allowed") ||
    lower.includes("refused by host") ||
    lower.includes("agent_commands")
  ) {
    code = "host_refused";
  } else if (lower.includes("64-bit python 3.12") || lower.includes("supported 64-bit python")) {
    code = "python_unsupported";
  } else if (
    lower.includes("executable not found") ||
    lower.includes("enoent") ||
    lower.includes("cannot find the file") ||
    lower.includes("no such file or directory") ||
    (lower.includes("not found") && (lower.includes("python") || exitCode === undefined))
  ) {
    code = "python_missing";
  } else if (lower.includes("free at least 1.5 gb") || lower.includes("no space left")) {
    code = "disk_space";
  } else if (
    lower.includes("sha-256") ||
    lower.includes("pinned length") ||
    lower.includes("invalid model archive") ||
    lower.includes("missing required model files") ||
    lower.includes("installation bound") ||
    lower.includes("staging path is occupied") ||
    lower.includes("without producing a verified")
  ) {
    code = "verification_failed";
  } else if (
    lower.includes("install-lock") ||
    lower.includes("inference-lock") ||
    lower.includes("resource temporarily unavailable") ||
    lower.includes("permissionerror")
  ) {
    code = "lock_busy";
  } else if (lower.includes("time limit") || lower.includes("timed out") || lower.includes("timeout")) {
    code = "timeout";
  } else if (
    lower.includes("redirected outside") ||
    lower.includes("urlerror") ||
    lower.includes("httperror") ||
    lower.includes("connection") ||
    lower.includes("ssl") ||
    lower.includes("pypi") ||
    lower.includes("github.com")
  ) {
    code = "network_error";
  } else if (mode === "test" && lower.includes("unsupported format")) {
    code = "test_unsupported_sample";
  } else if (mode === "test" && lower.includes("no transcript")) {
    code = "test_no_speech";
  }

  return exitCode !== undefined ? { code, message, exitCode } : { code, message };
}

function parseInstallProgress(raw: string | null | undefined, cancelled: boolean): SetupProgress {
  if (cancelled) {
    return { stage: "cancelling", message: "Cancelling installation…" };
  }
  const text = boundText(raw || "", MAX_PROGRESS_CHARS);
  if (!text) {
    return { stage: "starting", message: "Preparing installation…" };
  }
  const downloadMatch = text.match(/^Downloading model:\s*(\d+)\s*\/\s*(\d+)\s*MB\b/i);
  if (downloadMatch) {
    return {
      stage: "downloading_model",
      message: text,
      downloadedMb: Number(downloadMatch[1]),
      totalMb: Number(downloadMatch[2]),
    };
  }
  if (/runtime/i.test(text)) {
    return { stage: "installing_runtime", message: text };
  }
  if (/verify|unpack/i.test(text)) {
    return { stage: "verifying_and_unpacking", message: text };
  }
  return { stage: "starting", message: text };
}

function* snapshotActiveJob(current: ActiveJob): HostIoSteps<SetupJobSnapshot> {
  let progress: SetupProgress;
  if (current.mode === "test") {
    progress = {
      stage: "testing_model",
      message: "Loading the model and recognizing its English test sample…",
    };
  } else {
    const raw = current.cancelled ? null : yield* fs().readFile(root() + "/.progress-" + current.nonce);
    progress = parseInstallProgress(raw, current.cancelled);
  }
  return {
    jobId: current.id,
    mode: current.mode,
    modelId: current.model.id,
    modelLabel: current.model.label,
    origin: current.origin,
    state: current.cancelled ? "cancelling" : "running",
    startedAtMs: current.startedAtMs,
    progress,
  };
}

function noticeFromTerminalJob(snapshot: SetupJobSnapshot): ViewNode {
  if (snapshot.state === "cancelled") {
    return { kind: "note", body: "Installation cancelled." };
  }
  if (snapshot.state === "failed") {
    return {
      kind: "note",
      level: "error",
      body: snapshot.failure?.message || "The local dictation runtime returned an error.",
    };
  }
  if (snapshot.mode === "test") {
    return { kind: "note", body: snapshot.output || "The test produced no speech." };
  }
  return { kind: "note", body: snapshot.modelLabel + " installed." };
}

function* cleanupInstallMarkers(nonce: string): HostIoSteps<void> {
  yield* fs().removeFile(root() + "/.cancel-" + nonce);
  yield* fs().removeFile(root() + "/.progress-" + nonce);
}

export function* collectJob(): HostIoSteps<void> {
  if (!activeJob) return;
  const current = activeJob;
  const status = (yield { op: "execPoll", job: current.id }) as ExecPollResult | null | undefined;
  if (activeJob !== current) return;

  if (!status) {
    const failure: SetupFailure = {
      code: "job_lost",
      message: "The host no longer tracks this background job. Check dictation-status before retrying.",
    };
    const terminal: SetupJobSnapshot = {
      jobId: current.id,
      mode: current.mode,
      modelId: current.model.id,
      modelLabel: current.model.label,
      origin: current.origin,
      state: "failed",
      startedAtMs: current.startedAtMs,
      finishedAtMs: host.unixNowMs(),
      progress: { stage: "failed", message: failure.message },
      failure,
    };
    lastJob = terminal;
    glanceNotice = noticeFromTerminalJob(terminal);
    activeJob = null;
    yield { op: "execClose", job: current.id };
    if (current.mode === "install") yield* cleanupInstallMarkers(current.nonce);
    return;
  }

  if (status.done === false) return;
  if (status.done !== true) {
    if (typeof status.error === "string" && status.error.trim().length > 0) {
      const failure = classifyFailure(status.error, status.code, current.mode);
      const terminal: SetupJobSnapshot = {
        jobId: current.id,
        mode: current.mode,
        modelId: current.model.id,
        modelLabel: current.model.label,
        origin: current.origin,
        state: "failed",
        startedAtMs: current.startedAtMs,
        finishedAtMs: host.unixNowMs(),
        progress: { stage: "failed", message: failure.message },
        failure,
      };
      lastJob = terminal;
      glanceNotice = noticeFromTerminalJob(terminal);
      activeJob = null;
      yield { op: "execClose", job: current.id };
      if (current.mode === "install") yield* cleanupInstallMarkers(current.nonce);
    }
    return;
  }

  const finishedAtMs = host.unixNowMs();
  let terminal: SetupJobSnapshot;

  if (status.code === 3) {
    terminal = {
      jobId: current.id,
      mode: current.mode,
      modelId: current.model.id,
      modelLabel: current.model.label,
      origin: current.origin,
      state: "cancelled",
      startedAtMs: current.startedAtMs,
      finishedAtMs,
      progress: { stage: "cancelled", message: "Installation cancelled." },
    };
  } else if (status.error || (status.code !== undefined && status.code !== 0)) {
    const failure = classifyFailure(
      status.stderr || status.error || "The runtime returned an error.",
      status.code,
      current.mode,
    );
    terminal = {
      jobId: current.id,
      mode: current.mode,
      modelId: current.model.id,
      modelLabel: current.model.label,
      origin: current.origin,
      state: "failed",
      startedAtMs: current.startedAtMs,
      finishedAtMs,
      progress: { stage: "failed", message: failure.message },
      failure,
    };
  } else if (current.mode === "test") {
    const output = boundText(status.stdout || "", MAX_OUTPUT_CHARS);
    if (!output) {
      const failure: SetupFailure = {
        code: "test_no_speech",
        message: "The bundled test clip produced no transcript.",
        exitCode: status.code,
      };
      terminal = {
        jobId: current.id,
        mode: current.mode,
        modelId: current.model.id,
        modelLabel: current.model.label,
        origin: current.origin,
        state: "failed",
        startedAtMs: current.startedAtMs,
        finishedAtMs,
        progress: { stage: "failed", message: failure.message },
        failure,
      };
    } else {
      terminal = {
        jobId: current.id,
        mode: current.mode,
        modelId: current.model.id,
        modelLabel: current.model.label,
        origin: current.origin,
        state: "completed",
        startedAtMs: current.startedAtMs,
        finishedAtMs,
        progress: { stage: "completed", message: output },
        output,
      };
    }
  } else {
    const verified = (yield* hasRuntime()) && (yield* hasModel(current.model));
    if (!verified) {
      const failure: SetupFailure = {
        code: "verification_failed",
        message: "The setup process exited without producing a verified local runtime and model.",
        exitCode: status.code,
      };
      terminal = {
        jobId: current.id,
        mode: current.mode,
        modelId: current.model.id,
        modelLabel: current.model.label,
        origin: current.origin,
        state: "failed",
        startedAtMs: current.startedAtMs,
        finishedAtMs,
        progress: { stage: "failed", message: failure.message },
        failure,
      };
    } else {
      terminal = {
        jobId: current.id,
        mode: current.mode,
        modelId: current.model.id,
        modelLabel: current.model.label,
        origin: current.origin,
        state: "completed",
        startedAtMs: current.startedAtMs,
        finishedAtMs,
        progress: { stage: "completed", message: current.model.label + " installed." },
      };
    }
  }

  lastJob = terminal;
  glanceNotice = noticeFromTerminalJob(terminal);
  activeJob = null;
  yield { op: "execClose", job: current.id };
  if (current.mode === "install") yield* cleanupInstallMarkers(current.nonce);
}

function* ensureStagedWorker(): HostIoSteps<
  { ok: true; script: string; source: "staged" } | { ok: false; failure: SetupFailure }
> {
  const dir = stagedWorkerDir();
  const scriptPath = dir + "/parakeet.py";
  const reqPath = dir + "/requirements.txt";
  const currentScript = yield* fs().readFile(scriptPath);
  const currentReq = yield* fs().readFile(reqPath);
  if (currentScript === parakeetWorkerSource && currentReq === runtimeRequirementsSource) {
    return { ok: true, script: scriptPath, source: "staged" };
  }
  if (!(yield* fs().makeDirs(dir))) {
    return {
      ok: false,
      failure: {
        code: "worker_stage_failed",
        message: "The dictation helper directory could not be created under the plugin data root.",
      },
    };
  }
  if (currentScript !== parakeetWorkerSource) {
    if (!(yield* fs().writeFileAtomic(scriptPath, parakeetWorkerSource))) {
      return {
        ok: false,
        failure: {
          code: "worker_stage_failed",
          message: "The bundled dictation worker could not be staged under the plugin data root.",
        },
      };
    }
  }
  if (currentReq !== runtimeRequirementsSource) {
    if (!(yield* fs().writeFileAtomic(reqPath, runtimeRequirementsSource))) {
      return {
        ok: false,
        failure: {
          code: "worker_stage_failed",
          message: "The pinned runtime requirements could not be staged under the plugin data root.",
        },
      };
    }
  }
  return { ok: true, script: scriptPath, source: "staged" };
}

function* resolveWorkerScript(
  bundle?: string,
): HostIoSteps<{ ok: true; script: string; source: "bundle" | "staged" } | { ok: false; failure: SetupFailure }> {
  const normalizedBundle = typeof bundle === "string" ? bundle.trim() : "";
  if (normalizedBundle) {
    return { ok: true, script: normalizedBundle.replace(/\\/g, "/") + "/" + WORKER, source: "bundle" };
  }
  return yield* ensureStagedWorker();
}

function* buildStatusSnapshot(): HostIoSteps<DictationStatusSnapshot> {
  const selected = yield* selectedModel();
  const explicitSelection = yield* hasExplicitSelection();
  const runtimeInstalled = yield* hasRuntime();
  const models: DictationModelStatus[] = [];
  let selectedInstalled = false;

  for (const model of MODELS) {
    const installed = yield* hasModel(model);
    const isSelected = model.id === selected.id;
    if (isSelected) selectedInstalled = installed;
    models.push({
      id: model.id,
      label: model.label,
      languages: model.languages,
      size: model.size,
      bytes: model.bytes,
      sample: model.sample,
      isDefault: model.id === DEFAULT_MODEL_ID,
      installed,
      selected: isSelected,
      ready: installed && runtimeInstalled,
    });
  }

  return {
    ready: runtimeInstalled && selectedInstalled,
    runtimeInstalled,
    runtimeId: RUNTIME,
    defaultModelId: DEFAULT_MODEL_ID,
    selectedModelId: selected.id,
    selectedModelLabel: selected.label,
    hasExplicitSelection: explicitSelection,
    platform: String(host.platform() || ""),
    requirements: {
      defaultModelSize: MODELS[0].size,
      diskSpace: RUNTIME_DISK_ESTIMATE,
      python: RUNTIME_PYTHON_REQUIREMENT,
    },
    models,
    activeJob: activeJob ? yield* snapshotActiveJob(activeJob) : null,
    lastJob,
  };
}

export function* getDictationStatus(): HostIoSteps<DictationStatusSnapshot> {
  yield* collectJob();
  return yield* buildStatusSnapshot();
}

export function* getDictationProgress(): HostIoSteps<DictationProgressSnapshot> {
  yield* collectJob();
  const status = yield* buildStatusSnapshot();
  const state = status.activeJob ? status.activeJob.state : status.lastJob ? status.lastJob.state : "idle";
  return {
    state,
    activeJob: status.activeJob,
    lastJob: status.lastJob,
    ready: status.ready,
    runtimeInstalled: status.runtimeInstalled,
    selectedModelId: status.selectedModelId,
  };
}

function recordImmediateFailure(mode: SetupJobMode, model: Model, origin: SetupOrigin, failure: SetupFailure): void {
  const now = host.unixNowMs();
  lastJob = {
    jobId: "",
    mode,
    modelId: model.id,
    modelLabel: model.label,
    origin,
    state: "failed",
    startedAtMs: now,
    finishedAtMs: now,
    progress: { stage: "failed", message: failure.message },
    failure,
  };
  glanceNotice = { kind: "note", level: "error", body: failure.message };
}

function* beginJob(
  mode: SetupJobMode,
  model: Model,
  origin: SetupOrigin,
  bundle?: string,
): HostIoSteps<{ ok: true; job: SetupJobSnapshot } | { ok: false; failure: SetupFailure }> {
  starting = true;
  glanceNotice = null;
  try {
    if (!(yield* fs().makeDirs(root()))) {
      const failure: SetupFailure = {
        code: "worker_stage_failed",
        message: "The dictation data directory could not be opened.",
      };
      recordImmediateFailure(mode, model, origin, failure);
      return { ok: false, failure };
    }
    const resolved = yield* resolveWorkerScript(bundle);
    if (!resolved.ok) {
      recordImmediateFailure(mode, model, origin, resolved.failure);
      return { ok: false, failure: resolved.failure };
    }
    const nonce = makeNonce();
    const installedRuntime = yield* hasRuntime();
    const bin = mode === "test" || installedRuntime ? runtimePython() : python();
    const args =
      mode === "test"
        ? ["-I", resolved.script, "test", modelPath(model), model.sample]
        : [
            "-I",
            resolved.script,
            "install",
            root(),
            RUNTIME,
            modelPath(model),
            archiveName(model),
            archiveUrl(model),
            String(model.bytes),
            model.sha256,
            model.sample,
            nonce,
          ];
    const start = (yield {
      op: "execStart",
      options: { bin, args, timeoutMs: mode === "install" ? INSTALL_TIMEOUT_MS : TEST_TIMEOUT_MS },
    }) as { jobId?: string; error?: string } | null | undefined;

    if (!start || start.error || !start.jobId) {
      const failure = classifyFailure(
        start?.error || "The local setup process could not start.",
        undefined,
        mode,
      );
      recordImmediateFailure(mode, model, origin, failure);
      return { ok: false, failure };
    }

    activeJob = {
      id: start.jobId,
      nonce,
      mode,
      model,
      origin,
      startedAtMs: host.unixNowMs(),
      cancelled: false,
    };
    return { ok: true, job: yield* snapshotActiveJob(activeJob) };
  } catch (error) {
    const failure = classifyFailure(String(error), undefined, mode);
    recordImmediateFailure(mode, model, origin, failure);
    return { ok: false, failure };
  } finally {
    starting = false;
  }
}

export function* startInstall(
  model: Model,
  origin: SetupOrigin,
  bundle?: string,
): HostIoSteps<StartInstallResult> {
  yield* collectJob();
  if (starting) {
    return {
      ok: false,
      outcome: "busy",
      activeJob: activeJob ? yield* snapshotActiveJob(activeJob) : null,
      message: "A live dictation setup job is already starting.",
    };
  }
  if (activeJob) {
    const current = yield* snapshotActiveJob(activeJob);
    if (activeJob.mode === "install" && activeJob.model.id === model.id) {
      return {
        ok: true,
        outcome: "already_running",
        job: current,
        status: yield* buildStatusSnapshot(),
      };
    }
    return {
      ok: false,
      outcome: "busy",
      activeJob: current,
      message:
        "Another live dictation " +
        current.mode +
        " job (" +
        current.modelId +
        ", " +
        current.state +
        ") is active. Wait for it to finish or cancel the install first.",
    };
  }
  if ((yield* hasRuntime()) && (yield* hasModel(model))) {
    const matchingLast = lastJob && lastJob.mode === "install" && lastJob.modelId === model.id ? lastJob : null;
    return {
      ok: true,
      outcome: "already_installed",
      job: matchingLast,
      status: yield* buildStatusSnapshot(),
    };
  }
  const started = yield* beginJob("install", model, origin, bundle);
  const status = yield* buildStatusSnapshot();
  if (!started.ok) {
    return { ok: false, outcome: "failed", failure: started.failure, status };
  }
  return { ok: true, outcome: "started", job: started.job, status };
}

export function* cancelInstall(): HostIoSteps<CancelInstallResult> {
  yield* collectJob();
  if (!activeJob) {
    return {
      ok: false,
      outcome: "no_active_install",
      lastJob,
      message: "No live dictation installation is currently running.",
    };
  }
  if (activeJob.mode !== "install") {
    return {
      ok: false,
      outcome: "not_cancellable",
      activeJob: yield* snapshotActiveJob(activeJob),
      message: "Only an active installation can be cancelled; a bundled model test completes automatically.",
    };
  }
  if (activeJob.cancelled) {
    return {
      ok: true,
      outcome: "already_cancelling",
      job: yield* snapshotActiveJob(activeJob),
      status: yield* buildStatusSnapshot(),
    };
  }
  const expected = activeJob;
  const wrote = yield* fs().writeFileAtomic(root() + "/.cancel-" + expected.nonce, "");
  if (!wrote) {
    const failure: SetupFailure = {
      code: "runtime_error",
      message: "Could not signal cancellation for the active installation.",
    };
    glanceNotice = { kind: "note", level: "error", body: failure.message };
    return { ok: false, outcome: "failed", failure };
  }
  if (activeJob === expected) {
    activeJob.cancelled = true;
  }
  return {
    ok: true,
    outcome: "cancelling",
    job: yield* snapshotActiveJob(expected),
    status: yield* buildStatusSnapshot(),
  };
}

export function* selectInstalledModel(model: Model): HostIoSteps<SelectModelResult> {
  yield* collectJob();
  if (starting || activeJob) {
    return {
      ok: false,
      outcome: "busy",
      activeJob: activeJob ? yield* snapshotActiveJob(activeJob) : null,
      message: "Wait for the active live dictation job to finish or cancel it before changing the selected model.",
    };
  }
  if (!(yield* hasRuntime()) || !(yield* hasModel(model))) {
    return {
      ok: false,
      outcome: "not_installed",
      message: model.label + " and the local CPU runtime must be installed before selecting this model.",
    };
  }
  const current = yield* selectedModel();
  const explicit = yield* hasExplicitSelection();
  if (explicit && current.id === model.id) {
    glanceNotice = null;
    return { ok: true, outcome: "already_selected", status: yield* buildStatusSnapshot() };
  }
  if (!(yield* fs().makeDirs(root())) || !(yield* fs().writeFileAtomic(selectionPath(), model.id))) {
    const failure: SetupFailure = {
      code: "selection_save_failed",
      message: "The selected model could not be saved.",
    };
    glanceNotice = { kind: "note", level: "error", body: failure.message };
    return { ok: false, outcome: "failed", failure };
  }
  glanceNotice = null;
  return { ok: true, outcome: "selected", status: yield* buildStatusSnapshot() };
}

export function* startModelTest(
  model: Model,
  origin: SetupOrigin,
  bundle?: string,
): HostIoSteps<StartTestResult> {
  yield* collectJob();
  if (starting) {
    return {
      ok: false,
      outcome: "busy",
      activeJob: activeJob ? yield* snapshotActiveJob(activeJob) : null,
      message: "A live dictation job is already starting.",
    };
  }
  if (activeJob) {
    const current = yield* snapshotActiveJob(activeJob);
    if (activeJob.mode === "test" && activeJob.model.id === model.id) {
      return {
        ok: true,
        outcome: "already_running",
        job: current,
        status: yield* buildStatusSnapshot(),
      };
    }
    return {
      ok: false,
      outcome: "busy",
      activeJob: current,
      message:
        "Another live dictation " +
        current.mode +
        " job (" +
        current.modelId +
        ", " +
        current.state +
        ") is active. Wait for it to finish first.",
    };
  }
  if (!(yield* hasRuntime()) || !(yield* hasModel(model))) {
    return {
      ok: false,
      outcome: "not_installed",
      message: model.label + " and the local CPU runtime must be installed before running the bundled sample test.",
    };
  }
  const started = yield* beginJob("test", model, origin, bundle);
  const status = yield* buildStatusSnapshot();
  if (!started.ok) {
    return { ok: false, outcome: "failed", failure: started.failure, status };
  }
  return { ok: true, outcome: "started", job: started.job, status };
}
