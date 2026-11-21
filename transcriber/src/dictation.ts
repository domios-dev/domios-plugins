import type { DictationLaunch, HostIoSteps } from "@codeterm/plugin-sdk";
import { hasModel, hasRuntime, modelPath, runtimePython, selectedModel, WORKER } from "./models";

export function* dictationLaunch(): HostIoSteps<DictationLaunch> {
  const model = yield* selectedModel();
  if (!(yield* hasRuntime()) || !(yield* hasModel(model))) {
    return { state: "setup", reason: model.label + " and its local CPU runtime need to be installed." };
  }
  return { state: "ready", bin: runtimePython(), script: WORKER, args: ["stream", modelPath(model)] };
}
