from __future__ import annotations

import array
import contextlib
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import shutil
import struct
import subprocess
import sys
import tarfile
import threading
import time
import urllib.parse
import urllib.request
import venv
import wave

RATE = 16000
MIN_TEST_RATE = 8000
MAX_TEST_RATE = 48000
FRAME_BYTES = RATE
WINDOW_BYTES = RATE * 2 * 6
MIN_BYTES = RATE * 2
SPEECH_RMS = 180
SPEECH_SLICE_SAMPLES = RATE // 10
MAX_DICTIONARY_RULES = 200
MAX_RULE_CHARS = 128
FILES = {"encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"}
CHUNK_BYTES = 256 * 1024
DOWNLOAD_HOSTS = {"github.com", "release-assets.githubusercontent.com"}


class Cancelled(Exception):
    pass


class OwnerRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        dest = urllib.parse.urlsplit(newurl)
        if dest.scheme != "https" or dest.hostname not in DOWNLOAD_HOSTS or dest.username or dest.password:
            raise ValueError("The model download redirected outside the release hosts.")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def python_supported():
    machine = platform.machine().lower()
    return (sys.version_info[:2] == (3, 12) and sys.maxsize > 2**32
            and (sys.platform != "win32" and machine in {"aarch64", "arm64", "amd64", "x86_64"}
                 or sys.platform == "win32" and machine in {"amd64", "x86_64"})
            and sys.platform in {"win32", "darwin", "linux"})


def worker(model):
    os.environ.setdefault("OMP_NUM_THREADS", "4")
    import sherpa_onnx
    return sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=str(model / "encoder.int8.onnx"),
        decoder=str(model / "decoder.int8.onnx"),
        joiner=str(model / "joiner.int8.onnx"),
        tokens=str(model / "tokens.txt"),
        sample_rate=RATE, model_type="nemo_transducer", num_threads=min(4, os.cpu_count() or 1),
        provider="cpu",
    )


def samples(pcm):
    values = array.array("h")
    values.frombytes(pcm)
    if sys.byteorder == "big":
        values.byteswap()
    return values


def heard(pcm):
    values = samples(pcm)
    if not values:
        return False
    threshold = SPEECH_RMS * SPEECH_RMS
    step = min(len(values), SPEECH_SLICE_SAMPLES)
    for start in range(0, len(values), step):
        chunk = values[start:start + step]
        if sum(value * value for value in chunk) >= len(chunk) * threshold:
            return True
    return False


def decode(recognizer, pcm, sample_rate=RATE):
    waveform = samples(pcm)
    if not waveform:
        return ""
    peak = max(abs(min(waveform)), abs(max(waveform)))
    if peak == 0:
        return ""
    gain = min(8.0, max(1.0, 9000 / peak)) / 32768
    stream = recognizer.create_stream()
    stream.accept_waveform(sample_rate, [value * gain for value in waveform])
    recognizer.decode_stream(stream)
    return stream.result.text.strip()[:768]


def result(committed="", provisional=""):
    print(json.dumps({"committed": committed, "provisional": provisional}, ensure_ascii=True), flush=True)


def _is_word_char(ch):
    return bool(ch) and (ch.isalnum() or ch == "_")


def _aligned_lower(text):
    lower = text.lower()
    if len(lower) == len(text):
        return lower
    return "".join(ch.lower() if len(ch.lower()) == 1 else ch for ch in text)


def load_dictionary(path):
    if not path:
        return ()
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return ()
    if not isinstance(raw, list):
        return ()
    seen = {}
    order = 0
    for item in raw:
        if not isinstance(item, list) or len(item) != 2:
            continue
        wrong, right = item
        if not isinstance(wrong, str) or not isinstance(right, str):
            continue
        wrong = wrong.strip()
        right = right.strip()
        if not wrong or not right or len(wrong) > MAX_RULE_CHARS or len(right) > MAX_RULE_CHARS:
            continue
        key = _aligned_lower(wrong)
        if key not in seen and len(seen) >= MAX_DICTIONARY_RULES:
            continue
        seen[key] = (order, key, right)
        order += 1
    ordered = sorted(seen.values(), key=lambda entry: (-len(entry[1]), entry[0]))
    return tuple((wrong, right) for _, wrong, right in ordered)


def apply_dictionary(text, rules):
    if not text or not rules:
        return text
    lower = _aligned_lower(text)
    out = []
    i = 0
    length = len(text)
    while i < length:
        matched = None
        for wrong, right in rules:
            if not wrong or not lower.startswith(wrong, i):
                continue
            end = i + len(wrong)
            if _is_word_char(wrong[0]) and i > 0 and _is_word_char(text[i - 1]):
                continue
            if _is_word_char(wrong[-1]) and end < length and _is_word_char(text[end]):
                continue
            matched = (wrong, right)
            break
        if matched is not None:
            out.append(matched[1])
            i += len(matched[0])
        else:
            out.append(text[i])
            i += 1
    return "".join(out)


