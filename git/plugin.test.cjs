require("../scripts/host-io-fixture.cjs").installTestHostIo();
// Plugin-side tests for the Git plugin's pure porcelain/log parsers.
// Run: npx tsx plugins/git/plugin.test.cjs

// Immediate jobs keep existing fixtures synchronous; deferred fixtures model VM yields.
let currentHost;
Object.defineProperty(globalThis, "host", {
  configurable: true,
  get: () => currentHost,
  set: (mock) => {
    let sequence = 0;
    const jobs = new Map();
    currentHost = {
      log: () => {},
      execClose: () => {},
      execStart: (raw) => {
        const jobId = String(++sequence);
        jobs.set(jobId, JSON.parse(mock.exec(raw)));
        return JSON.stringify({ jobId });
      },
      awaitJob: (jobId, then) => then(jobs.get(jobId)),
      ...mock,
    };
    currentHost = require("../scripts/host-io-fixture.cjs").attachHostIo(currentHost);
    currentHost.io.exec = function* (options) {
      const started = yield { op: "execStart", options };
      return yield { op: "awaitJob", job: started.jobId };
    };
  },
});
globalThis.host = {};

const plugin = require("./plugin.js").default;

const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

test("parsePorcelain counts staged / unstaged / untracked", () => {
  const out = "M  staged.txt\n M unstaged.txt\nMM both.txt\n?? new.txt\n";
  const d = plugin.__test_parsePorcelain(out);
  assert(d.total === 4, "total 4");
  assert(d.staged === 2, "staged (M_, MM) = 2, got " + d.staged);
  assert(d.unstaged === 2, "unstaged (_M, MM) = 2, got " + d.unstaged);
  assert(d.untracked === 1, "untracked 1");
});

test("parsePorcelain clean tree is empty", () => {
  const d = plugin.__test_parsePorcelain("");
  assert(d.total === 0 && d.staged === 0 && d.untracked === 0, "all zero");
});

test("parseLog trims and drops blanks", () => {
  const commits = plugin.__test_parseLog("abc123 first\n def456 second \n\n");
  assert(commits.length === 2, "two commits, got " + commits.length);
  assert(commits[1] === "def456 second", "trimmed");
});

test("parseGraph splits \\x1e records / \\x1f fields", () => {
  const rec = (sha, parents, refs, subj) =>
    "\x1f" + sha + "\x1f" + parents + "\x1f" + "Ann" + "\x1f" + "2026-01-01" + "\x1f" + refs + "\x1f" + subj + "\x1e";
  const out = "\n" + rec("aaa", "bbb ccc", "HEAD -> refs/heads/main, tag: refs/tags/v1", "feat: x") + rec("bbb", "", "refs/remotes/origin/main", "init");
  const c = plugin.__test_parseGraph(out);
  assert(c.length === 2, "two commits, got " + c.length);
  assert(c[0].sha === "aaa", "sha aaa");
  assert(c[0].parents.length === 2 && c[0].parents[0] === "bbb", "two parents");
  assert(c[0].refs.some((r) => r.kind === "head" && r.name === "HEAD"), "head marker");
  assert(c[0].refs.some((r) => r.kind === "branch" && r.name === "main"), "local branch main");
  assert(c[0].refs.some((r) => r.kind === "tag" && r.name === "v1"), "tag v1");
  assert(c[1].refs[0].kind === "remote" && c[1].refs[0].name === "origin/main", "remote ref");
  assert(c[1].parents.length === 0, "root has no parents");
});

