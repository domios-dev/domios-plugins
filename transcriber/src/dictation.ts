import type { DictationLaunch, HostIoSteps } from "@codeterm/plugin-sdk";
import { configuredDictionaryRules } from "./dictionary";
import { dictionaryPath, hasModel, hasRuntime, modelPath, runtimePython, selectedModel, WORKER } from "./models";

export function* dictationLaunch(): HostIoSteps<DictationLaunch> {
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