class _StreamLoader:
    def __init__(self, model):
        self._done = threading.Event()
        self._recognizer = None
        self._error = None
        self._thread = threading.Thread(
            target=self._run, args=(model,), name="parakeet-model-load", daemon=True
        )
        self._thread.start()

    def _run(self, model):
        try:
            self._recognizer = worker(model)
        except Exception as failure:
            self._error = f"Could not load the local model: {failure}"[:420]
        finally:
            self._done.set()

    def failed(self):
        return self._done.is_set() and self._error is not None

    def get(self):
        self._done.wait()
        if self._error is not None:
            print(json.dumps({"error": self._error}), flush=True)
            return None
        return self._recognizer


def streaming(model, rules=()):
    source = sys.stdin.buffer
    # Start loading immediately so model init overlaps mic setup and lead-in audio.
    loader = _StreamLoader(model)
    recognizer = None
    window = bytearray()
    last = ""
    since_preview = 0

    def ensure_recognizer():
        nonlocal recognizer
        if recognizer is None:
            recognizer = loader.get()
        return recognizer

    while header := source.read(4):
        if len(header) != 4:
            raise ValueError("Incomplete microphone frame.")
        size, = struct.unpack("<I", header)
        if size > FRAME_BYTES or size % 2:
            raise ValueError("Invalid microphone frame.")
        if not size:
            if window:
                active = ensure_recognizer()
                if active is None:
                    return
                result(apply_dictionary(decode(active, window), rules))
            else:
                result("")
            return
        pcm = source.read(size)
        if len(pcm) != size:
            raise ValueError("Incomplete microphone audio.")
        speech = heard(pcm)
        if not window and not speech:
            if loader.failed():
                loader.get()
                return
            result()
            continue
        if loader.failed():
            loader.get()
            return
        window.extend(pcm)
        since_preview += size
        if len(window) >= WINDOW_BYTES or not speech and len(window) >= MIN_BYTES:
            active = ensure_recognizer()
            if active is None:
                return
            result(apply_dictionary(decode(active, window), rules))
            window.clear()
            last = ""
            since_preview = 0
        else:
            if since_preview >= MIN_BYTES:
                active = ensure_recognizer()
                if active is None:
                    return
                last = apply_dictionary(decode(active, window), rules)
                since_preview = 0
            result(provisional=last)


def test_model(model, sample):
    with wave.open(str(model / sample), "rb") as clip:
        rate = clip.getframerate()
        if not (MIN_TEST_RATE <= rate <= MAX_TEST_RATE) or clip.getnchannels() != 1 or clip.getsampwidth() != 2:
            raise ValueError("This model's bundled test clip uses an unsupported format.")
        text = decode(worker(model), clip.readframes(rate * 12), sample_rate=rate)
    if not text:
        raise ValueError("The bundled test clip produced no transcript.")
    print("Bundled English test: " + text)


@contextlib.contextmanager
def exclusive_job(root, name):
    with (root / name).open("a+b") as lock:
        if sys.platform == "win32":
            import msvcrt
            if lock.tell() == 0:
                lock.write(b"0")
                lock.flush()
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def download(url, target, expected_bytes, expected_hash, checkpoint):
    source = urllib.parse.urlsplit(url)
    if (source.scheme, source.hostname) != ("https", "github.com") or not source.path.startswith(
            "/k2-fsa/sherpa-onnx/releases/download/asr-models/"):
        raise ValueError("The model is outside the supported release source.")
    digest = hashlib.sha256()
    received = 0
    next_progress = 0
    opener = urllib.request.build_opener(OwnerRedirects())
    request = urllib.request.Request(url, headers={"User-Agent": "Domios-Transcriber"})
    with opener.open(request, timeout=15) as response, target.open("xb") as output:
        while True:
            checkpoint()
            chunk = response.read(CHUNK_BYTES)
            if not chunk:
                break
            received += len(chunk)
            if received > expected_bytes:
                raise ValueError("The model download exceeds the pinned length.")
            digest.update(chunk)
            output.write(chunk)
            if received >= next_progress:
                checkpoint(f"Downloading model: {received // 1000000} / {math.ceil(expected_bytes / 1000000)} MB")
                next_progress = received + 4 * 1024 * 1024
    if received != expected_bytes or digest.hexdigest() != expected_hash:
        raise ValueError("The model download failed its length or SHA-256 verification.")