test("branch lookup uses symbolic-ref so a same-name tag cannot leak heads/", () => {
  const calls = [];
  globalThis.host = {
    unixNowMs: () => 10000,
    exec: (raw) => {
      const opts = JSON.parse(raw);
      calls.push(opts.args.slice(2));
      const args = opts.args.slice(2);
      if (args[0] === "symbolic-ref") return JSON.stringify({ code: 0, stdout: "release-1.7.8\n", stderr: "" });
      if (args[0] === "status") return JSON.stringify({ code: 0, stdout: "", stderr: "" });
      throw new Error(`unexpected git call: ${args.join(" ")}`);
    },
  };
  const bubble = plugin.statusBubble({ cwd: "C:/same-name-tag" });
  assert(bubble.label === "release-1.7.8", `plain branch label, got ${bubble.label}`);
  assert(calls.some((args) => args.join(" ") === "symbolic-ref --quiet --short HEAD"), "symbolic-ref branch lookup");
});

test("splitRename handles plain and brace forms", () => {
  assert(plugin.__test_splitRename("a.txt").old_path === null, "no rename");
  const plain = plugin.__test_splitRename("old.txt => new.txt");
  assert(plain.path === "new.txt" && plain.old_path === "old.txt", "plain rename");
  const brace = plugin.__test_splitRename("src/{a => b}/f.txt");
  assert(brace.path === "src/b/f.txt" && brace.old_path === "src/a/f.txt", "brace rename, got " + JSON.stringify(brace));
});

test("parseNumstat marks rename / binary / modified", () => {
  const out = "3\t1\tsrc/a.ts\n-\t-\timg.png\n2\t0\told.txt => new.txt\n";
  const f = plugin.__test_parseNumstat(out);
  assert(f.length === 3, "three files");
  assert(f[0].status === "modified" && f[0].added === 3 && f[0].deleted === 1, "modified");
  assert(f[1].status === "binary" && f[1].added === null && f[1].deleted === null, "binary");
  assert(f[2].status === "renamed" && f[2].old_path === "old.txt", "renamed");
});

test("parseStatusPorcelain reads -z entries + rename old path", () => {
  const out = "M  staged.txt\0 M dirty.txt\0?? new.txt\0R  new-name.txt\0old-name.txt\0";
  const e = plugin.__test_parseStatusPorcelain(out);
  assert(e.length === 4, "four entries, got " + e.length);
  assert(e[0].status === "staged" && e[0].staged === true, "staged");
  assert(e[1].status === "modified" && e[1].staged === false, "unstaged modified");
  assert(e[2].status === "untracked", "untracked");
  assert(e[3].status === "renamed" && e[3].path === "new-name.txt" && e[3].old_path === "old-name.txt", "rename pair, got " + JSON.stringify(e[3]));
});

test("mergeWorkdirFiles joins numstat counts, untracked has no counts", () => {
  const entries = [
    { path: "a.ts", old_path: null, status: "modified", staged: false },
    { path: "new.txt", old_path: null, status: "untracked", staged: false },
  ];
  const merged = plugin.__test_mergeWorkdirFiles(entries, { "a.ts": [5, 2] });
  assert(merged[0].added === 5 && merged[0].deleted === 2, "joined counts");
  assert(merged[1].added === null && merged[1].deleted === null, "untracked null counts");
});

// ── path-authority (mutating-op path validation) ──

test("pathWithinRepo accepts repo-relative paths, rejects escapes", () => {
  const within = plugin.__test_pathWithinRepo;
  assert(within("src/plugin.ts") === true, "relative path ok");
  assert(within("a/b/../c.txt") === true, "internal .. that stays inside is ok");
  assert(within("") === false, "empty rejected");
  assert(within("../secret") === false, "parent escape rejected");
  assert(within("a/../../x") === false, "deep parent escape rejected");
  assert(within("/etc/passwd") === false, "absolute POSIX rejected");
  assert(within("C:\\Windows\\x") === false, "absolute Windows drive rejected");
  assert(within("\\\\server\\share") === false, "UNC / backslash-root rejected");
});

// ── manifest (Track S) ──

test("plugin.json does not advertise AI configuration without settings", () => {
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const manifest = JSON.parse(readFileSync(join(__dirname, "plugin.json"), "utf8"));
  assert(manifest.settingsSchema == null, "Git should remain zero-configuration");
  assert(manifest.configHelp == null, "Git should not expose Configure with AI");
});

