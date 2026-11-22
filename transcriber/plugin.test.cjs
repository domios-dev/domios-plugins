// Plugin-side tests for the one-shot whisper-cli Transcriber, exercised against a
// FAKE host (exec + an in-memory filesystem). The unit under test is the plugin's
// pure bootstrap/transcribe logic — no real ffmpeg/whisper-cli/brew/curl runs.
// Run: npx tsx transcriber/plugin.test.cjs
const { readFileSync } = require("fs");
const { join } = require("path");
const { runInThisContext } = require("node:vm");

const HOME = "/home/test";
const DATA_DIR = "/instances/custom-data";
const MODEL = DATA_DIR + "/transcriber/ggml-small.bin";
const BASE_MODEL = DATA_DIR + "/transcriber/ggml-base.bin";
const MANIFEST = JSON.parse(readFileSync(join(__dirname, "plugin.json"), "utf8"));
const SUBPROCESS_ALLOW = MANIFEST.permissions.subprocess.allow;

// ── Configurable fake host ─────────────────────────────────────────────
const execCalls = [];
const progressCalls = [];
let execHandler = () => JSON.stringify({ code: 0, stdout: "", stderr: "" });
let settingsObj = {};
let platformStr = "macos";
let files = {}; // path -> contents (in-memory fs)
const removedFiles = [];

globalThis.host = {
  settingsJson: () => JSON.stringify(settingsObj),
  platform: () => platformStr,
  homeDir: () => HOME,
  dataDir: () => DATA_DIR,
  expandHome: (p) => p,
  envGet: () => null,
  unixNow: () => 1700000000,
  unixNowMs: () => 1700000000000,
  log: () => {},
  fileExists: (p) => Object.prototype.hasOwnProperty.call(files, p),
  readFile: (p) => (Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null),
  writeFile: (p, c) => { files[p] = c; return true; },
  removeFile: (p) => { removedFiles.push(p); delete files[p]; return true; },
  readDir: (p) => {
    const prefix = p.endsWith("/") ? p : p + "/";
    const names = new Set();
    for (const f of Object.keys(files)) {
      if (!f.startsWith(prefix)) continue;
      const rest = f.substring(prefix.length);
      if (!rest.length) continue;
      const slash = rest.indexOf("/");
      names.add(slash === -1 ? rest : rest.substring(0, slash));
    }
    return Array.from(names);
  },
  makeDirs: () => true,
  writeTempFile: (c, suffix) => { const p = "/tmp/ct" + (suffix || ""); files[p] = c; return p; },
  progress: (opts) => { progressCalls.push(opts); },
  exec: (json) => {
    const opts = JSON.parse(json);
    execCalls.push(opts);
    return execHandler(opts);
  },
};

const fakeJobs = new Map();
const closedJobs = [];
const legacyFake = globalThis.host;
let execStartHandler = null;
let writeFileAtomicHandler = null;

Object.assign(legacyFake, {
  path: { get isWindows() { return platformStr === "windows"; } },
  io: {
    run(generator) {
      let next = generator.next();
      while (!next.done) next = generator.next(dispatch(next.value));
      return next.value;
    },
    exec: function* (options) { return yield { op: "exec", options }; },
    fs: Object.fromEntries(["fileExists", "readFile", "writeFile", "writeFileAtomic", "removeFile", "readDir", "makeDirs"]
      .map(op => [op, function* (path, contents) { return yield { op, path, contents }; }])),
  },
});

function dispatch(request) {
  const { op, options, path, contents } = request;
  if (op === "exec") return JSON.parse(legacyFake.exec(JSON.stringify(options)));
  if (op === "progress") return legacyFake.progress(options);
  if (op === "execStart") {
    execCalls.push(options);
    if (execStartHandler) return execStartHandler(options);
    const jobId = String(execCalls.length);
    fakeJobs.set(jobId, { done: false });
    return { jobId };
  }
  if (op === "execPoll") return fakeJobs.get(request.job);
  if (op === "execClose") { closedJobs.push(request.job); return fakeJobs.delete(request.job); }
  if (op === "writeFileAtomic") {
    if (writeFileAtomicHandler) return writeFileAtomicHandler(path, contents);
    return legacyFake.writeFile(path, contents);
  }
  return legacyFake[op](path, contents);
}

const bundle = readFileSync(join(__dirname, "plugin.js"), "utf8");
function loadPlugin() {
  const bundled = { exports: {} };
  runInThisContext("(function(module,exports) {" + bundle + "\n})")(bundled, bundled.exports);
  return bundled.exports.default;
}
let plugin = loadPlugin();

// ── Tiny runner ────────────────────────────────────────────────────────
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const allNodes = (nodes) => nodes.flatMap(node => [node, ...allNodes(node.children || [])]);
function reset(settings, platform) {
  execCalls.length = 0;
  progressCalls.length = 0;
  removedFiles.length = 0;
  closedJobs.length = 0;
  fakeJobs.clear();
  execStartHandler = null;
  writeFileAtomicHandler = null;
  settingsObj = settings || {};
  platformStr = platform || "macos";
  files = {};
  execHandler = () => JSON.stringify({ code: 0, stdout: "", stderr: "" });
  plugin = loadPlugin();
}

// Canonical whisper.cpp `-oj` output for the given segment texts.
function whisperJson(segments) {
  return JSON.stringify({
    systeminfo: "fake",
    model: { type: "small" },
    result: { language: "en" },
    transcription: segments.map((t) => ({ text: t })),
  });
}

// Handler that succeeds for everything and, when whisper-cli runs with -of <base>,
// writes <base>.json so the plugin can read it back.
function happyHandler(segments) {
  return (opts) => {
    if (/whisper-cli/.test(opts.bin)) {
      const i = (opts.args || []).indexOf("-of");
      if (i >= 0) files[opts.args[i + 1] + ".json"] = whisperJson(segments);
    }
    return JSON.stringify({ code: 0, stdout: "", stderr: "" });
  };
}

const indexOfCall = (pred) => execCalls.findIndex(pred);
const progressLabels = () => progressCalls.map((c) => c.label);
const buttonLabels = (view) => view.nodes.filter((n) => n.kind === "button").map((n) => n.label);
const badgeLabels = (view) => view.nodes.filter((n) => n.kind === "badge" && !n.label.startsWith("Selected")).map((n) => n.label);

function installHandler() {
  let ffmpegInstalled = false;
  let whisperInstalled = false;
  return (opts) => {
    if (opts.bin === "ffmpeg" && (opts.args || [])[0] === "-version") {
      return JSON.stringify(ffmpegInstalled ? { code: 0 } : { error: "not found" });
    }
    if (opts.bin === "whisper-cli" && (opts.args || [])[0] === "--help") {
      return JSON.stringify(whisperInstalled ? { code: 0 } : { error: "not found" });
    }
    if (opts.bin === "brew" && (opts.args || [])[1] === "ffmpeg") {
      ffmpegInstalled = true;
      return JSON.stringify({ code: 0 });
    }
    if (opts.bin === "brew" && (opts.args || [])[1] === "whisper-cpp") {
      whisperInstalled = true;
      return JSON.stringify({ code: 0 });
    }
    if (opts.bin === "curl") {
      const i = (opts.args || []).indexOf("-o");
      if (i >= 0) files[opts.args[i + 1]] = "downloaded";
      return JSON.stringify({ code: 0 });
    }
    return JSON.stringify({ code: 0, stdout: "", stderr: "" });
  };
}

function basename(bin) {
  return String(bin).split(/[\\/]/).pop();
}

function manifestAllowsExec(bin) {
  const base = basename(bin);
  return SUBPROCESS_ALLOW.some((entry) => entry === bin || entry === base);
}

