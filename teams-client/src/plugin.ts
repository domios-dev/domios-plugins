import { createFileTools, type FileInfo } from "./file-send";
import { parseSearchArgs } from "./search-args";
import { stateDir } from "../../shared/src/host-paths";
import { defineProviderIo, ioValue, type HostIoSteps, type HostIoResult } from "@codeterm/plugin-sdk";
import type { GlanceView, PluginModule, ViewNode } from "@codeterm/plugin-sdk";
import { readOutput } from "./read-output";
import { channelId, teamId } from "./channels";
import { createChannelCommands } from "./channel-commands";
import { boundedHistory, settings, sha256Hex, utf8Bytes } from "./message-utils";
import { decideSend, matchChats, parseSendScope, validateSendScope, type SendOrigin, type SendScope } from "../../shared/src/send-scope";
import {
  CHAT_CACHE_TTL_MS, EXO_HOME_DIR, EXO_MODULE, EXO_MODULE_SUM, EXO_PACKAGE, EXO_TOKEN_DIR, EXO_TOKEN_FILES,
  EXO_VERSION, GO_ARCHIVES, GO_DOWNLOAD_BASE, GO_VERSION, MAX_BYTES, MAX_COUNT, MAX_FILE_BYTES, SEARCH_BUDGET_MS,
  SEARCH_CHAT_MESSAGES, SEARCH_MAX_CHATS, SEARCH_RECENT_MESSAGES, SIGN_IN_TTL_MS, TIMEOUTS,
} from "./constants";
import {
  classifyAuthFailure, fileSendFailure, findSentFileMessageId, findSentMessageId, historyRows, htmlMessage, mapChats, microsoftMessage,
  normalizeArch, parseGoModDownload, parseJson, parseSha256, parseSignInLog, parseWhoami, personQuery,
  redact, searchMessages, searchTerms, sendFailure, sessionExpiry, sessionUsable,
  type Chat, type SearchHit, type SignInLog, type WhoAmI,
} from "./parse";

type Paths = {
  root: string; home: string; tokenDir: string; runtime: string; toolchain: string; goBinary: string; gopath: string; gocache: string;
  gomodcache: string; bin: string; binary: string; marker: string; noPath: string; loginLog: string; loginState: string;
  outbox: string; scope: string; chatCache: string;
};
type RunResult = { ok: true; stdout: string; stderr: string } | { ok: false; error: string; stdout: string; stderr: string; code?: number };
type Target = { platform: string; arch: string; archive: { file: string; sha256: string }; exe: string; tools: Tools };
type Tools = { curl: string; tar: string; hash: string[]; icacls: string; whoami: string; kill: string[]; powershell: string; wc: string; realpath: string };
type StateResult = { state: string; message: string; accountId?: string | null; upn?: string | null; user?: string | null; tenantId?: string | null; expiresOn?: string | null; signInUrl?: string; deviceCode?: string; accounts?: any[] };
type InstallStage = "download" | "extract" | "module" | "build";
type InstallJob = { stage: InstallStage; paths: Paths; target: Target };
type LoginRecord = { startedAt: number; pid?: number | null };

const installJobs: Record<string, InstallJob> = {};
let activeInstallJobId: string | null = null;
const storageProtectionCache: Record<string, { error?: string; message?: string }> = {};
const previewTokens: Record<string, any> = {};
let memoryChats: { identityKey: string; chats: Chat[]; at: number } | null = null;
let injectedClock: (() => number) | null = null;
let lastSendState: { state: string; message: string; updatedAt: number } | null = null;
let lastStatus: StateResult | null = null;
const CHAT_CACHE_SCHEMA = 2;

function now(): number {
  const value = injectedClock ? Number(injectedClock()) : Date.now();
  return Number.isFinite(value) ? value : Date.now();
}

function joinPath(...parts: string[]): string {
  return host.path.normalize(parts.join("/"));
}

function nativePath(path: string): string {
  return host.path.toNative(host.path.normalize(path));
}

function hostPlatform(): string {
  if (host.path.isWindows) return "win32";
  let value = "";
  try { value = String(host.platform() || "").toLowerCase(); } catch { }
  return value === "macos" ? "darwin" : value;
}

function exeName(platform: string, name: string): string {
  return platform === "win32" ? `${name}.exe` : name;
}

function paths(): Paths | null {
  try {
    const expanded = stateDir(host.dataDir(), "teams-client");
    if (!expanded) return null;
    const root = host.path.normalize(expanded);
    const home = joinPath(root, EXO_HOME_DIR);
    const runtime = joinPath(root, "runtime");
    const toolchain = joinPath(runtime, "toolchain");
    const platform = hostPlatform();
    return {
      root,
      home,
      tokenDir: joinPath(home, EXO_TOKEN_DIR),
      runtime,
      toolchain,
      goBinary: joinPath(toolchain, "go/bin", exeName(platform, "go")),
      gopath: joinPath(runtime, "gopath"),
      gocache: joinPath(runtime, "gocache"),
      gomodcache: joinPath(runtime, "gomodcache"),
      bin: joinPath(runtime, "bin"),
      binary: joinPath(runtime, "bin", exeName(platform, "exo-teams")),
      marker: joinPath(runtime, "install.json"),
      noPath: joinPath(runtime, "no-path"),
      loginLog: joinPath(root, "login.log"),
      loginState: joinPath(root, "login.json"),
      outbox: joinPath(root, "outbox.json"),
      scope: joinPath(root, "send-scope.json"),
      chatCache: joinPath(root, "chats.json"),
    };
  } catch {
    return null;
  }
}

// Windows tools come from System32 by path: a Git for Windows PATH puts GNU tar first, which reads "C:" as a remote host.
// certutil is avoided because its localized OEM-code-page header makes the host's UTF-8 stdout reader drop all output.
function toolsFor(platform: string, systemRoot = "C:/Windows"): Tools {
  const sys = (name: string) => nativePath(`${systemRoot}/System32/${name}`);
  const powershell = sys("WindowsPowerShell/v1.0/powershell.exe");
  if (platform === "win32") return { curl: sys("curl.exe"), tar: sys("tar.exe"), hash: [powershell, "-NoProfile", "-NonInteractive", "-Command", "(Get-FileHash -Algorithm SHA256 -LiteralPath $env:CT_HASH_FILE).Hash"], icacls: sys("icacls.exe"), whoami: sys("whoami.exe"), kill: [sys("taskkill.exe"), "/PID", "{pid}", "/T", "/F"], powershell, wc: "", realpath: "" };
  if (platform === "darwin") return { curl: "curl", tar: "tar", hash: ["shasum", "-a", "256", "{file}"], icacls: "", whoami: "", kill: ["kill", "{pid}"], powershell: "", wc: "wc", realpath: "realpath" };
  return { curl: "curl", tar: "tar", hash: ["sha256sum", "{file}"], icacls: "", whoami: "", kill: ["kill", "{pid}"], powershell: "", wc: "wc", realpath: "realpath" };
}

function resolveTarget(platform: string, arch: string, systemRoot?: string): Target | { state: string; message: string } {
  const archive = GO_ARCHIVES[`${platform}/${arch}`];
  if (!archive) return { state: "unsupported-platform", message: `exo-teams is built here with a pinned Go toolchain, which is pinned for macOS, Linux and Windows on x64 or arm64, not ${platform || "this system"}/${arch || "unknown"}.` };
  return { platform, arch, archive, exe: exeName(platform, "exo-teams"), tools: toolsFor(platform, systemRoot) };
}