test("subprocess allow-list is the git binary alone — discovery uses the host binding", () => {
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const manifest = JSON.parse(readFileSync(join(__dirname, "plugin.json"), "utf8"));
  const allow = manifest.permissions.subprocess.allow;
  assert(allow.length === 1 && allow[0] === "git", "only git allowed, got " + JSON.stringify(allow));
  const bundle = readFileSync(join(__dirname, "plugin.js"), "utf8");
  assert(!/bin:\s*"cmd"/.test(bundle) && !/bin:\s*"ls"/.test(bundle), "bundle spawns neither cmd nor ls");
});

// ── multi-repo discovery (host.listChildDirs binding) ──
//
// Contract coded against: host.listChildDirs(path) -> string[] | null, where
// null means denied/unreadable and [] a readable directory with no children.

// A mocked host whose only subprocess is git; any other bin fails the test.
// Each test uses its own parent path: the bubble cache is keyed by cwd.
function multiRepoHost(parent, listChildDirs) {
  return {
    unixNowMs: () => 10000,
    platform: () => "windows",
    listChildDirs,
    fileExists: (path) => /repo-[ab]\/\.git$/.test(path.replace(/\\/g, "/")),
    exec: (raw) => {
      const opts = JSON.parse(raw);
      if (opts.bin !== "git") throw new Error(`plugin spawned a non-git binary: ${opts.bin}`);
      const cwd = opts.args[1];
      const args = opts.args.slice(2);
      if (args[0] === "symbolic-ref") {
        if (cwd === parent) return JSON.stringify({ code: 1, stdout: "", stderr: "not a repository" });
        const branch = cwd.endsWith("repo-b") ? "feature/b" : "main";
        return JSON.stringify({ code: 0, stdout: `${branch}\n`, stderr: "" });
      }
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return JSON.stringify({ code: 1, stdout: "", stderr: "not a repository" });
      }
      if (args[0] === "status") return JSON.stringify({ code: 0, stdout: "", stderr: "" });
      throw new Error(`unexpected git call: ${cwd} ${args.join(" ")}`);
    },
  };
}

test("gitRepos discovers sibling repositories through host.listChildDirs", () => {
  const parent = "C:/ws-discovery";
  const listed = [];
  globalThis.host = multiRepoHost(parent, (path) => {
    listed.push(path);
    return ["repo-a", "repo-b", "not-a-repo"];
  });
  const repos = plugin.viewCall("gitRepos", { cwd: parent });
  assert(listed.length > 0 && listed[0] === parent, "listChildDirs called with the pane cwd");
  assert(repos.length === 2, `both repos discovered, got ${JSON.stringify(repos)}`);
  assert(repos[0].path === `${parent}/repo-a` && repos[0].branch === "main", "repo-a on main");
  assert(repos[1].path === `${parent}/repo-b` && repos[1].branch === "feature/b", "repo-b on feature/b");
});

test("denied listChildDirs (null) yields no repos without throwing", () => {
  const parent = "C:/ws-denied";
  globalThis.host = multiRepoHost(parent, () => null);
  const repos = plugin.viewCall("gitRepos", { cwd: parent });
  assert(Array.isArray(repos) && repos.length === 0, "denied listing degrades to [], got " + JSON.stringify(repos));
});

test("absent listChildDirs binding (older daemon) yields no repos without throwing", () => {
  const parent = "C:/ws-absent";
  const mock = multiRepoHost(parent, undefined);
  delete mock.listChildDirs;
  globalThis.host = mock;
  const repos = plugin.viewCall("gitRepos", { cwd: parent });
  assert(Array.isArray(repos) && repos.length === 0, "missing binding degrades to [], got " + JSON.stringify(repos));
  const bubble = plugin.statusBubble({ cwd: parent });
  assert(bubble === null || typeof bubble === "object", "bubble survives a host without the binding");
});

