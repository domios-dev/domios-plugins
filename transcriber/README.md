# Transcriber

Local live dictation for the Domios chat composer and speech-to-text for voice notes.

## Live composer dictation

You can set up and manage live dictation either through supported General/CLI commands or through the Transcriber glance panel in Extensions — both share one bounded setup lifecycle and state:

- `domios plugin transcriber help` — show supported commands, model catalog, requirements, and consent rules without starting setup.
- `domios plugin transcriber dictation-status` — inspect runtime/model state, catalog, selection, and any active or last setup job.
- `domios plugin transcriber dictation-install [model-id] --consent` — install the private CPU runtime and model (defaults to `parakeet-tdt-0.6b-v3-int8`) after explicit owner confirmation.
- `domios plugin transcriber dictation-progress` — inspect real setup stages, downloaded/total MB, completion, cancellation, or typed failures.
- `domios plugin transcriber dictation-cancel` — request cancellation of an in-progress installation (poll `dictation-progress` until exit is observed).
- `domios plugin transcriber dictation-select <model-id>` — select an installed model for subsequent recordings.
- `domios plugin transcriber dictation-test [model-id]` — run the release's bundled English WAV sample test for an installed model.

In the Transcriber glance panel, install a model, select it with **Use model**, use **Test model** to recognize the bundled English sample, **Refresh status** to see progress, or **Cancel installation** to discard an incomplete download.

| Model | Languages | Download |
| --- | --- | --- |
| Parakeet TDT 0.6B v3 int8 (`parakeet-tdt-0.6b-v3-int8`), default | 25 European languages, including Russian and English | 487 MB |
| Parakeet TDT 0.6B v2 int8 (`parakeet-tdt-0.6b-v2-int8`) | English | 482 MB |

Setup needs 64-bit Python 3.12, about 1.5 GB of free disk space, and access to the sherpa-onnx GitHub release and PyPI. The private CPU runtime supports Windows x64 and compatible macOS and Linux x64 or arm64 Python installations. Linux may need the matching Python venv package. Setup verifies the model archive and runtime wheels against pinned SHA-256 values, runs local Python (`-I`) under the host `subprocess` grant, and writes only inside this plugin's instance data directory. Agent commands additionally require the host `agent_commands` permission.

Use the composer microphone or select **Dictation** from the @ picker. Tap to start or stop, hold to dictate until release, or slide upward to keep listening after release. Parakeet revises the current bounded speech segment as you speak. A pause or the segment limit commits that segment. **Stop** finishes the remaining text in the draft. **Cancel** discards provisional text. A recording lasts at most five minutes. Model selection changes apply to the next recording.

Audio travels over a local connection to the active plugin worker. The worker runs inference on the local CPU and keeps the current window in memory.

## Voice-note transcription

- Provides the **transcriber** capability. CodeTerm hands it a recorded audio file
  (`.oga`/`.webm`/`.opus`/`.mp3`/…); it returns the transcript.
- It is a **one-shot** engine — no daemon, no HTTP server. Per clip it runs:
  1. `ffmpeg -i <input> -ar 16000 -ac 1 -f wav <tmp>.wav` — decode to 16 kHz mono WAV.
  2. `whisper-cli -m <model> -f <tmp>.wav -l <lang|auto> -nt -oj -of <tmp>` — transcribe to a JSON sidecar.
  3. Read the JSON, join the segments, delete the temp files.
- A glance view shows whether the engine is set up and lets you pre-warm it.

## Self-bootstrap (first use)

Dependencies are detected first and only installed if missing — into
`<instance data directory>/transcriber/` (model) and `<instance data directory>/transcriber/bin/` (downloaded binaries).

| OS | whisper-cli | ffmpeg |
|----|-------------|--------|
| **macOS** | `brew install whisper-cpp` | `brew install ffmpeg` |
| **Windows** | download the `whisper-bin-x64.zip` GitHub release (`curl`, with PowerShell fallback) → `tar` extract | `curl` a static ffmpeg zip → `tar` extract |
| **Linux** | `curl` the whisper.cpp release zip → `tar` extract | `curl` a static ffmpeg build → `tar` extract |

The model (`ggml-<model>.bin`, default `small`, ~466 MB, multilingual) is fetched from
HuggingFace with `curl`. `host.fetch` is text-only and cannot move binaries, so all
downloads go through `curl` via `host.exec`. If any step can't run automatically, the
plugin returns a clear message telling you exactly what to install by hand.

## Settings

| Key | Default | Meaning |
|-----|---------|---------|
| `model` | `small` | whisper.cpp model id. `base` is faster/lighter; `medium`/`large-v3` are more accurate. |
| `language` | `auto` | BCP-47 hint (e.g. `en`, `ru`). `auto` detects per clip. |

Set them with `codeterm plugin config transcriber --set model=base --set language=ru`.

The host selects the instance data directory, including isolated development roots.

## Voice-note permissions

| Permission | Why |
|------------|-----|
| `subprocess: brew, curl, powershell.exe, tar, whisper-cli, whisper-cli.exe, ffmpeg, ffmpeg.exe` | Install deps (brew / curl + tar; PowerShell only as a Windows download fallback), then convert and transcribe. CodeTerm allows full downloaded paths by basename, so the Windows `.exe` entries cover `<instance data directory>/transcriber/bin/**/ffmpeg.exe` and `**/whisper-cli.exe`. |

No network or secrets permissions are needed — downloads run through `curl`, and there
are no credentials to store.

## Use

Just record a voice note. On the first one the plugin installs whatever is missing
(this can take a while for the model download) and transcribes; subsequent notes are
fast. The glance view's "Set up engine + model" button pre-warms everything ahead of time.
