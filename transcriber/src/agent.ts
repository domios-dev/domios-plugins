import type { AgentCommandCtx, HostIoSteps } from "@codeterm/plugin-sdk";
import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_ID,
  findModel,
  MODELS,
  RUNTIME,
  RUNTIME_DISK_ESTIMATE,
  RUNTIME_PYTHON_REQUIREMENT,
  selectedModel,
  type Model,
} from "./models";
import {
  cancelInstall,
  getDictationProgress,
  getDictationStatus,
  selectInstalledModel,
  startInstall,
  startModelTest,
} from "./setup";

type AgentCommandResult = { result: string } | { error: string };

const PLUGIN_VERSION = "0.5.1";
const VALID_MODEL_IDS = MODELS.map((m) => m.id).join(", ");

function hasUnexpectedBody(ctx: AgentCommandCtx): boolean {
  return typeof ctx.body === "string" && ctx.body.trim().length > 0;
}

function normalizeArgs(ctx: AgentCommandCtx): string[] {
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
        description: "Inspect live dictation model/runtime installation state, catalog, selection, and active/last setup job.",
      },
      {
        verb: "dictation-install",
        usage: "domios plugin transcriber dictation-install [model-id] --consent",
        readOnly: false,
        description:
          "Install the local CPU runtime and selected Parakeet model (defaults to parakeet-tdt-0.6b-v3-int8) after explicit owner approval.",
      },
      {
        verb: "dictation-progress",
        usage: "domios plugin transcriber dictation-progress",
        readOnly: true,
        description: "Inspect real setup stage, downloaded/total MB, active status, or terminal outcome/typed failure.",
      },
      {
        verb: "dictation-cancel",
        usage: "domios plugin transcriber dictation-cancel",
        readOnly: false,
        description: "Request cancellation of an in-progress installation; poll dictation-progress until exit is observed.",
      },
      {
        verb: "dictation-select",
        usage: "domios plugin transcriber dictation-select <model-id>",
        readOnly: false,
        description: "Select an installed local Parakeet model for future live dictation sessions.",
      },
      {
        verb: "dictation-test",
        usage: "domios plugin transcriber dictation-test [model-id]",
        readOnly: false,
        description: "Run the bundled English WAV sample test for an installed model (defaults to the selected model).",
      },
      {
        verb: "help",
        usage: "domios plugin transcriber help",
        readOnly: true,
        description: "Show supported commands, model catalog, requirements, and consent/permission rules without starting setup.",
      },
    ],
    models: MODELS.map((model) => ({
      id: model.id,
      label: model.label,
      languages: model.languages,
      size: model.size,
      bytes: model.bytes,
      sample: model.sample,
      isDefault: model.id === DEFAULT_MODEL_ID,
    })),
    requirements: {
      modelDownload:
        "Parakeet TDT 0.6B v3 (Russian-capable default): ~487 MB; Parakeet TDT 0.6B v2 (English): ~482 MB.",
      diskSpace:
        RUNTIME_DISK_ESTIMATE + " free disk space in the instance plugin data directory (private runtime + unpacked model).",
      python:
        RUNTIME_PYTHON_REQUIREMENT + " (Windows x64 python.exe; macOS/Linux x64 or arm64 python3.12).",
      subprocess:
        "Spawns local Python (-I) with the bundled parakeet.py helper under the host subprocess permission allowlist.",
      network:
        "Downloads pinned sherpa-onnx==2.0.2 wheels from https://pypi.org/simple and the model archive from https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/, verified against pinned SHA-256 hashes.",
      filesystem:
        "Writes only inside the host-assigned plugin data directory (<dataDir>/transcriber/live-dictation).",
    },
    consent: {
      flag: "--consent",
      rule:
        "Explain the ~487 MB model download, ~1.5 GB disk / 64-bit Python 3.12 runtime, and subprocess/network/filesystem effects to the owner and get explicit approval before passing --consent.",
      hostAuthority:
        "--consent records owner confirmation for this plugin command only; it is not a host permission grant. Domios natively enforces agent_commands and subprocess permissions.",
    },
    boundaries: {
      voiceNotes:
        "Separate from voice-note Whisper settings (model, language, endpoint) and inbound integrations.voice_transcribe, which remain untouched.",
      microphoneAndDraft:
        "Live dictation setup and bundled sample testing never open the microphone, alter OS permissions, or insert text into the composer draft.",
    },
  };
}