test("a throwing listChildDirs binding yields no repos without throwing", () => {
  const parent = "C:/ws-throws";
  globalThis.host = multiRepoHost(parent, () => { throw new Error("host denied"); });
  const repos = plugin.viewCall("gitRepos", { cwd: parent });
  assert(Array.isArray(repos) && repos.length === 0, "throwing binding degrades to [], got " + JSON.stringify(repos));
});

test("multi-repo bubble summarizes and follows the selected repository", () => {
  const parent = "C:/workspace";
  globalThis.host = {
    unixNowMs: () => 10000,
    platform: () => "windows",
    listChildDirs: () => ["repo-a", "repo-b"],
    fileExists: (path) => /repo-[ab]\/\.git$/.test(path.replace(/\\/g, "/")),
    exec: (raw) => {
      const opts = JSON.parse(raw);
      if (opts.bin !== "git") throw new Error(`plugin spawned a non-git binary: ${opts.bin}`);
      const cwd = opts.args[1];
      const args = opts.args.slice(2);
      if (args[0] === "symbolic-ref") {
        if (cwd === parent) return JSON.stringify({ code: 1, stdout: "", stderr: "not a repository" });
        const branch = cwd.endsWith("repo-b") ? "feature/b" : "main";
        return JSON.stringify({ code: 0, stdout: `${branch}\n`, stderr: "" });
      }
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return JSON.stringify({ code: 1, stdout: "", stderr: "not a repository" });
      }
      if (args[0] === "status") return JSON.stringify({ code: 0, stdout: "", stderr: "" });
      throw new Error(`unexpected git call: ${cwd} ${args.join(" ")}`);
    },
  };
  const first = plugin.statusBubble({ cwd: parent });
  assert(first.label === "main +1", `first repo plus count, got ${first.label}`);
  const selected = plugin.viewCall("gitSelectRepo", { cwd: parent, path: `${parent}/repo-b` });
  assert(selected.selected === true, "selection accepted");
  const second = plugin.statusBubble({ cwd: parent });
  assert(second.label === "feature/b +1", `selected repo branch, got ${second.label}`);
});

test("parseWorktrees preserves paths, branches, and exceptional states", () => {
  const parsed = plugin.__test_parseWorktrees([
    "worktree D:/Developer/repo",
    "HEAD 1111111",
    "branch refs/heads/main",
    "",
    "worktree D:/Developer/repo-review",
    "HEAD 2222222",
    "detached",
    "locked review in progress",
    "",
    "worktree D:/Developer/repo-old",
    "HEAD 3333333",
    "branch refs/heads/old",
    "prunable gitdir file points to non-existent location",
    "",
  ].join("\n"));
  assert(parsed.length === 3, `three worktrees, got ${parsed.length}`);
  assert(parsed[0].branch === "main" && parsed[0].detached === false, "normal branch parsed");
  assert(parsed[1].detached === true && parsed[1].locked === "review in progress", "detached lock parsed");
  assert(parsed[2].prunable.includes("non-existent"), "prunable reason retained");
});

test("concurrent bubble calls retain the last result without sharing invocation-owned jobs", () => {
  let now = 20000;
  let starts = 0;
  const logs = [];
  const jobs = new Map();
  globalThis.host = {
    unixNowMs: () => now,
    exec: () => { throw new Error("bubble used synchronous exec"); },
    log: (level, message) => logs.push([level, message]),
    execStart: (raw) => {
      const id = String(++starts);
      const args = JSON.parse(raw).args.slice(2);
      jobs.set(id, { code: 0, stdout: args[0] === "symbolic-ref" ? "main\n" : " M file\n" });
      return JSON.stringify({ jobId: id });
    },
    awaitJob: (id, then) => ({ id, then }),
  };
  const ctx = { cwd: "C:/coalesced-secret" };
  const a = plugin.statusBubble(ctx);
  const b = plugin.statusBubble(ctx);
  assert(starts === 1 && b === null, "a concurrent invocation returns the last cached result");
  const aStatus = a.then(jobs.get(a.id));
  assert(starts === 2, "the original invocation starts one status job");
  const first = aStatus.then(jobs.get(aStatus.id));
  assert(plugin.statusBubble(ctx) === first && starts === 2, "cached within TTL");
  now += 4000;
  const expired = plugin.statusBubble(ctx);
  assert(starts === 3, "expiry starts a new computation");
  assert(plugin.statusBubble(ctx) === first, "a concurrent refresh retains the prior value");
  const status = expired.then(jobs.get(expired.id));
  status.then(jobs.get(status.id));
  assert(starts === 4, "expiry recomputes both commands");
});

