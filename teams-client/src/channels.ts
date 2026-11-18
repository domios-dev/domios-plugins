// Shapes emitted by the pinned exo-teams list-teams command. No new API or grant.
export type Channel = {
  id: string; title: string; teamId: string; team: string; tenantId: string;
  readable: boolean; writable: boolean; refusal: string | null;
};
export type Team = { id: string; title: string; tenantId: string; channels: Channel[] };

export function channelId(value: unknown): value is string {
  return typeof value === "string" && /^19:[A-Za-z0-9._-]+@thread\.(?:tacv2|skype)$/.test(value) && value.length <= 512;
}

export function teamId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9:._@-]{1,512}$/.test(value);
}

export function parseTeams(value: unknown): { teams: Team[] } | { error: string } {
  const unreadable = { error: "upstream-rejected: Teams returned an unreadable team/channel list. Refresh teams; if it persists, ask the owner to check Teams membership and tenant policy. No destination was selected." };
  if (!Array.isArray(value) || value.length > 500) return unreadable;
  const teams: Team[] = [];
  const ids = new Set<string>();
  const channels = new Set<string>();
  for (const raw of value) {
    if (!raw || !teamId(raw.id) || ids.has(raw.id) || typeof raw.displayName !== "string" || raw.displayName.length > 200 ||
      typeof raw.tenantId !== "string" || !raw.tenantId || raw.tenantId.length > 200 || !Array.isArray(raw.channels) || raw.channels.length > 500) return unreadable;
    ids.add(raw.id);
    const team: Team = { id: raw.id, title: raw.displayName.slice(0, 200), tenantId: raw.tenantId, channels: [] };
    for (const ch of raw.channels) {
      if (!ch || !channelId(ch.id) || channels.has(ch.id) || typeof ch.displayName !== "string" || ch.displayName.length > 200 ||
        (ch.tenantId != null && (typeof ch.tenantId !== "string" || ch.tenantId.length > 200))) return unreadable;
      channels.add(ch.id);
      const tenant = ch.tenantId || raw.tenantId;
      const wrongTenant = tenant !== raw.tenantId || (ch.parentTeamId && ch.parentTeamId !== raw.id);
      const locked = ch.isArchived === true || raw.isArchived === true || ch.isReadOnly === true;
      const unreadableChannel = ch.isMember === false;
      const refusal = wrongTenant ? "tenant-refused: channel tenant or parent does not match the selected team"
        : unreadableChannel ? "permission-refused: this account is not a channel member"
          : locked ? "permission-refused: the channel is archived or read-only" : null;
      team.channels.push({
        id: ch.id, title: ch.displayName.slice(0, 200), teamId: team.id, team: team.title,
        tenantId: tenant, readable: !wrongTenant && !unreadableChannel, writable: !refusal, refusal
      });
    }
    teams.push(team);
  }
  return { teams };
}
