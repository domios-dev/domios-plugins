from __future__ import annotations

import contextlib
import importlib.util
import io
from pathlib import Path
import struct
import tempfile
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


if __name__ == "__main__":
    unittest.main()