test("bubble output is byte-identical to the previous synchronous implementation", () => {
  // Frozen direct-repository behavior from 0.1.6, independent of Git history.
  function oldBubble(ctx, mock) {
    const branchResult = JSON.parse(mock.exec(JSON.stringify({ bin: "git", args: ["-C", ctx.cwd, "symbolic-ref", "--quiet", "--short", "HEAD"] })));
    const branch = branchResult.error || branchResult.code !== 0 ? null : (branchResult.stdout || "").trim() || null;
    if (!branch) return null;
    const status = JSON.parse(mock.exec(JSON.stringify({ bin: "git", args: ["-C", ctx.cwd, "status", "--porcelain"] })));
    const total = (status.stdout || "").split("\n").filter(line => line.length > 0).length;
    return {
      label: branch,
      tone: "default",
      icon: "git",
      tooltip: total ? `${total} changed — open Git` : "clean — open Git",
      action: "openPanel:view:git",
    };
  }
  for (const [index, branch, porcelain] of [[0, "main", ""], [1, "feature/é", "M  staged\n?? new\n"], [2, null, ""]]) {
    const mock = {
      unixNowMs: () => 30000,
      listChildDirs: () => [],
      exec: (raw) => {
        const command = JSON.parse(raw).args[2];
        return JSON.stringify(command === "symbolic-ref"
          ? { code: branch ? 0 : 1, stdout: branch ? ` ${branch}\n` : "" }
          : command === "status" ? { code: 0, stdout: porcelain } : { code: 1 });
      },
    };
    globalThis.host = mock;
    const ctx = { cwd: `C:/parity-${index}` };
    assert(JSON.stringify(plugin.statusBubble(ctx)) === JSON.stringify(oldBubble(ctx, mock)), `identical output fixture ${index}`);
  }
});

// ── bounded large diffs (uncommitted, untracked, commit, JSONL) ──

test("boundDiff leaves ordinary small diffs untouched", () => {
  const raw = [
    "diff --git a/a.ts b/a.ts",
    "index 1111111..2222222 100644",
    "--- a/a.ts",
    "+++ b/a.ts",
    "@@ -1,2 +1,2 @@",
    " const a = 1;",
    "-const b = 2;",
    "+const b = 3;",
  ].join("\n") + "\n";
  const res = plugin.__test_boundDiff(raw, { hostTruncated: false });
  assert(res.diff === raw, "ordinary diff returned verbatim");
  assert(!res.truncated && !res.longLinesTruncated, "no truncation flags on small diff");
});

test("boundDiff clips long single JSONL lines without marking host-truncated", () => {
  const bigLine = `{"event":"click","payload":"${"x".repeat(2000)}"}`;
  const raw = [
    "diff --git a/events.jsonl b/events.jsonl",
    "index 1111111..2222222 100644",
    "--- a/events.jsonl",
    "+++ b/events.jsonl",
    "@@ -1,1 +1,2 @@",
    " {\"event\":\"init\"}",
    `+${bigLine}`,
  ].join("\n") + "\n";
  const res = plugin.__test_boundDiff(raw, { hostTruncated: false });
  assert(!res.truncated, "not byte/line truncated");
  assert(res.longLinesTruncated === true, "longLinesTruncated flagged");
  const added = res.diff.split("\n").find((l) => l.startsWith("+{\"event\""));
  assert(added && added.endsWith("…"), "long line ends with ellipsis");
  assert(added.length === 1 + 500 + 1, `expected capped width 502, got ${added.length}`);
});

