// Roster derivation (port-spec F1/F15, §3).
// Roster authority is profiles.list with include_sessions:true — NEVER the
// all-sessions REST projection. Canonical session id = resolved_id || id.
// Groups come ONLY from ui_meta['hermes-bots'].groups (whole-object writes
// on create — see group screen). A group borrows its most recently active
// member's activity as a recency PROXY, not as group activity.
import type { RosterEntry, RosterProfile } from './types';

export function canonicalSessionId(session: { id: string; resolved_id?: string } | null | undefined): string | null {
  if (!session) return null;
  return session.resolved_id || session.id;
}

export function profileLastActive(profile: RosterProfile): number {
  const fromCanonical = profile.canonical_session?.last_active;
  const fromLast = profile.last_session?.last_active;
  return Math.max(fromCanonical ?? 0, fromLast ?? 0);
}

/** Group memberships from profile metadata. Legacy singular `group` is read, never written. */
export function deriveGroups(profiles: RosterProfile[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const profile of profiles) {
    const meta = profile.ui_meta?.['hermes-bots'];
    const names = [...(meta?.groups ?? [])];
    if (meta?.group && !names.includes(meta.group)) names.push(meta.group);
    for (const name of names) {
      const members = groups.get(name) ?? [];
      if (!members.includes(profile.name)) members.push(profile.name);
      groups.set(name, members);
    }
  }
  return groups;
}

/** Case-insensitive group-name lookup (creation casing and roster casing can differ). */
export function findGroupName(profiles: RosterProfile[], query: string): string | null {
  const lower = query.toLowerCase();
  for (const name of deriveGroups(profiles).keys()) {
    if (name.toLowerCase() === lower) return name;
  }
  return null;
}

export function buildRosterEntries(profiles: RosterProfile[]): RosterEntry[] {
  const byProfile = new Map(profiles.map((p) => [p.name, p]));
  const groups = deriveGroups(profiles);
  const entries: RosterEntry[] = profiles.map((profile) => ({
    kind: 'bot',
    profile,
    lastActive: profileLastActive(profile),
  }));
  for (const [name, members] of groups) {
    // Proxy recency: most recently active member's last_active.
    const lastActive = Math.max(0, ...members.map((m) => profileLastActive(byProfile.get(m)!)).filter((v) => Number.isFinite(v)));
    entries.push({ kind: 'group', name, members, lastActive });
  }
  entries.sort((a, b) => b.lastActive - a.lastActive);
  return entries;
}

/** sessions.changed is a refetch signal only — it carries no progress. */
export function shouldRefetchOnSessionsChanged(): boolean {
  return true;
}
