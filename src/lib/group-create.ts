// Group creation order (port-spec §4.2) — order matters:
// (1) write the group name into EVERY member's ui_meta['hermes-bots'].groups
//     via profiles.configure, sending the WHOLE hermes-bots object (the
//     handler merges key-wise; a partial write drops shape/colour/title);
// (2) groups.create with member_id + profile + handle on every member,
//     from one shared builder; (3) pin the returned room_id.
import type { GroupMember, GroupRoom, RosterProfile } from './types';

export function buildGroupMembers(profiles: RosterProfile[], memberNames: string[]): GroupMember[] {
  return memberNames.map((name) => ({ member_id: name, profile: name, handle: name }));
}

export function buildGroupUiMeta(profile: RosterProfile, groupName: string): Record<string, unknown> {
  const existing = profile.ui_meta?.['hermes-bots'] ?? {};
  const groups = [...(existing.groups ?? [])];
  if (!groups.includes(groupName)) groups.push(groupName);
  // Whole-object write: everything the profile already had, plus the group.
  return { ...existing, groups };
}

export interface GroupCreator {
  configure: (params: unknown) => Promise<unknown>;
  create: (params: unknown) => Promise<unknown>;
}

export async function createGroup(
  client: GroupCreator,
  profiles: RosterProfile[],
  groupName: string,
  memberNames: string[],
): Promise<{ room: GroupRoom | null; membershipWarning: string | null }> {
  // Step 1: membership first, so the group exists even if room creation fails.
  let membershipWarning: string | null = null;
  for (const name of memberNames) {
    const profile = profiles.find((p) => p.name === name);
    if (!profile) continue;
    try {
      await client.configure({ name, ui_meta: { 'hermes-bots': buildGroupUiMeta(profile, groupName) } });
    } catch {
      membershipWarning = `Could not save group membership for ${name}.`;
    }
  }
  // Step 2: room creation from the shared member builder.
  try {
    const res = (await client.create({
      profile: memberNames[0],
      room_id: groupName,
      name: groupName,
      members: buildGroupMembers(profiles, memberNames),
    })) as { room?: GroupRoom };
    return { room: res.room ?? null, membershipWarning };
  } catch {
    // Step 3 skipped: group still exists and is visible, with a warning.
    return { room: null, membershipWarning: membershipWarning ?? 'Group saved, but room creation failed — the group is still visible.' };
  }
}