test("boundDiff shapes host-truncated diff, rewrites hunk counts, drops dangling markers", () => {
  const header = [
    "diff --git a/big.txt b/big.txt",
    "index 1111111..2222222 100644",
    "--- a/big.txt",
    "+++ b/big.txt",
    "@@ -1,1 +1,500 @@",
    " first",
  ];
  const body = [];
  for (let i = 0; i < 400; i++) body.push(`+line ${i}`);
  // Simulate a dangling hunk header & partial no-newline marker after a 128 KiB cut
  const raw = header.concat(body, ["@@ -900,5 +1400,5 @@", "\\ No new"]).join("\n");
  const res = plugin.__test_boundDiff(raw, {
    hostTruncated: true,
    totalBytes: 512000,
    added: 500,
    deleted: 0,
    maxPreviewLines: 50,
  });
  assert(res.truncated === true, "marked truncated");
  assert(res.totalBytes === 512000, "preserves actual totalBytes");
  assert(res.shownLines === 50, `expected 50 shown lines, got ${res.shownLines}`);
  assert(res.added === 500 && res.deleted === 0, "preserves numstat");
  assert(res.diff.includes("@@ -1,1 +1,50 @@"), `rewrote hunk header counts, got:\n${res.diff.slice(0, 220)}`);
  assert(!res.diff.includes("@@ -900"), "dropped excess hunk");
  assert(!res.diff.includes("\\ No new"), "dropped partial no-newline marker");
});

test("boundDiff keeps a single huge JSONL line cut mid-line and strips trailing U+FFFD", () => {
  const partialLine = `+{"big":"${"a".repeat(800)}\uFFFD`;
  const raw = [
    "diff --git a/amplitude.jsonl b/amplitude.jsonl",
    "new file mode 100644",
    "index 0000000..1111111",
    "--- /dev/null",
    "+++ b/amplitude.jsonl",
    "@@ -0,0 +1,1 @@",
    partialLine,
  ].join("\n"); // no trailing newline: cut mid-line
  const res = plugin.__test_boundDiff(raw, {
    hostTruncated: true,
    totalBytes: 600000,
    added: 1,
    deleted: 0,
  });
  assert(res.truncated === true, "marked truncated");
  assert(res.shownLines === 1, `kept single cut line, got ${res.shownLines}`);
  assert(res.longLinesTruncated === true, "long line clipped");
  assert(!res.diff.includes("\uFFFD"), "stripped lossy replacement char");
  assert(res.diff.includes("@@ -0,0 +1,1 @@\n+{\"big\":\""), "valid hunk with kept line");
  assert(res.diff.trimEnd().endsWith("…"), "cut line ends with ellipsis");
});

test("boundDiff handles mid-line cut shorter than maxLineChars and header-only truncation", () => {
  const shortCut = [
    "diff --git a/x.jsonl b/x.jsonl",
    "--- a/x.jsonl",
    "+++ b/x.jsonl",
    "@@ -1,0 +1,2 @@",
    "+{\"a\":1}",
    "+{\"b\":",
  ].join("\n");
  const res = plugin.__test_boundDiff(shortCut, { hostTruncated: true, totalBytes: 200000 });
  assert(res.shownLines === 2, `kept both lines, got ${res.shownLines}`);
  assert(res.diff.includes("+{\"b\":…\n"), "mid-line cut gets ellipsis");

  const headerCut = "diff --git a/x.txt b/x.txt\nindex 111..222\n--- a/x.txt";
  const empty = plugin.__test_boundDiff(headerCut, { hostTruncated: true, totalBytes: 200000, added: 10, deleted: 0 });
  assert(empty.truncated === true && empty.diff === "" && empty.shownLines === 0, "header-only cut degrades cleanly");
});

