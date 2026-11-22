from __future__ import annotations

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import threading
import unittest
import wave


MODULE_PATH = Path(__file__).parent / "runtime" / "parakeet.py"
SPEC = importlib.util.spec_from_file_location("parakeet_runtime", MODULE_PATH)
assert SPEC and SPEC.loader
parakeet = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(parakeet)


class FakeResult:
    def __init__(self, text: str) -> None:
        self.text = text


class FakeStream:
    def __init__(self, text: str) -> None:
        self.received_rate: int | None = None
        self.received_len: int = 0
        self.result = FakeResult(text)

    def accept_waveform(self, sample_rate: int, waveform: list[float]) -> None:
        self.received_rate = sample_rate
        self.received_len = len(waveform)


class FakeRecognizer:
    def __init__(self, text: str = "hello from parakeet") -> None:
        self.streams: list[FakeStream] = []
        self._text = text

    def create_stream(self) -> FakeStream:
        stream = FakeStream(self._text)
        self.streams.append(stream)
        return stream

    def decode_stream(self, stream: FakeStream) -> None:
        assert stream in self.streams


def write_wav(path: Path, *, rate: int, channels: int = 1, sampwidth: int = 2, frames: int = 64) -> None:
    with wave.open(str(path), "wb") as clip:
        clip.setnchannels(channels)
        clip.setsampwidth(sampwidth)
        clip.setframerate(rate)
        if sampwidth == 2:
            sample = struct.pack("<h", 3000) * channels
        elif sampwidth == 1:
            sample = bytes([200]) * channels
        else:
            sample = struct.pack("<i", 3000) * channels
        clip.writeframes(sample * frames)


