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
var INSTALL_TIMEOUT_MS = 9e5;
var TEST_TIMEOUT_MS = 2e4;
var RUNTIME_DISK_ESTIMATE = "~1.5 GB";
var RUNTIME_PYTHON_REQUIREMENT = "64-bit Python 3.12";
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
var DEFAULT_MODEL = MODELS[0];
var DEFAULT_MODEL_ID = MODELS[0].id;
function findModel(id) {
  return MODELS.find((model) => model.id === id);
}
var archiveName = (model) => "sherpa-onnx-nemo-" + model.id;
var archiveUrl = (model) => RELEASE + archiveName(model) + ".tar.bz2";
var modelPath = (model) => root() + "/" + model.id + "-" + model.sha256.slice(0, 12);
function* hasExplicitSelection() {
  const selected = (yield* host.io.fs.readFile(selectionPath()))?.trim();
  return Boolean(selected && findModel(selected));
}
function* selectedModel() {
  const selected = (yield* host.io.fs.readFile(selectionPath()))?.trim();
  return (selected ? findModel(selected) : void 0) ?? DEFAULT_MODEL;
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

// transcriber/runtime/parakeet.py
var parakeet_default = `from __future__ import annotations\r
\r
import array\r
import contextlib\r
import hashlib\r
import json\r
import math\r
import os\r
from pathlib import Path\r
import platform\r
import shutil\r
import struct\r
import subprocess\r
import sys\r
import tarfile\r
import threading\r
import time\r
import urllib.parse\r
import urllib.request\r
import venv\r
import wave\r
\r
RATE = 16000\r
MIN_TEST_RATE = 8000\r
MAX_TEST_RATE = 48000\r
FRAME_BYTES = RATE\r
WINDOW_BYTES = RATE * 2 * 6\r
MIN_BYTES = RATE * 2\r
SPEECH_RMS = 180\r
SPEECH_SLICE_SAMPLES = RATE // 10\r
MAX_DICTIONARY_RULES = 200\r
MAX_RULE_CHARS = 128\r
FILES = {"encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"}\r
CHUNK_BYTES = 256 * 1024\r
DOWNLOAD_HOSTS = {"github.com", "release-assets.githubusercontent.com"}\r
\r
\r
class Cancelled(Exception):\r
    pass\r
\r
\r
class OwnerRedirects(urllib.request.HTTPRedirectHandler):\r
    def redirect_request(self, req, fp, code, msg, headers, newurl):\r
        dest = urllib.parse.urlsplit(newurl)\r
        if dest.scheme != "https" or dest.hostname not in DOWNLOAD_HOSTS or dest.username or dest.password:\r
            raise ValueError("The model download redirected outside the release hosts.")\r
        return super().redirect_request(req, fp, code, msg, headers, newurl)\r
\r
\r
def python_supported():\r
    machine = platform.machine().lower()\r
    return (sys.version_info[:2] == (3, 12) and sys.maxsize > 2**32\r
            and (sys.platform != "win32" and machine in {"aarch64", "arm64", "amd64", "x86_64"}\r
                 or sys.platform == "win32" and machine in {"amd64", "x86_64"})\r
            and sys.platform in {"win32", "darwin", "linux"})\r
\r
\r
def worker(model):\r
    os.environ.setdefault("OMP_NUM_THREADS", "4")\r
    import sherpa_onnx\r
    return sherpa_onnx.OfflineRecognizer.from_transducer(\r
        encoder=str(model / "encoder.int8.onnx"),\r
        decoder=str(model / "decoder.int8.onnx"),\r
        joiner=str(model / "joiner.int8.onnx"),\r
        tokens=str(model / "tokens.txt"),\r
        sample_rate=RATE, model_type="nemo_transducer", num_threads=min(4, os.cpu_count() or 1),\r
        provider="cpu",\r
    )\r
\r
\r
def samples(pcm):\r
    values = array.array("h")\r
    values.frombytes(pcm)\r
    if sys.byteorder == "big":\r
        values.byteswap()\r
    return values\r
\r
\r
def heard(pcm):\r
    values = samples(pcm)\r
    if not values:\r
        return False\r
    threshold = SPEECH_RMS * SPEECH_RMS\r
    step = min(len(values), SPEECH_SLICE_SAMPLES)\r
    for start in range(0, len(values), step):\r
        chunk = values[start:start + step]\r
        if sum(value * value for value in chunk) >= len(chunk) * threshold:\r
            return True\r
    return False\r
\r
\r
def decode(recognizer, pcm, sample_rate=RATE):\r
    waveform = samples(pcm)\r
    if not waveform:\r
        return ""\r
    peak = max(abs(min(waveform)), abs(max(waveform)))\r
    if peak == 0:\r
        return ""\r
    gain = min(8.0, max(1.0, 9000 / peak)) / 32768\r
    stream = recognizer.create_stream()\r
    stream.accept_waveform(sample_rate, [value * gain for value in waveform])\r
    recognizer.decode_stream(stream)\r
    return stream.result.text.strip()[:768]\r
\r
\r
def result(committed="", provisional=""):\r
    print(json.dumps({"committed": committed, "provisional": provisional}, ensure_ascii=True), flush=True)\r
\r
\r
def _is_word_char(ch):\r
    return bool(ch) and (ch.isalnum() or ch == "_")\r
\r
\r
def _aligned_lower(text):\r
    lower = text.lower()\r
    if len(lower) == len(text):\r
        return lower\r
    return "".join(ch.lower() if len(ch.lower()) == 1 else ch for ch in text)\r
\r
\r
def load_dictionary(path):\r
    if not path:\r
        return ()\r
    try:\r
        raw = json.loads(Path(path).read_text(encoding="utf-8"))\r
    except Exception:\r
        return ()\r
    if not isinstance(raw, list):\r
        return ()\r
    seen = {}\r
    order = 0\r
    for item in raw:\r
        if not isinstance(item, list) or len(item) != 2:\r
            continue\r
        wrong, right = item\r
        if not isinstance(wrong, str) or not isinstance(right, str):\r
            continue\r
        wrong = wrong.strip()\r
        right = right.strip()\r
        if not wrong or not right or len(wrong) > MAX_RULE_CHARS or len(right) > MAX_RULE_CHARS:\r
            continue\r
        key = _aligned_lower(wrong)\r
        if key not in seen and len(seen) >= MAX_DICTIONARY_RULES:\r
            continue\r
        seen[key] = (order, key, right)\r
        order += 1\r
    ordered = sorted(seen.values(), key=lambda entry: (-len(entry[1]), entry[0]))\r
    return tuple((wrong, right) for _, wrong, right in ordered)\r
\r
\r
def apply_dictionary(text, rules):\r
    if not text or not rules:\r
        return text\r
    lower = _aligned_lower(text)\r
    out = []\r
    i = 0\r
    length = len(text)\r
    while i < length:\r
        matched = None\r
        for wrong, right in rules:\r
            if not wrong or not lower.startswith(wrong, i):\r
                continue\r
            end = i + len(wrong)\r
            if _is_word_char(wrong[0]) and i > 0 and _is_word_char(text[i - 1]):\r
                continue\r
            if _is_word_char(wrong[-1]) and end < length and _is_word_char(text[end]):\r
                continue\r
            matched = (wrong, right)\r
            break\r
        if matched is not None:\r
            out.append(matched[1])\r
            i += len(matched[0])\r
        else:\r
            out.append(text[i])\r
            i += 1\r
    return "".join(out)\r
\r
\r
class _StreamLoader:\r
    def __init__(self, model):\r
        self._done = threading.Event()\r
        self._recognizer = None\r
        self._error = None\r
        self._thread = threading.Thread(\r
            target=self._run, args=(model,), name="parakeet-model-load", daemon=True\r
        )\r
        self._thread.start()\r
\r
    def _run(self, model):\r
        try:\r
            self._recognizer = worker(model)\r
        except Exception as failure:\r
            self._error = f"Could not load the local model: {failure}"[:420]\r
        finally:\r
            self._done.set()\r
\r
    def failed(self):\r
        return self._done.is_set() and self._error is not None\r
\r
    def get(self):\r
        self._done.wait()\r
        if self._error is not None:\r
            print(json.dumps({"error": self._error}), flush=True)\r
            return None\r
        return self._recognizer\r
\r
\r
def streaming(model, rules=()):\r
    source = sys.stdin.buffer\r
    # Start loading immediately so model init overlaps mic setup and lead-in audio.\r
    loader = _StreamLoader(model)\r
    recognizer = None\r
    window = bytearray()\r
    last = ""\r
    since_preview = 0\r
\r
    def ensure_recognizer():\r
        nonlocal recognizer\r
        if recognizer is None:\r
            recognizer = loader.get()\r
        return recognizer\r
\r
    while header := source.read(4):\r
        if len(header) != 4:\r
            raise ValueError("Incomplete microphone frame.")\r
        size, = struct.unpack("<I", header)\r
        if size > FRAME_BYTES or size % 2:\r
            raise ValueError("Invalid microphone frame.")\r
        if not size:\r
            if window:\r
                active = ensure_recognizer()\r
                if active is None:\r
                    return\r
                result(apply_dictionary(decode(active, window), rules))\r
            else:\r
                result("")\r
            return\r
        pcm = source.read(size)\r
        if len(pcm) != size:\r
            raise ValueError("Incomplete microphone audio.")\r
        speech = heard(pcm)\r
        if not window and not speech:\r
            if loader.failed():\r
                loader.get()\r
                return\r
            result()\r
            continue\r
        if loader.failed():\r
            loader.get()\r
            return\r
        window.extend(pcm)\r
        since_preview += size\r
        if len(window) >= WINDOW_BYTES or not speech and len(window) >= MIN_BYTES:\r
            active = ensure_recognizer()\r
            if active is None:\r
                return\r
            result(apply_dictionary(decode(active, window), rules))\r
            window.clear()\r
            last = ""\r
            since_preview = 0\r
        else:\r
            if since_preview >= MIN_BYTES:\r
                active = ensure_recognizer()\r
                if active is None:\r
                    return\r
                last = apply_dictionary(decode(active, window), rules)\r
                since_preview = 0\r
            result(provisional=last)\r
\r
\r
def test_model(model, sample):\r
    with wave.open(str(model / sample), "rb") as clip:\r
        rate = clip.getframerate()\r
        if not (MIN_TEST_RATE <= rate <= MAX_TEST_RATE) or clip.getnchannels() != 1 or clip.getsampwidth() != 2:\r
            raise ValueError("This model's bundled test clip uses an unsupported format.")\r
        text = decode(worker(model), clip.readframes(rate * 12), sample_rate=rate)\r
    if not text:\r
        raise ValueError("The bundled test clip produced no transcript.")\r
    print("Bundled English test: " + text)\r
\r
\r
@contextlib.contextmanager\r
def exclusive_job(root, name):\r
    with (root / name).open("a+b") as lock:\r
        if sys.platform == "win32":\r
            import msvcrt\r
            if lock.tell() == 0:\r
                lock.write(b"0")\r
                lock.flush()\r
            lock.seek(0)\r
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)\r
        else:\r
            import fcntl\r
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)\r
        yield\r
\r
\r
def download(url, target, expected_bytes, expected_hash, checkpoint):\r
    source = urllib.parse.urlsplit(url)\r
    if (source.scheme, source.hostname) != ("https", "github.com") or not source.path.startswith(\r
            "/k2-fsa/sherpa-onnx/releases/download/asr-models/"):\r
        raise ValueError("The model is outside the supported release source.")\r
    digest = hashlib.sha256()\r
    received = 0\r
    next_progress = 0\r
    opener = urllib.request.build_opener(OwnerRedirects())\r
    request = urllib.request.Request(url, headers={"User-Agent": "Domios-Transcriber"})\r
    with opener.open(request, timeout=15) as response, target.open("xb") as output:\r
        while True:\r
            checkpoint()\r
            chunk = response.read(CHUNK_BYTES)\r
            if not chunk:\r
                break\r
            received += len(chunk)\r
            if received > expected_bytes:\r
                raise ValueError("The model download exceeds the pinned length.")\r
            digest.update(chunk)\r
            output.write(chunk)\r
            if received >= next_progress:\r
                checkpoint(f"Downloading model: {received // 1000000} / {math.ceil(expected_bytes / 1000000)} MB")\r
                next_progress = received + 4 * 1024 * 1024\r
    if received != expected_bytes or digest.hexdigest() != expected_hash:\r
        raise ValueError("The model download failed its length or SHA-256 verification.")\r
\r
\r
def unpack(archive, target, archive_name, sample, checkpoint):\r
    target.mkdir()\r
    members = {f"{archive_name}/{name}": name for name in FILES}\r
    members[f"{archive_name}/test_wavs/{sample}"] = sample\r
    missing = set(members)\r
    extracted = 0\r
    with tarfile.open(archive, "r|bz2") as contents:\r
        for member in contents:\r
            checkpoint()\r
            if member.name not in members:\r
                continue\r
            if member.name not in missing or not member.isfile() or member.size <= 0:\r
                raise ValueError("Invalid model archive member.")\r
            extracted += member.size\r
            if extracted > 825 * 1024 * 1024:\r
                raise ValueError("The unpacked model exceeds the installation bound.")\r
            with contents.extractfile(member) as source, (target / members[member.name]).open("xb") as output:\r
                while chunk := source.read(CHUNK_BYTES):\r
                    checkpoint()\r
                    output.write(chunk)\r
            missing.remove(member.name)\r
    if missing:\r
        raise ValueError("The release archive is missing required model files.")\r
\r
\r
def install_runtime(target):\r
    venv.EnvBuilder(with_pip=True, symlinks=False).create(target)\r
    binary = target / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python3.12")\r
    requirements = Path(__file__).with_name("requirements.txt")\r
    environment = os.environ.copy()\r
    environment["PIP_CONFIG_FILE"] = os.devnull\r
    subprocess.run(\r
        [str(binary), "-I", "-m", "pip", "--isolated", "--disable-pip-version-check",\r
         "install", "--no-input", "--no-cache-dir", "--no-deps", "--only-binary=:all:",\r
         "--index-url", "https://pypi.org/simple", "--timeout", "15", "--retries", "0",\r
         "--require-hashes", "-r", str(requirements)],\r
        env=environment, check=True, timeout=180,\r
    )\r
    subprocess.run([str(binary), "-I", "-c", "import sherpa_onnx"], check=True, timeout=20)\r
\r
\r
def install(root, runtime, destination, archive_name, url, count, digest, sample, nonce):\r
    if not python_supported():\r
        raise ValueError("Install a supported 64-bit Python 3.12 to use local CPU dictation.")\r
    if (not nonce or not all(ch.isascii() and (ch.isalnum() or ch == "-") for ch in nonce)\r
            or destination.parent != root or Path(runtime).name != runtime):\r
        raise ValueError("Invalid installation destination.")\r
    root.mkdir(exist_ok=True, parents=True)\r
    progress = root / f".progress-{nonce}"\r
    cancelling = root / f".cancel-{nonce}"\r
    expires = time.monotonic() + 850\r
\r
    def checkpoint(message=None):\r
        if cancelling.exists():\r
            raise Cancelled()\r
        if time.monotonic() > expires:\r
            raise TimeoutError("The installation reached its time limit.")\r
        if message:\r
            progress.write_text(message, encoding="utf-8")\r
\r
    try:\r
        with exclusive_job(root, ".install-lock"):\r
            stage = root / ".owned-install-stage"\r
            marker = stage / ".transcriber-install"\r
            if stage.exists():\r
                if stage.is_symlink() or not marker.is_file():\r
                    raise ValueError("The model staging path is occupied.")\r
                shutil.rmtree(stage)\r
            stage.mkdir()\r
            marker.touch(exist_ok=False)\r
            try:\r
                runtime_path = root / runtime\r
                if shutil.disk_usage(root).free < count * 3:\r
                    raise ValueError("Free at least 1.5 GB in the instance data directory to install this model.")\r
                if not runtime_path.exists():\r
                    checkpoint("Installing the pinned local CPU runtime\u2026")\r
                    install_runtime(stage / "runtime")\r
                if not destination.exists():\r
                    archive = stage / "model.tar.bz2"\r
                    download(url, archive, count, digest, checkpoint)\r
                    checkpoint("Verifying and unpacking the model\u2026")\r
                    unpack(archive, stage / "model", archive_name, sample, checkpoint)\r
                    (stage / "model" / ".verified").write_text(digest, encoding="utf-8")\r
                checkpoint()\r
                if (stage / "runtime").exists():\r
                    (stage / "runtime").rename(runtime_path)\r
                if (stage / "model").exists():\r
                    checkpoint()\r
                    (stage / "model").rename(destination)\r
            finally:\r
                shutil.rmtree(stage)\r
    finally:\r
        progress.unlink(missing_ok=True)\r
        cancelling.unlink(missing_ok=True)\r
\r
\r
def main():\r
    mode, *args = sys.argv[1:]\r
    if mode in {"stream", "test"}:\r
        model = Path(args[0])\r
        with exclusive_job(model.parent, ".inference-lock"):\r
            if mode == "stream":\r
                dict_path = args[1] if len(args) > 1 and args[1] else None\r
                streaming(model, load_dictionary(dict_path))\r
            else:\r
                test_model(model, args[1])\r
    elif mode == "install":\r
        root, runtime, path, archive_name, url, length, digest, sample, nonce = args\r
        install(Path(root), runtime, Path(path), archive_name, url, int(length), digest, sample, nonce)\r
    else:\r
        raise ValueError("Unknown dictation worker mode.")\r
\r
\r
if __name__ == "__main__":\r
    try:\r
        main()\r
    except Cancelled:\r
        sys.exit(3)\r
    except Exception as error:\r
        message = (str(error) or type(error).__name__)[:420]\r
        if len(sys.argv) > 1 and sys.argv[1] == "stream":\r
            print(json.dumps({"error": message}), flush=True)\r
        else:\r
            print(message, file=sys.stderr, flush=True)\r
        sys.exit(1)\r
`;

// transcriber/runtime/requirements.txt
var requirements_default = "sherpa-onnx==2.0.2 \\\r\n    --hash=sha256:afc9f22ffc99d95855f8d281f17151674ecc1f9c4ec7deac15977fc8dbf3892c \\\r\n    --hash=sha256:fded4d4b7976208b5fefd29848d2c9dd8d32ddf4d8896176a2d41550906b7d4b \\\r\n    --hash=sha256:ed4696a1d97ef8f87b1a1cf2c6df0487b4bb7225540156916520a9a2a1e037a6 \\\r\n    --hash=sha256:1f3b170df13a279dfa1f9151e76b98d06df297fa0621364bec7ebbfc2c81c80a \\\r\n    --hash=sha256:47375cbb646f9514fb352c0c68154d787d7d4a3cefd4a90c3bc2918a35eba8fb \\\r\n    --hash=sha256:c54caa5c3ef56c630946382a8effbad87bc61a9e04378b667c1b92280cb26423\r\nsherpa-onnx-core==2.0.2 \\\r\n    --hash=sha256:5b2944fc8fc82ba7d2209b5637e296db01c40652abc343c9973ad45146662cd1 \\\r\n    --hash=sha256:481844a574e30ad2942bb78aae27d679e8e34fa11dbeea6e093126101f9367f7 \\\r\n    --hash=sha256:bce087ab2562ce216829490b1f87c37f5a3f18b773e088f6a0ddaf530c31c020 \\\r\n    --hash=sha256:11e7f94346ae6b812a4eb9371c1ffd0da36a49d33ab79c411a42085e80b565ec \\\r\n    --hash=sha256:ce8ebd70fa5fe887991bccaacaa86fc21ae64c843b7db4e76c7950695265895e \\\r\n    --hash=sha256:41df86dec3e321b0e40d8d6970aff294006eb65f6d3a4410aaddd8c9a42fc85a\r\n";

// transcriber/src/setup.ts
var MAX_PROGRESS_CHARS = 180;
var MAX_OUTPUT_CHARS = 360;
var MAX_ERROR_CHARS = 400;
var WORKER_VERSION = "0.5.1";
function fnv1aHex(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
var WORKER_TAG = WORKER_VERSION + "-" + fnv1aHex(parakeet_default + "\0" + requirements_default);
var fs = () => host.io.fs;
var activeJob = null;
var lastJob = null;
var starting = false;
var glanceNotice = null;
var nonceCounter = 0;
function boundText(value, maxChars) {
  return String(value || "").replace(/\r\n/g, "\n").trim().slice(0, maxChars);
}
function makeNonce() {
  nonceCounter = (nonceCounter + 1) % 1e6;
  return host.unixNowMs().toString(36) + "-" + nonceCounter.toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}
function isSetupStarting() {
  return starting;
}
function currentGlanceNotice() {
  return glanceNotice;
}
function stagedWorkerDir() {
  return root() + "/.worker-" + WORKER_TAG;
}
function classifyFailure(rawMessage, exitCode, mode) {
  const message = boundText(rawMessage, MAX_ERROR_CHARS) || "The local dictation runtime returned an error.";
  const lower = message.toLowerCase();
  let code = "runtime_error";
  if (lower.includes("denied") || lower.includes("not in subprocess.allow") || lower.includes("permission denied") || lower.includes("not allowed") || lower.includes("refused by host") || lower.includes("agent_commands")) {
    code = "host_refused";
  } else if (lower.includes("64-bit python 3.12") || lower.includes("supported 64-bit python")) {
    code = "python_unsupported";
  } else if (lower.includes("executable not found") || lower.includes("enoent") || lower.includes("cannot find the file") || lower.includes("no such file or directory") || lower.includes("not found") && (lower.includes("python") || exitCode === void 0)) {
    code = "python_missing";
  } else if (lower.includes("free at least 1.5 gb") || lower.includes("no space left")) {
    code = "disk_space";
  } else if (lower.includes("sha-256") || lower.includes("pinned length") || lower.includes("invalid model archive") || lower.includes("missing required model files") || lower.includes("installation bound") || lower.includes("staging path is occupied") || lower.includes("without producing a verified")) {
    code = "verification_failed";
  } else if (lower.includes("install-lock") || lower.includes("inference-lock") || lower.includes("resource temporarily unavailable") || lower.includes("permissionerror")) {
    code = "lock_busy";
  } else if (lower.includes("time limit") || lower.includes("timed out") || lower.includes("timeout")) {
    code = "timeout";
  } else if (lower.includes("redirected outside") || lower.includes("urlerror") || lower.includes("httperror") || lower.includes("connection") || lower.includes("ssl") || lower.includes("pypi") || lower.includes("github.com")) {
    code = "network_error";
  } else if (mode === "test" && lower.includes("unsupported format")) {
    code = "test_unsupported_sample";
  } else if (mode === "test" && lower.includes("no transcript")) {
    code = "test_no_speech";
  }
  return exitCode !== void 0 ? { code, message, exitCode } : { code, message };
}
function parseInstallProgress(raw, cancelled) {
  if (cancelled) {
    return { stage: "cancelling", message: "Cancelling installation\u2026" };
  }
  const text = boundText(raw || "", MAX_PROGRESS_CHARS);
  if (!text) {
    return { stage: "starting", message: "Preparing installation\u2026" };
  }
  const downloadMatch = text.match(/^Downloading model:\s*(\d+)\s*\/\s*(\d+)\s*MB\b/i);
  if (downloadMatch) {
    return {
      stage: "downloading_model",
      message: text,
      downloadedMb: Number(downloadMatch[1]),
      totalMb: Number(downloadMatch[2])
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
function* snapshotActiveJob(current) {
  let progress2;
  if (current.mode === "test") {
    progress2 = {
      stage: "testing_model",
      message: "Loading the model and recognizing its English test sample\u2026"
    };
  } else {
    const raw = current.cancelled ? null : yield* fs().readFile(root() + "/.progress-" + current.nonce);
    progress2 = parseInstallProgress(raw, current.cancelled);
  }
  return {
    jobId: current.id,
    mode: current.mode,
    modelId: current.model.id,
    modelLabel: current.model.label,
    origin: current.origin,
    state: current.cancelled ? "cancelling" : "running",
    startedAtMs: current.startedAtMs,
    progress: progress2
  };
}
function noticeFromTerminalJob(snapshot) {
  if (snapshot.state === "cancelled") {
    return { kind: "note", body: "Installation cancelled." };
  }
  if (snapshot.state === "failed") {
    return {
      kind: "note",
      level: "error",
      body: snapshot.failure?.message || "The local dictation runtime returned an error."
    };
  }
  if (snapshot.mode === "test") {
    return { kind: "note", body: snapshot.output || "The test produced no speech." };
  }
  return { kind: "note", body: snapshot.modelLabel + " installed." };
}
function* cleanupInstallMarkers(nonce) {
  yield* fs().removeFile(root() + "/.cancel-" + nonce);
  yield* fs().removeFile(root() + "/.progress-" + nonce);
}
function* collectJob() {
  if (!activeJob) return;
  const current = activeJob;
  const status = yield { op: "execPoll", job: current.id };
  if (activeJob !== current) return;
  if (!status) {
    const failure = {
      code: "job_lost",
      message: "The host no longer tracks this background job. Check dictation-status before retrying."
    };
    const terminal2 = {
      jobId: current.id,
      mode: current.mode,
      modelId: current.model.id,
      modelLabel: current.model.label,
      origin: current.origin,
      state: "failed",
      startedAtMs: current.startedAtMs,
      finishedAtMs: host.unixNowMs(),
      progress: { stage: "failed", message: failure.message },
      failure
    };
    lastJob = terminal2;
    glanceNotice = noticeFromTerminalJob(terminal2);
    activeJob = null;
    yield { op: "execClose", job: current.id };
    if (current.mode === "install") yield* cleanupInstallMarkers(current.nonce);
    return;
  }
  if (status.done === false) return;
  if (status.done !== true) {
    if (typeof status.error === "string" && status.error.trim().length > 0) {
      const failure = classifyFailure(status.error, status.code, current.mode);
      const terminal2 = {
        jobId: current.id,
        mode: current.mode,
        modelId: current.model.id,
        modelLabel: current.model.label,
        origin: current.origin,
        state: "failed",
        startedAtMs: current.startedAtMs,
        finishedAtMs: host.unixNowMs(),
        progress: { stage: "failed", message: failure.message },
        failure
      };
      lastJob = terminal2;
      glanceNotice = noticeFromTerminalJob(terminal2);
      activeJob = null;
      yield { op: "execClose", job: current.id };
      if (current.mode === "install") yield* cleanupInstallMarkers(current.nonce);
    }
    return;
  }
  const finishedAtMs = host.unixNowMs();
  let terminal;
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
      progress: { stage: "cancelled", message: "Installation cancelled." }
    };
  } else if (status.error || status.code !== void 0 && status.code !== 0) {
    const failure = classifyFailure(
      status.stderr || status.error || "The runtime returned an error.",
      status.code,
      current.mode
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
      failure
    };
  } else if (current.mode === "test") {
    const output = boundText(status.stdout || "", MAX_OUTPUT_CHARS);
    if (!output) {
      const failure = {
        code: "test_no_speech",
        message: "The bundled test clip produced no transcript.",
        exitCode: status.code
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
        failure
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
        output
      };
    }
  } else {
    const verified = (yield* hasRuntime()) && (yield* hasModel(current.model));
    if (!verified) {
      const failure = {
        code: "verification_failed",
        message: "The setup process exited without producing a verified local runtime and model.",
        exitCode: status.code
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
        failure
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
        progress: { stage: "completed", message: current.model.label + " installed." }
      };
    }
  }
  lastJob = terminal;
  glanceNotice = noticeFromTerminalJob(terminal);
  activeJob = null;
  yield { op: "execClose", job: current.id };
  if (current.mode === "install") yield* cleanupInstallMarkers(current.nonce);
}
function* ensureStagedWorker() {
  const dir = stagedWorkerDir();
  const scriptPath = dir + "/parakeet.py";
  const reqPath = dir + "/requirements.txt";
  const currentScript = yield* fs().readFile(scriptPath);
  const currentReq = yield* fs().readFile(reqPath);
  if (currentScript === parakeet_default && currentReq === requirements_default) {
    return { ok: true, script: scriptPath, source: "staged" };
  }
  if (!(yield* fs().makeDirs(dir))) {
    return {
      ok: false,
      failure: {
        code: "worker_stage_failed",
        message: "The dictation helper directory could not be created under the plugin data root."
      }
    };
  }
  if (currentScript !== parakeet_default) {
    if (!(yield* fs().writeFileAtomic(scriptPath, parakeet_default))) {
      return {
        ok: false,
        failure: {
          code: "worker_stage_failed",
          message: "The bundled dictation worker could not be staged under the plugin data root."
        }
      };
    }
  }
  if (currentReq !== requirements_default) {
    if (!(yield* fs().writeFileAtomic(reqPath, requirements_default))) {
      return {
        ok: false,
        failure: {
          code: "worker_stage_failed",
          message: "The pinned runtime requirements could not be staged under the plugin data root."
        }
      };
    }
  }
  return { ok: true, script: scriptPath, source: "staged" };
}
function* resolveWorkerScript(bundle) {
  const normalizedBundle = typeof bundle === "string" ? bundle.trim() : "";
  if (normalizedBundle) {
    return { ok: true, script: normalizedBundle.replace(/\\/g, "/") + "/" + WORKER, source: "bundle" };
  }
  return yield* ensureStagedWorker();
}
function* buildStatusSnapshot() {
  const selected = yield* selectedModel();
  const explicitSelection = yield* hasExplicitSelection();
  const runtimeInstalled = yield* hasRuntime();
  const models = [];
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
      ready: installed && runtimeInstalled
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
      python: RUNTIME_PYTHON_REQUIREMENT
    },
    models,
    activeJob: activeJob ? yield* snapshotActiveJob(activeJob) : null,
    lastJob
  };
}
function* getDictationStatus() {
  yield* collectJob();
  return yield* buildStatusSnapshot();
}
function* getDictationProgress() {
  yield* collectJob();
  const status = yield* buildStatusSnapshot();
  const state = status.activeJob ? status.activeJob.state : status.lastJob ? status.lastJob.state : "idle";
  return {
    state,
    activeJob: status.activeJob,
    lastJob: status.lastJob,
    ready: status.ready,
    runtimeInstalled: status.runtimeInstalled,
    selectedModelId: status.selectedModelId
  };
}
function recordImmediateFailure(mode, model, origin, failure) {
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
    failure
  };
  glanceNotice = { kind: "note", level: "error", body: failure.message };
}
function* beginJob(mode, model, origin, bundle) {
  starting = true;
  glanceNotice = null;
  try {
    if (!(yield* fs().makeDirs(root()))) {
      const failure = {
        code: "worker_stage_failed",
        message: "The dictation data directory could not be opened."
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
    const args = mode === "test" ? ["-I", resolved.script, "test", modelPath(model), model.sample] : [
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
      nonce
    ];
    const start = yield {
      op: "execStart",
      options: { bin, args, timeoutMs: mode === "install" ? INSTALL_TIMEOUT_MS : TEST_TIMEOUT_MS }
    };
    if (!start || start.error || !start.jobId) {
      const failure = classifyFailure(
        start?.error || "The local setup process could not start.",
        void 0,
        mode
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
      cancelled: false
    };
    return { ok: true, job: yield* snapshotActiveJob(activeJob) };
  } catch (error) {
    const failure = classifyFailure(String(error), void 0, mode);
    recordImmediateFailure(mode, model, origin, failure);
    return { ok: false, failure };
  } finally {
    starting = false;
  }
}
function* startInstall(model, origin, bundle) {
  yield* collectJob();
  if (starting) {
    return {
      ok: false,
      outcome: "busy",
      activeJob: activeJob ? yield* snapshotActiveJob(activeJob) : null,
      message: "A live dictation setup job is already starting."
    };
  }
  if (activeJob) {
    const current = yield* snapshotActiveJob(activeJob);
    if (activeJob.mode === "install" && activeJob.model.id === model.id) {
      return {
        ok: true,
        outcome: "already_running",
        job: current,
        status: yield* buildStatusSnapshot()
      };
    }
    return {
      ok: false,
      outcome: "busy",
      activeJob: current,
      message: "Another live dictation " + current.mode + " job (" + current.modelId + ", " + current.state + ") is active. Wait for it to finish or cancel the install first."
    };
  }
  if ((yield* hasRuntime()) && (yield* hasModel(model))) {
    const matchingLast = lastJob && lastJob.mode === "install" && lastJob.modelId === model.id ? lastJob : null;
    return {
      ok: true,
      outcome: "already_installed",
      job: matchingLast,
      status: yield* buildStatusSnapshot()
    };
  }
  const started = yield* beginJob("install", model, origin, bundle);
  const status = yield* buildStatusSnapshot();
  if (!started.ok) {
    return { ok: false, outcome: "failed", failure: started.failure, status };
  }
  return { ok: true, outcome: "started", job: started.job, status };
}
function* cancelInstall() {
  yield* collectJob();
  if (!activeJob) {
    return {
      ok: false,
      outcome: "no_active_install",
      lastJob,
      message: "No live dictation installation is currently running."
    };
  }
  if (activeJob.mode !== "install") {
    return {
      ok: false,
      outcome: "not_cancellable",
      activeJob: yield* snapshotActiveJob(activeJob),
      message: "Only an active installation can be cancelled; a bundled model test completes automatically."
    };
  }
  if (activeJob.cancelled) {
    return {
      ok: true,
      outcome: "already_cancelling",
      job: yield* snapshotActiveJob(activeJob),
      status: yield* buildStatusSnapshot()
    };
  }
  const expected = activeJob;
  const wrote = yield* fs().writeFileAtomic(root() + "/.cancel-" + expected.nonce, "");
  if (!wrote) {
    const failure = {
      code: "runtime_error",
      message: "Could not signal cancellation for the active installation."
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
    status: yield* buildStatusSnapshot()
  };
}
function* selectInstalledModel(model) {
  yield* collectJob();
  if (starting || activeJob) {
    return {
      ok: false,
      outcome: "busy",
      activeJob: activeJob ? yield* snapshotActiveJob(activeJob) : null,
      message: "Wait for the active live dictation job to finish or cancel it before changing the selected model."
    };
  }
  if (!(yield* hasRuntime()) || !(yield* hasModel(model))) {
    return {
      ok: false,
      outcome: "not_installed",
      message: model.label + " and the local CPU runtime must be installed before selecting this model."
    };
  }
  const current = yield* selectedModel();
  const explicit = yield* hasExplicitSelection();
  if (explicit && current.id === model.id) {
    glanceNotice = null;
    return { ok: true, outcome: "already_selected", status: yield* buildStatusSnapshot() };
  }
  if (!(yield* fs().makeDirs(root())) || !(yield* fs().writeFileAtomic(selectionPath(), model.id))) {
    const failure = {
      code: "selection_save_failed",
      message: "The selected model could not be saved."
    };
    glanceNotice = { kind: "note", level: "error", body: failure.message };
    return { ok: false, outcome: "failed", failure };
  }
  glanceNotice = null;
  return { ok: true, outcome: "selected", status: yield* buildStatusSnapshot() };
}
function* startModelTest(model, origin, bundle) {
  yield* collectJob();
  if (starting) {
    return {
      ok: false,
      outcome: "busy",
      activeJob: activeJob ? yield* snapshotActiveJob(activeJob) : null,
      message: "A live dictation job is already starting."
    };
  }
  if (activeJob) {
    const current = yield* snapshotActiveJob(activeJob);
    if (activeJob.mode === "test" && activeJob.model.id === model.id) {
      return {
        ok: true,
        outcome: "already_running",
        job: current,
        status: yield* buildStatusSnapshot()
      };
    }
    return {
      ok: false,
      outcome: "busy",
      activeJob: current,
      message: "Another live dictation " + current.mode + " job (" + current.modelId + ", " + current.state + ") is active. Wait for it to finish first."
    };
  }
  if (!(yield* hasRuntime()) || !(yield* hasModel(model))) {
    return {
      ok: false,
      outcome: "not_installed",
      message: model.label + " and the local CPU runtime must be installed before running the bundled sample test."
    };
  }
  const started = yield* beginJob("test", model, origin, bundle);
  const status = yield* buildStatusSnapshot();
  if (!started.ok) {
    return { ok: false, outcome: "failed", failure: started.failure, status };
  }
  return { ok: true, outcome: "started", job: started.job, status };
}

// transcriber/src/agent.ts
var PLUGIN_VERSION = "0.5.1";
var VALID_MODEL_IDS = MODELS.map((m) => m.id).join(", ");
function hasUnexpectedBody(ctx) {
  return typeof ctx.body === "string" && ctx.body.trim().length > 0;
}
function normalizeArgs(ctx) {
  return Array.isArray(ctx.args) ? ctx.args.map((arg) => String(arg)) : [];
}
function buildHelpPayload() {
  return {
    plugin: "transcriber",
    version: PLUGIN_VERSION,
    runtimeId: RUNTIME,
    defaultModelId: DEFAULT_MODEL_ID,
    verbs: [
      {
        verb: "dictation-status",
        usage: "domios plugin transcriber dictation-status",
        readOnly: true,
        description: "Inspect live dictation model/runtime installation state, catalog, selection, and active/last setup job."
      },
      {
        verb: "dictation-install",
        usage: "domios plugin transcriber dictation-install [model-id] --consent",
        readOnly: false,
        description: "Install the local CPU runtime and selected Parakeet model (defaults to parakeet-tdt-0.6b-v3-int8) after explicit owner approval."
      },
      {
        verb: "dictation-progress",
        usage: "domios plugin transcriber dictation-progress",
        readOnly: true,
        description: "Inspect real setup stage, downloaded/total MB, active status, or terminal outcome/typed failure."
      },
      {
        verb: "dictation-cancel",
        usage: "domios plugin transcriber dictation-cancel",
        readOnly: false,
        description: "Request cancellation of an in-progress installation; poll dictation-progress until exit is observed."
      },
      {
        verb: "dictation-select",
        usage: "domios plugin transcriber dictation-select <model-id>",
        readOnly: false,
        description: "Select an installed local Parakeet model for future live dictation sessions."
      },
      {
        verb: "dictation-test",
        usage: "domios plugin transcriber dictation-test [model-id]",
        readOnly: false,
        description: "Run the bundled English WAV sample test for an installed model (defaults to the selected model)."
      },
      {
        verb: "help",
        usage: "domios plugin transcriber help",
        readOnly: true,
        description: "Show supported commands, model catalog, requirements, and consent/permission rules without starting setup."
      }
    ],
    models: MODELS.map((model) => ({
      id: model.id,
      label: model.label,
      languages: model.languages,
      size: model.size,
      bytes: model.bytes,
      sample: model.sample,
      isDefault: model.id === DEFAULT_MODEL_ID
    })),
    requirements: {
      modelDownload: "Parakeet TDT 0.6B v3 (Russian-capable default): ~487 MB; Parakeet TDT 0.6B v2 (English): ~482 MB.",
      diskSpace: RUNTIME_DISK_ESTIMATE + " free disk space in the instance plugin data directory (private runtime + unpacked model).",
      python: RUNTIME_PYTHON_REQUIREMENT + " (Windows x64 python.exe; macOS/Linux x64 or arm64 python3.12).",
      subprocess: "Spawns local Python (-I) with the bundled parakeet.py helper under the host subprocess permission allowlist.",
      network: "Downloads pinned sherpa-onnx==2.0.2 wheels from https://pypi.org/simple and the model archive from https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/, verified against pinned SHA-256 hashes.",
      filesystem: "Writes only inside the host-assigned plugin data directory (<dataDir>/transcriber/live-dictation)."
    },
    consent: {
      flag: "--consent",
      rule: "Explain the ~487 MB model download, ~1.5 GB disk / 64-bit Python 3.12 runtime, and subprocess/network/filesystem effects to the owner and get explicit approval before passing --consent.",
      hostAuthority: "--consent records owner confirmation for this plugin command only; it is not a host permission grant. Domios natively enforces agent_commands and subprocess permissions."
    },
    boundaries: {
      voiceNotes: "Separate from voice-note Whisper settings (model, language, endpoint) and inbound integrations.voice_transcribe, which remain untouched.",
      microphoneAndDraft: "Live dictation setup and bundled sample testing never open the microphone, alter OS permissions, or insert text into the composer draft."
    }
  };
}
function consentRequiredError(model) {
  return "consent_required: Explicit owner consent is required before installing " + model.label + " (" + model.id + ", " + model.size + " model download; " + RUNTIME_DISK_ESTIMATE + " free disk space with private " + RUNTIME_PYTHON_REQUIREMENT + " CPU runtime; downloads pinned wheels from PyPI and model archive from GitHub with SHA-256 verification; runs local Python subprocess under the plugin data directory). After informing the owner and receiving explicit approval, run: domios plugin transcriber dictation-install " + model.id + " --consent. Note: --consent confirms owner approval for this command only and is not a host permission grant; Domios enforces agent_commands and subprocess permissions natively.";
}
function parseInstallArgs(args) {
  if (args.length > 2) {
    return {
      ok: false,
      error: "invalid_arguments: Usage: dictation-install [model-id] --consent. Valid models: " + VALID_MODEL_IDS + "."
    };
  }
  let consented = false;
  let model = null;
  for (const arg of args) {
    if (arg === "--consent") {
      if (consented) {
        return { ok: false, error: "invalid_arguments: Duplicate --consent flag." };
      }
      consented = true;
      continue;
    }
    if (arg.startsWith("-")) {
      return {
        ok: false,
        error: "invalid_arguments: Unknown option `" + arg + "`. Usage: dictation-install [model-id] --consent."
      };
    }
    if (model) {
      return {
        ok: false,
        error: "invalid_arguments: Expected at most one model-id. Valid models: " + VALID_MODEL_IDS + "."
      };
    }
    const found = findModel(arg);
    if (!found) {
      return {
        ok: false,
        error: "invalid_model: Unknown model `" + arg + "`. Valid models: " + VALID_MODEL_IDS + "."
      };
    }
    model = found;
  }
  return { ok: true, model: model ?? DEFAULT_MODEL, consented };
}
function* onAgentCommand(ctx) {
  const verb = typeof ctx?.verb === "string" ? ctx.verb.trim() : "";
  const args = normalizeArgs(ctx);
  if (hasUnexpectedBody(ctx)) {
    return {
      error: "invalid_arguments: Transcriber dictation commands do not accept a stdin/file body. Use explicit CLI arguments; run `help` for usage."
    };
  }
  switch (verb) {
    case "help": {
      if (args.length) return { error: "invalid_arguments: Usage: help (takes no arguments)." };
      return { result: JSON.stringify(buildHelpPayload()) };
    }
    case "dictation-status": {
      if (args.length) return { error: "invalid_arguments: Usage: dictation-status (takes no arguments)." };
      const status = yield* getDictationStatus();
      return { result: JSON.stringify(status) };
    }
    case "dictation-progress": {
      if (args.length) return { error: "invalid_arguments: Usage: dictation-progress (takes no arguments)." };
      const progress2 = yield* getDictationProgress();
      return { result: JSON.stringify(progress2) };
    }
    case "dictation-install": {
      const parsed = parseInstallArgs(args);
      if (!parsed.ok) return { error: parsed.error };
      if (!parsed.consented) {
        return { error: consentRequiredError(parsed.model) };
      }
      const res = yield* startInstall(parsed.model, "agent");
      if (!res.ok) {
        if (res.outcome === "busy") {
          return { error: "busy: " + res.message };
        }
        return { error: res.failure.code + ": " + res.failure.message };
      }
      return {
        result: JSON.stringify({
          ok: true,
          outcome: res.outcome,
          modelId: parsed.model.id,
          modelLabel: parsed.model.label,
          job: res.job,
          status: res.status,
          next: res.outcome === "already_installed" ? "Model and runtime are already installed. Use dictation-select or dictation-test if needed." : "Poll `domios plugin transcriber dictation-progress` to observe real setup stages and completion."
        })
      };
    }
    case "dictation-cancel": {
      if (args.length) return { error: "invalid_arguments: Usage: dictation-cancel (takes no arguments)." };
      const res = yield* cancelInstall();
      if (!res.ok) {
        if (res.outcome === "no_active_install") {
          return { error: "no_active_install: " + res.message };
        }
        if (res.outcome === "not_cancellable") {
          return { error: "not_cancellable: " + res.message };
        }
        return { error: res.failure.code + ": " + res.failure.message };
      }
      return {
        result: JSON.stringify({
          ok: true,
          outcome: res.outcome,
          job: res.job,
          status: res.status,
          next: "Poll `domios plugin transcriber dictation-progress` until cancellation exit is observed."
        })
      };
    }
    case "dictation-select": {
      if (args.length !== 1 || args[0].startsWith("-")) {
        return {
          error: "invalid_arguments: Usage: dictation-select <model-id>. Valid models: " + VALID_MODEL_IDS + "."
        };
      }
      const model = findModel(args[0]);
      if (!model) {
        return {
          error: "invalid_model: Unknown model `" + args[0] + "`. Valid models: " + VALID_MODEL_IDS + "."
        };
      }
      const res = yield* selectInstalledModel(model);
      if (!res.ok) {
        if (res.outcome === "busy") return { error: "busy: " + res.message };
        if (res.outcome === "not_installed") return { error: "model_not_installed: " + res.message };
        return { error: res.failure.code + ": " + res.failure.message };
      }
      return {
        result: JSON.stringify({
          ok: true,
          outcome: res.outcome,
          selectedModelId: model.id,
          selectedModelLabel: model.label,
          status: res.status
        })
      };
    }
    case "dictation-test": {
      if (args.length > 1 || args.length === 1 && args[0].startsWith("-")) {
        return {
          error: "invalid_arguments: Usage: dictation-test [model-id]. Valid models: " + VALID_MODEL_IDS + "."
        };
      }
      const model = args.length === 1 ? findModel(args[0]) : yield* selectedModel();
      if (!model) {
        return {
          error: "invalid_model: Unknown model `" + args[0] + "`. Valid models: " + VALID_MODEL_IDS + "."
        };
      }
      const res = yield* startModelTest(model, "agent");
      if (!res.ok) {
        if (res.outcome === "busy") return { error: "busy: " + res.message };
        if (res.outcome === "not_installed") return { error: "model_not_installed: " + res.message };
        return { error: res.failure.code + ": " + res.failure.message };
      }
      return {
        result: JSON.stringify({
          ok: true,
          outcome: res.outcome,
          modelId: model.id,
          modelLabel: model.label,
          sample: model.sample,
          job: res.job,
          status: res.status,
          next: "Poll `domios plugin transcriber dictation-progress` to read the bundled sample transcript."
        })
      };
    }
    default:
      return {
        error: "unknown_verb: Unsupported Transcriber verb `" + verb + "`. Supported verbs: dictation-status, dictation-install, dictation-progress, dictation-cancel, dictation-select, dictation-test, help."
      };
  }
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
function* modelGlance(clip, bundle) {
  const status = yield* getDictationStatus();
  const nodes = [{ kind: "text", text: "Live dictation" }];
  if (!status.runtimeInstalled) {
    nodes.push({ kind: "note", body: "Setup uses local CPU inference and needs a supported 64-bit Python 3.12 installation." });
  }
  const running = status.activeJob;
  if (running) {
    nodes.push({ kind: "note", body: running.progress.message });
    nodes.push({ kind: "button", label: "Refresh status", action: "dictation:refresh" });
    if (running.mode === "install" && running.state !== "cancelling") {
      nodes.push({ kind: "button", label: "Cancel installation", action: "dictation:cancel" });
    }
  }
  const notice = currentGlanceNotice();
  if (!running && notice) nodes.push(notice);
  for (const model of status.models) {
    const details = [
      { kind: "text", text: model.label },
      { kind: "text", text: model.languages + " \xB7 " + model.size + " \xB7 CPU", style: { tone: "muted" } }
    ];
    const controls = [];
    if (model.selected) {
      controls.push({
        kind: "badge",
        label: model.ready ? "Selected \xB7 Installed" : "Selected",
        tone: model.ready ? "ok" : "muted"
      });
    } else if (model.installed) {
      controls.push({ kind: "badge", label: "Installed", tone: "ok" });
    }
    if (!isSetupStarting() && !running) {
      if (!model.ready) {
        controls.push({ kind: "button", label: "Install " + model.size, action: "dictation:install:" + model.id });
      } else if (!model.selected) {
        controls.push({ kind: "button", label: "Use model", action: "dictation:select:" + model.id });
      } else {
        controls.push({ kind: "button", label: "Test model", action: "dictation:test:" + model.id });
      }
    }
    if (controls.length) details.push({ kind: "row", children: controls });
    nodes.push({ kind: "divider" }, { kind: "stack", style: { spacing: "sm" }, children: details });
  }
  const clipView = yield* clip;
  return {
    title: "Transcriber",
    nodes: [...nodes, { kind: "divider" }, { kind: "text", text: "Voice notes" }, ...clipView.nodes]
  };
}
function* modelGlanceAction(action, clip, bundle) {
  const [, verb, id] = action.split(":");
  const model = id ? findModel(id) : void 0;
  if (verb === "cancel") {
    yield* cancelInstall();
  } else if (model) {
    if (verb === "install") {
      yield* startInstall(model, "glance", bundle);
    } else if (verb === "select") {
      yield* selectInstalledModel(model);
    } else if (verb === "test") {
      yield* startModelTest(model, "glance", bundle);
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
  onAgentCommand: (ctx) => host.io.run(onAgentCommand(ctx)),
  renderGlance: (_ctx, bundle) => host.io.run(modelGlance(renderGlance(), bundle)),
  glanceAction: (action, _ctx, bundle) => host.io.run(
    action.startsWith("dictation:") ? modelGlanceAction(action, renderGlance(), bundle) : modelGlance(glanceAction(action), bundle)
  )
};
var plugin_default = plugin;