test("gitWorkdirDiff handles oversized tracked diff without returning output_too_large error", () => {
  const bigChunk = [
    "diff --git a/amplitude.jsonl b/amplitude.jsonl",
    "index 1111111..2222222 100644",
    "--- a/amplitude.jsonl",
    "+++ b/amplitude.jsonl",
    "@@ -1,1 +1,65 @@",
    " {\"row\":0}",
    `+{"row":1,"data":"${"z".repeat(1200)}"}`,
    `+{"row":2,"data":"${"y".repeat(1200)}"}`,
  ].join("\n");
  globalThis.host = {
    exec: (raw) => {
      const args = JSON.parse(raw).args.slice(2);
      if (args[0] === "diff" && args.includes("--numstat")) {
        return JSON.stringify({ code: 0, stdout: "64\t0\tamplitude.jsonl\n", stderr: "" });
      }
      if (args[0] === "diff" && args.includes("HEAD")) {
        return JSON.stringify({
          code: 0,
          stdout: bigChunk,
          stderr: "",
          truncated: true,
          outputTooLarge: { stream: "stdout", limitBytes: 131072, actualBytes: 451059 },
          error: "output_too_large: stdout produced 451059 bytes; limit is 131072 bytes; project or page subprocess output before returning it",
        });
      }
      throw new Error(`unexpected git call: ${args.join(" ")}`);
    },
  };
  const out = plugin.viewCall("gitWorkdirDiff", { cwd: "C:/repo", path: "amplitude.jsonl" });
  assert(!out.error, `expected preview, got error: ${out.error}`);
  assert(out.truncated === true, "marked truncated");
  assert(out.totalBytes === 451059, "exact actualBytes preserved");
  assert(out.added === 64 && out.deleted === 0, "numstat counts attached");
  assert(out.shownLines === 3, `expected 3 shown lines, got ${out.shownLines}`);
  assert(out.longLinesTruncated === true, "JSONL lines width-capped");
  assert(out.diff.includes("@@ -1,1 +1,3 @@"), "valid rewritten hunk header");
});

test("gitWorkdirDiff handles untracked small and oversized files and skips untracked dirs", () => {
  const calls = [];
  globalThis.host = {
    exec: (raw) => {
      const args = JSON.parse(raw).args.slice(2);
      calls.push(args);
      if (args[0] === "diff" && args.includes("HEAD")) {
        return JSON.stringify({ code: 0, stdout: "", stderr: "" });
      }
      if (args[0] === "-c" && args[2] === "status") {
        const target = args[args.length - 1];
        return JSON.stringify({ code: 0, stdout: `?? ${target}\0`, stderr: "" });
      }
      if (args[0] === "diff" && args.includes("--no-index") && args.includes("--numstat")) {
        return JSON.stringify({ code: 1, stdout: "120\t0\t/dev/null => huge.jsonl\n", stderr: "" });
      }
      if (args[0] === "diff" && args.includes("--no-index")) {
        const target = args[args.length - 1];
        if (target === "small.txt") {
          return JSON.stringify({
            code: 1,
            stdout: "diff --git a/small.txt b/small.txt\nnew file mode 100644\n--- /dev/null\n+++ b/small.txt\n@@ -0,0 +1,2 @@\n+hi\n+there\n",
            stderr: "",
          });
        }
        return JSON.stringify({
          code: 1,
          stdout: `diff --git a/huge.jsonl b/huge.jsonl\nnew file mode 100644\n--- /dev/null\n+++ b/huge.jsonl\n@@ -0,0 +1,120 @@\n+{"k":"${"v".repeat(900)}"}`,
          stderr: "",
          truncated: true,
          outputTooLarge: { stream: "stdout", limitBytes: 131072, actualBytes: 580000 },
          error: "output_too_large: stdout produced 580000 bytes; limit is 131072 bytes",
        });
      }
      throw new Error(`unexpected git call: ${args.join(" ")}`);
    },
  };

  const small = plugin.viewCall("gitWorkdirDiff", { cwd: "C:/repo", path: "small.txt" });
  assert(!small.error && !small.truncated && small.diff.includes("+hi\n+there\n"), "small untracked file diff rendered");

  const huge = plugin.viewCall("gitWorkdirDiff", { cwd: "C:/repo", path: "huge.jsonl" });
  assert(!huge.error && huge.truncated === true && huge.totalBytes === 580000, "large untracked file truncated cleanly");
  assert(huge.added === 120 && huge.deleted === 0 && huge.shownLines === 1, "large untracked file has numstat and preview line");

  const dirCountBefore = calls.length;
  const dir = plugin.viewCall("gitWorkdirDiff", { cwd: "C:/repo", path: "plans/sub/" });
  assert(!dir.error && dir.diff === "", "untracked directory returns empty diff");
  assert(!calls.slice(dirCountBefore).some((a) => a.includes("--no-index")), "untracked directory skips --no-index");

  const escapeCountBefore = calls.length;
  const escaped = plugin.viewCall("gitWorkdirDiff", { cwd: "C:/repo", path: "../secret.txt" });
  assert(!escaped.error && escaped.diff === "", "escaping path returns empty diff");
  assert(!calls.slice(escapeCountBefore).some((a) => a.includes("--no-index")), "escaping path refuses --no-index");
});

