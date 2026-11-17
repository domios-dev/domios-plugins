import type { HostIoSteps } from "@codeterm/plugin-sdk";
import { MAX_FILE_BYTES, TIMEOUTS } from "./constants";
import { parseByteCount, parseFileProbe, parseSha256 } from "./parse";
export type FileInfo = { path: string; name: string; size: number; sha256: string };
type RunResult = { ok: true; stdout: string; stderr: string } | { ok: false; stdout: string; stderr: string; error: string };
type FileFailure = "invalid-request" | "file-too-large" | "file-unreadable";
type Target = { platform: string; tools: { powershell: string; realpath: string; wc: string; hash: string[] } };
type Ports = {
  runProcess: (bin: string, args: string[], env: Record<string, string>, timeout: number) => HostIoSteps<RunResult>;
  nativePath: (path: string) => string;
  failureMessage: (kind: FileFailure, detail: string) => string;
};
export function createFileTools({ runProcess, nativePath, failureMessage }: Ports) {
  const SEND_FILE_USAGE = "Usage: send-file <chat-id | person> <absolute path> [--from-pad caption.md] [--key <idempotency-key>]. Quote a multi-word name or a path with spaces.";

  function absolutePath(value: string): boolean {
    return host.path.isWindows ? /^[A-Za-z]:[\\/]/.test(value) : value.startsWith("/");
  }

  function parseSendFileArgs(args: string[], body?: string): { target: string; path: string; message: string; key?: string } | { error: string } {
    const positional: string[] = [];
    const message: string[] = [];
    let key: string | undefined;
    let inMessage = false;
    let sawMessage = false;
    for (let i = 0; i < args.length; i++) {
      const arg = String(args[i]);
      if (arg === "--key") {
        if (key !== undefined || i + 1 >= args.length || !/^[A-Za-z0-9._:-]{1,160}$/.test(String(args[i + 1]))) return { error: failureMessage("invalid-request", "--key needs one 1–160 character idempotency key ([A-Za-z0-9._:-]).") };
        key = String(args[++i]);
        inMessage = false;
      } else if (arg === "--message") {
        if (sawMessage) return { error: failureMessage("invalid-request", "Give --message once.") };
        sawMessage = inMessage = true;
      } else if (inMessage) message.push(arg);
      else positional.push(arg);
    }
    const at = positional.findIndex((arg, index) => index > 0 && absolutePath(arg));
    if (at < 1) return { error: failureMessage("invalid-request", SEND_FILE_USAGE) };
    const target = positional.slice(0, at).join(" ").trim();
    const path = positional.slice(at).join(" ");
    if (!target || target.length > 200) return { error: failureMessage("invalid-request", SEND_FILE_USAGE) };
    if (path.length > 1024 || /[\u0000-\u001f]/.test(path)) return { error: failureMessage("invalid-request", "The file path must not contain control characters.") };
    if (body !== undefined && sawMessage) return { error: failureMessage("invalid-request", "Inline --message cannot be combined with a body source.") };
    return { target, path, message: body ?? message.join(" "), key };
  }

  function underRoot(path: string, root: string): boolean {
    const fold = (value: string) => {
      const normalized = host.path.normalize(value).replace(/\\/g, "/").replace(/\/+$/, "");
      return host.path.isWindows ? normalized.toLowerCase() : normalized;
    };
    const child = fold(path);
    const parent = fold(root);
    return child === parent || child.startsWith(`${parent}/`);
  }

  // Prints only ASCII key=value lines: the console code page would mangle a path, and contents never leave the probe.
  const WINDOWS_FILE_PROBE = "$ErrorActionPreference='Stop'; try { $f = Get-Item -LiteralPath $env:CT_FILE -Force; if ($f.PSIsContainer) { 'kind=dir'; exit 0 }; 'size=' + $f.Length; 'link=' + [bool]($f.Attributes -band [IO.FileAttributes]::ReparsePoint); if ($f.Length -le [long]$env:CT_MAX_BYTES) { $s = [IO.File]::OpenRead($f.FullName); $s.Close(); 'sha256=' + (Get-FileHash -Algorithm SHA256 -LiteralPath $f.FullName).Hash } } catch { 'error=' + $_.Exception.GetType().Name }";

  // A confined plugin cannot stat files outside its own directories, so size, readability and the content hash come from a subprocess.
  function* probeFile(p: { root: string }, target: Target, rawPath: string): HostIoSteps<{ file: FileInfo } | { error: string }> {
    let path = host.path.normalize(rawPath);
    const refuse = (kind: FileFailure, detail: string) => ({ error: failureMessage(kind, detail) });
    const ownData = "Files inside the Teams Client data directory are never sent.";
    if (/^[\\/]{2}/.test(rawPath)) return refuse("invalid-request", "Network paths are not accepted; give a local absolute path.");
    if (underRoot(path, p.root)) return refuse("invalid-request", ownData);
    let size: number;
    let sha256: string | null = null;
    if (target.platform === "win32") {
      const run = (yield* runProcess(target.tools.powershell, ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_FILE_PROBE], { CT_FILE: nativePath(path), CT_MAX_BYTES: String(MAX_FILE_BYTES) }, TIMEOUTS.fileProbe));
      const probe = parseFileProbe(run.stdout);
      if (probe.state === "missing") return refuse("file-unreadable", "No file exists at that path.");
      if (probe.state === "directory") return refuse("file-unreadable", "That path is a directory.");
      if (probe.state === "denied") return refuse("file-unreadable", "This account may not read that file.");
      if (probe.state !== "file") return refuse("file-unreadable", "The file could not be opened for reading.");
      if (probe.link) return refuse("invalid-request", "That path is a link or junction; give the path of the file itself.");
      size = probe.size;
      sha256 = probe.sha256;
    } else {
      const real = (yield* runProcess(target.tools.realpath, [nativePath(path)], {}, TIMEOUTS.probe));
      const resolved = real.ok ? real.stdout.trim() : "";
      if (!resolved.startsWith("/") || /[\r\n]/.test(resolved)) return refuse("file-unreadable", "No readable file exists at that path.");
      path = host.path.normalize(resolved);
      const realRoot = (yield* runProcess(target.tools.realpath, [nativePath(p.root)], {}, TIMEOUTS.probe));
      if (underRoot(path, p.root) || (realRoot.ok && underRoot(path, realRoot.stdout.trim()))) return refuse("invalid-request", ownData);
      const count = (yield* runProcess(target.tools.wc, ["-c", nativePath(path)], {}, TIMEOUTS.fileProbe));
      const bytes = count.ok ? parseByteCount(count.stdout) : null;
      if (bytes === null) return refuse("file-unreadable", "The path is not a readable regular file.");
      size = bytes;
    }
    if (size > MAX_FILE_BYTES) return refuse("file-too-large", `The file is ${size} bytes.`);
    if (target.platform !== "win32") {
      const [bin, ...args] = target.tools.hash.map((part) => part === "{file}" ? nativePath(path) : part);
      const hashed = (yield* runProcess(bin, args, {}, TIMEOUTS.fileProbe));
      sha256 = hashed.ok ? parseSha256(hashed.stdout) : null;
    }
    if (!sha256) return refuse("file-unreadable", "The file could not be read to the end.");
    const name = path.split(/[\\/]/).pop() || "";
    if (!name) return refuse("invalid-request", "The path does not name a file.");
    return { file: { path, name, size, sha256 } };
  }

  return { parseSendFileArgs, probeFile };
}
