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

// transcriber/src/plugin.ts
var plugin_exports = {};
__export(plugin_exports, {
  default: () => plugin_default
});
module.exports = __toCommonJS(plugin_exports);

// transcriber/src/dictionary.ts
var MAX_DICTIONARY_RULES = 200;
var MAX_RULE_CHARS = 128;
function isWordChar(ch) {
  if (!ch) return false;
  if (ch >= "0" && ch <= "9" || ch === "_") return true;
  return ch.toLowerCase() !== ch.toUpperCase();
}
function alignedLower(text) {
  const lower = text.toLowerCase();
  if (lower.length === text.length) return lower;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const mapped = text[i].toLowerCase();
    out += mapped.length === 1 ? mapped : text[i];
  }
  return out;
}
function addRule(byKey, wrongRaw, rightRaw, order) {
  const wrong = wrongRaw.trim();
  const right = rightRaw.trim();
  if (!wrong || !right || wrong.length > MAX_RULE_CHARS || right.length > MAX_RULE_CHARS) {
    return order;
  }
  const key = alignedLower(wrong);
  if (!byKey.has(key) && byKey.size >= MAX_DICTIONARY_RULES) {
    return order;
  }
  byKey.set(key, { order, wrong: key, right });
  return order + 1;
}
function parseDictionary(raw) {
  const byKey = /* @__PURE__ */ new Map();
  let order = 0;
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i++) {
      const item = raw[i];
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const entry = item;
      if (typeof entry.from !== "string" || typeof entry.to !== "string") continue;
      order = addRule(byKey, entry.from, entry.to, order);
    }
  } else if (typeof raw === "string" && raw.trim()) {
    const entries = raw.split(/\r\n|\n|\r|;/);
    for (let i = 0; i < entries.length; i++) {
      const line = entries[i].trim();
      if (!line) continue;
      let sep = line.indexOf("=>");
      if (sep < 0) sep = line.indexOf("->");
      if (sep < 0) continue;
      order = addRule(byKey, line.slice(0, sep), line.slice(sep + 2), order);
    }
  } else {
    return [];
  }
  const rules = Array.from(byKey.values());
  rules.sort((a, b) => b.wrong.length - a.wrong.length || a.order - b.order);
  return rules.map((r) => [r.wrong, r.right]);
}
function applyDictionary(text, rules) {
  if (!text || !rules.length) return text;
  const lower = alignedLower(text);
  let out = "";
  let i = 0;
  while (i < text.length) {
    let matched = null;
    for (let r = 0; r < rules.length; r++) {
      const rule = rules[r];
      const wrong = rule[0];
      if (!wrong || !lower.startsWith(wrong, i)) continue;
      const end = i + wrong.length;
      if (isWordChar(wrong[0]) && i > 0 && isWordChar(text[i - 1])) continue;
      if (isWordChar(wrong[wrong.length - 1]) && end < text.length && isWordChar(text[end])) continue;
      matched = rule;
      break;
    }
    if (matched) {
      out += matched[1];
      i += matched[0].length;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}
function configuredDictionaryRules() {
  try {
    const parsed = JSON.parse(host.settingsJson());
    return parseDictionary(parsed?.dictionary);
  } catch {
    return [];
  }
}

// transcriber/src/models.ts
var RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/";
var WORKER = "runtime/parakeet.py";
var RUNTIME = "runtime-py312-sherpa-2.0.2";
var root = () => host.dataDir() + "/transcriber/live-dictation";
var selectionPath = () => root() + "/selected";
var dictionaryPath = () => root() + "/dictionary.json";
var python = () => host.path.isWindows ? "python.exe" : "python3.12";
var runtimePython = () => root() + "/" + RUNTIME + (host.path.isWindows ? "/Scripts/python.exe" : "/bin/python3.12");
var MODELS = [
  {
    id: "parakeet-tdt-0.6b-v3-int8",
    label: "Parakeet TDT 0.6B v3",
    languages: "25 European languages, including Russian and English",
    size: "487 MB",
    bytes: 487211443,
    sha256: "1495e91b59d7fc53ddca91f3431758ec99f8fa253fdb0e1e851be0f72b14b0f9",
    sample: "en.wav"
  },
  {
    id: "parakeet-tdt-0.6b-v2-int8",
    label: "Parakeet TDT 0.6B v2",
    languages: "English",
    size: "482 MB",
    bytes: 482440461,
    sha256: "6fc4426b54aa549a0019b8a75b8dea59164e71790a37ac56a045ad57f915f714",
    sample: "0.wav"
  }
];
var archiveName = (model) => "sherpa-onnx-nemo-" + model.id;
var archiveUrl = (model) => RELEASE + archiveName(model) + ".tar.bz2";
var modelPath = (model) => root() + "/" + model.id + "-" + model.sha256.slice(0, 12);
function* selectedModel() {
  const selected = (yield* host.io.fs.readFile(selectionPath()))?.trim();
  return MODELS.find((model) => model.id === selected) ?? MODELS[0];
}
function* hasRuntime() {
  return yield* host.io.fs.fileExists(runtimePython());
}
function* hasModel(model) {
  const path = modelPath(model);
  if ((yield* host.io.fs.readFile(path + "/.verified"))?.trim() !== model.sha256) return false;
  for (const file of ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"]) {
    if (!(yield* host.io.fs.fileExists(path + "/" + file))) return false;
  }
  return true;
}

// transcriber/src/dictation.ts
function* dictationLaunch() {
  const model = yield* selectedModel();
  if (!(yield* hasRuntime()) || !(yield* hasModel(model))) {
    return { state: "setup", reason: model.label + " and its local CPU runtime need to be installed." };
  }
  const args = ["stream", modelPath(model)];
  const rules = configuredDictionaryRules();
  if (rules.length) {
    const path = dictionaryPath();
    const ok = yield* host.io.fs.writeFileAtomic(path, JSON.stringify(rules));
    if (ok !== false) args.push(path);
  }
  return { state: "ready", bin: runtimePython(), script: WORKER, args };
}

// transcriber/src/modelView.ts
var fs = () => host.io.fs;
var job = null;
var starting = false;
var notice = null;
function* collectJob() {
  if (!job) return;
  const current = job;
  const status = yield { op: "execPoll", job: current.id };
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
function* modelGlance(clip, bundle) {
  yield* collectJob();
  const selected = yield* selectedModel();
  const runtime = yield* hasRuntime();
  const nodes = [{ kind: "text", text: "Live dictation" }];
  if (!bundle) nodes.push({ kind: "note", level: "warn", body: "This host cannot open the dictation runtime." });
  if (!runtime) nodes.push({ kind: "note", body: "Setup uses local CPU inference and needs a supported 64-bit Python 3.12 installation." });
  const running = job;
  if (running) {
    const progress2 = yield* fs().readFile(root() + "/.progress-" + running.nonce);
    nodes.push({ kind: "note", body: running.cancelled ? "Cancelling installation\u2026" : progress2?.trim().slice(0, 180) || (running.mode === "install" ? "Preparing installation\u2026" : "Loading the model and recognizing its English test sample\u2026") });
    nodes.push({ kind: "button", label: "Refresh status", action: "dictation:refresh" });
    if (running.mode === "install" && !running.cancelled) nodes.push({ kind: "button", label: "Cancel installation", action: "dictation:cancel" });
  }
  if (notice) nodes.push(notice);
  for (const model of MODELS) {
    const installed = yield* hasModel(model);
    const active = model.id === selected.id;
    const details = [
      { kind: "text", text: model.label },
      { kind: "text", text: model.languages + " \xB7 " + model.size + " \xB7 CPU", style: { tone: "muted" } }
    ];
    const controls = [];
    if (active) controls.push({ kind: "badge", label: installed && runtime ? "Selected \xB7 Installed" : "Selected", tone: installed && runtime ? "ok" : "muted" });
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
function* begin(mode, model, bundle) {
  if (job || starting) return;
  starting = true;
  notice = null;
  try {
    const nonce = host.unixNowMs().toString(36) + "-" + Math.random().toString(36).slice(2, 14);
    if (!(yield* fs().makeDirs(root()))) throw new Error("The dictation data directory could not be opened.");
    const script = bundle.replace(/\\/g, "/") + "/" + WORKER;
    const installedRuntime = yield* hasRuntime();
    const bin = installedRuntime ? runtimePython() : python();
    const args = mode === "test" ? ["-I", script, "test", modelPath(model), model.sample] : [
      "-I",
      script,
      "install",
      root(),
      RUNTIME,
      modelPath(model),
      archiveName(model),
      archiveUrl(model),
      String(model.bytes),
      model.sha256,
      model.sample,
      nonce
    ];
    const start = yield { op: "execStart", options: { bin, args, timeoutMs: mode === "install" ? 9e5 : 2e4 } };
    if (!start.jobId) throw new Error("The local setup process could not start.");
    job = { id: start.jobId, nonce, mode, model, cancelled: false };
  } catch (error) {
    notice = { kind: "note", level: "error", body: String(error).slice(0, 400) };
  } finally {
    starting = false;
  }
}
function* modelGlanceAction(action, clip, bundle) {
  yield* collectJob();
  const [, verb, id] = action.split(":");
  const model = MODELS.find((candidate) => candidate.id === id);
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

// transcriber/src/plugin.ts
var WHISPER_RELEASE = "v1.9.1";
var WHISPER_BASE = "https://github.com/ggml-org/whisper.cpp/releases/download/" + WHISPER_RELEASE;
var FFMPEG_WIN_ZIP = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
var FFMPEG_LINUX_TAR = "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz";
function settings() {
  try {
    return JSON.parse(host.settingsJson()) || {};
  } catch (e) {
    return {};
  }
}
function modelId() {
  const s = settings();
  return s.model && s.model.length ? s.model : "small";
}
function language() {
  const s = settings();
  if (s.language && s.language.length) return s.language;
  const env = host.envGet("CODETERM_TRANSCRIBE_LANG");
  return env && env.length ? env : "auto";
}
function endpoint() {
  const s = settings();
  const ep = s.endpoint && s.endpoint.length ? s.endpoint : host.envGet("CODETERM_TRANSCRIBE_ENDPOINT");
  return ep && ep.length ? ep.trim() : "";
}
function baseDir() {
  return host.dataDir() + "/transcriber";
}
function binDir() {
  return baseDir() + "/bin";
}
function tmpDir() {
  return baseDir() + "/tmp";
}
function modelPath2() {
  return baseDir() + "/ggml-" + modelId() + ".bin";
}
function modelDonePath() {
  return modelPath2() + ".done";
}
function entryName(entry) {
  return typeof entry === "string" ? entry : entry.name;
}
function* cleanupOrphanModels(activeModel) {
  const dir = baseDir();
  let entries;
  try {
    entries = yield* host.io.fs.readDir(dir);
  } catch (e) {
    return;
  }
  const activeName = activeModel.substring(activeModel.lastIndexOf("/") + 1);
  for (const entry of entries) {
    const name = entryName(entry);
    if (!/^ggml-.*\.bin$/.test(name)) continue;
    if (name === activeName) continue;
    const path = typeof entry === "string" ? dir + "/" + name : entry.path || dir + "/" + name;
    if (path === activeModel || path.endsWith(".part")) continue;
    yield* host.io.fs.removeFile(path);
    yield* host.io.fs.removeFile(path + ".done");
  }
}
function osKind() {
  const p = String(host.platform() || "").toLowerCase();
  if (p.indexOf("win") !== -1) return "windows";
  if (p.indexOf("mac") !== -1 || p.indexOf("darwin") !== -1 || p.indexOf("osx") !== -1)
    return "macos";
  return "linux";
}
function exeSuffix() {
  return osKind() === "windows" ? ".exe" : "";
}
function* exec(opts) {
  try {
    return yield* host.io.exec(opts);
  } catch (error) {
    return { error: String(error) };
  }
}
function* runBin(bin, args, timeoutMs) {
  return yield* exec({ bin, args, timeoutMs });
}
function ranOk(r) {
  return !r.error;
}
function exitedOk(r) {
  return !r.error && (r.code === void 0 || r.code === 0);
}
function* progress(opts) {
  yield { op: "progress", options: { ...opts } };
}
function* errorResult(message) {
  yield* progress({ label: "Error", error: message });
  return { error: message };
}
function* findLocalBin(name) {
  const root2 = binDir();
  const suffix = exeSuffix();
  const direct = root2 + "/" + name + suffix;
  if (yield* host.io.fs.fileExists(direct)) return direct;
  const fixedCandidates = [
    root2 + "/bin/" + name + suffix,
    root2 + "/Release/" + name + suffix
  ];
  for (const c of fixedCandidates) {
    if (yield* host.io.fs.fileExists(c)) return c;
  }
  let entries;
  try {
    entries = yield* host.io.fs.readDir(root2);
  } catch (e) {
    return null;
  }
  for (const entry of entries) {
    const child = entryName(entry);
    if (!child || child.indexOf("/") !== -1 || child.indexOf("\\") !== -1) continue;
    const base = root2 + "/" + child;
    const candidates = [
      base + "/" + name + suffix,
      base + "/bin/" + name + suffix,
      base + "/Release/" + name + suffix
    ];
    for (const c of candidates) {
      if (yield* host.io.fs.fileExists(c)) return c;
    }
  }
  return null;
}
function* download(url, dest) {
  yield* host.io.fs.makeDirs(dirOf(dest));
  yield* host.io.fs.removeFile(dest);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const r = yield* exec({ bin: "curl", args: ["-fL", "--retry", "2", "--retry-delay", "2", "-o", dest, url], timeoutMs: 18e5 });
    if (exitedOk(r)) return { ok: true };
    yield* host.io.fs.removeFile(dest);
    if (attempt === 2 && osKind() === "windows") {
      const ps = yield* downloadWithPowerShell(url, dest);
      if ("error" in ps) {
        return {
          error: "download failed (" + url + "): curl: " + (r.stderr || r.error || "exit " + r.code) + "; powershell: " + ps.error
        };
      }
      return ps;
    }
    if (attempt === 2) {
      return { error: "download failed (" + url + "): " + (r.stderr || r.error || "curl exit " + r.code) };
    }
  }
  return { ok: true };
}
function* downloadWithPowerShell(url, dest) {
  const script = "$ProgressPreference='SilentlyContinue';Invoke-WebRequest -Uri " + psQuote(url) + " -OutFile " + psQuote(dest) + " -UseBasicParsing";
  const r = yield* exec({
    bin: "powershell.exe",
    args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    timeoutMs: 18e5
  });
  if (!exitedOk(r) || !(yield* host.io.fs.fileExists(dest))) {
    return { error: r.stderr || r.error || "powershell exit " + r.code };
  }
  return { ok: true };
}
function psQuote(value) {
  return "'" + value.replace(/'/g, "''") + "'";
}
function* untar(archive, dest) {
  yield* host.io.fs.makeDirs(dest);
  const r = yield* exec({ bin: "tar", args: ["-xf", archive, "-C", dest], timeoutMs: 6e5 });
  if (!exitedOk(r)) {
    return { error: "extract failed (" + archive + "): " + (r.stderr || r.error || "tar exit " + r.code) };
  }
  return { ok: true };
}
function dirOf(p) {
  const i = p.lastIndexOf("/");
  return i > 0 ? p.substring(0, i) : ".";
}
function* brewPrefixes() {
  const out = [];
  for (const brew of ["/opt/homebrew/bin/brew", "/usr/local/bin/brew", "brew"]) {
    const r = yield* exec({ bin: brew, args: ["--prefix"], timeoutMs: 15e3 });
    const prefix = ranOk(r) ? String(r.stdout || "").trim() : "";
    if (prefix) {
      out.push(prefix + "/bin");
      break;
    }
  }
  return out;
}
function* unixBinCandidates(name) {
  const home = host.homeDir && host.homeDir() || "";
  const dirs = (yield* brewPrefixes()).concat([
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    home ? home.replace(/\/+$/, "") + "/.local/bin" : ""
  ]);
  const seen = {};
  const out = [];
  for (const dir of dirs) {
    if (!dir || seen[dir]) continue;
    seen[dir] = true;
    out.push(dir + "/" + name);
  }
  return out;
}
function* resolveUnixBin(name) {
  const local = yield* findLocalBin(name);
  if (local) return local;
  const candidates = yield* unixBinCandidates(name);
  for (const candidate of candidates) {
    if (yield* host.io.fs.fileExists(candidate)) return candidate;
  }
  return null;
}
function* lookedIn(name) {
  return (yield* unixBinCandidates(name)).concat([binDir() + "/" + name]).join(", ");
}
function* ensureFfmpeg() {
  if (ranOk(yield* exec({ bin: "ffmpeg", args: ["-version"] }))) return { bin: "ffmpeg" };
  const local = yield* findLocalBin("ffmpeg");
  if (local) return { bin: local };
  const os = osKind();
  if (os === "macos") {
    const found = yield* resolveUnixBin("ffmpeg");
    if (found) return { bin: found };
    yield* progress({ label: "Installing ffmpeg\u2026" });
    const r = yield* exec({ bin: "brew", args: ["install", "ffmpeg"], timeoutMs: 18e5 });
    if (exitedOk(r)) {
      const installed2 = yield* resolveUnixBin("ffmpeg");
      if (installed2) return { bin: installed2 };
      if (ranOk(yield* exec({ bin: "ffmpeg", args: ["-version"] }))) return { bin: "ffmpeg" };
    }
    return { error: "ffmpeg is required. Install it with `brew install ffmpeg`. Looked in: " + (yield* lookedIn("ffmpeg")) };
  }
  if (os === "windows") {
    yield* progress({ label: "Installing ffmpeg\u2026" });
    const zip = baseDir() + "/ffmpeg.zip";
    const dl2 = yield* download(FFMPEG_WIN_ZIP, zip);
    if ("error" in dl2) return ffmpegManual(dl2.error);
    const ex2 = yield* untar(zip, binDir());
    if ("error" in ex2) return ffmpegManual(ex2.error);
    yield* host.io.fs.removeFile(zip);
    const installed2 = yield* findLocalBin("ffmpeg");
    if (installed2) return { bin: installed2 };
    return ffmpegManual("ffmpeg binary not found after extraction");
  }
  yield* progress({ label: "Installing ffmpeg\u2026" });
  const tar = baseDir() + "/ffmpeg.tar.xz";
  const dl = yield* download(FFMPEG_LINUX_TAR, tar);
  if ("error" in dl) return ffmpegManual(dl.error);
  const ex = yield* untar(tar, binDir());
  if ("error" in ex) return ffmpegManual(ex.error);
  yield* host.io.fs.removeFile(tar);
  const installed = yield* findLocalBin("ffmpeg");
  if (installed) return { bin: installed };
  return ffmpegManual("ffmpeg binary not found after extraction");
}
function ffmpegManual(why) {
  return {
    error: "ffmpeg is required to decode the audio but could not be installed automatically (" + why + "). Install ffmpeg from your package manager (e.g. `apt install ffmpeg`) or https://ffmpeg.org/download.html."
  };
}
function* ensureEngine() {
  if (ranOk(yield* exec({ bin: "whisper-cli", args: ["--help"] }))) return { bin: "whisper-cli" };
  const local = yield* findLocalBin("whisper-cli");
  if (local) return { bin: local };
  const os = osKind();
  if (os === "macos") {
    const found = yield* resolveUnixBin("whisper-cli");
    if (found) return { bin: found };
    yield* progress({ label: "Installing whisper.cpp\u2026" });
    const r = yield* exec({ bin: "brew", args: ["install", "whisper-cpp"], timeoutMs: 18e5 });
    if (exitedOk(r)) {
      const installed2 = yield* resolveUnixBin("whisper-cli");
      if (installed2) return { bin: installed2 };
      if (ranOk(yield* exec({ bin: "whisper-cli", args: ["--help"] }))) return { bin: "whisper-cli" };
    }
    return { error: "whisper-cli is required. Install it with `brew install whisper-cpp`. Looked in: " + (yield* lookedIn("whisper-cli")) };
  }
  yield* progress({ label: "Installing whisper.cpp\u2026" });
  const asset = os === "windows" ? "whisper-bin-x64.zip" : "whisper-bin-Linux.zip";
  const archive = baseDir() + "/whisper.zip";
  const dl = yield* download(WHISPER_BASE + "/" + asset, archive);
  if ("error" in dl) return engineManual(os, dl.error);
  const ex = yield* untar(archive, binDir());
  if ("error" in ex) return engineManual(os, ex.error);
  yield* host.io.fs.removeFile(archive);
  const installed = yield* findLocalBin("whisper-cli");
  if (installed) return { bin: installed };
  return engineManual(os, "whisper-cli not found after extraction");
}
function engineManual(os, why) {
  return {
    error: "whisper-cli (whisper.cpp) is required but could not be installed automatically on " + os + " (" + why + "). Build/download whisper.cpp from https://github.com/ggml-org/whisper.cpp/releases and place `whisper-cli" + exeSuffix() + "` in " + binDir() + "."
  };
}
function* ensureModel(force = false) {
  const mp = modelPath2();
  const done = modelDonePath();
  if (!force && (yield* host.io.fs.fileExists(mp)) && (yield* host.io.fs.fileExists(done))) {
    yield* cleanupOrphanModels(mp);
    return { ok: true };
  }
  yield* host.io.fs.removeFile(mp);
  yield* host.io.fs.removeFile(done);
  yield* host.io.fs.makeDirs(baseDir());
  const url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-" + modelId() + ".bin";
  yield* progress({ label: "Downloading model ggml-" + modelId() + " (~" + modelSizeMb(modelId()) + "MB)\u2026" });
  const dl = yield* download(url, mp);
  if ("error" in dl) {
    yield* host.io.fs.removeFile(mp);
    return {
      error: "could not download the whisper model `ggml-" + modelId() + ".bin`: " + dl.error + ". Download it manually to " + mp + "."
    };
  }
  yield* host.io.fs.writeFile(done, "");
  yield* cleanupOrphanModels(mp);
  return { ok: true };
}
function modelSizeMb(id) {
  const sizes = {
    tiny: 75,
    "tiny.en": 75,
    base: 142,
    "base.en": 142,
    small: 466,
    "small.en": 466,
    medium: 1500,
    "medium.en": 1500,
    large: 2900,
    "large-v1": 2900,
    "large-v2": 2900,
    "large-v3": 3100,
    "large-v3-turbo": 1600
  };
  return sizes[id] || 466;
}
function* modelFileBytes(path) {
  const dir = baseDir();
  const activeName = path.substring(path.lastIndexOf("/") + 1);
  let entries;
  try {
    entries = yield* host.io.fs.readDir(dir);
  } catch (e) {
    return null;
  }
  for (const entry of entries) {
    if (typeof entry === "string") continue;
    if (entry.name === activeName && typeof entry.size === "number") return entry.size;
  }
  return null;
}
function* modelFileLabel() {
  const mp = modelPath2();
  const done = modelDonePath();
  if (!(yield* host.io.fs.fileExists(mp))) return "missing (~" + modelSizeMb(modelId()) + "MB)";
  if (!(yield* host.io.fs.fileExists(done))) return "partial (~" + modelSizeMb(modelId()) + "MB)";
  const bytes = yield* modelFileBytes(mp);
  if (bytes !== null) return "present (" + bytes + " bytes, expected ~" + modelSizeMb(modelId()) + "MB)";
  return "present (~" + modelSizeMb(modelId()) + "MB)";
}
var SPEECH_PEAK_THRESHOLD_DB = -45;
function parseMaxVolumeDb(stderr) {
  const m = stderr.match(/max_volume:\s*(-?\d+[.,]\d+|-?\d+)\s*dB/i);
  if (!m) return null;
  return parseFloat(m[1].replace(",", "."));
}
function* hasSpeech(ffmpegBin, wav) {
  const r = yield* runBin(ffmpegBin, ["-i", wav, "-af", "volumedetect", "-f", "null", "-"], 1e4);
  if (r.error) return true;
  const maxDb = parseMaxVolumeDb(r.stderr || "");
  if (maxDb === null) return true;
  return maxDb > SPEECH_PEAK_THRESHOLD_DB;
}
function joinSegments(raw) {
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data.transcription)) {
      return data.transcription.map((s) => typeof s.text === "string" ? s.text : "").join("").trim();
    }
    if (typeof data.text === "string") return data.text.trim();
    return "";
  } catch (e) {
    return "";
  }
}
function parseRemote(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { error: "unparseable daemon response: " + (raw ? raw.substring(0, 200) : "empty body") };
  }
  if (typeof data.error === "string" && data.error.length) return { error: data.error };
  if (typeof data.text !== "string") return { error: "daemon response missing `text`: " + raw.substring(0, 200) };
  const text = data.text.trim();
  if (!text.length) return { error: "daemon returned an empty transcript (no speech detected or upload rejected)" };
  return { text };
}
function* transcribeRemote(ep, path, lang) {
  const l = lang && lang.length ? lang : language();
  const args = ["-sS", "-m", "600", "-F", "file=@" + path];
  if (l && l.length && l !== "auto") args.push("-F", "language=" + l);
  args.push(ep);
  yield* progress({ label: "Transcribing on remote\u2026" });
  const r = yield* exec({ bin: "curl", args, timeoutMs: 66e4 });
  if (!exitedOk(r)) {
    return yield* errorResult(
      "remote transcription failed (" + ep + "): " + (r.stderr || r.error || "curl exit " + r.code)
    );
  }
  const parsed = parseRemote(r.stdout || "");
  if ("error" in parsed) return yield* errorResult("remote transcription failed (" + ep + "): " + parsed.error);
  yield* progress({ label: "Done", done: true });
  return { text: applyDictionary(parsed.text, configuredDictionaryRules()) };
}
function* transcribe(path, lang) {
  const ep = endpoint();
  if (ep.length) return yield* transcribeRemote(ep, path, lang);
  const ffmpeg = yield* ensureFfmpeg();
  if ("error" in ffmpeg) return yield* errorResult(ffmpeg.error);
  const engine = yield* ensureEngine();
  if ("error" in engine) return yield* errorResult(engine.error);
  const model = yield* ensureModel();
  if ("error" in model) return yield* errorResult(model.error);
  yield* host.io.fs.makeDirs(tmpDir());
  const base = tmpDir() + "/job-" + host.unixNowMs();
  const wav = base + ".wav";
  const json = base + ".json";
  const conv = yield* runBin(ffmpeg.bin, ["-y", "-i", path, "-ar", "16000", "-ac", "1", "-f", "wav", wav], 12e4);
  if (!exitedOk(conv)) {
    yield* host.io.fs.removeFile(wav);
    return yield* errorResult("ffmpeg could not decode the audio: " + (conv.stderr || conv.error || "exit " + conv.code));
  }
  if (!(yield* hasSpeech(ffmpeg.bin, wav))) {
    yield* host.io.fs.removeFile(wav);
    return { text: "" };
  }
  const l = lang && lang.length ? lang : language();
  yield* progress({ label: "Transcribing\u2026" });
  const tr = yield* runBin(engine.bin, ["-m", modelPath2(), "-f", wav, "-l", l, "-nt", "-oj", "-of", base], 6e5);
  if (!exitedOk(tr)) {
    yield* host.io.fs.removeFile(wav);
    yield* host.io.fs.removeFile(json);
    return yield* errorResult("whisper-cli failed: " + (tr.stderr || tr.error || "exit " + tr.code));
  }
  const raw = yield* host.io.fs.readFile(json);
  yield* host.io.fs.removeFile(wav);
  yield* host.io.fs.removeFile(json);
  if (!raw) return yield* errorResult("whisper-cli produced no transcript output");
  yield* progress({ label: "Done", done: true });
  return { text: applyDictionary(joinSegments(raw), configuredDictionaryRules()) };
}
function* present(name) {
  if (ranOk(yield* exec({ bin: name, args: name === "ffmpeg" ? ["-version"] : ["--help"] }))) return true;
  return (yield* findLocalBin(name)) !== null;
}
function* transcribeStatus() {
  const ep = endpoint();
  if (ep.length) return { state: "ready", reason: "remote: " + ep };
  const hasFfmpeg = yield* present("ffmpeg");
  const hasEngine = yield* present("whisper-cli");
  const hasModel2 = (yield* host.io.fs.fileExists(modelPath2())) && (yield* host.io.fs.fileExists(modelDonePath()));
  if (hasFfmpeg && hasEngine && hasModel2) return { state: "ready" };
  const missing = [];
  if (!hasEngine) missing.push("whisper-cli");
  if (!hasFfmpeg) missing.push("ffmpeg");
  if (!hasModel2) missing.push("model ggml-" + modelId() + ".bin");
  return { state: "unloaded", reason: "needs: " + missing.join(", ") + " (installed on first use)" };
}
function* renderGlance() {
  const ep = endpoint();
  if (ep.length) {
    const nodes2 = [
      { kind: "badge", label: "Remote", tone: "ok" },
      { kind: "keyVal", key: "Endpoint", value: ep },
      { kind: "keyVal", key: "Language", value: language() },
      { kind: "note", body: "GPU offload \u2014 local whisper.cpp/model are not used." },
      { kind: "divider" },
      { kind: "button", label: "Settings", action: "settings" }
    ];
    return { title: "Transcriber", nodes: nodes2 };
  }
  const st = yield* transcribeStatus();
  const ready = st.state === "ready";
  const hasModel2 = (yield* host.io.fs.fileExists(modelPath2())) && (yield* host.io.fs.fileExists(modelDonePath()));
  const badge = st.state === "unavailable" ? "Unavailable" : ready ? "Ready" : hasModel2 ? "Idle" : "Not installed";
  const nodes = [];
  nodes.push({
    kind: "badge",
    label: badge,
    tone: ready ? "ok" : st.state === "unavailable" ? "danger" : "warn"
  });
  nodes.push({ kind: "keyVal", key: "Model", value: "ggml-" + modelId() });
  nodes.push({ kind: "keyVal", key: "Model file", value: yield* modelFileLabel() });
  nodes.push({ kind: "keyVal", key: "Language", value: language() });
  if (st.reason) nodes.push({ kind: "note", body: st.reason });
  nodes.push({ kind: "divider" });
  if (!hasModel2) nodes.push({ kind: "button", label: "Install", action: "install" });
  nodes.push({ kind: "button", label: "Reinstall", action: "reinstall" });
  nodes.push({ kind: "button", label: "Settings", action: "settings" });
  return { title: "Transcriber", nodes };
}
function* glanceAction(action) {
  if (action === "install" || action === "reinstall") {
    const ffmpeg = yield* ensureFfmpeg();
    if (!("error" in ffmpeg)) {
      const engine = yield* ensureEngine();
      if (!("error" in engine)) yield* ensureModel(action === "reinstall");
    }
  }
  return yield* renderGlance();
}
var plugin = {
  transcribe: (path, lang) => host.io.run(transcribe(path, lang)),
  transcribeStatus: () => host.io.run(transcribeStatus()),
  dictationLaunch: () => host.io.run(dictationLaunch()),
  renderGlance: (_ctx, bundle) => host.io.run(modelGlance(renderGlance(), bundle)),
  glanceAction: (action, _ctx, bundle) => host.io.run(
    action.startsWith("dictation:") ? modelGlanceAction(action, renderGlance(), bundle) : modelGlance(glanceAction(action), bundle)
  )
};
var plugin_default = plugin;