test("gitCommitDiff handles oversized normal and merge commit diffs with numstat", () => {
  for (const [label, parents, expectMerge] of [["normal", "aaa bbb\n", false], ["merge", "aaa bbb ccc\n", true]]) {
    globalThis.host = {
      exec: (raw) => {
        const args = JSON.parse(raw).args.slice(2);
        if (args[0] === "rev-list") return JSON.stringify({ code: 0, stdout: parents, stderr: "" });
        if (args.includes("--numstat")) {
          assert((args[0] === "diff") === expectMerge, `${label}: numstat command matches merge flag`);
          return JSON.stringify({ code: 0, stdout: "80\t12\tdata.jsonl\n", stderr: "" });
        }
        return JSON.stringify({
          code: 0,
          stdout: `diff --git a/data.jsonl b/data.jsonl\n--- a/data.jsonl\n+++ b/data.jsonl\n@@ -1,1 +1,80 @@\n+{"commit":"${"c".repeat(700)}"}\n`,
          stderr: "",
          truncated: true,
          outputTooLarge: { stream: "stdout", limitBytes: 131072, actualBytes: 520000 },
          error: "output_too_large: stdout produced 520000 bytes; limit is 131072 bytes",
        });
      },
    };
    const out = plugin.viewCall("gitCommitDiff", { cwd: "C:/repo", sha: "aaa", path: "data.jsonl" });
    assert(!out.error, `${label}: no output_too_large error, got ${out.error}`);
    assert(out.truncated === true && out.totalBytes === 520000, `${label}: truncated with actualBytes`);
    assert(out.added === 80 && out.deleted === 12 && out.shownLines === 1, `${label}: numstat and shownLines`);
    assert(out.longLinesTruncated === true, `${label}: long line clipped`);
  }
});

test("gitWorkdirDiff preserves real non-oversized errors", () => {
  globalThis.host = {
    exec: () => JSON.stringify({ error: "spawn git: ENOENT" }),
  };
  const out = plugin.viewCall("gitWorkdirDiff", { cwd: "C:/repo", path: "a.ts" });
  assert(out.error === "spawn git: ENOENT", `expected real error, got ${JSON.stringify(out)}`);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`✓ ${name}`); }
  catch (err) { failed += 1; console.error(`✗ ${name}`); console.error(err); }
}
console.log(`git plugin: ${tests.length - failed}/${tests.length} passed`);
if (failed > 0) process.exit(1);
