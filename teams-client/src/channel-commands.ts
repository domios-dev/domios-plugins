import type { HostIoSteps } from "@codeterm/plugin-sdk";
import { CHAT_CACHE_TTL_MS, MAX_BYTES, MAX_COUNT, TIMEOUTS } from "./constants";
import { channelId, teamId, parseTeams, type Channel } from "./channels";
import { historyRows, microsoftMessage, parseJson } from "./parse";
import { boundedHistory, cutText, sha256Hex, utf8Bytes } from "./message-utils";
type Sender = { identityKey: string; tenantId: string };
type Result = { result: string } | { error: string };
type Run = { ok: boolean; stdout: string; stderr: string; error?: string };
type Ports = {
  now: () => number;
  paths: () => { root: string } | null;
  run: (args: string[], timeout: number) => HostIoSteps<Run>;
  read: (id: string, count: number) => HostIoSteps<{ messages: unknown[] } | { error: string }>;
  liveSender: () => HostIoSteps<{ sender: Sender } | { error: string }>;
};
export function createChannelCommands({ now, paths, run, read, liveSender }: Ports) {
  let previewSequence = 0;
  function* channelList(): HostIoSteps<ReturnType<typeof parseTeams>> {
    const p = paths();
    if (!p) return { error: "upstream-rejected: Teams storage is unavailable." };
    const response = yield* run(["list-teams", "--json"], TIMEOUTS.chats);
    if (!response.ok) return { error: `upstream-rejected: Could not list teams/channels. Check Teams membership and tenant policy. Microsoft said: "${microsoftMessage(`${response.error || ""} ${response.stderr} ${response.stdout}`).slice(0, 1000)}"` };
    return parseTeams(parseJson(response.stdout));
  }

  function* resolveChannel(sender: Sender, team: string, id: string, write = false): HostIoSteps<{ channel: Channel } | { error: string }> {
    const listed = yield* channelList();
    if ("error" in listed) return listed;
    const found = listed.teams.find(item => item.id === team)?.channels.find(ch => ch.id === id);
    if (!found) return { error: "channel-not-found: This exact team/channel pair is absent from the current account. Refresh teams and channels; never select by a shared display name." };
    // Upstream's history CLI tests display-name substring matches before later ids.
    if (listed.teams.some(item => item.channels.some(ch => ch.id !== id && `${item.title} ${ch.title}`.toLowerCase().includes(id.toLowerCase())))) return { error: "upstream-rejected: A channel display name shadows this immutable id in upstream history lookup. Rename that conflicting channel before reading or sending with confirmation; no guessed destination was read." };
    if (sender.tenantId && sender.tenantId !== found.tenantId) return { error: "tenant-refused: This channel is outside the signed-in tenant." };
    if (!found.readable || (write && !found.writable)) return { error: found.refusal || "permission-refused: The selected channel is unavailable." };
    return { channel: found };
  }

  function* agentTeams(args: string[], channels = false): HostIoSteps<{ result: string } | { error: string }> {
    if (channels && (!teamId(args[0]) || args.length > 2)) return { error: "Usage: channels <immutable-team-id> [channel-name]. Select a team with teams [name]." };
    const live = yield* liveSender();
    if ("error" in live) return live;
    const listed = yield* channelList();
    if ("error" in listed) return listed;
    const query = (channels ? args[1] || "" : args.join(" ")).toLowerCase();
    const team = channels ? listed.teams.find(item => item.id === args[0]) : undefined;
    if (channels && !team) return { error: "team-not-found: Select an exact team id from teams; names are not ids." };
    const matches = channels ? team!.channels.filter(ch => ch.title.toLowerCase().includes(query) || ch.id === query)
      : listed.teams.filter(item => item.title.toLowerCase().includes(query) || item.id.toLowerCase() === query)
        .map(({ channels: items, ...item }) => ({ ...item, channelCount: items.length }));
    const out = {
      [channels ? "channels" : "teams"]: matches.slice(0, MAX_COUNT), truncated: matches.length > MAX_COUNT,
      next: channels ? "Use the exact teamId and channel id together: send <channel-id> --team <team-id> --key <key> --from-pad message.md. Mentions are unsupported."
        : "Use channels <team-id> [name] to select a channel. Refine the name query if truncated."
    };
    while (matches.length && utf8Bytes(JSON.stringify(out)) > MAX_BYTES) { (out[channels ? "channels" : "teams"] as unknown[]).pop(); out.truncated = true; }
    return { result: JSON.stringify(out) };
  }

  type ChannelSnapshot = { identity: string; tenant: string; team: string; channel: string; at: number; messages: ReturnType<typeof historyRows>; clipped: boolean };
  const channelSnapshots = new Map<string, ChannelSnapshot>();

  function* channelHistory(args: string[]): HostIoSteps<{ result: string } | { error: string }> {
    const [team, id, ...options] = args;
    if (!teamId(team) || !channelId(id) || options.length % 2) return { error: "Usage: channel-history <team-id> <channel-id> [--limit 1-50] [--cursor <cursor>]." };
    let count = 20;
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let i = 0; i < options.length; i += 2) {
      const [flag, value] = options.slice(i, i + 2);
      if (seen.has(flag)) return { error: "invalid-request: Give each history option once." };
      seen.add(flag);
      if (flag === "--limit" && /^(?:[1-9]|[1-4][0-9]|50)$/.test(value)) count = Number(value);
      else if (flag === "--cursor" && /^[a-f0-9]{32}:[0-9]{1,3}$/.test(value)) cursor = value;
      else return { error: "invalid-request: History accepts --limit 1-50 and a returned --cursor only." };
    }
    const live = yield* liveSender();
    if ("error" in live) return live;
    const found = yield* resolveChannel(live.sender, team, id);
    if ("error" in found) return found;
    for (const [key, snap] of channelSnapshots) if (now() - snap.at > CHAT_CACHE_TTL_MS) channelSnapshots.delete(key);
    let token = cursor?.split(":")[0];
    const offset = cursor ? Number(cursor.split(":")[1]) : 0;
    let snapshot = token ? channelSnapshots.get(token) : undefined;
    if (cursor && (!snapshot || snapshot.identity !== live.sender.identityKey || snapshot.tenant !== found.channel.tenantId || snapshot.team !== team || snapshot.channel !== id || offset >= snapshot.messages.length)) return { error: "invalid-request: History cursor expired or belongs to a different account/team/channel. Start channel-history again without --cursor." };
    if (!snapshot) {
      const response = yield* read(id, 200);
      if ("error" in response) return { error: `upstream-rejected: Could not read the selected channel. Check membership and tenant policy. ${microsoftMessage(response.error).slice(0, 1000)}` };
      const messages = historyRows(response.messages).sort((a, b) => b.createdDateTime.localeCompare(a.createdDateTime) || b.id.localeCompare(a.id)).slice(0, 200);
      const clipped = messages.some(row => row.content.length > 8192);
      for (const row of messages) row.content = cutText(row.content, 8192);
      snapshot = { identity: live.sender.identityKey, tenant: found.channel.tenantId, team, channel: id, at: now(), messages, clipped };
      token = sha256Hex(`channel-history:${now()}:${++previewSequence}`).slice(0, 32);
      if (channelSnapshots.size >= 4) channelSnapshots.delete(channelSnapshots.keys().next().value!);
      channelSnapshots.set(token, snapshot);
    }
    const page = boundedHistory(id, snapshot.messages.slice(offset, offset + count).reverse(), count, MAX_BYTES - 4096);
    const next = offset + page.messages.length;
    return {
      result: JSON.stringify({
        teamId: team, channelId: id, messages: page.messages,
        nextCursor: next < snapshot.messages.length ? `${token}:${next}` : null, truncated: page.truncated || snapshot.clipped,
        window: "Stable local snapshot of at most the latest 200 messages; older upstream pages are not fetched. Cursors expire after 10 minutes or plugin reload.", mentions: "unsupported"
      })
    };
  }

  return { agentTeams, resolveChannel, channelHistory, clear: () => channelSnapshots.clear() };
}
