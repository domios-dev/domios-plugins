import type { HostIoSteps } from "@codeterm/plugin-sdk";

const RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/";
export const WORKER = "runtime/parakeet.py";
export const RUNTIME = "runtime-py312-sherpa-2.0.2";
export const INSTALL_TIMEOUT_MS = 900_000;
export const TEST_TIMEOUT_MS = 20_000;
export const RUNTIME_DISK_ESTIMATE = "~1.5 GB";
export const RUNTIME_PYTHON_REQUIREMENT = "64-bit Python 3.12";

export const root = () => host.dataDir() + "/transcriber/live-dictation";
export const selectionPath = () => root() + "/selected";
export const dictionaryPath = () => root() + "/dictionary.json";
export const python = () => host.path.isWindows ? "python.exe" : "python3.12";
export const runtimePython = () => root() + "/" + RUNTIME + (host.path.isWindows ? "/Scripts/python.exe" : "/bin/python3.12");

export const MODELS = [
  {
    id: "parakeet-tdt-0.6b-v3-int8", label: "Parakeet TDT 0.6B v3",
    languages: "25 European languages, including Russian and English", size: "487 MB", bytes: 487211443,
    sha256: "1495e91b59d7fc53ddca91f3431758ec99f8fa253fdb0e1e851be0f72b14b0f9", sample: "en.wav",
  },
  {
    id: "parakeet-tdt-0.6b-v2-int8", label: "Parakeet TDT 0.6B v2",
    languages: "English", size: "482 MB", bytes: 482440461,
    sha256: "6fc4426b54aa549a0019b8a75b8dea59164e71790a37ac56a045ad57f915f714", sample: "0.wav",
  },
] as const;

export type Model = typeof MODELS[number];
export const DEFAULT_MODEL: Model = MODELS[0];
export const DEFAULT_MODEL_ID: Model["id"] = MODELS[0].id;

export function findModel(id: string): Model | undefined {
  return MODELS.find((model) => model.id === id);
}

export const archiveName = (model: Model) => "sherpa-onnx-nemo-" + model.id;
export const archiveUrl = (model: Model) => RELEASE + archiveName(model) + ".tar.bz2";
export const modelPath = (model: Model) => root() + "/" + model.id + "-" + model.sha256.slice(0, 12);

export function* hasExplicitSelection(): HostIoSteps<boolean> {
  const selected = (yield* host.io.fs.readFile(selectionPath()))?.trim();
  return Boolean(selected && findModel(selected));
}

export function* selectedModel(): HostIoSteps<Model> {
  const selected = (yield* host.io.fs.readFile(selectionPath()))?.trim();
  return (selected ? findModel(selected) : undefined) ?? DEFAULT_MODEL;
}

export function* hasRuntime(): HostIoSteps<boolean> {
  return yield* host.io.fs.fileExists(runtimePython());
}

export function* hasModel(model: Model): HostIoSteps<boolean> {
  const path = modelPath(model);
  if ((yield* host.io.fs.readFile(path + "/.verified"))?.trim() !== model.sha256) return false;
  for (const file of ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"]) {
    if (!(yield* host.io.fs.fileExists(path + "/" + file))) return false;
  }
  return true;
}