def unpack(archive, target, archive_name, sample, checkpoint):
    target.mkdir()
    members = {f"{archive_name}/{name}": name for name in FILES}
    members[f"{archive_name}/test_wavs/{sample}"] = sample
    missing = set(members)
    extracted = 0
    with tarfile.open(archive, "r|bz2") as contents:
        for member in contents:
            checkpoint()
            if member.name not in members:
                continue
            if member.name not in missing or not member.isfile() or member.size <= 0:
                raise ValueError("Invalid model archive member.")
            extracted += member.size
            if extracted > 825 * 1024 * 1024:
                raise ValueError("The unpacked model exceeds the installation bound.")
            with contents.extractfile(member) as source, (target / members[member.name]).open("xb") as output:
                while chunk := source.read(CHUNK_BYTES):
                    checkpoint()
                    output.write(chunk)
            missing.remove(member.name)
    if missing:
        raise ValueError("The release archive is missing required model files.")


def install_runtime(target):
    venv.EnvBuilder(with_pip=True, symlinks=False).create(target)
    binary = target / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python3.12")
    requirements = Path(__file__).with_name("requirements.txt")
    environment = os.environ.copy()
    environment["PIP_CONFIG_FILE"] = os.devnull
    subprocess.run(
        [str(binary), "-I", "-m", "pip", "--isolated", "--disable-pip-version-check",
         "install", "--no-input", "--no-cache-dir", "--no-deps", "--only-binary=:all:",
         "--index-url", "https://pypi.org/simple", "--timeout", "15", "--retries", "0",
         "--require-hashes", "-r", str(requirements)],
        env=environment, check=True, timeout=180,
    )
    subprocess.run([str(binary), "-I", "-c", "import sherpa_onnx"], check=True, timeout=20)


def install(root, runtime, destination, archive_name, url, count, digest, sample, nonce):
    if not python_supported():
        raise ValueError("Install a supported 64-bit Python 3.12 to use local CPU dictation.")
    if (not nonce or not all(ch.isascii() and (ch.isalnum() or ch == "-") for ch in nonce)
            or destination.parent != root or Path(runtime).name != runtime):
        raise ValueError("Invalid installation destination.")
    root.mkdir(exist_ok=True, parents=True)
    progress = root / f".progress-{nonce}"
    cancelling = root / f".cancel-{nonce}"
    expires = time.monotonic() + 850

    def checkpoint(message=None):
        if cancelling.exists():
            raise Cancelled()
        if time.monotonic() > expires:
            raise TimeoutError("The installation reached its time limit.")
        if message:
            progress.write_text(message, encoding="utf-8")

    try:
        with exclusive_job(root, ".install-lock"):
            stage = root / ".owned-install-stage"
            marker = stage / ".transcriber-install"
            if stage.exists():
                if stage.is_symlink() or not marker.is_file():
                    raise ValueError("The model staging path is occupied.")
                shutil.rmtree(stage)
            stage.mkdir()
            marker.touch(exist_ok=False)
            try:
                runtime_path = root / runtime
                if shutil.disk_usage(root).free < count * 3:
                    raise ValueError("Free at least 1.5 GB in the instance data directory to install this model.")
                if not runtime_path.exists():
                    checkpoint("Installing the pinned local CPU runtime…")
                    install_runtime(stage / "runtime")
                if not destination.exists():
                    archive = stage / "model.tar.bz2"
                    download(url, archive, count, digest, checkpoint)
                    checkpoint("Verifying and unpacking the model…")
                    unpack(archive, stage / "model", archive_name, sample, checkpoint)
                    (stage / "model" / ".verified").write_text(digest, encoding="utf-8")
                checkpoint()
                if (stage / "runtime").exists():
                    (stage / "runtime").rename(runtime_path)
                if (stage / "model").exists():
                    checkpoint()
                    (stage / "model").rename(destination)
            finally:
                shutil.rmtree(stage)
    finally:
        progress.unlink(missing_ok=True)
        cancelling.unlink(missing_ok=True)


def main():
    mode, *args = sys.argv[1:]
    if mode in {"stream", "test"}:
        model = Path(args[0])
        with exclusive_job(model.parent, ".inference-lock"):
            if mode == "stream":
                dict_path = args[1] if len(args) > 1 and args[1] else None
                streaming(model, load_dictionary(dict_path))
            else:
                test_model(model, args[1])
    elif mode == "install":
        root, runtime, path, archive_name, url, length, digest, sample, nonce = args
        install(Path(root), runtime, Path(path), archive_name, url, int(length), digest, sample, nonce)
    else:
        raise ValueError("Unknown dictation worker mode.")


if __name__ == "__main__":
    try:
        main()
    except Cancelled:
        sys.exit(3)
    except Exception as error:
        message = (str(error) or type(error).__name__)[:420]
        if len(sys.argv) > 1 and sys.argv[1] == "stream":
            print(json.dumps({"error": message}), flush=True)
        else:
            print(message, file=sys.stderr, flush=True)
        sys.exit(1)
