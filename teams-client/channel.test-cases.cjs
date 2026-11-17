const assert = require("node:assert/strict");
module.exports = function registerChannelCases({ test, mockHost, plugin, command, result, PAD_BODY, parse, C, WHOAMI_OK, ALEX_CHAT, normalize }) {
  const TEAM_A = "19:team_a@thread.tacv2";
  const TEAM_B = "19:team_b@thread.tacv2";
  const CHANNEL_A = "19:channel_a@thread.tacv2";
  const CHANNEL_B = "19:channel_b@thread.tacv2";
  const RAW_TEAMS = [
    {
      id: TEAM_A, displayName: "Engineering", tenantId: "tenant-1", channels: [
        { id: CHANNEL_A, displayName: "General", parentTeamId: TEAM_A, tenantId: "tenant-1", isMember: true },
      ]
    },
    {
      id: TEAM_B, displayName: "Operations", tenantId: "tenant-1", channels: [
        { id: CHANNEL_B, displayName: "General", parentTeamId: TEAM_B, tenantId: "tenant-1", isMember: true },
      ]
    },
  ];
  function channelFixture(options = {}) {
    const env = mockHost({ teams: structuredClone(RAW_TEAMS), ...options });
    env.install(); env.signIn();
    return env;
  }
  function channelSend(key = "channel-key", body = PAD_BODY, team = TEAM_A, channel = CHANNEL_A) {
    return plugin.onAgentCommand({ sessionId: "pad", verb: "send", args: [channel, "--team", team, "--key", key], body });
  }
  function posts(env) { return env.exoCalls().filter(call => call.args[0] === "send"); }

  test("teams and channel discovery disambiguates identical names by exact team", () => {
    channelFixture();
    assert.equal(result(command("teams")).teams.length, 2);
    const a = result(command("channels", [TEAM_A, "General"])).channels[0];
    const b = result(command("channels", [TEAM_B, "General"])).channels[0];
    assert.equal(a.title, b.title);
    assert.equal(a.team, "Engineering"); assert.equal(b.team, "Operations");
    assert.equal(a.id, CHANNEL_A); assert.equal(b.id, CHANNEL_B);
    assert.equal(a.teamId, TEAM_A); assert.equal(a.writable, true);
    assert.match(command("channels", ["Engineering"]).error, /team-not-found/);
  });

  test("unreadable teams, channels and permission errors refuse without any post", () => {
    for (const stdout of ["{", "null", "{}", '[{"id":"x"}]', JSON.stringify([{ ...RAW_TEAMS[0], channels: null }])]) {
      const env = channelFixture({ teamResult: { code: 0, stdout, stderr: "" } });
      assert.match(command("teams").error, /unreadable/);
      assert.match(channelSend().error, /unreadable/);
      assert.equal(posts(env).length, 0);
    }
    const env = channelFixture({ teamResult: { code: 1, stdout: "", stderr: "GET teams/users/me returned status 403" } });
    assert.match(command("teams").error, /tenant policy.*403/);
    assert.match(channelSend().error, /403/);
    assert.equal(posts(env).length, 0);
  });

  test("tenant mismatch, missing membership and locked channels are explicit", () => {
    for (const [change, refusal] of [
      [{ tenantId: "other-tenant" }, /tenant-refused/],
      [{ parentTeamId: TEAM_B }, /tenant-refused/],
      [{ isMember: false }, /permission-refused/],
      [{ isReadOnly: true }, /permission-refused/],
      [{ isArchived: true }, /permission-refused/],
    ]) {
      const env = channelFixture(); Object.assign(env.state.teams[0].channels[0], change);
      const listed = result(command("channels", [TEAM_A])).channels[0];
      assert.equal(listed.writable, false); assert.match(listed.refusal, refusal);
      assert.match(channelSend().error, refusal); assert.equal(posts(env).length, 0);
    }
  });

  test("unreadable chat lists refuse cleanly through the retained chat path", () => {
    const env = channelFixture();
    for (const value of [null, {}, "unreadable"]) {
      env.state.chats = value;
      assert.match(command("chats", ["--refresh"]).error, /unreadable chat list/);
    }
    assert.equal(posts(env).length, 0);
  });

  test("duplicate ids and malformed list entries fail closed", () => {
    const { parseTeams } = require("./src/channels.ts");
    assert.ok(parseTeams([...RAW_TEAMS, RAW_TEAMS[0]]).error);
    assert.ok(parseTeams([{ ...RAW_TEAMS[0], channels: [RAW_TEAMS[0].channels[0], RAW_TEAMS[0].channels[0]] }]).error);
    assert.ok(parseTeams([{ ...RAW_TEAMS[0], tenantId: "" }]).error);
    assert.ok(parseTeams([{ ...RAW_TEAMS[0], channels: [{ ...RAW_TEAMS[0].channels[0], id: "General" }] }]).error);
  });

  test("channel send uses AgentPad body and the existing ledger, same key invokes upstream once", () => {
    const env = channelFixture();
    const sent = result(channelSend());
    assert.equal(sent.status, "sent"); assert.equal(sent.destination.id, CHANNEL_A);
    assert.equal(sent.destination.teamId, TEAM_A); assert.equal(sent.destination.tenantId, "tenant-1");
    assert.equal(sent.destination.label, "Engineering / General");
    assert.equal(result(channelSend()).idempotencyKey, sent.idempotencyKey);
    assert.equal(posts(env).length, 1);
    assert.deepEqual(posts(env)[0].args, ["send", CHANNEL_A, parse.htmlMessage(PAD_BODY), "--json"]);
    const ledger = JSON.parse(env.files.get(normalize(plugin.__test_paths().outbox)));
    assert.equal(ledger.schema, 2); assert.equal(ledger.attempts.length, 1);
    assert.equal(ledger.attempts[0].state, "sent");
    assert.doesNotMatch(JSON.stringify(ledger), /trailing whitespace|multiline authored text/);
    assert.match(channelSend("channel-key", "changed").error, /different chat, text or file/);
    assert.match(channelSend("channel-key", PAD_BODY, TEAM_B, CHANNEL_B).error, /different chat, text or file/);
    assert.equal(posts(env).length, 1);
  });

  test("uncertain and interrupted channel attempts never invoke upstream again, including after plugin reload", () => {
    for (const sendResult of [
      { code: 1, stdout: "", stderr: "sending message: POST returned status 503" },
      { code: 1, stdout: "", stderr: "sending message: context deadline exceeded" },
      { code: 0, stdout: "{}", stderr: "" },
    ]) {
      const env = channelFixture({ sendResult });
      assert.match(channelSend().error, /unknown:/);
      plugin.__test_reset();
      assert.match(channelSend().error, /unknown:/); assert.equal(posts(env).length, 1);
      const p = normalize(plugin.__test_paths().outbox);
      const ledger = JSON.parse(env.files.get(p)); ledger.attempts[0].state = "pending";
      env.files.set(p, JSON.stringify(ledger));
      assert.match(channelSend().error, /unknown:/); assert.equal(posts(env).length, 1);
    }
  });

  test("definite channel permission rejection stays typed and sent keys remain account-bound", () => {
    const env = channelFixture({ sendResult: { code: 1, stdout: "", stderr: "sending message: POST returned status 403" } });
    assert.match(channelSend().error, /upstream-rejected/);
    const sentEnv = channelFixture(); result(channelSend());
    sentEnv.state.whoami = WHOAMI_OK.replaceAll("andrey.kovalev@quantumsoft.pro", "other@example.com");
    assert.match(channelSend().error, /another account/);
    assert.equal(posts(sentEnv).length, 1);
    assert.equal(posts(env).length, 1);
  });

  test("channel sends require an exact pair, a key and the existing owner send scope", () => {
    const env = channelFixture();
    assert.match(command("send", [CHANNEL_A, "body"]).error, /require --team/);
    assert.match(channelSend("key", "body", TEAM_B, CHANNEL_A).error, /channel-not-found/);
    assert.match(plugin.onAgentCommand({ sessionId: "pad", verb: "send", args: [CHANNEL_A, "--team", TEAM_A], body: PAD_BODY }).error, /require --key/);
    const p = plugin.__test_paths();
    env.files.set(normalize(p.scope), JSON.stringify({ mode: "only", chats: [{ id: ALEX_CHAT, title: "Alex" }] }));
    assert.match(channelSend().error, /chat-not-allowed/);
    assert.equal(posts(env).length, 0);
  });

  test("mention options refuse explicitly while literal @names and markup stay escaped plain text", () => {
    const env = channelFixture();
    for (const option of ["--mention", "--mentions", "--mentions=user"]) {
      const response = plugin.onAgentCommand({ sessionId: "pad", verb: "send", args: [CHANNEL_A, "--team", TEAM_A, "--key", "mention", option, "user"], body: PAD_BODY });
      assert.match(response.error, /unsupported-mentions/);
    }
    assert.equal(posts(env).length, 0);
    result(channelSend("literal", '@User <at id="0">User</at>'));
    assert.equal(posts(env)[0].args[2], '@User &lt;at id=&quot;0&quot;&gt;User&lt;/at&gt;');
  });

  test("channel history pages a stable local snapshot without upstream --all or overlapping messages", () => {
    const messages = Array.from({ length: 65 }, (_, i) => ({ id: String(i), messagetype: "Text", content: `body ${i}`, originalarrivaltime: new Date(1700000000000 + i * 1000).toISOString() }));
    const env = channelFixture({ messages });
    let page = result(command("channel-history", [TEAM_A, CHANNEL_A, "--limit", "20"]));
    const ids = page.messages.map(row => row.id);
    assert.ok(page.nextCursor); assert.ok(page.messages.every(row => row.untrusted));
    env.state.messages.push({ id: "new", messagetype: "Text", content: "arrived later" });
    while (page.nextCursor) {
      page = result(command("channel-history", [TEAM_A, CHANNEL_A, "--limit", "20", "--cursor", page.nextCursor]));
      ids.push(...page.messages.map(row => row.id));
    }
    assert.equal(ids.length, 65); assert.equal(new Set(ids).size, 65); assert.ok(!ids.includes("new"));
    const reads = env.exoCalls().filter(call => call.args[0] === "get-messages");
    assert.equal(reads.length, 1);
    assert.deepEqual(reads[0].args, ["get-messages", CHANNEL_A, "--json", "--count", "200"]);
  });

  test("history cursors refuse cross-channel, cross-account, expired and invalid use", () => {
    const env = channelFixture({ messages: Array.from({ length: 25 }, (_, i) => ({ id: String(i), messagetype: "Text", content: "x" })) });
    const page = result(command("channel-history", [TEAM_A, CHANNEL_A]));
    const cursor = page.nextCursor; assert.ok(cursor);
    assert.match(command("channel-history", [TEAM_B, CHANNEL_B, "--cursor", cursor]).error, /different account\/team\/channel/);
    env.state.whoami = WHOAMI_OK.replaceAll("andrey.kovalev@quantumsoft.pro", "other@example.com");
    assert.match(command("channel-history", [TEAM_A, CHANNEL_A, "--cursor", cursor]).error, /different account\/team\/channel/);
    env.state.whoami = WHOAMI_OK;
    plugin.__test_setClock(() => Date.now() + C.CHAT_CACHE_TTL_MS + 1);
    assert.match(command("channel-history", [TEAM_A, CHANNEL_A, "--cursor", cursor]).error, /expired/);
    plugin.__test_setClock(null);
    for (const options of [["--limit", "0"], ["--all", "true"], ["--cursor", "url"], ["--limit", "2", "--limit", "3"]]) {
      assert.match(command("channel-history", [TEAM_A, CHANNEL_A, ...options]).error, /invalid-request/);
    }
  });

  test("history bounds 200 rows and 32 KiB including Unicode and rejects unreadable reads", () => {
    const env = channelFixture({ messages: Array.from({ length: 240 }, (_, i) => ({ id: String(i), messagetype: "Text", content: "😀".repeat(20000) })) });
    const raw = command("channel-history", [TEAM_A, CHANNEL_A, "--limit", "50"]);
    assert.ok(Buffer.byteLength(raw.result, "utf8") <= C.MAX_BYTES);
    const page = result(raw); assert.equal(page.truncated, true); assert.ok(page.messages.length > 0);
    assert.ok(page.nextCursor);
    env.state.getChatError = "fetching messages: GET returned status 403";
    assert.match(command("channel-history", [TEAM_B, CHANNEL_B]).error, /upstream-rejected.*403/);
  });

  test("channel discovery is byte bounded and never reads credentials through the plugin", () => {
    const env = channelFixture();
    env.state.teams = Array.from({ length: 80 }, (_, i) => ({ ...RAW_TEAMS[0], id: `19:team_${i}@thread.tacv2`, displayName: "😀".repeat(100), channels: [] }));
    const response = command("teams");
    assert.ok(Buffer.byteLength(response.result, "utf8") <= C.MAX_BYTES);
    assert.equal(result(response).truncated, true);
    const read = env.exoCalls().find(call => call.args[0] === "list-teams");
    assert.ok(normalize(read.env.HOME).startsWith(normalize(plugin.__test_paths().root)));
  });

  test("channel history rejects upstream display-name id shadowing", () => {
    const env = channelFixture();
    env.state.teams[1].channels[0].displayName = CHANNEL_A;
    assert.match(command("channel-history", [TEAM_A, CHANNEL_A]).error, /shadows this immutable id/);
    assert.match(channelSend().error, /shadows this immutable id/);
    assert.equal(posts(env).length, 0);
    assert.equal(env.exoCalls().filter(call => call.args[0] === "get-messages").length, 0);
  });

  test("channel mixed inline body refuses before sending and sent ledger survives reload", () => {
    const env = channelFixture();
    assert.match(plugin.onAgentCommand({ sessionId: "pad", verb: "send", args: [CHANNEL_A, "--team", TEAM_A, "--key", "mixed", "inline"], body: PAD_BODY }).error, /cannot be combined/);
    assert.equal(posts(env).length, 0);
    result(channelSend()); plugin.__test_reset();
    assert.equal(result(channelSend()).status, "sent"); assert.equal(posts(env).length, 1);
  });

};