class ParakeetTestModelTests(unittest.TestCase):
    def test_accepts_24khz_and_16khz_mono_pcm16_and_passes_actual_sample_rate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            model_dir = Path(tmp)
            for rate, name in [(24000, "en.wav"), (16000, "0.wav")]:
                # Exceed 12s slightly to verify the bounded readframes(rate * 12) cap.
                write_wav(model_dir / name, rate=rate, frames=rate * 12 + 50)
                recognizer = FakeRecognizer(f"transcript at {rate}")
                orig_worker = parakeet.worker
                parakeet.worker = lambda _model, r=recognizer: r
                stdout = io.StringIO()
                try:
                    with contextlib.redirect_stdout(stdout):
                        parakeet.test_model(model_dir, name)
                finally:
                    parakeet.worker = orig_worker

                self.assertEqual(len(recognizer.streams), 1)
                self.assertEqual(recognizer.streams[0].received_rate, rate)
                self.assertEqual(recognizer.streams[0].received_len, rate * 12)
                self.assertEqual(stdout.getvalue().strip(), f"Bundled English test: transcript at {rate}")

    def test_rejects_stereo_non_pcm16_and_out_of_range_rates(self) -> None:
        cases = [
            ("stereo.wav", dict(rate=24000, channels=2, sampwidth=2)),
            ("pcm8.wav", dict(rate=16000, channels=1, sampwidth=1)),
            ("pcm32.wav", dict(rate=16000, channels=1, sampwidth=4)),
            ("too_low.wav", dict(rate=7999, channels=1, sampwidth=2)),
            ("too_high.wav", dict(rate=48001, channels=1, sampwidth=2)),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            model_dir = Path(tmp)
            orig_worker = parakeet.worker
            parakeet.worker = lambda _model: self.fail("worker must not be loaded for unsupported WAV formats")
            try:
                for name, kwargs in cases:
                    write_wav(model_dir / name, **kwargs)
                    with self.subTest(name=name):
                        with self.assertRaisesRegex(ValueError, "unsupported format"):
                            parakeet.test_model(model_dir, name)
            finally:
                parakeet.worker = orig_worker


def frame_bytes(pcm: bytes) -> bytes:
    return struct.pack("<I", len(pcm)) + pcm


def pcm_tone(amplitude: int, samples_count: int) -> bytes:
    return struct.pack("<h", amplitude) * samples_count


class _FakeStdin:
    def __init__(self, buffer) -> None:
        self.buffer = buffer


class _GatedBuffer:
    def __init__(self, chunks: list[tuple[threading.Event | None, bytes]]) -> None:
        self._chunks = list(chunks)
        self._buf = bytearray()

    def read(self, n: int) -> bytes:
        while len(self._buf) < n and self._chunks:
            gate, data = self._chunks.pop(0)
            if gate is not None:
                assert gate.wait(timeout=5), "timed out waiting for test gate"
            self._buf.extend(data)
        out = bytes(self._buf[:n])
        del self._buf[:n]
        return out


class _NotifyingStdout(io.StringIO):
    def __init__(self, on_line) -> None:
        super().__init__()
        self._on_line = on_line

    def write(self, s: str) -> int:
        written = super().write(s)
        if "\n" in s:
            self._on_line()
        return written


class ParakeetStreamingTests(unittest.TestCase):
    def test_streaming_starts_loading_eagerly_before_first_frame_arrives(self) -> None:
        load_started = threading.Event()
        recognizer = FakeRecognizer("eager hello")
        orig_worker = parakeet.worker
        orig_stdin = sys.stdin

        def fake_worker(_model):
            load_started.set()
            return recognizer

        speech_frame = frame_bytes(pcm_tone(1000, parakeet.FRAME_BYTES // 2))
        finish_frame = frame_bytes(b"")
        buf = _GatedBuffer([(load_started, speech_frame + finish_frame)])
        stdout = io.StringIO()
        parakeet.worker = fake_worker
        sys.stdin = _FakeStdin(buf)
        try:
            with contextlib.redirect_stdout(stdout):
                parakeet.streaming(Path("unused"))
        finally:
            parakeet.worker = orig_worker
            sys.stdin = orig_stdin

        lines = [json.loads(line) for line in stdout.getvalue().splitlines()]
        self.assertEqual(
            lines,
            [
                {"committed": "", "provisional": ""},
                {"committed": "eager hello", "provisional": ""},
            ],
        )
        self.assertEqual(len(recognizer.streams), 1)

    def test_streaming_buffers_first_speech_frame_without_blocking_on_loader(self) -> None:
        load_started = threading.Event()
        release_load = threading.Event()
        first_reply = threading.Event()
        recognizer = FakeRecognizer("preview ok")
        orig_worker = parakeet.worker
        orig_stdin = sys.stdin

        def slow_worker(_model):
            load_started.set()
            assert release_load.wait(timeout=5)
            return recognizer

        half_sec = frame_bytes(pcm_tone(1000, parakeet.FRAME_BYTES // 2))
        finish = frame_bytes(b"")
        # Frame 2 waits until frame 1 has already replied while loader is still blocked.
        buf = _GatedBuffer([(None, half_sec), (first_reply, half_sec + finish)])

        def on_line():
            if not first_reply.is_set():
                first_reply.set()
                release_load.set()

        stdout = _NotifyingStdout(on_line)
        parakeet.worker = slow_worker
        sys.stdin = _FakeStdin(buf)
        try:
            with contextlib.redirect_stdout(stdout):
                parakeet.streaming(Path("unused"))
        finally:
            release_load.set()
            parakeet.worker = orig_worker
            sys.stdin = orig_stdin

        self.assertTrue(load_started.is_set())
        lines = [json.loads(line) for line in stdout.getvalue().splitlines()]
        self.assertEqual(
            lines,
            [
                {"committed": "", "provisional": ""},
                {"committed": "", "provisional": "preview ok"},
                {"committed": "preview ok", "provisional": ""},
            ],
        )

    def test_streaming_exits_immediately_on_empty_finish_while_loader_blocked(self) -> None:
        load_started = threading.Event()
        release_load = threading.Event()
        orig_worker = parakeet.worker
        orig_stdin = sys.stdin

        def blocked_worker(_model):
            load_started.set()
            release_load.wait(timeout=5)
            return FakeRecognizer()

        stdout = io.StringIO()
        parakeet.worker = blocked_worker
        sys.stdin = _FakeStdin(io.BytesIO(frame_bytes(b"")))
        try:
            with contextlib.redirect_stdout(stdout):
                parakeet.streaming(Path("unused"))
            self.assertEqual(
                [json.loads(line) for line in stdout.getvalue().splitlines()],
                [{"committed": "", "provisional": ""}],
            )
        finally:
            release_load.set()
            parakeet.worker = orig_worker
            sys.stdin = orig_stdin

    def test_streaming_reports_loader_error_once_in_frame_protocol(self) -> None:
        orig_worker = parakeet.worker
        orig_stdin = sys.stdin

        def broken_worker(_model):
            raise RuntimeError("missing onnx")

        speech_frame = frame_bytes(pcm_tone(1000, parakeet.FRAME_BYTES // 2))
        finish_frame = frame_bytes(b"")
        stdout = io.StringIO()
        parakeet.worker = broken_worker
        sys.stdin = _FakeStdin(io.BytesIO(speech_frame + speech_frame + finish_frame))
        try:
            with contextlib.redirect_stdout(stdout):
                parakeet.streaming(Path("unused"))
        finally:
            parakeet.worker = orig_worker
            sys.stdin = orig_stdin

        lines = [json.loads(line) for line in stdout.getvalue().splitlines()]
        error_lines = [line for line in lines if "error" in line]
        self.assertEqual(len(error_lines), 1)
        self.assertIn("missing onnx", error_lines[0]["error"])
        self.assertEqual(lines[-1], error_lines[0])

    def test_heard_catches_late_first_syllable_and_rejects_room_noise(self) -> None:
        half_sec_samples = parakeet.FRAME_BYTES // 2
        self.assertFalse(parakeet.heard(b""))
        self.assertFalse(parakeet.heard(pcm_tone(0, half_sec_samples)))
        self.assertFalse(parakeet.heard(pcm_tone(100, half_sec_samples)))
        # 400ms silence + 100ms soft first syllable at 250 RMS (whole-frame RMS ~112 < 180).
        late_syllable = pcm_tone(0, half_sec_samples - parakeet.SPEECH_SLICE_SAMPLES) + pcm_tone(
            250, parakeet.SPEECH_SLICE_SAMPLES
        )
        self.assertTrue(parakeet.heard(late_syllable))

    def test_dictionary_applies_longest_first_word_boundary_in_streaming(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            dict_file = Path(tmp) / "dictionary.json"
            dict_file.write_text(
                json.dumps([
                    ["в доме", "в Domios"],
                    ["в доме все", "в Domios"],
                    ["дом", "Dom"],
                    ["bad_only_one"],
                    ["", "ignored"],
                    ["ignored", ""],
                ]),
                encoding="utf-8",
            )
            rules = parakeet.load_dictionary(dict_file)
            self.assertEqual(
                parakeet.apply_dictionary("Да В доме все, но в доме сидишь и домик", rules),
                "Да в Domios, но в Domios сидишь и домик",
            )

            # Corrupt/missing dictionary files fail open cleanly.
            bad_file = Path(tmp) / "broken.json"
            bad_file.write_text("{not json", encoding="utf-8")
            self.assertEqual(parakeet.load_dictionary(bad_file), ())
            self.assertEqual(parakeet.load_dictionary(Path(tmp) / "missing.json"), ())

            # Verify streaming applies dictionary to both provisional and committed segments.
            orig_worker = parakeet.worker
            orig_stdin = sys.stdin
            recognizer = FakeRecognizer("Да в доме все, но в доме сидишь и домик")
            half_sec = frame_bytes(pcm_tone(1000, parakeet.FRAME_BYTES // 2))
            finish = frame_bytes(b"")
            stdout = io.StringIO()
            parakeet.worker = lambda _model: recognizer
            sys.stdin = _FakeStdin(io.BytesIO(half_sec + half_sec + finish))
            try:
                with contextlib.redirect_stdout(stdout):
                    parakeet.streaming(Path("unused"), rules)
            finally:
                parakeet.worker = orig_worker
                sys.stdin = orig_stdin

            lines = [json.loads(line) for line in stdout.getvalue().splitlines()]
            expected = "Да в Domios, но в Domios сидишь и домик"
            self.assertEqual(
                lines,
                [
                    {"committed": "", "provisional": ""},
                    {"committed": "", "provisional": expected},
                    {"committed": expected, "provisional": ""},
                ],
            )


if __name__ == "__main__":
    unittest.main()
