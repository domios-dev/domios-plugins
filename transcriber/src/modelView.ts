import type { ExecResult, GlanceView, HostIoSteps, ViewNode } from "@codeterm/plugin-sdk";
import { archiveName, archiveUrl, hasModel, hasRuntime, modelPath, MODELS, python, root, RUNTIME, runtimePython,
  selectedModel, selectionPath, WORKER, type Model } from "./models";

const fs = () => host.io.fs;
let job: { id: string; nonce: string; mode: "install" | "test"; model: Model; cancelled: boolean } | null = null;
let starting = false;
let notice: ViewNode | null = null;

function* collectJob(): HostIoSteps<void> {
  if (!job) return;
  const current = job;
  const status = (yield { op: "execPoll", job: current.id }) as ExecResult & { done?: boolean };
  if (job !== current || !status?.done) return;
  if (status.code === 3) {
    notice = { kind: "note", body: "Installation cancelled." };
  } else if (status.error || status.code !== 0) {
    notice = { kind: "note", level: "error", body: (status.stderr || status.error || "The runtime returned an error.").trim().slice(0, 400) };
  } else if (current.mode === "test") {
    notice = { kind: "note", body: (status.stdout || "The test produced no speech.").trim().slice(0, 360) };
  } else {
    notice = { kind: "note", body: current.model.label + " installed." };
  }
  job = null;
  yield { op: "execClose", job: current.id };
  if (current.mode === "install") {
    yield* fs().removeFile(root() + "/.cancel-" + current.nonce);
    yield* fs().removeFile(root() + "/.progress-" + current.nonce);
  }
}

export function* modelGlance(clip: HostIoSteps<GlanceView>, bundle?: string): HostIoSteps<GlanceView> {
  yield* collectJob();
  const selected = yield* selectedModel();
  const runtime = yield* hasRuntime();
  const nodes: ViewNode[] = [{ kind: "text", text: "Live dictation" }];
  if (!bundle) nodes.push({ kind: "note", level: "warn", body: "This host cannot open the dictation runtime." });
  if (!runtime) nodes.push({ kind: "note", body: "Setup uses local CPU inference and needs a supported 64-bit Python 3.12 installation." });
  const running = job;
  if (running) {
    const progress = yield* fs().readFile(root() + "/.progress-" + running.nonce);
    nodes.push({ kind: "note", body: running.cancelled ? "Cancelling installation…" : progress?.trim().slice(0, 180) ||
      (running.mode === "install" ? "Preparing installation…" : "Loading the model and recognizing its English test sample…") });
    nodes.push({ kind: "button", label: "Refresh status", action: "dictation:refresh" });
    if (running.mode === "install" && !running.cancelled) nodes.push({ kind: "button", label: "Cancel installation", action: "dictation:cancel" });
  }
  if (notice) nodes.push(notice);
  for (const model of MODELS) {
    const installed = yield* hasModel(model);
    const active = model.id === selected.id;
    const details: ViewNode[] = [
      { kind: "text", text: model.label },
      { kind: "text", text: model.languages + " · " + model.size + " · CPU", style: { tone: "muted" } },
    ];
    const controls: ViewNode[] = [];
    if (active) controls.push({ kind: "badge", label: installed && runtime ? "Selected · Installed" : "Selected", tone: installed && runtime ? "ok" : "muted" });
    else if (installed) controls.push({ kind: "badge", label: "Installed", tone: "ok" });
    if (bundle && !starting && !job) {
      if (!installed || !runtime) controls.push({ kind: "button", label: "Install " + model.size, action: "dictation:install:" + model.id });
      else if (!active) controls.push({ kind: "button", label: "Use model", action: "dictation:select:" + model.id });
      else controls.push({ kind: "button", label: "Test model", action: "dictation:test:" + model.id });
    }
    if (controls.length) details.push({ kind: "row", children: controls });
    nodes.push({ kind: "divider" }, { kind: "stack", style: { spacing: "sm" }, children: details });
  }
  const clipView = yield* clip;
  return { title: "Transcriber", nodes: [...nodes, { kind: "divider" }, { kind: "text", text: "Voice notes" }, ...clipView.nodes] };
}

function* begin(mode: "install" | "test", model: Model, bundle: string): HostIoSteps<void> {
  if (job || starting) return;
  starting = true;
  notice = null;
  try {
    const nonce = host.unixNowMs().toString(36) + "-" + Math.random().toString(36).slice(2, 14);
    if (!(yield* fs().makeDirs(root()))) throw new Error("The dictation data directory could not be opened.");
    const script = bundle.replace(/\\/g, "/") + "/" + WORKER;
    const installedRuntime = yield* hasRuntime();
    const bin = installedRuntime ? runtimePython() : python();
    const args = mode === "test"
      ? ["-I", script, "test", modelPath(model), model.sample]
      : ["-I", script, "install", root(), RUNTIME, modelPath(model), archiveName(model),
        archiveUrl(model), String(model.bytes), model.sha256, model.sample, nonce];
    const start = (yield { op: "execStart", options: { bin, args, timeoutMs: mode === "install" ? 900_000 : 20_000 } }) as { jobId?: string };
    if (!start.jobId) throw new Error("The local setup process could not start.");
    job = { id: start.jobId, nonce, mode, model, cancelled: false };
  } catch (error) {
    notice = { kind: "note", level: "error", body: String(error).slice(0, 400) };
  } finally { starting = false; }
}

export function* modelGlanceAction(action: string, clip: HostIoSteps<GlanceView>, bundle?: string): HostIoSteps<GlanceView> {
  yield* collectJob();
  const [, verb, id] = action.split(":");
  const model = MODELS.find(candidate => candidate.id === id);
  if (verb === "cancel" && job?.mode === "install" && !job.cancelled) {
    const expected = job;
    if ((yield* fs().writeFileAtomic(root() + "/.cancel-" + expected.nonce, "")) && job === expected) job.cancelled = true;
  } else if (model && bundle && !job && !starting) {
    if (verb === "install") yield* begin("install", model, bundle);
    else if ((verb === "select" || verb === "test") && (yield* hasRuntime()) && (yield* hasModel(model))) {
      if (verb === "select") {
        if (!(yield* fs().writeFileAtomic(selectionPath(), model.id))) {
          notice = { kind: "note", level: "error", body: "The selected model could not be saved." };
        } else notice = null;
      } else yield* begin("test", model, bundle);
    }
  }
  return yield* modelGlance(clip, bundle);
}
