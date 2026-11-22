import type { GlanceView, HostIoSteps, ViewNode } from "@codeterm/plugin-sdk";
import { findModel } from "./models";
import {
  cancelInstall,
  currentGlanceNotice,
  getDictationStatus,
  isSetupStarting,
  selectInstalledModel,
  startInstall,
  startModelTest,
} from "./setup";

export function* modelGlance(clip: HostIoSteps<GlanceView>, bundle?: string): HostIoSteps<GlanceView> {
  const status = yield* getDictationStatus();
  const nodes: ViewNode[] = [{ kind: "text", text: "Live dictation" }];
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
    const details: ViewNode[] = [
      { kind: "text", text: model.label },
      { kind: "text", text: model.languages + " · " + model.size + " · CPU", style: { tone: "muted" } },
    ];
    const controls: ViewNode[] = [];
    if (model.selected) {
      controls.push({
        kind: "badge",
        label: model.ready ? "Selected · Installed" : "Selected",
        tone: model.ready ? "ok" : "muted",
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
    nodes: [...nodes, { kind: "divider" }, { kind: "text", text: "Voice notes" }, ...clipView.nodes],
  };
}

export function* modelGlanceAction(action: string, clip: HostIoSteps<GlanceView>, bundle?: string): HostIoSteps<GlanceView> {
  const [, verb, id] = action.split(":");
  const model = id ? findModel(id) : undefined;
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