function withSandbox(handler) {
  return (opts) => {
    if (!manifestAllowsExec(opts.bin)) {
      return JSON.stringify({ error: "denied exec(" + opts.bin + ") — not in subprocess.allow" });
    }
    return handler(opts);
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

test("live dictation defaults to the Russian-capable local model and ignores the clip endpoint", () => {
  reset({ endpoint: "https://fixture.invalid/clip" }, "windows");
  assert(plugin.dictationLaunch().state === "setup", "explicit setup is required");
  assert(!execCalls.length, "availability cannot start subprocesses or download models");
  const root = DATA_DIR + "/transcriber/live-dictation";
  const model = root + "/parakeet-tdt-0.6b-v3-int8-1495e91b59d7";
  files[model + "/.verified"] = "1495e91b59d7fc53ddca91f3431758ec99f8fa253fdb0e1e851be0f72b14b0f9";
  files[root + "/runtime-py312-sherpa-2.0.2/Scripts/python.exe"] = "";
  for (const asset of ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"]) files[model + "/" + asset] = "";
  const ready = plugin.dictationLaunch();
  assert(ready.state === "ready" && ready.args[1] === model && ready.script === "runtime/parakeet.py",
    "matched local runtime and model only");
});

test("model install requires a glance action, and cancellation preserves the selected model", () => {
  reset({}, "windows");
  const bundle = "C:/plugin/fixture";
  const initial = plugin.renderGlance({}, bundle);
  assert(allNodes(initial.nodes).some(node => node.kind === "button" && node.action === "dictation:install:parakeet-tdt-0.6b-v3-int8"),
    "setup is offered before starting");
  assert(!execCalls.some(call => call.bin === "python.exe"), "render does not launch setup");
  const started = plugin.glanceAction("dictation:install:parakeet-tdt-0.6b-v3-int8", {}, bundle);
  const first = execCalls.find(call => call.bin === "python.exe");
  assert(first && first.args.includes(bundle + "/runtime/parakeet.py"), "uses the loaded runtime path");
  assert(started.nodes.some(node => node.action === "dictation:cancel"), "cancel is available during the exact install");
  plugin.glanceAction("dictation:cancel", {}, bundle);
  const root = DATA_DIR + "/transcriber/live-dictation";
  assert(Object.keys(files).some(path => path.startsWith(root + "/.cancel-")), "cancellation signals only the owned job");
  assert(!(root + "/selected" in files), "an incomplete install cannot change the model");
  for (const id of fakeJobs.keys()) fakeJobs.set(id, { done: true, code: 3 });
  const cancelled = plugin.glanceAction("dictation:refresh", {}, bundle);
  assert(cancelled.nodes.some(node => node.body === "Installation cancelled."), "closed install reports cancellation");
});

test("progress: cold transcribe reports install, model download, transcribe, done phases", () => {
  reset({}, "macos");
  let ffmpegInstalled = false;
  let whisperInstalled = false;
  execHandler = (opts) => {
    if (opts.bin === "ffmpeg" && (opts.args || [])[0] === "-version") {
      return JSON.stringify(ffmpegInstalled ? { code: 0 } : { error: "not found" });
    }
    if (opts.bin === "whisper-cli" && (opts.args || [])[0] === "--help") {
      return JSON.stringify(whisperInstalled ? { code: 0 } : { error: "not found" });
    }
    if (opts.bin === "brew" && (opts.args || [])[1] === "ffmpeg") {
      ffmpegInstalled = true;
      return JSON.stringify({ code: 0 });
    }
    if (opts.bin === "brew" && (opts.args || [])[1] === "whisper-cpp") {
      whisperInstalled = true;
      return JSON.stringify({ code: 0 });
    }
    if (/whisper-cli/.test(opts.bin)) {
      const i = (opts.args || []).indexOf("-of");
      if (i >= 0) files[opts.args[i + 1] + ".json"] = whisperJson(["cold path"]);
    }
    return JSON.stringify({ code: 0, stdout: "", stderr: "" });
  };

  const r = plugin.transcribe("/tmp/note.oga");
  assert(r.text === "cold path", "transcribes after bootstrap, got " + JSON.stringify(r));
  assert(JSON.stringify(progressLabels()) === JSON.stringify([
    "Installing ffmpeg…",
    "Installing whisper.cpp…",
    "Downloading model ggml-small (~466MB)…",
    "Transcribing…",
    "Done",
  ]), "unexpected progress labels: " + JSON.stringify(progressCalls));
  assert(progressCalls[progressCalls.length - 1].done === true, "final progress call marks done");
});

test("progress: warm transcribe reports only transcribing and done phases", () => {
  reset({}, "macos");
  files[MODEL] = "x"; files[MODEL + ".done"] = "x";
  execHandler = happyHandler(["warm path"]);

  const r = plugin.transcribe("/tmp/note.oga");
  assert(r.text === "warm path", "transcribes warm path, got " + JSON.stringify(r));
  assert(JSON.stringify(progressLabels()) === JSON.stringify([
    "Transcribing…",
    "Done",
  ]), "unexpected warm progress labels: " + JSON.stringify(progressCalls));
  assert(progressCalls[progressCalls.length - 1].done === true, "final progress call marks done");
});

test("deps present + model present: transcribe installs nothing (no brew/curl)", () => {
  reset({}, "macos");
  files[MODEL] = "x"; files[MODEL + ".done"] = "x"; // model already downloaded
  execHandler = happyHandler(["hello world"]);

  const r = plugin.transcribe("/tmp/note.oga");
  assert(!r.error, "no error, got " + JSON.stringify(r));
  assert(r.text === "hello world", "text joined, got " + JSON.stringify(r));

  const installed = execCalls.some((c) => c.bin === "brew" || c.bin === "curl");
  assert(!installed, "must not install when deps present; calls=" +
    JSON.stringify(execCalls.map((c) => c.bin)));
});

test("poison partial: model file present but no .done sentinel → re-downloads (not trusted)", () => {
  reset({}, "macos");
  files[MODEL] = "partial-30mb"; // an interrupted download left a truncated file, no .done
  execHandler = happyHandler(["recovered"]);

  const r = plugin.transcribe("/tmp/note.oga");
  assert(!r.error, "should recover, got " + JSON.stringify(r));
  // It must re-download (curl) rather than feed whisper-cli the truncated model.
  const reDownloaded = execCalls.some((c) => c.bin === "curl");
  assert(reDownloaded, "must re-download when .done sentinel is missing; calls=" +
    JSON.stringify(execCalls.map((c) => c.bin)));
  assert(files[MODEL + ".done"] !== undefined, "writes .done sentinel after a successful download");
});

test("model switch cleanup: removes orphan ggml bins and matching done sentinels, keeps active and part", () => {
  reset({ model: "base" }, "macos");
  const dir = DATA_DIR + "/transcriber";
  const active = dir + "/ggml-base.bin";
  files[active] = "active"; files[active + ".done"] = "ok";
  files[dir + "/ggml-small.bin"] = "old"; files[dir + "/ggml-small.bin.done"] = "ok";
  files[dir + "/ggml-medium.bin"] = "old2"; files[dir + "/ggml-medium.bin.done"] = "ok";
  files[dir + "/ggml-large-v3.bin.part"] = "in-progress";
  execHandler = happyHandler(["switched"]);

  const r = plugin.transcribe("/tmp/note.oga");
  assert(r.text === "switched", "transcribes with active model, got " + JSON.stringify(r));
  assert(files[active] === "active", "active model kept");
  assert(files[active + ".done"] === "ok", "active sentinel kept");
  assert(files[dir + "/ggml-small.bin"] === undefined, "old small model removed");
  assert(files[dir + "/ggml-small.bin.done"] === undefined, "old small sentinel removed");
  assert(files[dir + "/ggml-medium.bin"] === undefined, "old medium model removed");
  assert(files[dir + "/ggml-medium.bin.done"] === undefined, "old medium sentinel removed");
  assert(files[dir + "/ggml-large-v3.bin.part"] === "in-progress", "in-progress part kept");
});

test("model switch cleanup: active-only model deletes nothing", () => {
  reset({ model: "base" }, "macos");
  const dir = DATA_DIR + "/transcriber";
  const active = dir + "/ggml-base.bin";
  files[active] = "active"; files[active + ".done"] = "ok";
  execHandler = happyHandler(["active only"]);

  const r = plugin.transcribe("/tmp/note.oga");
  assert(r.text === "active only", "transcribes with active model, got " + JSON.stringify(r));
  const modelDeletes = removedFiles.filter((p) => p.indexOf(dir + "/ggml-") === 0);
  assert(modelDeletes.length === 0, "must not delete any model files; removed=" + JSON.stringify(removedFiles));
});

test("transcribe pipeline: ffmpeg converts to 16k wav BEFORE whisper-cli, json joined", () => {
  reset({}, "macos");
  files[MODEL] = "x"; files[MODEL + ".done"] = "x";
  execHandler = happyHandler(["one ", "two"]);

  const r = plugin.transcribe("/tmp/note.webm");
  assert(r.text === "one two", "segments joined, got " + JSON.stringify(r));

  const ffmpeg = indexOfCall((c) => /ffmpeg/.test(c.bin) && (c.args || []).indexOf("-i") >= 0);
  const whisper = indexOfCall((c) => /whisper-cli/.test(c.bin) && (c.args || []).indexOf("-oj") >= 0);
  assert(ffmpeg >= 0, "ffmpeg convert call present");
  assert(whisper >= 0, "whisper-cli call present");
  assert(ffmpeg < whisper, "ffmpeg must run before whisper-cli");

  // ffmpeg targets 16kHz mono wav from the input
  const conv = execCalls[ffmpeg].args;
  assert(conv.indexOf("16000") >= 0, "16kHz sample rate");
  assert(conv.indexOf("/tmp/note.webm") >= 0, "input path passed to ffmpeg");
});

test("language: explicit arg wins, else settings.language, else auto", () => {
  reset({ language: "ru" }, "macos");
  files[MODEL] = "x"; files[MODEL + ".done"] = "x";
  execHandler = happyHandler(["x"]);
  plugin.transcribe("/tmp/a.oga");
  let w = execCalls.find((c) => /whisper-cli/.test(c.bin) && (c.args || []).indexOf("-l") >= 0);
  let li = w.args.indexOf("-l");
  assert(w.args[li + 1] === "ru", "settings language used, got " + w.args[li + 1]);

  reset({ language: "ru" }, "macos");
  files[MODEL] = "x"; files[MODEL + ".done"] = "x";
  execHandler = happyHandler(["x"]);
  plugin.transcribe("/tmp/a.oga", "de");
  w = execCalls.find((c) => /whisper-cli/.test(c.bin) && (c.args || []).indexOf("-l") >= 0);
  li = w.args.indexOf("-l");
  assert(w.args[li + 1] === "de", "explicit arg wins, got " + w.args[li + 1]);

  reset({}, "macos");
  files[MODEL] = "x"; files[MODEL + ".done"] = "x";
  execHandler = happyHandler(["x"]);
  plugin.transcribe("/tmp/a.oga");
  w = execCalls.find((c) => /whisper-cli/.test(c.bin) && (c.args || []).indexOf("-l") >= 0);
  li = w.args.indexOf("-l");
  assert(w.args[li + 1] === "auto", "defaults to auto, got " + w.args[li + 1]);
});

test("missing deps that cannot be installed: clear actionable error", () => {
  reset({}, "linux");
  // Everything fails: probes error (binary absent), curl download errors too.
  execHandler = () => JSON.stringify({ error: "executable not found" });

  const r = plugin.transcribe("/tmp/note.oga");
  assert(r.error, "must surface an error, got " + JSON.stringify(r));
  assert(!r.text, "no text on failure");
  assert(/install/i.test(r.error), "error tells the user to install, got: " + r.error);
});

test("windows: downloads whisper.cpp from current ggml-org release asset", () => {
  reset({}, "windows");
  files[DATA_DIR + "/transcriber/bin/ffmpeg.exe"] = "ffmpeg";
  files[MODEL] = "x"; files[MODEL + ".done"] = "x";
  execHandler = withSandbox((opts) => {
    if (opts.bin === "ffmpeg" && (opts.args || [])[0] === "-version") {
      return JSON.stringify({ error: "not on PATH" });
    }
    if (opts.bin === "whisper-cli" && (opts.args || [])[0] === "--help") {
      return JSON.stringify({ error: "not found" });
    }
    if (opts.bin === "curl" && (opts.args || []).indexOf("https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-x64.zip") >= 0) {
      const i = opts.args.indexOf("-o");
      files[opts.args[i + 1]] = "zip";
      return JSON.stringify({ code: 0 });
    }
    if (opts.bin === "tar") {
      files[DATA_DIR + "/transcriber/bin/Release/whisper-cli.exe"] = "exe";
      return JSON.stringify({ code: 0 });
    }
    if (/whisper-cli/.test(opts.bin)) {
      const i = (opts.args || []).indexOf("-of");
      if (i >= 0) files[opts.args[i + 1] + ".json"] = whisperJson(["win ok"]);
      return JSON.stringify({ code: 0 });
    }
    return JSON.stringify({ code: 0, stdout: "", stderr: "" });
  });

  const r = plugin.transcribe("/tmp/note.oga");
  assert(r.text === "win ok", "transcribes after windows bootstrap, got " + JSON.stringify(r));
  const whisperCurl = execCalls.find((c) => c.bin === "curl" && (c.args || []).some((a) => /whisper-bin-x64\.zip$/.test(a)));
  assert(whisperCurl, "whisper asset downloaded with curl");
  assert(whisperCurl.args.indexOf("https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-x64.zip") >= 0,
    "uses current ggml-org asset, got " + JSON.stringify(whisperCurl.args));
});

test("windows: discovers ffmpeg inside nested gyan.dev zip layout", () => {
  reset({}, "windows");
  const nestedFfmpeg = DATA_DIR + "/transcriber/bin/ffmpeg-7.1.1-essentials_build/bin/ffmpeg.exe";
  files[nestedFfmpeg] = "ffmpeg";
  files[DATA_DIR + "/transcriber/bin/whisper-cli.exe"] = "whisper";
  files[MODEL] = "x"; files[MODEL + ".done"] = "x";
  execHandler = withSandbox((opts) => {
    if (opts.bin === "ffmpeg" && (opts.args || [])[0] === "-version") {
      return JSON.stringify({ error: "not on PATH" });
    }
    if (opts.bin === "whisper-cli" && (opts.args || [])[0] === "--help") {
      return JSON.stringify({ error: "not on PATH" });
    }
    if (/whisper-cli/.test(opts.bin)) {
      const i = (opts.args || []).indexOf("-of");
      if (i >= 0) files[opts.args[i + 1] + ".json"] = whisperJson(["nested ffmpeg ok"]);
    }
    return JSON.stringify({ code: 0, stdout: "", stderr: "" });
  });

  const r = plugin.transcribe("/tmp/note.oga");
  assert(r.text === "nested ffmpeg ok", "transcribes with nested ffmpeg, got " + JSON.stringify(r));
  const conv = execCalls.find((c) => c.bin === nestedFfmpeg && (c.args || []).indexOf("-ar") >= 0);
  assert(conv, "uses nested ffmpeg for conversion, calls=" + JSON.stringify(execCalls.map((c) => c.bin)));
  assert(!execCalls.some((c) => c.bin === "curl"), "must not redownload ffmpeg when nested binary exists");
});

test("windows: falls back to PowerShell when curl cannot write the release asset", () => {
  reset({}, "windows");
  const archive = DATA_DIR + "/transcriber/whisper.zip";
  files[DATA_DIR + "/transcriber/bin/ffmpeg.exe"] = "ffmpeg";
  files[MODEL] = "x"; files[MODEL + ".done"] = "x";
  execHandler = withSandbox((opts) => {
    if (opts.bin === "ffmpeg" && (opts.args || [])[0] === "-version") {
      return JSON.stringify({ error: "not on PATH" });
    }
    if (opts.bin === "whisper-cli" && (opts.args || [])[0] === "--help") {
      return JSON.stringify({ error: "not found" });
    }
    if (opts.bin === "curl" && (opts.args || []).some((a) => /whisper-bin-x64\.zip$/.test(a))) {
      return JSON.stringify({ code: 23, stderr: "curl: (23) client returned ERROR on write" });
    }
    if (opts.bin === "powershell.exe" && (opts.args || []).join(" ").indexOf("Invoke-WebRequest") >= 0) {
      files[archive] = "zip";
      return JSON.stringify({ code: 0 });
    }
    if (opts.bin === "tar") {
      files[DATA_DIR + "/transcriber/bin/Release/whisper-cli.exe"] = "exe";
      return JSON.stringify({ code: 0 });
    }
    if (/whisper-cli/.test(opts.bin)) {
      const i = (opts.args || []).indexOf("-of");
      if (i >= 0) files[opts.args[i + 1] + ".json"] = whisperJson(["fallback ok"]);
      return JSON.stringify({ code: 0 });
    }
    return JSON.stringify({ code: 0, stdout: "", stderr: "" });
  });

  const r = plugin.transcribe("/tmp/note.oga");
  assert(r.text === "fallback ok", "transcribes after powershell fallback, got " + JSON.stringify(r));
  assert(execCalls.some((c) => c.bin === "powershell.exe" && (c.args || []).join(" ").indexOf("Invoke-WebRequest") >= 0),
    "powershell fallback invoked only for download");
  assert(!execCalls.some((c) => c.bin === "powershell.exe" && (c.args || []).join(" ").indexOf("whisper-cli.exe") >= 0),
    "must not run downloaded whisper-cli through powershell");
});

test("data root: reuses existing nested Windows assets outside home", () => {
  reset({}, "windows");
  files[DATA_DIR + "/transcriber/bin/ffmpeg.exe"] = "ffmpeg";
  const nestedWhisper = DATA_DIR + "/transcriber/bin/Release/whisper-cli.exe";
  files[nestedWhisper] = "exe";
  files[MODEL] = "x"; files[MODEL + ".done"] = "x";
  execHandler = withSandbox((opts) => {
    if (opts.bin === "ffmpeg" && (opts.args || [])[0] === "-version") {
      return JSON.stringify({ error: "not on PATH" });
    }
    if (opts.bin === "whisper-cli" && (opts.args || [])[0] === "--help") {
      return JSON.stringify({ error: "not on PATH" });
    }
    if (/whisper-cli/.test(opts.bin)) {
      const i = (opts.args || []).indexOf("-of");
      if (i >= 0) files[opts.args[i + 1] + ".json"] = whisperJson(["direct"]);
    }
    return JSON.stringify({ code: 0, stdout: "", stderr: "" });
  });

  const r = plugin.transcribe("/tmp/note.oga");
  assert(r.text === "direct", "transcribes by direct downloaded binary exec, got " + JSON.stringify(r));
  assert(execCalls.some((c) => c.bin === DATA_DIR + "/transcriber/bin/ffmpeg.exe"),
    "direct local ffmpeg.exe exec should be allowed by manifest basename");
  assert(execCalls.some((c) => c.bin === nestedWhisper),
    "direct nested whisper-cli.exe exec should be allowed by manifest basename");
  assert(!execCalls.some((c) => c.bin === "powershell.exe"),
    "must not use powershell runtime wrapper for downloaded binaries");
  assert(!execCalls.some((c) => ["curl", "tar", "brew"].includes(c.bin)),
    "existing data-root assets must not be downloaded or reinstalled");
  assert(!JSON.stringify(execCalls).includes(HOME),
    "storage must use host.dataDir independently of homeDir");
  assert(execCalls.some((c) => (c.args || []).includes(MODEL)),
    "the existing model must be loaded from the instance data root");
});

test("transcribeStatus: ready when deps+model present, unloaded otherwise", () => {
  reset({}, "macos");
  files[MODEL] = "x"; files[MODEL + ".done"] = "x";
  execHandler = () => JSON.stringify({ code: 0 }); // probes succeed
  let s = plugin.transcribeStatus();
  assert(s.state === "ready", "ready when all present, got " + JSON.stringify(s));

  reset({}, "macos"); // no model, probes fail
  execHandler = () => JSON.stringify({ error: "not found" });
  s = plugin.transcribeStatus();
  assert(s.state === "unloaded", "unloaded when deps missing, got " + JSON.stringify(s));
});

test("glance: inactive model shows install and reinstall with not-installed status", () => {
  reset({ model: "base", language: "ru" }, "macos");
  execHandler = () => JSON.stringify({ code: 0 });

  const view = plugin.renderGlance();
  assert(JSON.stringify(badgeLabels(view)) === JSON.stringify(["Not installed"]),
    "not-installed badge shown, got " + JSON.stringify(view.nodes));
  assert(view.nodes.some((n) => n.kind === "keyVal" && n.key === "Model" && n.value === "ggml-base"),
    "active settings model shown, got " + JSON.stringify(view.nodes));
  assert(view.nodes.some((n) => n.kind === "keyVal" && n.key === "Model file" && /missing/i.test(n.value)),
    "missing model file status shown, got " + JSON.stringify(view.nodes));
  assert(JSON.stringify(buttonLabels(view)) === JSON.stringify(["Install", "Reinstall", "Settings"]),
    "install, reinstall, settings buttons shown, got " + JSON.stringify(view.nodes));
});

test("glanceAction install downloads the active settings model and emits progress", () => {
  reset({ model: "base" }, "macos");
  execHandler = installHandler();

  const view = plugin.glanceAction("install");
  assert(files[BASE_MODEL] === "downloaded", "active base model downloaded");
  assert(files[BASE_MODEL + ".done"] !== undefined, "done sentinel written for active model");
  assert(JSON.stringify(progressLabels()) === JSON.stringify([
    "Installing ffmpeg…",
    "Installing whisper.cpp…",
    "Downloading model ggml-base (~142MB)…",
  ]), "unexpected install progress labels: " + JSON.stringify(progressCalls));
  assert(JSON.stringify(badgeLabels(view)) === JSON.stringify(["Ready"]),
    "glance rerendered ready status, got " + JSON.stringify(view.nodes));
  assert(JSON.stringify(buttonLabels(view)) === JSON.stringify(["Reinstall", "Settings"]),
    "install hidden after model exists, got " + JSON.stringify(view.nodes));
});

test("glanceAction reinstall after settings model change prunes old and keeps only active", () => {
  reset({ model: "base" }, "macos");
  files[MODEL] = "old-small"; files[MODEL + ".done"] = "ok";
  execHandler = installHandler();

  const view = plugin.glanceAction("reinstall");
  assert(files[BASE_MODEL] === "downloaded", "new active base model downloaded");
  assert(files[BASE_MODEL + ".done"] !== undefined, "new active sentinel written");
  assert(files[MODEL] === undefined, "old small model pruned");
  assert(files[MODEL + ".done"] === undefined, "old small sentinel pruned");
  const remainingModels = Object.keys(files).filter((p) => /\/ggml-.*\.bin$/.test(p)).sort();
  assert(JSON.stringify(remainingModels) === JSON.stringify([BASE_MODEL]),
    "only active model remains, got " + JSON.stringify(remainingModels));
  assert(JSON.stringify(progressLabels()) === JSON.stringify([
    "Installing ffmpeg…",
    "Installing whisper.cpp…",
    "Downloading model ggml-base (~142MB)…",
  ]), "unexpected reinstall progress labels: " + JSON.stringify(progressCalls));
  assert(JSON.stringify(badgeLabels(view)) === JSON.stringify(["Ready"]),
    "glance rerendered ready status, got " + JSON.stringify(view.nodes));
});

// ── Remote mode (mesh GPU offload) ──────────────────────────────────────

// Fake daemon: respond to a curl multipart upload with the given JSON body.
function remoteHandler(body) {
  return (opts) => {
    if (opts.bin === "curl") return JSON.stringify({ code: 0, stdout: JSON.stringify(body), stderr: "" });
    return JSON.stringify({ code: 0, stdout: "", stderr: "" });
  };
}

test("remote: uploads via curl to endpoint and parses daemon text, no local deps", () => {
  reset({ endpoint: "http://gpu:7891/transcribe", language: "ru" }, "macos");
  execHandler = remoteHandler({ text: "  привет мир  ", language: "ru" });

  const r = plugin.transcribe("/tmp/note.m4a");
  assert(r.text === "привет мир", "trims remote transcript, got " + JSON.stringify(r));

  const curl = execCalls.find((c) => c.bin === "curl");
  assert(curl, "curl invoked, calls=" + JSON.stringify(execCalls.map((c) => c.bin)));
  const a = curl.args;
  assert(a.indexOf("http://gpu:7891/transcribe") >= 0, "endpoint passed to curl, got " + JSON.stringify(a));
  const fi = a.indexOf("-F");
  assert(a.indexOf("file=@/tmp/note.m4a") >= 0, "audio uploaded as file field, got " + JSON.stringify(a));
  assert(a.indexOf("language=ru") >= 0, "language hint forwarded, got " + JSON.stringify(a));

  // Remote mode must NOT touch ffmpeg/whisper-cli/brew/model.
  const localBins = execCalls.filter((c) => /ffmpeg|whisper-cli|brew/.test(c.bin));
  assert(localBins.length === 0, "no local engine calls in remote mode, got " + JSON.stringify(localBins.map((c) => c.bin)));
});

test("remote: language=auto omits the language field (daemon rejects 'auto')", () => {
  reset({ endpoint: "http://gpu:7891/transcribe" }, "macos"); // no language → auto
  execHandler = remoteHandler({ text: "hello", language: "en" });

  plugin.transcribe("/tmp/note.m4a");
  const curl = execCalls.find((c) => c.bin === "curl");
  assert(curl.args.every((x) => x.indexOf("language=") !== 0), "must not send language field, got " + JSON.stringify(curl.args));
});

test("remote: explicit lang arg wins over settings", () => {
  reset({ endpoint: "http://gpu:7891/transcribe", language: "ru" }, "macos");
  execHandler = remoteHandler({ text: "x", language: "de" });

  plugin.transcribe("/tmp/note.m4a", "de");
  const curl = execCalls.find((c) => c.bin === "curl");
  assert(curl.args.indexOf("language=de") >= 0, "explicit arg forwarded, got " + JSON.stringify(curl.args));
});

test("remote: daemon error body is surfaced", () => {
  reset({ endpoint: "http://gpu:7891/transcribe" }, "macos");
  execHandler = remoteHandler({ error: "bad audio" });

  const r = plugin.transcribe("/tmp/note.m4a");
  assert(r.error, "must surface error, got " + JSON.stringify(r));
  assert(/bad audio/.test(r.error), "includes daemon message, got " + r.error);
  assert(!r.text, "no text on failure");
});

test("remote: empty transcript is surfaced as an error (no silent empty result)", () => {
  reset({ endpoint: "http://gpu:7891/transcribe" }, "macos");
  execHandler = remoteHandler({ text: "", language: "nn" });

  const r = plugin.transcribe("/tmp/note.m4a");
  assert(r.error, "empty transcript surfaces error, got " + JSON.stringify(r));
  assert(/empty transcript/.test(r.error), "explains empty transcript, got " + r.error);
});

test("remote: curl transport failure is surfaced, no local fallback", () => {
  reset({ endpoint: "http://gpu:7891/transcribe" }, "macos");
  execHandler = (opts) => {
    if (opts.bin === "curl") return JSON.stringify({ error: "Connection refused" });
    return JSON.stringify({ code: 0 });
  };

  const r = plugin.transcribe("/tmp/note.m4a");
  assert(r.error, "transport failure surfaces error, got " + JSON.stringify(r));
  assert(/remote transcription failed/.test(r.error), "clear remote error, got " + r.error);
  const localBins = execCalls.filter((c) => /ffmpeg|whisper-cli|brew/.test(c.bin));
  assert(localBins.length === 0, "no silent local fallback, got " + JSON.stringify(localBins.map((c) => c.bin)));
});

test("remote: status is ready and glance shows the endpoint", () => {
  reset({ endpoint: "http://gpu:7891/transcribe" }, "macos");
  execHandler = () => JSON.stringify({ code: 0 });

  const s = plugin.transcribeStatus();
  assert(s.state === "ready", "remote status ready, got " + JSON.stringify(s));

  const view = plugin.renderGlance();
  assert(JSON.stringify(badgeLabels(view)) === JSON.stringify(["Remote"]), "remote badge, got " + JSON.stringify(view.nodes));
  assert(view.nodes.some((n) => n.kind === "keyVal" && n.key === "Endpoint" && n.value === "http://gpu:7891/transcribe"),
    "endpoint shown, got " + JSON.stringify(view.nodes));
  assert(JSON.stringify(buttonLabels(view)) === JSON.stringify(["Settings"]), "only settings button, got " + JSON.stringify(view.nodes));
});

// ── Run ────────────────────────────────────────────────────────────────
let failed = 0;

test("macOS: a Homebrew ffmpeg outside the plugin PATH is used by absolute path", () => {
  reset({ model: "small" }, "macos");
  // Installed where brew puts it, invisible to a runtime with no login PATH.
  files["/usr/local/bin/ffmpeg"] = "binary";
  files["/usr/local/bin/whisper-cli"] = "binary";
  files[DATA_DIR + "/transcriber/ggml-small.bin"] = "x".repeat(200000);
  execHandler = withSandbox((opts) => {
    if (basename(opts.bin) === "ffmpeg" && opts.bin.indexOf("/") === -1) {
      return JSON.stringify({ error: "not found" });
    }
    if (basename(opts.bin) === "whisper-cli" && opts.bin.indexOf("/") === -1) {
      return JSON.stringify({ error: "not found" });
    }
    if (basename(opts.bin) === "brew") return JSON.stringify({ error: "not found" });
    if (basename(opts.bin) === "whisper-cli") {
      const of = (opts.args || []).indexOf("-of");
      if (of >= 0) files[opts.args[of + 1] + ".json"] = whisperJson(["hello"]);
      return JSON.stringify({ code: 0 });
    }
    return JSON.stringify({ code: 0, stdout: "", stderr: "" });
  });
  files["/tmp/note.oga"] = "audio";
  plugin.transcribe("/tmp/note.oga");
  assert(
    execCalls.some((c) => c.bin === "/usr/local/bin/ffmpeg"),
    "ffmpeg must run by its absolute path, ran: " + execCalls.map((c) => c.bin).join(", "),
  );
  assert(
    !execCalls.some((c) => basename(c.bin) === "brew" && (c.args || [])[0] === "install"),
    "a binary that is already present must not trigger brew install",
  );
});

test("macOS: brew --prefix decides where an installed binary is looked for", () => {
  reset({ model: "small" }, "macos");
  files["/opt/custom/bin/ffmpeg"] = "binary";
  files["/opt/custom/bin/whisper-cli"] = "binary";
  files[DATA_DIR + "/transcriber/ggml-small.bin"] = "x".repeat(200000);
  execHandler = withSandbox((opts) => {
    if (opts.bin.indexOf("/") === -1 && basename(opts.bin) !== "brew") {
      return JSON.stringify({ error: "not found" });
    }
    if (basename(opts.bin) === "brew" && (opts.args || [])[0] === "--prefix") {
      return JSON.stringify({ code: 0, stdout: "/opt/custom\n", stderr: "" });
    }
    if (opts.bin === "curl") {
      const i = (opts.args || []).indexOf("-o");
      if (i >= 0) files[opts.args[i + 1]] = "x".repeat(200000);
      return JSON.stringify({ code: 0 });
    }
    if (basename(opts.bin) === "whisper-cli") {
      const of = (opts.args || []).indexOf("-of");
      if (of >= 0) files[opts.args[of + 1] + ".json"] = whisperJson(["hi"]);
      return JSON.stringify({ code: 0 });
    }
    return JSON.stringify({ code: 0, stdout: "", stderr: "" });
  });
  files["/tmp/note.oga"] = "audio";
  plugin.transcribe("/tmp/note.oga");
  // Before the fix this reached `brew install` for a binary that was already
  // there, because only the PATH probe and the plugin-local dir were consulted.
  assert(
    !execCalls.some((c) => (c.args || [])[0] === "install"),
    "binaries under brew's own prefix must be found, not reinstalled; ran: " + execCalls.map((c) => c.bin).join(", "),
  );
  assert(
    execCalls.some((c) => basename(c.bin) === "brew" && (c.args || [])[0] === "--prefix"),
    "brew's own prefix must be asked for rather than guessed",
  );
});

test("macOS: a genuinely missing ffmpeg names where it was looked for", () => {
  reset({ model: "small" }, "macos");
  execHandler = withSandbox(() => JSON.stringify({ error: "not found" }));
  files["/tmp/note.oga"] = "audio";
  const r = plugin.transcribe("/tmp/note.oga");
  const msg = (r && (r.error || r.text)) || "";
  assert(/looked in/i.test(msg), "the failure must be diagnosable, got " + JSON.stringify(r));
  assert(msg.indexOf("/usr/local/bin/ffmpeg") >= 0, "the standard prefixes must be named, got " + msg);
});

test("custom dictionary: Cyrillic & Latin longest-match-first, case-insensitive, word-boundary safe", () => {
  const dict = "в доме => в Domios\nв доме все => в Domios; дом -> Dom; domios os => Domios";
  reset({ endpoint: "http://gpu.local:7891/transcribe", dictionary: dict }, "windows");
  execHandler = () => JSON.stringify({
    code: 0,
    stdout: JSON.stringify({ text: "Да В доме все, но в доме сидишь и домик про DOMIOS OS" }),
    stderr: "",
  });
  const remote = plugin.transcribe("/tmp/note.oga");
  assert(
    remote.text === "Да в Domios, но в Domios сидишь и домик про Domios",
    "remote dictionary mismatch: " + JSON.stringify(remote),
  );

  // Also verify local whisper-cli path applies the exact same rules.
  reset({ dictionary: dict }, "macos");
  files[MODEL] = "ok";
  files[MODEL + ".done"] = "ok";
  execHandler = happyHandler(["Да в доме все, но в доме сидишь и домик"]);
  const local = plugin.transcribe("/tmp/note.oga");
  assert(
    local.text === "Да в Domios, но в Domios сидишь и домик",
    "local dictionary mismatch: " + JSON.stringify(local),
  );
});

test("custom dictionary: empty or malformed rules fail open safely and respect bounds", () => {
  reset({ endpoint: "http://gpu.local:7891/transcribe", dictionary: ";; no-arrow ;; => missingLeft ; missingRight => ; " + "x".repeat(129) + " => tooLong" }, "windows");
  execHandler = () => JSON.stringify({ code: 0, stdout: JSON.stringify({ text: "unchanged text" }), stderr: "" });
  const r = plugin.transcribe("/tmp/note.oga");
  assert(r.text === "unchanged text", "malformed rules must fail open: " + JSON.stringify(r));
});

test("custom dictionary: dictationLaunch writes sorted dictionary.json only when configured", () => {
  const root = DATA_DIR + "/transcriber/live-dictation";
  const model = root + "/parakeet-tdt-0.6b-v3-int8-1495e91b59d7";
  const setupModel = () => {
    files[model + "/.verified"] = "1495e91b59d7fc53ddca91f3431758ec99f8fa253fdb0e1e851be0f72b14b0f9";
    files[root + "/runtime-py312-sherpa-2.0.2/Scripts/python.exe"] = "";
    for (const asset of ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"]) files[model + "/" + asset] = "";
  };

  reset({ dictionary: "   ;; invalid-line " }, "windows");
  setupModel();
  const withoutDict = plugin.dictationLaunch();
  assert(withoutDict.state === "ready" && withoutDict.args.length === 2,
    "empty/malformed dictionary omits arg: " + JSON.stringify(withoutDict));

  reset({ dictionary: "в доме => в Domios; в доме все => в Domios\nдомиус -> Domios" }, "windows");
  setupModel();
  const withDict = plugin.dictationLaunch();
  const dictPath = root + "/dictionary.json";
  assert(withDict.state === "ready" && withDict.args.length === 3 && withDict.args[2] === dictPath,
    "configured dictionary passes dictionary.json path: " + JSON.stringify(withDict));
  const saved = JSON.parse(files[dictPath]);
  assert(JSON.stringify(saved) === JSON.stringify([
    ["в доме все", "в Domios"],
    ["в доме", "в Domios"],
    ["домиус", "Domios"],
  ]), "rules must be normalized and sorted longest-first: " + JSON.stringify(saved));
});

test("custom dictionary: structured [{ from, to }] array matches legacy string parity", () => {
  const structured = [
    { from: "в доме", to: "в Domios" },
    { from: "в доме все", to: "в Domios" },
    { from: "дом", to: "Dom" },
    { from: "domios os", to: "Domios" },
  ];
  reset({ endpoint: "http://gpu.local:7891/transcribe", dictionary: structured }, "windows");
  execHandler = () => JSON.stringify({
    code: 0,
    stdout: JSON.stringify({ text: "Да В доме все, но в доме сидишь и домик про DOMIOS OS" }),
    stderr: "",
  });
  const remote = plugin.transcribe("/tmp/note.oga");
  assert(
    remote.text === "Да в Domios, но в Domios сидишь и домик про Domios",
    "structured array remote dictionary mismatch: " + JSON.stringify(remote),
  );

  reset({ dictionary: structured }, "macos");
  files[MODEL] = "ok";
  files[MODEL + ".done"] = "ok";
  execHandler = happyHandler(["Да в доме все, но в доме сидишь и домик"]);
  const local = plugin.transcribe("/tmp/note.oga");
  assert(
    local.text === "Да в Domios, но в Domios сидишь и домик",
    "structured array local dictionary mismatch: " + JSON.stringify(local),
  );
});

test("custom dictionary: malformed array items fail open and dictationLaunch stages structured array", () => {
  const root = DATA_DIR + "/transcriber/live-dictation";
  const model = root + "/parakeet-tdt-0.6b-v3-int8-1495e91b59d7";
  const setupModel = () => {
    files[model + "/.verified"] = "1495e91b59d7fc53ddca91f3431758ec99f8fa253fdb0e1e851be0f72b14b0f9";
    files[root + "/runtime-py312-sherpa-2.0.2/Scripts/python.exe"] = "";
    for (const asset of ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"]) files[model + "/" + asset] = "";
  };

  reset({
    dictionary: [
      null,
      42,
      "bare-string",
      [],
      { from: "   ", to: "Domios" },
      { from: "ok", to: "" },
      { from: 123, to: "bad" },
      { from: "x".repeat(129), to: "tooLong" },
    ],
  }, "windows");
  setupModel();
  const emptyLaunch = plugin.dictationLaunch();
  assert(emptyLaunch.state === "ready" && emptyLaunch.args.length === 2,
    "all-malformed array must omit dictionary.json arg: " + JSON.stringify(emptyLaunch));

  reset({
    dictionary: [
      { from: "  в доме  ", to: "в Old" },
      null,
      { from: "в доме все", to: "в Domios" },
      { from: "В ДОМЕ", to: "в Domios" },
      { from: "домиус", to: "Domios" },
      { from: "bad", to: 99 },
    ],
  }, "windows");
  setupModel();
  const launch = plugin.dictationLaunch();
  const dictPath = root + "/dictionary.json";
  assert(launch.state === "ready" && launch.args.length === 3 && launch.args[2] === dictPath,
    "structured array passes dictionary.json path: " + JSON.stringify(launch));
  const saved = JSON.parse(files[dictPath]);
  assert(JSON.stringify(saved) === JSON.stringify([
    ["в доме все", "в Domios"],
    ["в доме", "в Domios"],
    ["домиус", "Domios"],
  ]), "structured array rules must dedupe, normalize, and sort longest-first: " + JSON.stringify(saved));
});

// ── Agent-operated live dictation setup (0.5.1) ────────────────────────

const DICTATION_ROOT = DATA_DIR + "/transcriber/live-dictation";
const V3_ID = "parakeet-tdt-0.6b-v3-int8";
const V3_SHA = "1495e91b59d7fc53ddca91f3431758ec99f8fa253fdb0e1e851be0f72b14b0f9";
const V3_DIR = DICTATION_ROOT + "/" + V3_ID + "-" + V3_SHA.slice(0, 12);
const V2_ID = "parakeet-tdt-0.6b-v2-int8";
const V2_SHA = "6fc4426b54aa549a0019b8a75b8dea59164e71790a37ac56a045ad57f915f714";
const V2_DIR = DICTATION_ROOT + "/" + V2_ID + "-" + V2_SHA.slice(0, 12);
const CANONICAL_PARAKEET_PY = readFileSync(join(__dirname, "runtime", "parakeet.py"), "utf8");
const CANONICAL_REQUIREMENTS_TXT = readFileSync(join(__dirname, "runtime", "requirements.txt"), "utf8");

function agentCall(verb, args = [], body) {
  return plugin.onAgentCommand({ sessionId: "general-fixture", verb, args, ...(body !== undefined ? { body } : {}) });
}

function parseAgentOk(res, label) {
  assert(res && typeof res.result === "string" && !res.error, `${label}: expected result, got ${JSON.stringify(res)}`);
  return JSON.parse(res.result);
}

function seedRuntime(platform = "windows") {
  const py = DICTATION_ROOT + "/runtime-py312-sherpa-2.0.2" + (platform === "windows" ? "/Scripts/python.exe" : "/bin/python3.12");
  files[py] = "";
}

function seedModel(modelId) {
  const dir = modelId === V3_ID ? V3_DIR : V2_DIR;
  const sha = modelId === V3_ID ? V3_SHA : V2_SHA;
  files[dir + "/.verified"] = sha;
  for (const asset of ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"]) {
    files[dir + "/" + asset] = "";
  }
}

test("metadata & exports: 0.5.1 / minCodeterm 1.21.1 agreement, discoverable agentVerbs/agentGuide/help", () => {
  reset({}, "windows");
  const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8"));
  const channel = JSON.parse(readFileSync(join(__dirname, "..", "channel.json"), "utf8"));
  const channelEntry = channel.plugins.find((p) => p.id === "transcriber");
  assert(MANIFEST.version === "0.5.1" && MANIFEST.minCodeterm === "1.21.1", "plugin.json version/minCodeterm mismatch");
  assert(pkg.version === "0.5.1", "package.json version mismatch");
  assert(channelEntry && channelEntry.version === "0.5.1" && channelEntry.minCodeterm === "1.21.1", "channel.json mismatch");
  assert(MANIFEST.permissions.agent_commands === true, "agent_commands permission must be declared");
  assert(MANIFEST.agentGuide === "agent-guide.md", "agentGuide must point to agent-guide.md");
  const guide = readFileSync(join(__dirname, "agent-guide.md"), "utf8");
  assert(guide.includes("487 MB") && guide.includes("1.5 GB") && guide.includes("Python 3.12"), "agent-guide.md must state resource requirements");
  assert(Array.isArray(MANIFEST.agentVerbs) && MANIFEST.agentVerbs.length >= 6, "agentVerbs must expose dictation operations");
  assert(Array.isArray(MANIFEST.agentReadOnlyVerbs) && MANIFEST.agentReadOnlyVerbs.includes("dictation-status") && MANIFEST.agentReadOnlyVerbs.includes("dictation-progress"), "read-only verbs declared");
  assert(!MANIFEST.agentReadOnlyVerbs.includes("dictation-install"), "dictation-install must not be read-only");
  assert(typeof plugin.onAgentCommand === "function", "plugin must export onAgentCommand");

  const help = parseAgentOk(agentCall("help"), "help");
  assert(help.version === "0.5.1" && help.defaultModelId === V3_ID, "help reports version and Russian-capable default");
  assert(/487 MB/.test(help.requirements.modelDownload), "help states ~487 MB model");
  assert(/1\.5 GB/.test(help.requirements.diskSpace) && /Python 3\.12/.test(help.requirements.python), "help states ~1.5 GB / Python 3.12");
  assert(/pypi\.org/i.test(help.requirements.network) && /github\.com/i.test(help.requirements.network), "help states network implications");
  assert(/not a host permission grant/i.test(help.consent.hostAuthority), "help states --consent is not a host permission grant");
  assert(execCalls.length === 0 && Object.keys(files).length === 0, "help must be strictly side-effect free");
});

test("agent dictation-status is read-only and refuses invalid arguments or unexpected body", () => {
  reset({}, "windows");
  const status = parseAgentOk(agentCall("dictation-status"), "dictation-status");
  assert(status.ready === false && status.runtimeInstalled === false, "uninstalled state reported truthfully");
  assert(status.defaultModelId === V3_ID && status.selectedModelId === V3_ID, "defaults to Russian-capable v3");
  assert(status.models.length === 2 && status.models[0].id === V3_ID && status.models[0].isDefault === true, "catalog exposed");
  assert(status.activeJob === null && status.lastJob === null, "no active or last job initially");
  assert(execCalls.length === 0 && Object.keys(files).length === 0, "status must not launch subprocesses or write files");

  const badStatus = agentCall("dictation-status", ["extra"]);
  assert(badStatus.error && /^invalid_arguments:/.test(badStatus.error), "rejects unexpected status args");
  const badBody = agentCall("dictation-install", [V3_ID], JSON.stringify({ authorized: true, consent: true }));
  assert(badBody.error && /^invalid_arguments:/.test(badBody.error), "rejects JSON body and never treats JSON boolean as authorization");
  const unknownVerb = agentCall("viewCall", ["install"]);
  assert(unknownVerb.error && /^unknown_verb:/.test(unknownVerb.error), "unknown/raw internal verb refused");
  assert(execCalls.length === 0 && Object.keys(files).length === 0, "refused calls leave zero side effects");
});

test("agent dictation-install requires explicit --consent and returns real native host refusals verbatim", () => {
  reset({}, "windows");
  const noConsent = agentCall("dictation-install");
  assert(noConsent.error && /^consent_required:/.test(noConsent.error), "install without --consent must refuse");
  assert(/487 MB/.test(noConsent.error) && /1\.5 GB/.test(noConsent.error) && /not a host permission grant/i.test(noConsent.error),
    "consent error states size/disk and honest host permission contract");
  assert(execCalls.length === 0 && Object.keys(files).length === 0, "consent refusal writes nothing and spawns nothing");

  const badModel = agentCall("dictation-install", ["../../evil.py", "--consent"]);
  assert(badModel.error && /^invalid_model:/.test(badModel.error), "arbitrary model/path input rejected");
  const badFlag = agentCall("dictation-install", ["--python", "evil", "--consent"]);
  assert(badFlag.error && /^invalid_arguments:/.test(badFlag.error), "unknown flag rejected");

  // Simulate real native host subprocess allowlist refusal.
  execStartHandler = (opts) => ({ error: "denied exec(" + opts.bin + ") — not in subprocess.allow" });
  const refused = agentCall("dictation-install", [V3_ID, "--consent"]);
  assert(refused.error && /^host_refused:/.test(refused.error), "native host refusal surfaces as host_refused: " + JSON.stringify(refused));
  assert(refused.error.includes("not in subprocess.allow"), "native refusal detail preserved verbatim");
  const prog = parseAgentOk(agentCall("dictation-progress"), "progress after host refusal");
  assert(prog.state === "failed" && prog.activeJob === null && prog.lastJob.failure.code === "host_refused",
    "typed host_refused failure recorded without holding slot");
});

test("agent dictation-install stages canonical parakeet.py + requirements.txt in data root, tracks real progress, and verifies completion", () => {
  reset({}, "windows");
  const started = parseAgentOk(agentCall("dictation-install", ["--consent"]), "install start");
  assert(started.ok === true && started.outcome === "started" && started.modelId === V3_ID, "default v3 install started");
  assert(execCalls.length === 1 && execCalls[0].bin === "python.exe", "spawned python.exe once");
  assert(execCalls[0].args[0] === "-I" && execCalls[0].args[2] === "install", "isolated python install mode");

  const stagedScript = execCalls[0].args[1];
  assert(stagedScript.startsWith(DICTATION_ROOT + "/.worker-") && stagedScript.endsWith("/parakeet.py"),
    "staged inside plugin-owned data root without bundle path or hardcoded ~/.domios/plugins: " + stagedScript);
  assert(!stagedScript.includes(HOME), "never guesses homeDir/plugins path");
  const stagedReq = stagedScript.replace(/\/parakeet\.py$/, "/requirements.txt");
  assert(files[stagedScript] === CANONICAL_PARAKEET_PY, "staged worker is exact canonical runtime/parakeet.py");
  assert(files[stagedReq] === CANONICAL_REQUIREMENTS_TXT, "staged requirements.txt is exact canonical runtime/requirements.txt");

  const nonce = execCalls[0].args[execCalls[0].args.length - 1];
  const progressFile = DICTATION_ROOT + "/.progress-" + nonce;

  // Stage 1: initial starting before worker writes progress
  let p = parseAgentOk(agentCall("dictation-progress"), "progress starting");
  assert(p.state === "running" && p.activeJob.progress.stage === "starting" && p.activeJob.progress.downloadedMb === undefined,
    "no elapsed-time fiction before worker progress");

  // Stage 2: runtime install
  files[progressFile] = "Installing the pinned local CPU runtime…";
  p = parseAgentOk(agentCall("dictation-progress"), "progress runtime");
  assert(p.activeJob.progress.stage === "installing_runtime", "runtime stage parsed");

  // Stage 3: real download MB
  files[progressFile] = "Downloading model: 212 / 488 MB";
  p = parseAgentOk(agentCall("dictation-progress"), "progress downloading");
  assert(p.activeJob.progress.stage === "downloading_model" && p.activeJob.progress.downloadedMb === 212 && p.activeJob.progress.totalMb === 488,
    "real MB progress parsed");

  // Stage 4: verifying/unpacking
  files[progressFile] = "Verifying and unpacking the model…";
  p = parseAgentOk(agentCall("dictation-progress"), "progress unpacking");
  assert(p.activeJob.progress.stage === "verifying_and_unpacking", "unpack stage parsed");

  // Complete WITH verified runtime + model files on disk
  seedRuntime("windows");
  seedModel(V3_ID);
  for (const id of fakeJobs.keys()) fakeJobs.set(id, { done: true, code: 0, stdout: "", stderr: "" });

  p = parseAgentOk(agentCall("dictation-progress"), "progress completed");
  assert(p.state === "completed" && p.activeJob === null && p.ready === true && p.lastJob.state === "completed",
    "completed install releases slot and reports ready");
  assert(closedJobs.length === 1, "completed job handle closed via execClose");
  assert(!(progressFile in files), "progress marker cleaned up on exit");

  // Repeated install after completion is idempotent: no duplicate execStart
  const again = parseAgentOk(agentCall("dictation-install", [V3_ID, "--consent"]), "install after completion");
  assert(again.outcome === "already_installed" && execCalls.length === 1, "repeated install after completion spawns nothing");
});

test("agent install catches false success (exit 0 without verified files) and classifies typed failures", () => {
  reset({}, "windows");
  parseAgentOk(agentCall("dictation-install", [V3_ID, "--consent"]), "start for false-success test");
  for (const id of fakeJobs.keys()) fakeJobs.set(id, { done: true, code: 0, stdout: "", stderr: "" });
  let p = parseAgentOk(agentCall("dictation-progress"), "progress false success");
  assert(p.state === "failed" && p.lastJob.failure.code === "verification_failed" && p.ready === false,
    "exit 0 without verified runtime/model must fail with verification_failed, not false success");

  // Disk space failure
  parseAgentOk(agentCall("dictation-install", [V3_ID, "--consent"]), "start for disk failure");
  for (const id of fakeJobs.keys()) fakeJobs.set(id, { done: true, code: 1, stderr: "Free at least 1.5 GB in the instance data directory to install this model." });
  p = parseAgentOk(agentCall("dictation-progress"), "progress disk failure");
  assert(p.state === "failed" && p.lastJob.failure.code === "disk_space" && p.lastJob.failure.exitCode === 1,
    "disk space error classified accurately");

  // Unsupported Python failure
  parseAgentOk(agentCall("dictation-install", [V3_ID, "--consent"]), "start for python unsupported");
  for (const id of fakeJobs.keys()) fakeJobs.set(id, { done: true, code: 1, stderr: "Install a supported 64-bit Python 3.12 to use local CPU dictation." });
  p = parseAgentOk(agentCall("dictation-progress"), "progress python unsupported");
  assert(p.state === "failed" && p.lastJob.failure.code === "python_unsupported", "python_unsupported classified accurately");
});

test("repeated/concurrent install and cancellation preserve existing selected model until exit is observed", () => {
  reset({}, "windows");
  // Pre-install and explicitly select v2.
  seedRuntime("windows");
  seedModel(V2_ID);
  files[DICTATION_ROOT + "/selected"] = V2_ID;

  // Start installing v3 (upgrade/add second model)
  const started = parseAgentOk(agentCall("dictation-install", [V3_ID, "--consent"]), "start v3 install");
  assert(started.outcome === "started" && execCalls.length === 1, "started v3 install");

  // Repeated same-model install returns active job without spawning a duplicate process
  const repeat = parseAgentOk(agentCall("dictation-install", [V3_ID, "--consent"]), "repeat v3 install");
  assert(repeat.outcome === "already_running" && repeat.job.jobId === started.job.jobId && execCalls.length === 1,
    "repeated install returns active operation with zero duplicate processes");

  // Concurrent different-model install is refused as busy
  const other = agentCall("dictation-install", [V2_ID, "--consent"]);
  assert(other.error && /^busy:/.test(other.error) && execCalls.length === 1, "different model refused while install active");

  // Select refused while install active
  const selBusy = agentCall("dictation-select", [V2_ID]);
  assert(selBusy.error && /^busy:/.test(selBusy.error), "select refused while install active");

  // Request cancel: slot MUST stay held until exit is actually observed!
  const cancelling = parseAgentOk(agentCall("dictation-cancel"), "cancel install");
  assert(cancelling.outcome === "cancelling" && cancelling.job.state === "cancelling", "cancel marks cancelling");
  const nonce = execCalls[0].args[execCalls[0].args.length - 1];
  assert((DICTATION_ROOT + "/.cancel-" + nonce) in files, "cancel marker written for exact active job");
  assert(closedJobs.length === 0, "execClose must NOT run before process exit is observed");

  // Repeated cancel is idempotent
  const cancelAgain = parseAgentOk(agentCall("dictation-cancel"), "repeat cancel");
  assert(cancelAgain.outcome === "already_cancelling", "repeated cancel is idempotent");

  // Another install while cancelling is still blocked (slot not prematurely released!)
  const whileCancelling = agentCall("dictation-install", [V2_ID, "--consent"]);
  assert(whileCancelling.error && /^busy:/.test(whileCancelling.error) && execCalls.length === 1,
    "slot remains held until cancellation exit is actually observed");

  // Now process exits with code 3 (Cancelled)
  for (const id of fakeJobs.keys()) fakeJobs.set(id, { done: true, code: 3 });
  const afterExit = parseAgentOk(agentCall("dictation-progress"), "progress after cancel exit");
  assert(afterExit.state === "cancelled" && afterExit.activeJob === null && afterExit.lastJob.state === "cancelled",
    "observed cancel exit releases slot truthfully");
  assert(closedJobs.length === 1, "job closed after exit observed");
  assert(!((DICTATION_ROOT + "/.cancel-" + nonce) in files), "cancel marker cleaned up");
  assert(files[DICTATION_ROOT + "/selected"] === V2_ID && afterExit.selectedModelId === V2_ID,
    "cancelled upgrade preserves existing installed/selected model");
  assert(agentCall("dictation-cancel").error.startsWith("no_active_install:"), "cancel after exit reports no active install");
});

test("agent dictation-select and dictation-test enforce installed state, bounded bundled sample only, and non-cancellable test", () => {
  reset({}, "windows");
  // Refuses select and test when not installed
  assert(agentCall("dictation-select", [V2_ID]).error.startsWith("model_not_installed:"), "cannot select uninstalled model");
  assert(agentCall("dictation-test").error.startsWith("model_not_installed:"), "cannot test uninstalled model");
  assert(execCalls.length === 0, "no process launched when not installed");

  // Install runtime + both models
  seedRuntime("windows");
  seedModel(V3_ID);
  seedModel(V2_ID);

  // Select v2 explicitly
  const selV2 = parseAgentOk(agentCall("dictation-select", [V2_ID]), "select v2");
  assert(selV2.outcome === "selected" && selV2.selectedModelId === V2_ID, "selected v2");
  assert(files[DICTATION_ROOT + "/selected"] === V2_ID, "selection persisted atomically");
  const selV2Again = parseAgentOk(agentCall("dictation-select", [V2_ID]), "select v2 again");
  assert(selV2Again.outcome === "already_selected", "idempotent select");
  const launch = plugin.dictationLaunch();
  assert(launch.state === "ready" && launch.args[1] === V2_DIR, "dictationLaunch uses newly selected model");

  // Reject arbitrary audio path / extra args in dictation-test
  assert(agentCall("dictation-test", ["/tmp/owner.wav"]).error.startsWith("invalid_model:"), "arbitrary file path rejected");
  assert(agentCall("dictation-test", [V2_ID, "extra"]).error.startsWith("invalid_arguments:"), "extra args rejected");

  // Run bundled sample test for default (currently selected v2 -> 0.wav)
  const testStart = parseAgentOk(agentCall("dictation-test"), "start bundled test");
  assert(testStart.outcome === "started" && testStart.modelId === V2_ID && testStart.sample === "0.wav",
    "test targets selected model's bundled sample only");
  assert(execCalls.length === 1 && execCalls[0].bin === DICTATION_ROOT + "/runtime-py312-sherpa-2.0.2/Scripts/python.exe",
    "test runs inside private runtime python");
  assert(execCalls[0].args[2] === "test" && execCalls[0].args[3] === V2_DIR && execCalls[0].args[4] === "0.wav",
    "test passes exact model dir and bundled sample name");

  // Repeated same-model test returns active job; cancel on test returns not_cancellable
  const testRepeat = parseAgentOk(agentCall("dictation-test", [V2_ID]), "repeat test");
  assert(testRepeat.outcome === "already_running" && execCalls.length === 1, "no duplicate test process");
  assert(agentCall("dictation-cancel").error.startsWith("not_cancellable:"), "test job is not cancellable");

  // Finish test with bundled transcript
  for (const id of fakeJobs.keys()) fakeJobs.set(id, { done: true, code: 0, stdout: "Bundled English test: hello world\n", stderr: "" });
  const testDone = parseAgentOk(agentCall("dictation-progress"), "test progress done");
  assert(testDone.state === "completed" && testDone.lastJob.output === "Bundled English test: hello world",
    "bundled sample transcript returned");

  // Empty test stdout reports test_no_speech failure
  parseAgentOk(agentCall("dictation-test", [V3_ID]), "start v3 test");
  for (const id of fakeJobs.keys()) fakeJobs.set(id, { done: true, code: 0, stdout: "   \n", stderr: "" });
  const emptyTest = parseAgentOk(agentCall("dictation-progress"), "empty test output");
  assert(emptyTest.state === "failed" && emptyTest.lastJob.failure.code === "test_no_speech",
    "empty test stdout reported as typed failure");
});

test("glance and agent share one job lifecycle without duplicates in either direction", () => {
  reset({}, "windows");
  const bundleDir = "C:/plugin/fixture";
  const pythonCalls = () => execCalls.filter((c) => /python/i.test(c.bin));

  // Direction 1: Agent starts install -> Glance sees real progress, cannot duplicate, and can cancel it
  const agentStarted = parseAgentOk(agentCall("dictation-install", [V3_ID, "--consent"]), "agent starts install");
  const nonce1 = pythonCalls()[0].args[pythonCalls()[0].args.length - 1];
  files[DICTATION_ROOT + "/.progress-" + nonce1] = "Downloading model: 90 / 488 MB";

  const glanceView = plugin.renderGlance({}, bundleDir);
  assert(glanceView.nodes.some((n) => n.kind === "note" && n.body === "Downloading model: 90 / 488 MB"),
    "glance displays real progress of agent-started install");
  assert(glanceView.nodes.some((n) => n.kind === "button" && n.action === "dictation:cancel"),
    "glance offers cancel for agent-started install");
  assert(!allNodes(glanceView.nodes).some((n) => n.kind === "button" && String(n.action || "").startsWith("dictation:install:")),
    "glance hides install buttons while agent job is active");

  // Clicking glance install cannot duplicate the job
  plugin.glanceAction("dictation:install:" + V3_ID, {}, bundleDir);
  assert(pythonCalls().length === 1, "glance install cannot duplicate active agent job");

  // Cancelling from glance cancels the exact shared job visible to agent
  plugin.glanceAction("dictation:cancel", {}, bundleDir);
  let prog = parseAgentOk(agentCall("dictation-progress"), "agent sees glance cancel");
  assert(prog.state === "cancelling" && prog.activeJob.jobId === agentStarted.job.jobId,
    "agent sees cancelling state triggered from glance");
  for (const id of fakeJobs.keys()) fakeJobs.set(id, { done: true, code: 3 });
  prog = parseAgentOk(agentCall("dictation-progress"), "agent collects cancel exit");
  assert(prog.state === "cancelled" && prog.activeJob === null, "shared job closed cleanly");

  // Direction 2: Glance starts install -> Agent sees it, cannot duplicate, and can cancel it
  plugin.glanceAction("dictation:install:" + V3_ID, {}, bundleDir);
  assert(pythonCalls().length === 2, "glance started new install after prior exited");
  assert(pythonCalls()[1].args.includes(bundleDir + "/runtime/parakeet.py"), "glance uses bundle runtime path when provided");
  const agentRepeat = parseAgentOk(agentCall("dictation-install", [V3_ID, "--consent"]), "agent repeats glance install");
  assert(agentRepeat.outcome === "already_running" && agentRepeat.job.origin === "glance" && pythonCalls().length === 2,
    "agent returns active glance job without duplicate process");
  const agentCancel = parseAgentOk(agentCall("dictation-cancel"), "agent cancels glance install");
  assert(agentCancel.outcome === "cancelling", "agent cancels glance-started install");
  for (const id of fakeJobs.keys()) fakeJobs.set(id, { done: true, code: 3 });
  const glanceAfter = plugin.glanceAction("dictation:refresh", {}, bundleDir);
  assert(glanceAfter.nodes.some((n) => n.body === "Installation cancelled."), "glance reports shared cancellation");
});

test("stale or lost host jobs release the single slot truthfully instead of wedging", () => {
  reset({}, "windows");
  parseAgentOk(agentCall("dictation-install", [V3_ID, "--consent"]), "start job that host will lose");
  const nonce = execCalls[0].args[execCalls[0].args.length - 1];
  files[DICTATION_ROOT + "/.progress-" + nonce] = "Downloading model: 10 / 488 MB";

  // Simulate host losing/evicting the background job handle (execPoll returns undefined)
  fakeJobs.clear();
  const lost = parseAgentOk(agentCall("dictation-progress"), "progress on lost job");
  assert(lost.state === "failed" && lost.activeJob === null && lost.lastJob.failure.code === "job_lost",
    "lost job transitions cleanly to job_lost and releases slot");
  assert(!((DICTATION_ROOT + "/.progress-" + nonce) in files), "stale progress marker cleaned up");

  // Slot is now free for a fresh install attempt
  const retry = parseAgentOk(agentCall("dictation-install", [V3_ID, "--consent"]), "fresh install after lost job");
  assert(retry.outcome === "started" && execCalls.length === 2, "slot recovered cleanly after lost job");
});

test("live dictation agent setup preserves voice-note settings, remote/local clip transcription, and dictionary byte-for-byte", () => {
  const originalSettings = {
    model: "small",
    language: "ru",
    endpoint: "http://gpu:7891/transcribe",
    dictionary: "в доме => в Domios",
  };
  reset(JSON.parse(JSON.stringify(originalSettings)), "windows");
  execHandler = remoteHandler({ text: "привет в доме", language: "ru" });

  // Run full live dictation agent sequence
  parseAgentOk(agentCall("help"), "help");
  parseAgentOk(agentCall("dictation-status"), "status");
  parseAgentOk(agentCall("dictation-install", [V3_ID, "--consent"]), "install");
  seedRuntime("windows");
  seedModel(V3_ID);
  for (const id of fakeJobs.keys()) fakeJobs.set(id, { done: true, code: 0 });
  parseAgentOk(agentCall("dictation-progress"), "complete install");
  parseAgentOk(agentCall("dictation-select", [V3_ID]), "select v3");
  parseAgentOk(agentCall("dictation-test", [V3_ID]), "test v3");
  for (const id of fakeJobs.keys()) fakeJobs.set(id, { done: true, code: 0, stdout: "Bundled English test: ok" });
  parseAgentOk(agentCall("dictation-progress"), "complete test");

  // Voice-note config and behavior must remain byte-for-byte unchanged
  assert(JSON.stringify(settingsObj) === JSON.stringify(originalSettings), "voice-note settings mutated!");
  const clipStatus = plugin.transcribeStatus();
  assert(clipStatus.state === "ready" && clipStatus.reason === "remote: http://gpu:7891/transcribe",
    "voice-note remote status preserved");
  const clipOut = plugin.transcribe("/tmp/note.oga");
  assert(clipOut.text === "привет в Domios", "voice-note transcription and dictionary preserved: " + JSON.stringify(clipOut));
  const curl = execCalls.find((c) => c.bin === "curl");
  assert(curl && curl.args.includes("language=ru") && curl.args.includes("http://gpu:7891/transcribe"),
    "voice-note endpoint and language=ru preserved");
});

for (const [name, fn] of tests) {
  try { fn(); console.log(`✓ ${name}`); }
  catch (err) { failed += 1; console.error(`✗ ${name}`); console.error(err); }
}
console.log(`transcriber plugin: ${tests.length - failed}/${tests.length} passed`);
if (failed > 0) process.exit(1);
