# Transcriber — Live Dictation Agent Guide

General can inspect, install, monitor, cancel, select, and test local Parakeet live composer dictation through supported Transcriber plugin commands instead of sending the owner to the glance panel. Glance and agent commands share one bounded setup lifecycle and state.

## Supported commands

```sh
domios plugin transcriber help
domios plugin transcriber dictation-status
domios plugin transcriber dictation-install [model-id] --consent
domios plugin transcriber dictation-progress
domios plugin transcriber dictation-cancel
domios plugin transcriber dictation-select <model-id>
domios plugin transcriber dictation-test [model-id]
```

Read-only verbs (`help`, `dictation-status`, `dictation-progress`) never start installation, testing, recording, or inference.

## Catalog & resource implications

| Model ID | Label | Languages | Download |
| --- | --- | --- | --- |
| `parakeet-tdt-0.6b-v3-int8` (default) | Parakeet TDT 0.6B v3 | 25 European languages, including Russian and English | ~487 MB |
| `parakeet-tdt-0.6b-v2-int8` | Parakeet TDT 0.6B v2 | English | ~482 MB |

Before requesting installation, tell the owner:
- **Model download**: ~487 MB for the Russian-capable default `Parakeet TDT 0.6B v3` (~482 MB for `v2`).
- **Private runtime & disk**: ~1.5 GB free disk space in this instance's plugin data directory, and a supported 64-bit Python 3.12 installation (`python.exe` on Windows x64; `python3.12` on macOS/Linux x64 or arm64).
- **Subprocess, network & filesystem**: runs local Python (`-I`) with the bundled `parakeet.py` worker inside `<dataDir>/transcriber/live-dictation`, downloads pinned `sherpa-onnx==2.0.2` wheels from `https://pypi.org/simple` and the model archive from `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/`, verifies pinned SHA-256 hashes, and writes only inside this plugin's data directory.

## Consent & host permissions

1. Run `domios plugin transcriber dictation-status` first to inspect current runtime/model/job state.
2. Explain the download size, disk/Python 3.12 requirements, and network/subprocess/filesystem effects above and wait for explicit owner approval.
3. Run `domios plugin transcriber dictation-install parakeet-tdt-0.6b-v3-int8 --consent` (or omit the model ID for the Russian-capable default).
4. `--consent` records owner approval for this command only; it is **not** a host permission grant. Domios natively enforces `agent_commands` and `subprocess` permissions. If the host refuses a command or subprocess (`host_refused`), report the exact refusal directly — never bypass it or run manual `pip`/config workarounds.

## Progress, cancellation, selection & testing

- **Progress**: poll `dictation-progress` to observe real setup stages (`installing_runtime`, `downloading_model` with actual MB read, `verifying_and_unpacking`), completion, cancellation, or typed failures (`python_missing`, `python_unsupported`, `disk_space`, `network_error`, `verification_failed`, `lock_busy`, `timeout`, `host_refused`, `job_lost`).
- **Repeated intent**: repeating `dictation-install` for the same model returns the active or already-installed state without starting duplicate downloads or processes.
- **Cancel**: run `dictation-cancel`, then poll `dictation-progress` until exit is observed. Cancellation, refusal, or failed upgrades never overwrite an existing installed/selected model.
- **Select**: run `dictation-select <model-id>` only after the runtime and target model are installed.
- **Test**: run `dictation-test [model-id]` (only when explicitly requested) and poll `dictation-progress` to read the transcript of the release's bundled English WAV sample.

## Preserved boundaries

Live dictation setup never modifies voice-note Whisper settings (`model`, `language`, `endpoint`), inbound `integrations.voice_transcribe`, custom dictionary rules, local microphone/OS permissions, or the chat composer draft.