function windowsRoot(): string | undefined {
  try {
    const value = String(host.envGet("SystemRoot") || host.envGet("windir") || "");
    return /^[A-Za-z]:[\\/][^\r\n"]*$/.test(value) ? host.path.normalize(value) : undefined;
  } catch { return undefined; }
}

let cachedTarget: Target | { state: string; message: string } | null = null;

function* detectTarget(p: Paths): HostIoSteps<Target | { state: string; message: string }> {
  if (cachedTarget) return cachedTarget;
  const platform = hostPlatform();
  let arch = "";
  if (platform === "win32") {
    try { arch = normalizeArch(String(host.envGet("PROCESSOR_ARCHITEW6432") || host.envGet("PROCESSOR_ARCHITECTURE") || "")); } catch { }
  } else {
    const probe = (yield* runProcess("uname", ["-m"], {}, TIMEOUTS.probe));
    arch = probe.ok ? normalizeArch(probe.stdout) : "";
  }
  cachedTarget = resolveTarget(platform, arch, windowsRoot());
  return cachedTarget;
}

function* runProcess(bin: string, args: string[], env: Record<string, string>, timeoutMs: number): HostIoSteps<RunResult> {
  let result: { code?: number; stdout?: string; stderr?: string; error?: string } | null;
  try { result = parseJson(JSON.stringify(yield* host.io.exec({ bin, args, env, timeoutMs }))); }
  catch (error) { return { ok: false, error: String(error), stdout: "", stderr: "" }; }
  if (!result) return { ok: false, error: `${bin} returned an unreadable process result.`, stdout: "", stderr: "" };
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  if (result.error) return { ok: false, error: String(result.error), stdout, stderr, code: result.code };
  if (result.code !== 0) return { ok: false, error: stderr || stdout || `${bin} exited ${result.code}.`, stdout, stderr, code: result.code };
  return { ok: true, stdout, stderr };
}

// exo-teams keeps its tokens under the user home and opens a browser through PATH; both point into plugin storage.
function exoEnv(p: Paths): Record<string, string> {
  const home = nativePath(p.home);
  return { HOME: home, USERPROFILE: home, PATH: nativePath(p.noPath) };
}

function goEnv(p: Paths): Record<string, string> {
  const home = nativePath(p.home);
  return {
    HOME: home,
    USERPROFILE: home,
    GOPATH: nativePath(p.gopath),
    GOCACHE: nativePath(p.gocache),
    GOMODCACHE: nativePath(p.gomodcache),
    GOBIN: nativePath(p.bin),
    GOTOOLCHAIN: "local",
    GOENV: "off",
    GOTELEMETRY: "off",
    GOFLAGS: "-trimpath",
    CGO_ENABLED: "0",
    GOPROXY: "https://proxy.golang.org",
    GOSUMDB: "sum.golang.org",
    GONOSUMDB: "",
    GONOSUMCHECK: "",
    GOPRIVATE: "",
    GOINSECURE: "",
  };
}

// Restrict only the root, once: files created later inherit its ACL, and a recursive walk would outlast the exec bound.
function windowsAclCommands(root: string, principal: string): string[][] {
  return [[root, "/inheritance:r", "/grant:r", `${principal}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F", "/C"]];
}

const ACL_MARKER = ".acl-restricted";

function* protectStorage(p: Paths): HostIoSteps<{ error?: string; message?: string }> {
  if (storageProtectionCache[p.root]) return storageProtectionCache[p.root];
  const result = (yield* applyStorageProtection(p));
  if (!result.error) storageProtectionCache[p.root] = result;
  return result;
}

function* applyStorageProtection(p: Paths): HostIoSteps<{ error?: string; message?: string }> {
  // Older hosts canonicalize write roots before granting mkdir, so a fresh
  // plugin data root cannot create itself. Bootstrap only our fixed root via
  // the declared subprocess API, then use host.fs for every child directory.
  if (!(yield* host.io.fs.makeDirs(p.root))) {
    const created = host.path.isWindows
      ? (yield* runProcess(toolsFor("win32", windowsRoot()).powershell,
        ["-NoProfile", "-NonInteractive", "-Command", "[IO.Directory]::CreateDirectory($env:CT_PLUGIN_ROOT) | Out-Null"],
        { CT_PLUGIN_ROOT: nativePath(p.root) }, TIMEOUTS.probe))
      : (yield* runProcess("mkdir", ["-p", "-m", "700", nativePath(p.root)], {}, TIMEOUTS.probe));
    if (!created.ok) return { error: "storage-protection-failed", message: "Could not create the plugin-owned private directory. Nothing was started." };
  }
  for (const dir of [p.root, p.home, p.tokenDir, p.runtime, p.noPath]) {
    try { if (!(yield* host.io.fs.makeDirs(dir))) return { error: "storage-protection-failed", message: "Could not create the plugin-owned private directory." }; }
    catch { return { error: "storage-protection-failed", message: "Could not create the plugin-owned private directory." }; }
  }
  if (host.path.isWindows) {
    const marker = joinPath(p.root, ACL_MARKER);
    if ((yield* host.io.fs.fileExists(marker))) return {};
    const tools = toolsFor("win32", windowsRoot());
    const who = (yield* runProcess(tools.whoami, [], {}, TIMEOUTS.probe));
    const principal = who.ok ? who.stdout.trim() : "";
    if (!principal || /[\r\n]/.test(principal)) return { error: "storage-protection-failed", message: "Could not identify the Windows account for the plugin storage ACL." };
    for (const args of windowsAclCommands(nativePath(p.root), principal)) {
      const acl = (yield* runProcess(tools.icacls, args, {}, TIMEOUTS.probe));
      if (!acl.ok) return { error: "storage-protection-failed", message: "Could not restrict the plugin storage with a Windows ACL. Nothing was started." };
    }
    (yield* host.io.fs.writeFile(marker, "1"));
    return {};
  }
  for (const dir of [p.root, p.home, p.tokenDir]) {
    const chmod = (yield* runProcess("chmod", ["700", nativePath(dir)], {}, TIMEOUTS.probe));
    if (!chmod.ok) return { error: "storage-protection-failed", message: "Could not restrict the plugin storage permissions. Nothing was started." };
  }
  return {};
}

function* installedMarker(p: Paths): HostIoSteps<boolean> {
  const marker = (yield* host.io.fs.readJson(p.marker)) as { module?: string; version?: string; sum?: string } | null;
  return !!marker && marker.module === EXO_MODULE && marker.version === EXO_VERSION && marker.sum === EXO_MODULE_SUM && (yield* host.io.fs.fileExists(p.binary));
}

function lifecycleMessage(state: string, detail?: string): string {
  const messages: Record<string, string> = {
    "not-installed": "The pinned exo-teams CLI is not installed yet. Run `codeterm plugin teams-client login` (or Sign in in the view): it downloads a pinned Go toolchain, verifies its SHA-256, builds exo-teams at a pinned commit verified against the Go checksum database, then shows a sign-in code.",
    "unsupported-platform": detail || "This operating system and architecture are not supported.",
    "install-failed": detail || "The pinned exo-teams CLI could not be downloaded, verified or built. Check network access and retry Sign in.",
    "install-in-progress": "The pinned exo-teams CLI is being installed. Keep polling login-status; the sign-in code follows.",
    "logged-out": "Not signed in to Teams. Run `codeterm plugin teams-client login` (or Sign in in the view) to get a sign-in code.",
    "logged-in": "Microsoft Teams is connected.",
    "awaiting-user": "Waiting for you to enter the code at the Microsoft sign-in page.",
  };
  return messages[state] || detail || "Teams Client could not determine its current state.";
}

function* readLoginRecord(p: Paths): HostIoSteps<LoginRecord | null> {
  const value = (yield* host.io.fs.readJson(p.loginState)) as LoginRecord | null;
  return value && Number.isFinite(Number(value.startedAt)) ? value : null;
}

function* readSignInLog(p: Paths): HostIoSteps<SignInLog> {
  if (!(yield* host.io.fs.fileExists(p.loginLog))) return { state: "starting" };
  return parseSignInLog(String((yield* host.io.fs.readFileTail(p.loginLog, 16384)) || ""));
}

// A pending sign-in is one whose log has neither finished nor passed Microsoft's device-code lifetime.
function* pendingSignIn(p: Paths): HostIoSteps<{ record: LoginRecord; log: SignInLog } | null> {
  const record = (yield* readLoginRecord(p));
  if (!record) return null;
  const log = (yield* readSignInLog(p));
  if (log.state === "signed-in" || log.state === "failed") return null;
  if (now() - record.startedAt > SIGN_IN_TTL_MS + 30_000) return null;
  return { record, log };
}

function* endSignIn(p: Paths, kill: boolean): HostIoSteps<void> {
  const record = (yield* readLoginRecord(p));
  if (kill && record && Number.isInteger(record.pid) && Number(record.pid) > 0) {
    const target = (yield* detectTarget(p));
    if (!("state" in target)) {
      const [bin, ...args] = target.tools.kill.map((part) => part === "{pid}" ? String(record.pid) : part);
      (yield* runProcess(bin, args, {}, TIMEOUTS.probe));
    }
  }
  try { (yield* host.io.fs.removeFile(p.loginState)); } catch { }
}

function* runExo(p: Paths, args: string[], timeoutMs: number): HostIoSteps<RunResult> {
  const target = (yield* detectTarget(p));
  if ("state" in target) return { ok: false, error: target.message, stdout: "", stderr: "" };
  if (!(yield* installedMarker(p))) return { ok: false, error: lifecycleMessage("not-installed"), stdout: "", stderr: "" };
  const secured = (yield* protectStorage(p));
  if (secured.error) return { ok: false, error: secured.message || "Could not secure plugin storage.", stdout: "", stderr: "" };
  if (["list-chats", "get-chat", "list-teams", "get-messages"].includes(args[0])) {
    return yield* readOutput(nativePath(p.binary), args, exoEnv(p), p.root,
      target.platform === "win32" ? target.tools.powershell : null, timeoutMs, runProcess);
  }
  return (yield* runProcess(nativePath(p.binary), args, exoEnv(p), timeoutMs));
}

function failureText(run: RunResult): string {
  return run.ok ? "" : `${run.error}\n${run.stderr}\n${run.stdout}`;
}

function* whoami(p: Paths): HostIoSteps<{ who: WhoAmI } | { error: string }> {
  const run = (yield* runExo(p, ["whoami", "--json"], TIMEOUTS.whoami));
  if (!run.ok) return { error: failureText(run) };
  const who = parseWhoami(run.stdout);
  return who ? { who } : { error: "exo-teams whoami returned unreadable output." };
}

function loggedIn(who: WhoAmI): StateResult {
  const upn = who.email || who.user;
  const expiresOn = sessionExpiry(who);
  return {
    state: "logged-in",
    message: upn ? `Signed in as ${who.user ? `${who.user} (${upn})` : upn}.` : lifecycleMessage("logged-in"),
    accountId: upn || "teams-account",
    upn: upn || null,
    user: who.user || null,
    tenantId: null,
    expiresOn,
    accounts: [{ id: upn || "teams-account", accountId: upn || "teams-account", tenantId: null, upn, active: true, expiresOn }],
  };
}

function* status(): HostIoSteps<StateResult> {
  const value = (yield* computeStatus());
  lastStatus = value;
  return value;
}

function* computeStatus(): HostIoSteps<StateResult> {
  const p = paths();
  if (!p) return { state: "unsupported-platform", message: "The host home directory is unavailable.", accounts: [] };
  const target = (yield* detectTarget(p));
  if ("state" in target) return { state: target.state, message: target.message, accounts: [] };
  if (activeInstallJobId) return { state: "install-in-progress", message: lifecycleMessage("install-in-progress"), accounts: [] };
  if (!(yield* installedMarker(p))) return { state: "not-installed", message: lifecycleMessage("not-installed"), accounts: [] };
  const pending = (yield* pendingSignIn(p));
  if (pending && pending.log.state === "awaiting-user") {
    return { state: "awaiting-user", message: `Open ${pending.log.signInUrl} and enter code ${pending.log.deviceCode}.`, signInUrl: pending.log.signInUrl, deviceCode: pending.log.deviceCode, accounts: [] };
  }
  // The token files are declared credentials, so the host hides them from fileExists; exo-teams itself says whether they exist.
  const first = (yield* whoami(p));
  if ("who" in first && sessionUsable(first.who)) return loggedIn(first.who);
  if ("error" in first) {
    const known = classifyAuthFailure(first.error);
    if (known && known.state !== "expired") return { state: known.state, message: known.message, accounts: [] };
  }
  const refreshed = (yield* runExo(p, ["auth", "--refresh"], TIMEOUTS.refresh));
  if (!refreshed.ok) {
    const known = classifyAuthFailure(failureText(refreshed));
    if (known && known.state !== "logged-out") return { state: known.state, message: known.message, accounts: [] };
    return { state: "expired", message: `The Teams session could not be renewed silently. Microsoft said: "${microsoftMessage(failureText(refreshed))}" Run login to sign in again.`, accounts: [] };
  }
  const second = (yield* whoami(p));
  if ("who" in second && sessionUsable(second.who)) return loggedIn(second.who);
  const detail = "error" in second ? ` ${microsoftMessage(second.error)}` : "";
  return { state: "expired", message: `The Teams session is not usable after a refresh.${detail} Run login to sign in again.`, accounts: [] };
}

type Sender = { id: string; accountId: string; tenantId: string; upn: string; user: string; identityKey: string };

function senderFrom(value: StateResult): Sender | null {
  const upn = String(value.upn || "");
  if (value.state !== "logged-in" || !upn) return null;
  return { id: upn, accountId: upn, tenantId: String(value.tenantId || ""), upn, user: String(value.user || ""), identityKey: JSON.stringify([upn.toLowerCase()]) };
}

function* liveSender(): HostIoSteps<{ sender: Sender } | { error: string }> {
  const current = (yield* status());
  if (current.state === "expired" || current.state === "refused") return { error: `reauth-needed: ${current.state}. ${current.message}` };
  if (["logged-out", "awaiting-user", "not-installed"].includes(current.state)) return { error: failureMessage("not-logged-in") };
  if (current.state !== "logged-in") return { error: `upstream-rejected: ${current.message}` };
  const sender = senderFrom(current);
  return sender ? { sender } : { error: "upstream-rejected: The signed-in Teams account could not be resolved. Refresh Teams Client status." };
}

function* previewSender(): HostIoSteps<{ sender: Sender } | { error: string }> {
  const sender = lastStatus ? senderFrom(lastStatus) : null;
  if (sender) return { sender };
  return (yield* liveSender());
}

function validChatId(value: string): boolean {
  return /^[A-Za-z0-9:._@-]{1,512}$/.test(value) && value.includes(":");
}

function* readSendScope(): HostIoSteps<SendScope> {
  const p = paths();
  if (!p) return parseSendScope(null, validChatId);
  let raw: string | null = null;
  try { raw = (yield* host.io.fs.fileExists(p.scope)) ? ((yield* host.io.fs.readFile(p.scope)) ?? "") : null; } catch { raw = ""; }
  return parseSendScope(raw, validChatId);
}

function* setSendScope(args: any): HostIoSteps<{ result: string } | { error: string }> {
  const scope = validateSendScope(args, validChatId);
  if ("error" in scope) return { error: `${scope.error} The restriction was not changed.` };
  const p = paths();
  if (!p) return { error: "The Teams Client data directory is unavailable; the restriction was not changed." };
  try {
    if (!(yield* host.io.fs.makeDirs(p.root)) || (yield* host.io.fs.writeFile(p.scope, JSON.stringify(scope))) !== true) {
      return { error: "Could not save the restriction; the previous setting still applies." };
    }
  } catch { return { error: "Could not save the restriction; the previous setting still applies." }; }
  return { result: JSON.stringify((yield* readSendScope())) };
}

function* chatList(sender: Sender, refresh = false): HostIoSteps<{ chats: Chat[] } | { error: string }> {
  const p = paths();
  if (!p) return { error: lifecycleMessage("unsupported-platform") };
  if (!refresh && memoryChats && memoryChats.identityKey === sender.identityKey && now() - memoryChats.at < CHAT_CACHE_TTL_MS) return { chats: memoryChats.chats };
  if (!refresh) {
    const cached = (yield* host.io.fs.readJson(p.chatCache)) as { schema?: number; identityKey?: string; at?: number; chats?: Chat[] } | null;
    if (cached && cached.schema === CHAT_CACHE_SCHEMA && cached.identityKey === sender.identityKey && Array.isArray(cached.chats) && now() - Number(cached.at) < CHAT_CACHE_TTL_MS) {
      memoryChats = { identityKey: sender.identityKey, chats: cached.chats, at: Number(cached.at) };
      return { chats: cached.chats };
    }
  }
  const run = (yield* runExo(p, ["list-chats", "--json"], TIMEOUTS.chats));
  if (!run.ok) {
    const known = classifyAuthFailure(failureText(run));
    return { error: known ? `${known.state === "logged-out" ? "not-logged-in" : "reauth-needed"}: ${known.message}` : `upstream-rejected: exo-teams could not list chats. Microsoft said: "${microsoftMessage(failureText(run))}"` };
  }
  const source = parseJson<any[]>(run.stdout.trim());
  if (!Array.isArray(source)) return { error: "upstream-rejected: exo-teams returned an unreadable chat list." };
  const chats = mapChats(source, sender.user);
  memoryChats = { identityKey: sender.identityKey, chats, at: now() };
  try { (yield* host.io.fs.writeFile(p.chatCache, JSON.stringify({ schema: CHAT_CACHE_SCHEMA, identityKey: sender.identityKey, at: memoryChats.at, chats }))); } catch { }
  return { chats };
}

function findChats(chats: Chat[], query: string, preferDirect: boolean) {
  const q = personQuery(query);
  if (preferDirect) {
    const direct = matchChats(chats.filter((chat) => chat.chatType === "oneOnOne"), q);
    if (direct.match || direct.ambiguous) return direct;
  }
  return matchChats(chats, q);
}

function* agentChats(args: string[], preferDirect = false): HostIoSteps<{ result: string } | { error: string }> {
  const refresh = args.includes("--refresh");
  const query = args.filter((arg) => arg !== "--refresh").join(" ").trim();
  const resolved = (yield* liveSender());
  if ("error" in resolved) return resolved;
  const listed = (yield* chatList(resolved.sender, refresh));
  if ("error" in listed) return listed;
  if (!query) return { result: JSON.stringify({ chats: listed.chats }) };
  const found = findChats(listed.chats, query, preferDirect);
  const next = found.match
    ? `Send with: send ${found.match.id} --key <unique-key> --from-pad message.md`
    : found.ambiguous
      ? "Several chats match. Show the candidates to the owner and ask which one, then use its id."
      : "No chat matches. Ask the owner for a more exact name, or use send-to <full name> to start a 1:1 chat.";
  return { result: JSON.stringify({ query, match: found.match, ambiguous: found.ambiguous, candidates: found.candidates, next }) };
}

function* resolveDestination(id: string, sender: Sender): HostIoSteps<{ destination: any } | { error: string }> {
  if (!validChatId(id)) return { error: failureMessage("invalid-request", "Use an immutable chat id from `chats <name>`; chat names are not ids.") };
  let listed = (yield* chatList(sender));
  if ("error" in listed) return { error: listed.error };
  let chat = listed.chats.find((item) => item.id === id);
  if (!chat) {
    listed = (yield* chatList(sender, true));
    if ("error" in listed) return { error: listed.error };
    chat = listed.chats.find((item) => item.id === id);
  }
  if (!chat) return { error: failureMessage("chat-not-found", id) };
  return { destination: { id: chat.id, label: chat.title || chat.id, chatType: chat.chatType, members: chat.members } };
}

function* readMessages(p: Paths, chatId: string, count: number, channel = false): HostIoSteps<{ messages: any[] } | { error: string }> {
  const run = (yield* runExo(p, [channel ? "get-messages" : "get-chat", chatId, "--json", "--count", String(Math.max(1, Math.min(200, count)))], TIMEOUTS.history));
  if (!run.ok) return { error: failureText(run) };
  const messages = parseJson<any[]>(run.stdout.trim());
  return Array.isArray(messages) ? { messages } : { error: "exo-teams returned unreadable messages." };
}

function* agentHistory(args: string[]): HostIoSteps<{ result: string } | { error: string }> {
  if (args.length < 1 || args.length > 2 || !validChatId(args[0])) return { error: "Usage: history <immutable-chat-id> [n]. Select an id from chats; display names are not ids." };
  const configured = settings();
  let count = configured.historyCount;
  if (args.length === 2) {
    if (!/^[0-9]{1,3}$/.test(args[1]) || Number(args[1]) < 1) return { error: "History count must be an integer from 1 to 50." };
    count = Math.min(MAX_COUNT, Number(args[1]));
  }
  const resolved = (yield* liveSender());
  if ("error" in resolved) return resolved;
  const found = (yield* resolveDestination(args[0], resolved.sender));
  if ("error" in found) return found;
  const p = paths()!;
  const read = (yield* readMessages(p, args[0], count));
  if ("error" in read) return { error: `upstream-rejected: exo-teams could not read that chat. Microsoft said: "${microsoftMessage(read.error)}"` };
  return { result: JSON.stringify(boundedHistory(args[0], historyRows(read.messages), count, configured.historyMaxBytes)) };
}

const { parseSendFileArgs, probeFile } = createFileTools({ runProcess, nativePath, failureMessage });
const channelCommands = createChannelCommands({
  now, paths, liveSender,
  run: function*(args, timeout) { return yield* runExo(paths()!, args, timeout); },
  read: function*(id, count) { return yield* readMessages(paths()!, id, count, true); },
});
const { agentTeams, resolveChannel, channelHistory } = channelCommands;
let previewSequence = 0;
function* previewCommand(args: string[], origin: SendOrigin = "agent", body?: string): HostIoSteps<{ result: string } | { error: string }> {
  if (args.length < (body === undefined ? 2 : 1) || !validChatId(args[0])) return { error: "Usage: preview <immutable-chat-id> --from-pad message.md. Find the id with `chats <name>`; chat names are not accepted." };
  if (body !== undefined && args.length > 1) return { error: "invalid-request: Inline text cannot be combined with a body source." };
  const text = body ?? args.slice(1).join(" ");
  if (!text.length) return { error: "invalid-request: Preview text must not be empty." };
  const resolved = (yield* previewSender());
  if ("error" in resolved) return resolved;
  const found = (yield* resolveDestination(args[0], resolved.sender));
  if ("error" in found) return found;
  const previewId = sha256Hex(`preview\u0000${now()}\u0000${++previewSequence}`);
  previewTokens[previewId] = { sender: resolved.sender, destination: found.destination, text, origin, previewNonce: previewId };
  const decision = decideSend((yield* readSendScope()), found.destination.id, origin);
  return {
    result: JSON.stringify({
      previewId,
      idempotencyKey: previewId,
      sender: resolved.sender,
      tenant: { id: resolved.sender.tenantId },
      destination: found.destination,
      text,
      allowed: decision.allow,
      restriction: decision.allow ? null : decision.message,
    })
  };
}

type AttemptState = "pending" | "sent" | "failed" | "unknown";
type SendFailure = "invalid-request" | "not-logged-in" | "reauth-needed" | "chat-not-found" | "chat-not-allowed" | "file-too-large" | "file-unreadable" | "upstream-rejected" | "unknown";
const SEND_FAILURES: SendFailure[] = ["invalid-request", "not-logged-in", "reauth-needed", "chat-not-found", "chat-not-allowed", "file-too-large", "file-unreadable", "upstream-rejected", "unknown"];
type Attempt = {
  idempotencyKey: string;
  sender: Sender;
  target?: string;
  destination: { id: string; label: string; teamId?: string; tenantId?: string };
  payloadHash: string;
  state: AttemptState;
  createdAt: number;
  updatedAt: number;
  sendCount: number;
  failure?: SendFailure;
  failureCause?: string;
  failureMessage?: string;
  messageId?: string | null;
};
type Outbox = { schema: 2; attempts: Attempt[] };

function failureMessage(kind: SendFailure, detail?: any, cause?: string): string {
  switch (kind) {
    case "invalid-request": return `invalid-request: ${String(detail || "Usage: send <immutable-chat-id> [--key <idempotency-key>] --from-pad message.md.")} Find the chat id with \`chats <name>\`, then send again.`;
    case "not-logged-in": return "not-logged-in: Sign in to Teams through `codeterm plugin teams-client login` (or Sign in in the view) before sending.";
    case "reauth-needed": return `reauth-needed: ${String(cause || "expired")}. ${String(detail || "The Teams session needs a new sign-in. Run login again.")}`;
    case "chat-not-found": return `chat-not-found: No chat of this account has id ${String(detail || "unavailable")}. Look it up with \`chats <name>\` and use an id from that result.`;
    case "chat-not-allowed": return String(detail || "chat-not-allowed: The owner's \"Restrict agent sends\" setting does not include this chat. Ask the owner to add it in the Teams Client view.");
    case "file-too-large": return `file-too-large: ${String(detail || "The file is over the limit.")} The limit is ${MAX_FILE_BYTES / (1024 * 1024)} MiB; nothing was uploaded or sent.`;
    case "file-unreadable": return `file-unreadable: ${String(detail || "The file could not be read.")} Give an absolute path to an existing, readable regular file; nothing was uploaded or sent.`;
    case "upstream-rejected": return `upstream-rejected:${String(detail || "the Teams chat service refused the operation")}. Correct the cause, then send again only if you still want delivery.`;
    case "unknown": return `unknown: ${String(detail || "Teams may have accepted this message but confirmation was lost.")} Do not retry this idempotency key and do not report it as delivered; inspect the chat and decide manually.`;
  }
  const exhaustive: never = kind;
  return exhaustive;
}

function* loadOutbox(p: Paths): HostIoSteps<{ ledger?: Outbox; error?: string }> {
  try {
    if (!(yield* host.io.fs.fileExists(p.outbox))) return { ledger: { schema: 2, attempts: [] } };
    const value = parseJson<any>((yield* host.io.fs.readFile(p.outbox)) || "");
    if (value && value.schema === 1) return { ledger: { schema: 2, attempts: [] } };
    if (!value || value.schema !== 2 || !Array.isArray(value.attempts)) return { error: "the existing outbox ledger is unreadable" };
    const states: AttemptState[] = ["pending", "sent", "failed", "unknown"];
    const valid = value.attempts.every((item: any) => item && typeof item.idempotencyKey === "string" &&
      typeof item.payloadHash === "string" && /^[a-f0-9]{64}$/.test(item.payloadHash) && states.includes(item.state) &&
      item.sender && typeof item.sender.accountId === "string" && typeof item.sender.identityKey === "string" &&
      item.destination && validChatId(String(item.destination.id || "")) && typeof item.destination.label === "string" &&
      (!String(item.target || "").startsWith("channel:") || (channelId(item.destination.id) && teamId(item.destination.teamId) && typeof item.destination.tenantId === "string" && !!item.destination.tenantId)) &&
      Number.isFinite(Number(item.createdAt)) && Number.isFinite(Number(item.updatedAt)) && Number.isInteger(item.sendCount) && item.sendCount >= 0);
    if (!valid) return { error: "the existing outbox ledger contains an invalid or unrecognized attempt state" };
    return { ledger: value as Outbox };
  } catch { return { error: "the existing outbox ledger could not be read" }; }
}

function* persistOutbox(p: Paths, ledger: Outbox): HostIoSteps<boolean> {
  try {
    if (!(yield* host.io.fs.makeDirs(p.root))) return false;
    return (yield* host.io.fs.writeFileAtomic(p.outbox, JSON.stringify(ledger))) === true;
  } catch { return false; }
}

function rememberSendFailure(kind: SendFailure, message: string): { error: string } {
  lastSendState = { state: kind, message, updatedAt: now() };
  return { error: message };
}

function sendFailureResult(kind: SendFailure, detail?: any, cause?: string): { error: string } {
  return rememberSendFailure(kind, failureMessage(kind, detail, cause));
}

function rememberPrefixedFailure(message: string): { error: string } {
  const state = message.slice(0, message.indexOf(":")) as SendFailure;
  return SEND_FAILURES.includes(state) ? rememberSendFailure(state, message) : sendFailureResult("unknown", "The command result could not be classified safely. Inspect the Teams chat before retrying.");
}

function parseSendArgs(args: string[], target: (value: string) => boolean, usage: string, body?: string): { target: string; text: string; key?: string } | { error: string } {
  if (args.length < (body === undefined ? 2 : 1) || !target(args[0])) return { error: failureMessage("invalid-request", usage) };
  let start = 1;
  let key: string | undefined;
  if (args[1] === "--key") {
    if (args.length < (body === undefined ? 4 : 3) || !/^[A-Za-z0-9._:-]{1,160}$/.test(args[2])) return { error: failureMessage("invalid-request", "--key needs a 1–160 character idempotency key ([A-Za-z0-9._:-]), followed by message text.") };
    key = args[2];
    start = 3;
  }
  if (body !== undefined && args.length > start) return { error: failureMessage("invalid-request", "Inline text cannot be combined with a body source.") };
  const text = body ?? args.slice(start).join(" ");
  if (!text.trim().length) return { error: failureMessage("invalid-request", "Message text must not be empty.") };
  return { target: args[0], text, key };
}

function attemptResult(attempt: Attempt, extra: Record<string, unknown> = {}): { result: string } {
  lastSendState = { state: "sent", message: attempt.messageId ? `Teams accepted message ${attempt.messageId}.` : "Teams accepted the message; its id could not be read back.", updatedAt: now() };
  return {
    result: JSON.stringify({
      status: "sent",
      sender: attempt.sender,
      destination: attempt.destination,
      idempotencyKey: attempt.idempotencyKey,
      messageId: attempt.messageId || null,
      ...extra,
      ...(attempt.messageId ? {} : { messageIdNote: "exo-teams confirmed the send, but the message id was not found when the chat was read back. Check the chat before resending." }),
      deliveryGuarantee: "A sent idempotency key is never resent. An unconfirmed send stays unknown. This is not an exactly-once delivery guarantee.",
    })
  };
}

function* persistFailure(p: Paths, ledger: Outbox, attempt: Attempt, kind: SendFailure, detail?: string, cause?: string): HostIoSteps<{ error: string }> {
  attempt.failure = kind;
  attempt.failureCause = cause;
  attempt.failureMessage = failureMessage(kind, detail, cause);
  attempt.updatedAt = now();
  attempt.state = kind === "unknown" ? "unknown" : "failed";
  if (!(yield* persistOutbox(p, ledger))) {
    attempt.state = "unknown";
    attempt.failure = "unknown";
    attempt.failureCause = undefined;
    attempt.failureMessage = failureMessage("unknown");
    (yield* persistOutbox(p, ledger));
    return rememberSendFailure("unknown", attempt.failureMessage);
  }
  return rememberSendFailure(kind, attempt.failureMessage);
}

function* exoFailure(p: Paths, ledger: Outbox, attempt: Attempt, run: RunResult, classify: (text: string) => { kind: SendFailure; detail: string; cause?: string } = sendFailure): HostIoSteps<{ error: string }> {
  const failure = classify(failureText(run));
  return (yield* persistFailure(p, ledger, attempt, failure.kind, failure.detail, failure.cause));
}

type SendPlan = { kind: "chat"; chatId: string } | { kind: "person"; query: string } | { kind: "channel"; teamId: string; channelId: string };

type Payload = { kind: "text"; text: string } | { kind: "file"; file: FileInfo; message: string };

function payloadHash(payload: Payload): string {
  return payload.kind === "text" ? sha256Hex(payload.text) : sha256Hex(`file\u0000${payload.file.name}\u0000${payload.file.sha256}\u0000${payload.message}`);
}

function fileSummary(payload: Payload): Record<string, unknown> {
  return payload.kind === "file" ? { file: { name: payload.file.name, bytes: payload.file.size } } : {};
}

// Delivery runs `send` or `send-file` for a known chat, or `new-dm` when a person has no 1:1 chat yet; each stays behind one ledger entry.
function* deliver(origin: SendOrigin, plan: SendPlan, payload: Payload, explicitKey: string | undefined): HostIoSteps<{ result: string } | { error: string }> {
  const matchingPreview = plan.kind === "chat" && payload.kind === "text"
    ? Object.values(previewTokens).reverse().find((token: any) => token.destination.id === plan.chatId && token.text === payload.text)
    : null;
  let key = explicitKey || matchingPreview?.previewNonce;
  const p = paths();
  if (!p) return sendFailureResult("upstream-rejected", "the plugin-owned data directory is unavailable");
  const outboxLock = yield* host.io.fs.lockFile(p.outbox);
  if (!outboxLock) return { error: "busy: another send is updating the outbox; retry after it completes." };
  try {
    const loaded = (yield* loadOutbox(p));
    if (!loaded.ledger) return sendFailureResult("upstream-rejected", loaded.error || "the outbox could not be read");
    const ledger = loaded.ledger;
    const hash = payloadHash(payload);
    const destinationKey = plan.kind === "chat" ? plan.chatId : plan.kind === "channel"
      ? `channel:${plan.teamId}:${plan.channelId}` : `person:${sha256Hex(personQuery(plan.query).toLowerCase()).slice(0, 24)}`;
    let attempt = key ? ledger.attempts.find((item) => item.idempotencyKey === key) : undefined;
    if (attempt && (attempt.payloadHash !== hash || (attempt.target || attempt.destination.id) !== destinationKey)) {
      return sendFailureResult("invalid-request", "This idempotency key is already bound to a different chat, text or file; choose a new key only for an intentional new send.");
    }
    // Channel readback remains bound to the current account even on an already-sent key.
    if (attempt && attempt.state === "sent" && plan.kind !== "channel") return attemptResult(attempt, fileSummary(payload));
    if (attempt && attempt.state === "unknown") return sendFailureResult("unknown");
    if (attempt && attempt.state === "pending") return (yield* persistFailure(p, ledger, attempt, "unknown", "a previous invocation ended before its send result was recorded"));
    if (attempt && attempt.state === "failed" && attempt.sendCount > 0) return rememberPrefixedFailure(attempt.failureMessage || failureMessage("upstream-rejected", "This key already dispatched a failed attempt; an intentional new attempt requires a new key"));

    const resolved = (yield* liveSender());
    if ("error" in resolved) return rememberPrefixedFailure(resolved.error);
    if (attempt && attempt.sender.identityKey !== resolved.sender.identityKey) {
      return sendFailureResult("invalid-request", "This idempotency key belongs to another account; choose a new key only for an intentional new send.");
    }
    if (attempt && attempt.state === "sent") return attemptResult(attempt, fileSummary(payload));

    let destination: Attempt["destination"];
    let newDm = false;
    let person = "";
    if (plan.kind === "channel") {
      const found = yield* resolveChannel(resolved.sender, plan.teamId, plan.channelId, true);
      if ("error" in found) return found;
      destination = {
        id: found.channel.id, label: `${found.channel.team} / ${found.channel.title}`,
        teamId: found.channel.teamId, tenantId: found.channel.tenantId
      };
      if (attempt && attempt.destination.tenantId !== destination.tenantId) return sendFailureResult("invalid-request", "This channel key belongs to a different tenant. No message was posted.");
    } else if (plan.kind === "chat") {
      const found = (yield* resolveDestination(plan.chatId, resolved.sender));
      if ("error" in found) return rememberPrefixedFailure(found.error);
      destination = { id: found.destination.id, label: String(found.destination.label || found.destination.id) };
    } else {
      const listed = (yield* chatList(resolved.sender));
      if ("error" in listed) return rememberPrefixedFailure(listed.error);
      // A person is reached only through a 1:1 chat; new-dm's unique-roster thread returns the existing DM when there is one.
      const found = matchChats(listed.chats.filter((chat) => chat.chatType === "oneOnOne"), personQuery(plan.query));
      if (found.ambiguous) {
        return sendFailureResult("invalid-request", `Several chats match "${plan.query}": ${found.candidates.slice(0, 8).map((chat) => `${chat.title} (${chat.chatType}, ${chat.id})`).join("; ")}. Ask the owner which one and send to its id.`);
      }
      if (found.match) destination = { id: found.match.id, label: found.match.title };
      else if (payload.kind === "file") {
        return sendFailureResult("invalid-request", `No 1:1 chat with "${plan.query}" exists, and a file can only go to an existing chat. Start the chat with send-to <full name> --from-pad message.md first, or send the file to a chat id.`);
      } else {
        if (personQuery(plan.query).split(/\s+/).filter(Boolean).length < 2) {
          return sendFailureResult("invalid-request", `No chat with "${plan.query}" exists. To start a new 1:1 chat, give the person's full name.`);
        }
        newDm = true;
        person = personQuery(plan.query);
        destination = { id: destinationKey, label: destinationKey };
      }
    }
    const decision = decideSend((yield* readSendScope()), destination.id, origin);
    if (!decision.allow) return sendFailureResult("chat-not-allowed", decision.message);
    if (!key) key = sha256Hex(`send\u0000${now()}\u0000${++previewSequence}\u0000${destination.id}`).slice(0, 32);

    if (!attempt) {
      attempt = { idempotencyKey: key, sender: resolved.sender, target: destinationKey, destination, payloadHash: hash, state: "pending", createdAt: now(), updatedAt: now(), sendCount: 0 };
      ledger.attempts.push(attempt);
    }
    attempt.destination = destination;
    attempt.state = "pending";
    attempt.updatedAt = now();
    attempt.sendCount += 1;
    delete attempt.failure;
    delete attempt.failureCause;
    delete attempt.failureMessage;
    if (!(yield* persistOutbox(p, ledger))) return sendFailureResult("upstream-rejected", "the pending attempt could not be persisted; Teams was not contacted");

    const sentAfter = now() - 120_000;
    let chatId = destination.id;
    if (payload.kind === "file") {
      const message = payload.message ? ["--message", htmlMessage(payload.message)] : [];
      const run = (yield* runExo(p, ["send-file", chatId, "--file", nativePath(payload.file.path), ...message, "--json"], TIMEOUTS.sendFile));
      if (!run.ok) return (yield* exoFailure(p, ledger, attempt, run, fileSendFailure));
      const ok = parseJson<any>(run.stdout.trim());
      if (!ok || ok.ok !== true) return (yield* persistFailure(p, ledger, attempt, "unknown", "exo-teams exited cleanly but did not report the file as sent."));
    } else if (newDm) {
      const run = (yield* runExo(p, ["new-dm", person, htmlMessage(payload.text), "--json"], TIMEOUTS.send));
      if (!run.ok) return (yield* exoFailure(p, ledger, attempt, run));
      const created = parseJson<any>(run.stdout.trim());
      const createdId = created && typeof created.id === "string" ? created.id : "";
      const resolvedName = run.stderr.match(/found user:\s*(.+?)\s*(?:\(|$)/m)?.[1] || person;
      if (!validChatId(createdId)) return (yield* persistFailure(p, ledger, attempt, "unknown", "exo-teams reported the new chat as sent but returned no chat id."));
      chatId = createdId;
      attempt.destination = { id: createdId, label: resolvedName };
      memoryChats = null;
    } else {
      const run = (yield* runExo(p, ["send", chatId, htmlMessage(payload.text), "--json"], TIMEOUTS.send));
      if (!run.ok) return (yield* exoFailure(p, ledger, attempt, run));
      const ok = parseJson<any>(run.stdout.trim());
      if (!ok || ok.ok !== true) return (yield* persistFailure(p, ledger, attempt, "unknown", "exo-teams exited cleanly but did not report the send as accepted."));
    }
    attempt.state = "sent";
    attempt.updatedAt = now();
    const read = (yield* readMessages(p, chatId, 20, plan.kind === "channel"));
    attempt.messageId = !("messages" in read) ? null : payload.kind === "file"
      ? findSentFileMessageId(read.messages, payload.file.name, resolved.sender.user, sentAfter)
      : findSentMessageId(read.messages, payload.text, resolved.sender.user, sentAfter);
    if (!(yield* persistOutbox(p, ledger))) return (yield* persistFailure(p, ledger, attempt, "unknown", "Teams accepted the message but the sent result could not be recorded."));
    return attemptResult(attempt, fileSummary(payload));
  } finally { yield* host.io.fs.unlockFile(outboxLock); }
}

function* sendCommand(origin: SendOrigin, args: string[], body?: string): HostIoSteps<{ result: string } | { error: string }> {
  if (args[1] === "--team") {
    const at = args.indexOf("--team");
    const team = args[at + 1];
    if (at !== 1 || !teamId(team) || args.lastIndexOf("--team") !== at || !channelId(args[0])) return { error: "invalid-request: Use send <channel-id> --team <team-id> --key <key> --from-pad message.md. Select both ids from channels." };
    const rest = [args[0], ...args.slice(3)];
    if (rest.slice(1, 4).some(arg => /^(?:--mention|--mentions)(?:=|$)/.test(arg))) return { error: "unsupported-mentions: The pinned exo-teams CLI has no mention metadata. Nothing was sent. Use plain text without a mention option." };
    const parsed = parseSendArgs(rest, channelId, "Use send <channel-id> --team <team-id> --key <key> --from-pad message.md.", body);
    if ("error" in parsed) return rememberPrefixedFailure(parsed.error);
    if (!parsed.key) return { error: "invalid-request: Channel sends require --key <unique-key>. Reuse it only for this same team, channel and body." };
    return yield* deliver(origin, { kind: "channel", teamId: team, channelId: parsed.target }, { kind: "text", text: parsed.text }, parsed.key);
  }
  if (channelId(args[0])) return { error: "invalid-request: Channel sends require --team <team-id>. Select the exact team and channel with channels <team-id>." };
  const parsed = parseSendArgs(args, validChatId, "Usage: send <immutable-chat-id> [--key <idempotency-key>] --from-pad message.md; chat names are not ids. Use send-to <person> for a person.", body);
  if ("error" in parsed) return rememberPrefixedFailure(parsed.error);
  return (yield* deliver(origin, { kind: "chat", chatId: parsed.target }, { kind: "text", text: parsed.text }, parsed.key));
}

function* sendToCommand(args: string[], body?: string): HostIoSteps<{ result: string } | { error: string }> {
  const separator = args.indexOf("--");
  const rest = separator > 0 ? [args.slice(0, separator).join(" "), ...args.slice(separator + 1)] : args;
  const parsed = parseSendArgs(rest, (value) => !!value.trim() && value.length <= 200, "Usage: send-to <person name or email> [--key <idempotency-key>] --from-pad message.md. Quote a multi-word name, or put -- after it.", body);
  if ("error" in parsed) return rememberPrefixedFailure(parsed.error);
  return (yield* deliver("agent", { kind: "person", query: parsed.target.trim() }, { kind: "text", text: parsed.text }, parsed.key));
}

function* sendFileCommand(args: string[], body?: string): HostIoSteps<{ result: string } | { error: string }> {
  const parsed = parseSendFileArgs(args, body);
  if ("error" in parsed) return rememberPrefixedFailure(parsed.error);
  const p = paths();
  if (!p) return sendFailureResult("upstream-rejected", "the plugin-owned data directory is unavailable");
  const target = (yield* detectTarget(p));
  if ("state" in target) return sendFailureResult("upstream-rejected", target.message);
  const probed = (yield* probeFile(p, target, parsed.path));
  if ("error" in probed) return rememberPrefixedFailure(probed.error);
  const plan: SendPlan = validChatId(parsed.target) ? { kind: "chat", chatId: parsed.target } : { kind: "person", query: parsed.target };
  return (yield* deliver("agent", plan, { kind: "file", file: probed.file, message: parsed.message }, parsed.key));
}

function* searchScope(sender: Sender, chats: Chat[], wanted: string): HostIoSteps<{ chat: Chat } | { error: string }> {
  const exact = chats.find((item) => item.id === wanted);
  if (exact) return { chat: exact };
  if (validChatId(wanted)) {
    const fresh = (yield* chatList(sender, true));
    if ("error" in fresh) return fresh;
    const found = fresh.chats.find((item) => item.id === wanted);
    return found ? { chat: found } : { error: failureMessage("chat-not-found", wanted) };
  }
  const found = findChats(chats, wanted, true);
  if (found.ambiguous) return { error: `invalid-request: Several chats match "${wanted}": ${found.candidates.slice(0, 8).map((item) => `${item.title} (${item.chatType}, ${item.id})`).join("; ")}. Ask the owner which one and pass its id to --chat.` };
  return found.match ? { chat: found.match } : { error: `chat-not-found: No chat matches "${wanted}". Look it up with \`search <name>\` or \`chats <name>\`.` };
}

// exo-teams `search` queries Graph mail and drive items, not chat messages, so message text is matched in fetched chat history.
function* searchMessagesCommand(args: string[]): HostIoSteps<{ result: string } | { error: string }> {
  const parsed = parseSearchArgs(args);
  if ("error" in parsed) return parsed;
  const resolved = (yield* liveSender());
  if ("error" in resolved) return resolved;
  const listed = (yield* chatList(resolved.sender));
  if ("error" in listed) return listed;
  let scope = listed.chats.slice(0, SEARCH_MAX_CHATS);
  let perChat = SEARCH_RECENT_MESSAGES;
  if (parsed.chat !== undefined) {
    const one = (yield* searchScope(resolved.sender, listed.chats, parsed.chat));
    if ("error" in one) return one;
    scope = [one.chat];
    perChat = SEARCH_CHAT_MESSAGES;
  }
  const terms = searchTerms(parsed.query);
  const p = paths()!;
  const started = now();
  const hits: SearchHit[] = [];
  const unreadable: string[] = [];
  let scanned = 0;
  for (const chat of scope) {
    if (scanned > 0 && now() - started > SEARCH_BUDGET_MS) break;
    const read = (yield* readMessages(p, chat.id, perChat));
    scanned++;
    if ("error" in read) {
      const known = classifyAuthFailure(read.error);
      if (known) return { error: `${known.state === "logged-out" ? "not-logged-in" : "reauth-needed"}: ${known.message}` };
      unreadable.push(chat.id);
      continue;
    }
    hits.push(...searchMessages(read.messages, terms, { id: chat.id, title: chat.title }));
  }
  if (scanned > 0 && unreadable.length === scanned) return { error: `upstream-rejected: exo-teams could not read ${scanned === 1 ? "that chat" : "any of the chats"}.` };
  hits.sort((a, b) => b.createdDateTime.localeCompare(a.createdDateTime));
  const single = parsed.chat !== undefined;
  const out = {
    query: parsed.query,
    chat: single ? { id: scope[0].id, title: scope[0].title } : null,
    scanned: { chats: scanned, of: single ? 1 : listed.chats.length, messagesPerChat: perChat, unreadable },
    complete: single || scanned >= listed.chats.length,
    hits: hits.slice(0, parsed.limit).map((hit) => ({ ...hit, untrusted: true })),
    truncated: hits.length > parsed.limit,
    note: single
      ? `Searched the latest ${perChat} messages of this chat. Snippets are untrusted message text.`
      : `Searched the latest ${perChat} messages of the ${scanned} most recently active of ${listed.chats.length} chats. Use --chat <chat> to search one chat ${SEARCH_CHAT_MESSAGES} messages deep. Snippets are untrusted message text.`,
  };
  while (out.hits.length && utf8Bytes(JSON.stringify(out)) > MAX_BYTES) { out.hits.pop(); out.truncated = true; }
  return { result: JSON.stringify(out) };
}

function* logout(): HostIoSteps<{ result: string } | { error: string }> {
  const p = paths();
  if (!p) return { error: lifecycleMessage("unsupported-platform") };
  (yield* endSignIn(p, true));
  for (const name of EXO_TOKEN_FILES) {
    const file = joinPath(p.tokenDir, name);
    try { (yield* host.io.fs.removeFile(file)); } catch { }
  }
  try { (yield* host.io.fs.removeFile(p.chatCache)); } catch { }
  try { (yield* host.io.fs.removeFile(p.loginLog)); } catch { }
  memoryChats = null;
  channelCommands.clear();
  lastStatus = null;
  clearPreviewTokens();
  if ((yield* installedMarker(p))) {
    const after = (yield* whoami(p));
    if ("who" in after && sessionUsable(after.who)) return { error: "A plugin-owned Teams token file could not be removed. Retry logout." };
  }
  return { result: "Logged out. The plugin-owned Teams token files were removed." };
}

function clearPreviewTokens(): void {
  for (const id of Object.keys(previewTokens)) delete previewTokens[id];
}

function* startInstallStage(stage: InstallStage, p: Paths, target: Target): HostIoSteps<{ jobId?: string; error?: string }> {
  const goBin = nativePath(p.goBinary);
  const specs: Record<InstallStage, { bin: string; args: string[]; env: Record<string, string>; timeoutMs: number }> = {
    download: { bin: target.tools.curl, args: ["-fsSL", "--proto", "=https", "--retry", "2", "-o", nativePath(joinPath(p.runtime, target.archive.file)), `${GO_DOWNLOAD_BASE}${target.archive.file}`], env: {}, timeoutMs: TIMEOUTS.download },
    extract: { bin: target.tools.tar, args: ["-xf", nativePath(joinPath(p.runtime, target.archive.file)), "-C", nativePath(p.toolchain)], env: {}, timeoutMs: TIMEOUTS.extract },
    module: { bin: goBin, args: ["mod", "download", "-json", `${EXO_MODULE}@${EXO_VERSION}`], env: goEnv(p), timeoutMs: TIMEOUTS.goModule },
    build: { bin: goBin, args: ["install", `${EXO_PACKAGE}@${EXO_VERSION}`], env: goEnv(p), timeoutMs: TIMEOUTS.goBuild },
  };
  const spec = specs[stage];
  if (stage === "extract" && !(yield* host.io.fs.makeDirs(p.toolchain))) return { error: "Could not create the private toolchain directory." };
  let started: { jobId?: string; error?: string };
  try { started = (yield* ioValue<HostIoResult<"execStart">>({ op: "execStart", options: { bin: spec.bin, args: spec.args, env: spec.env, timeoutMs: spec.timeoutMs } })); }
  catch { return { error: `Could not start the ${stage} step.` }; }
  if (!started.jobId) return { error: started.error || `The ${stage} step did not start.` };
  installJobs[started.jobId] = { stage, paths: p, target };
  activeInstallJobId = started.jobId;
  return { jobId: started.jobId };
}

const STAGE_MESSAGES: Record<InstallStage, string> = {
  download: `Downloading the pinned Go toolchain ${GO_VERSION} into the plugin runtime.`,
  extract: "The Go toolchain checksum matched; extracting it.",
  module: "Fetching exo-teams at its pinned commit through the Go module proxy.",
  build: "The exo-teams module matched its pinned checksum; building it.",
};

function* nextInstallStage(p: Paths, target: Target, from?: InstallStage): HostIoSteps<any> {
  const order: InstallStage[] = ["download", "extract", "module", "build"];
  let index = from ? order.indexOf(from) + 1 : 0;
  if (!from && (yield* host.io.fs.fileExists(p.goBinary))) index = 2;
  if (index >= order.length) return null;
  const stage = order[index];
  const started = (yield* startInstallStage(stage, p, target));
  if (!started.jobId) return { done: true, state: "install-failed", error: lifecycleMessage("install-failed", started.error) };
  return { done: false, jobId: started.jobId, state: "install-in-progress", message: STAGE_MESSAGES[stage] };
}

function* verifyArchive(p: Paths, target: Target): HostIoSteps<string | null> {
  const file = nativePath(joinPath(p.runtime, target.archive.file));
  const [bin, ...args] = target.tools.hash.map((part) => part === "{file}" ? file : part);
  const run = (yield* runProcess(bin, args, { CT_HASH_FILE: file }, TIMEOUTS.hash));
  const digest = run.ok ? parseSha256(run.stdout) : null;
  if (digest === target.archive.sha256) return null;
  try { (yield* host.io.fs.removeFile(joinPath(p.runtime, target.archive.file))); } catch { }
  const observed = digest ? `got ${digest}` : `${bin} gave no digest: ${redact(run.ok ? run.stdout : `${run.error} ${run.stderr}`).trim().slice(0, 300)}`;
  return `The downloaded Go toolchain ${target.archive.file} did not match its pinned SHA-256 ${target.archive.sha256} (${observed}), so it was deleted and nothing was built.`;
}

function* finishInstallStage(jobId: string, job: InstallJob, poll: { code?: number; stdout?: string; stderr?: string; error?: string }): HostIoSteps<any> {
  delete installJobs[jobId];
  if (activeInstallJobId === jobId) activeInstallJobId = null;
  const { paths: p, target, stage } = job;
  if (poll.error || poll.code !== 0) {
    const detail = redact(String(poll.stderr || poll.error || "").trim().split(/\r?\n/).slice(-3).join(" ")).slice(0, 400);
    return { done: true, state: "install-failed", error: lifecycleMessage("install-failed", `The ${stage} step failed${detail ? `: ${detail}` : "."} Retry Sign in.`) };
  }
  if (stage === "download") {
    const mismatch = (yield* verifyArchive(p, target));
    if (mismatch) return { done: true, state: "install-failed", error: mismatch };
  }
  if (stage === "extract") {
    try { (yield* host.io.fs.removeFile(joinPath(p.runtime, target.archive.file))); } catch { }
    if (!(yield* host.io.fs.fileExists(p.goBinary))) return { done: true, state: "install-failed", error: lifecycleMessage("install-failed", "The Go toolchain archive did not contain the expected go binary.") };
  }
  if (stage === "module") {
    const module = parseGoModDownload(String(poll.stdout || ""));
    if (!module || module.error || module.version !== EXO_VERSION || module.sum !== EXO_MODULE_SUM) {
      return { done: true, state: "install-failed", error: `The exo-teams module did not match its pinned version ${EXO_VERSION} and checksum ${EXO_MODULE_SUM}, so it was not built.` };
    }
  }
  if (stage === "build") {
    if (!(yield* host.io.fs.fileExists(p.binary))) return { done: true, state: "install-failed", error: lifecycleMessage("install-failed", "go install finished without producing the exo-teams binary.") };
    (yield* host.io.fs.writeFile(p.marker, JSON.stringify({ module: EXO_MODULE, version: EXO_VERSION, sum: EXO_MODULE_SUM, go: GO_VERSION })));
    return (yield* startSignIn(p));
  }
  return (yield* nextInstallStage(p, target, stage));
}

function* startSignIn(p: Paths): HostIoSteps<any> {
  const pending = (yield* pendingSignIn(p));
  if (pending) return signInView(pending.log);
  (yield* endSignIn(p, true));
  try { (yield* host.io.fs.removeFile(p.loginLog)); } catch { }
  let started: { jobId?: string; error?: string };
  try { started = (yield* ioValue<HostIoResult<"execStart">>({ op: "execStart", options: { bin: nativePath(p.binary), args: ["auth"], env: exoEnv(p), timeoutMs: SIGN_IN_TTL_MS + 60_000, detach: true, logFile: p.loginLog } })); }
  catch { return { done: true, state: "sign-in-failed", error: "Could not start exo-teams sign-in." }; }
  if (!started.jobId) return { done: true, state: "sign-in-failed", error: started.error || "exo-teams sign-in did not start." };
  let pid: number | null = null;
  try {
    const poll = (yield* ioValue<HostIoResult<"execPoll">>({ op: "execPoll", job: started.jobId }));
    const result = poll && typeof poll.stdout === "string" ? parseJson<any>(poll.stdout) : null;
    pid = Number.isInteger(poll?.pid) ? poll.pid : Number.isInteger(result?.pid) ? result.pid : null;
    if (poll && poll.done) (yield* ioValue<HostIoResult<"execClose">>({ op: "execClose", job: started.jobId }));
  } catch { }
  (yield* host.io.fs.writeFile(p.loginState, JSON.stringify({ startedAt: now(), pid })));
  lastStatus = null;
  return signInView((yield* readSignInLog(p)));
}

function signInView(log: SignInLog): any {
  if (log.state === "awaiting-user") {
    return { done: false, state: "awaiting-user", signInUrl: log.signInUrl, deviceCode: log.deviceCode, message: `Open ${log.signInUrl} in your usual browser, enter code ${log.deviceCode}, and sign in with your work account. The code expires in 15 minutes.` };
  }
  return { done: false, state: "awaiting-user", message: "Microsoft is issuing a sign-in code. Poll login-status until it returns signInUrl and deviceCode." };
}

function* loginStart(): HostIoSteps<any> {
  const p = paths();
  if (!p) return { done: true, state: "unsupported-platform", error: lifecycleMessage("unsupported-platform") };
  if (activeInstallJobId) return (yield* loginPoll());
  const target = (yield* detectTarget(p));
  if ("state" in target) return { done: true, state: target.state, error: target.message };
  const secured = (yield* protectStorage(p));
  if (secured.error) return { done: true, state: secured.error, error: secured.message };
  if (!(yield* installedMarker(p))) return (yield* nextInstallStage(p, target));
  return (yield* startSignIn(p));
}

function* loginPoll(): HostIoSteps<any> {
  const p = paths();
  if (!p) return { done: true, state: "unsupported-platform", error: lifecycleMessage("unsupported-platform") };
  if (activeInstallJobId) {
    const jobId = activeInstallJobId;
    const job = installJobs[jobId];
    let poll: { done?: boolean; code?: number; stdout?: string; stderr?: string; error?: string };
    try { poll = (yield* ioValue<HostIoResult<"execPoll">>({ op: "execPoll", job: jobId })); }
    catch { activeInstallJobId = null; return { done: true, state: "install-failed", error: "Could not read the install job." }; }
    if (!poll.done) return { done: false, jobId, state: "install-in-progress", message: STAGE_MESSAGES[job.stage] };
    try { (yield* ioValue<HostIoResult<"execClose">>({ op: "execClose", job: jobId })); } catch { }
    return (yield* finishInstallStage(jobId, job, poll));
  }
  const record = (yield* readLoginRecord(p));
  if (!record) {
    const current = (yield* status());
    return { done: true, state: current.state, message: current.message };
  }
  const log = (yield* readSignInLog(p));
  if (log.state === "failed") {
    (yield* endSignIn(p, false));
    return { done: true, state: log.failure.state, error: log.failure.message };
  }
  if (log.state === "signed-in") {
    (yield* endSignIn(p, false));
    memoryChats = null;
    const current = (yield* status());
    return current.state === "logged-in"
      ? { done: true, state: "logged-in", message: current.message }
      : { done: true, state: current.state, error: current.message };
  }
  if (now() - record.startedAt > SIGN_IN_TTL_MS + 30_000) {
    (yield* endSignIn(p, true));
    return { done: true, state: "expired", error: "The sign-in code expired before the sign-in finished. Run login again for a fresh code." };
  }
  return signInView(log);
}

function agentLoginView(current: any): Record<string, unknown> {
  return {
    done: current.done === true,
    state: String(current.state || "awaiting-user"),
    signIn: current.deviceCode ? "device-code" : undefined,
    signInUrl: current.signInUrl,
    deviceCode: current.deviceCode,
    message: current.error || current.message,
    ...(current.error ? { error: current.error } : {}),
  };
}

function* health(): HostIoSteps<Record<string, unknown>> {
  return {
    ...(yield* status()),
    cli: { module: EXO_MODULE, version: EXO_VERSION, commit: "b9ebbf5", go: GO_VERSION },
    sendScope: (yield* readSendScope()),
    lastSend: lastSendState,
  };
}

function* onAgentCommand(ctx: { sessionId: string; verb: string; args: string[]; body?: string }): HostIoSteps<{ result: string } | { error: string }> {
  const args = Array.isArray(ctx.args) ? ctx.args : [];
  switch (ctx.verb) {
    case "login": {
      if (args.length) return { error: "Usage: login." };
      const current = (yield* loginStart());
      if (current.error && current.done) return { error: current.error };
      return { result: JSON.stringify(agentLoginView(current)) };
    }
    case "login-status": {
      if (args.length) return { error: "Usage: login-status." };
      return { result: JSON.stringify(agentLoginView((yield* loginPoll()))) };
    }
    case "accounts": {
      const current = (yield* status());
      return { result: JSON.stringify({ state: current.state, accounts: current.accounts || [] }) };
    }
    case "use": return { error: "exo-teams keeps one signed-in Teams account. Run logout, then login with the other account." };
    case "chats": return (yield* agentChats(args));
    case "teams": return yield* agentTeams(args);
    case "channels": return yield* agentTeams(args, true);
    case "channel-history": return yield* channelHistory(args);
    case "search": return args.length ? (yield* agentChats(args, true)) : { error: "Usage: search <person name or email>." };
    case "history": return (yield* agentHistory(args));
    case "health": return { result: JSON.stringify((yield* health())) };
    case "logout": return (yield* logout());
    case "send": return (yield* sendCommand("agent", args, ctx.body));
    case "send-to": return (yield* sendToCommand(args, ctx.body));
    case "send-file": return (yield* sendFileCommand(args, ctx.body));
    case "search-messages": return (yield* searchMessagesCommand(args));
    case "preview": return (yield* previewCommand(args, "agent", ctx.body));
    default: return { error: `Unknown Teams Client verb: ${ctx.verb}` };
  }
}

function* viewCall(method: string, args: any): HostIoSteps<unknown> {
  const value = args || {};
  if (method === "status") {
    const current = (yield* status());
    return { ...current, loginJobId: current.state === "awaiting-user" || activeInstallJobId ? "sign-in" : null };
  }
  if (method === "accounts") return { accounts: (lastStatus || (yield* status())).accounts || [] };
  if (method === "loginStart") return (yield* loginStart());
  if (method === "loginPoll") return (yield* loginPoll());
  if (method === "useAccount") return { error: "exo-teams keeps one signed-in Teams account. Sign out, then sign in with the other account." };
  if (method === "logout") return (yield* logout());
  if (method === "chats") return (yield* agentChats(String(value.query || "").trim() ? [String(value.query)] : []));
  if (method === "sendScope") return (yield* readSendScope());
  if (method === "setSendScope") return (yield* setSendScope(value));
  if (method === "preview") return (yield* previewCommand([String(value.chatId || ""), String(value.text || "")], "view"));
  if (method === "send") return (yield* sendCommand("view", [String(value.chatId || ""), "--key", String(value.idempotencyKey || ""), String(value.text || "")]));
  return { error: `Unknown Teams Client view method: ${method}` };
}

function* renderGlance(): HostIoSteps<GlanceView> {
  const p = paths();
  const installed = !!(p && (yield* installedMarker(p)));
  const current = lastStatus;
  const connected = current?.state === "logged-in";
  const nodes: ViewNode[] = [{ kind: "badge", label: connected ? "Connected" : installed ? "Sign-in needed" : "exo-teams not installed", tone: connected ? "ok" : installed ? "warn" : "muted" }];
  nodes.push({ kind: "text", text: connected ? `${current?.upn || "Account resolved"}` : "Open Teams Client to check status or sign in.", style: { tone: "muted" } });
  const scope = (yield* readSendScope());
  nodes.push({ kind: "text", text: scope.mode === "all" ? "Agent sends: any chat" : `Agent sends: ${scope.chats.length} allowed chat${scope.chats.length === 1 ? "" : "s"}`, style: { tone: scope.mode === "all" ? "muted" : "warn" } });
  if (lastSendState) nodes.push({ kind: "text", text: `Last send: ${lastSendState.state} · ${lastSendState.message}`, style: { tone: lastSendState.state === "sent" ? "ok" : "warn" } });
  return { title: "Teams Client", nodes };
}

const plugin = defineProviderIo({
  onAgentCommand,
  renderGlance,
  viewCall: viewCall as PluginModule["viewCall"],
  __test_paths: paths,
  __test_setClock: (clock: (() => number) | null) => { injectedClock = clock; },
  __test_reset: () => {
    for (const id of Object.keys(installJobs)) delete installJobs[id];
    activeInstallJobId = null;
    cachedTarget = null;
    memoryChats = null;
    channelCommands.clear();
    lastStatus = null;
    lastSendState = null;
    clearPreviewTokens();
    for (const key of Object.keys(storageProtectionCache)) delete storageProtectionCache[key];
  },
  __test_resolveTarget: resolveTarget,
  __test_windowsAclCommands: windowsAclCommands,
  __test_sha256Hex: sha256Hex,
  __test_boundedHistory: boundedHistory,
  __test_failureMessage: failureMessage,
}, () => host.io) satisfies PluginModule;

export default defineProviderIo(plugin, () => host.io);