function consentRequiredError(model: Model): string {
  return (
    "consent_required: Explicit owner consent is required before installing " +
    model.label +
    " (" +
    model.id +
    ", " +
    model.size +
    " model download; " +
    RUNTIME_DISK_ESTIMATE +
    " free disk space with private " +
    RUNTIME_PYTHON_REQUIREMENT +
    " CPU runtime; downloads pinned wheels from PyPI and model archive from GitHub with SHA-256 verification; runs local Python subprocess under the plugin data directory). " +
    "After informing the owner and receiving explicit approval, run: domios plugin transcriber dictation-install " +
    model.id +
    " --consent. " +
    "Note: --consent confirms owner approval for this command only and is not a host permission grant; Domios enforces agent_commands and subprocess permissions natively."
  );
}

function parseInstallArgs(args: string[]): { ok: true; model: Model; consented: boolean } | { ok: false; error: string } {
  if (args.length > 2) {
    return {
      ok: false,
      error: "invalid_arguments: Usage: dictation-install [model-id] --consent. Valid models: " + VALID_MODEL_IDS + ".",
    };
  }
  let consented = false;
  let model: Model | null = null;
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
        error: "invalid_arguments: Unknown option `" + arg + "`. Usage: dictation-install [model-id] --consent.",
      };
    }
    if (model) {
      return {
        ok: false,
        error: "invalid_arguments: Expected at most one model-id. Valid models: " + VALID_MODEL_IDS + ".",
      };
    }
    const found = findModel(arg);
    if (!found) {
      return {
        ok: false,
        error: "invalid_model: Unknown model `" + arg + "`. Valid models: " + VALID_MODEL_IDS + ".",
      };
    }
    model = found;
  }
  return { ok: true, model: model ?? DEFAULT_MODEL, consented };
}

export function* onAgentCommand(ctx: AgentCommandCtx): HostIoSteps<AgentCommandResult> {
  const verb = typeof ctx?.verb === "string" ? ctx.verb.trim() : "";
  const args = normalizeArgs(ctx);

  if (hasUnexpectedBody(ctx)) {
    return {
      error:
        "invalid_arguments: Transcriber dictation commands do not accept a stdin/file body. Use explicit CLI arguments; run `help` for usage.",
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
      const progress = yield* getDictationProgress();
      return { result: JSON.stringify(progress) };
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
          next:
            res.outcome === "already_installed"
              ? "Model and runtime are already installed. Use dictation-select or dictation-test if needed."
              : "Poll `domios plugin transcriber dictation-progress` to observe real setup stages and completion.",
        }),
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
          next: "Poll `domios plugin transcriber dictation-progress` until cancellation exit is observed.",
        }),
      };
    }

    case "dictation-select": {
      if (args.length !== 1 || args[0].startsWith("-")) {
        return {
          error: "invalid_arguments: Usage: dictation-select <model-id>. Valid models: " + VALID_MODEL_IDS + ".",
        };
      }
      const model = findModel(args[0]);
      if (!model) {
        return {
          error: "invalid_model: Unknown model `" + args[0] + "`. Valid models: " + VALID_MODEL_IDS + ".",
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
          status: res.status,
        }),
      };
    }

    case "dictation-test": {
      if (args.length > 1 || (args.length === 1 && args[0].startsWith("-"))) {
        return {
          error: "invalid_arguments: Usage: dictation-test [model-id]. Valid models: " + VALID_MODEL_IDS + ".",
        };
      }
      const model = args.length === 1 ? findModel(args[0]) : yield* selectedModel();
      if (!model) {
        return {
          error: "invalid_model: Unknown model `" + args[0] + "`. Valid models: " + VALID_MODEL_IDS + ".",
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
          next: "Poll `domios plugin transcriber dictation-progress` to read the bundled sample transcript.",
        }),
      };
    }

    default:
      return {
        error:
          "unknown_verb: Unsupported Transcriber verb `" +
          verb +
          "`. Supported verbs: dictation-status, dictation-install, dictation-progress, dictation-cancel, dictation-select, dictation-test, help.",
      };
  }
}
