import { describe, expect, it } from 'vitest';
import { buildGroupMembers, buildGroupUiMeta, createGroup } from '../src/lib/group-create';
import { deriveGroups, findGroupName } from '../src/lib/roster';
import type { RosterProfile } from '../src/lib/types';

const profile = (name: string, groups?: string[], extra?: Record<string, unknown>): RosterProfile => ({
  name,
  ui_meta: { 'hermes-bots': { shape: 'blobatar', color: 'blue', groups, ...extra } },
});

describe('group room-id / name handling', () => {
  it('derives groups from profile metadata, not a separate registry', () => {
    const groups = deriveGroups([profile('a', ['Team']), profile('b', ['Team', 'Ops']), profile('c')]);
    expect(groups.get('Team')).toEqual(['a', 'b']);
    expect(groups.get('Ops')).toEqual(['b']);
  });

  it('matches group names case-insensitively', () => {
    const profiles = [profile('a', ['Dev Team'])];
    expect(findGroupName(profiles, 'dev team')).toBe('Dev Team');
    expect(findGroupName(profiles, 'DEV TEAM')).toBe('Dev Team');
    expect(findGroupName(profiles, 'missing')).toBeNull();
  });

  it('builds members with member_id + profile + handle from one builder', () => {
    expect(buildGroupMembers([], ['a', 'b'])).toEqual([
      { member_id: 'a', profile: 'a', handle: 'a' },
      { member_id: 'b', profile: 'b', handle: 'b' },
    ]);
  });
});

describe('group creation order', () => {
  it('writes membership to every member FIRST, then creates the room, with whole-object writes', async () => {
    const order: string[] = [];
    const profiles = [profile('a', ['Old']), profile('b')];
    const { room } = await createGroup(
      {
        configure: async (p) => {
          order.push(`configure:${(p as { name: string }).name}`);
          // Whole-object write must preserve shape/colour/title.
          const meta = (p as { ui_meta: { 'hermes-bots': Record<string, unknown> } }).ui_meta['hermes-bots'];
          expect(meta.shape).toBe('blobatar');
          expect((meta.groups as string[])).toContain('NewGroup');
        },
        create: async () => {
          order.push('create');
          return { room: { room_id: 'room-1', name: 'NewGroup' } };
        },
      },
      profiles,
      'NewGroup',
      ['a', 'b'],
    );
    expect(order).toEqual(['configure:a', 'configure:b', 'create']);
    expect(room?.room_id).toBe('room-1');
  });

  it('if room creation fails, the group still exists (warning, no silent failure)', async () => {
    const configured: string[] = [];
    const { room, membershipWarning } = await createGroup(
      {
        configure: async (p) => {
          configured.push((p as { name: string }).name);
        },
        create: async () => {
          throw new Error('room failed');
        },
      },
      [profile('a')],
      'Fallback',
      ['a'],
    );
    expect(configured).toEqual(['a']);
    expect(room).toBeNull();
    expect(membershipWarning).toMatch(/still/);
  });

  it('whole-object write preserves existing groups', () => {
    const meta = buildGroupUiMeta(profile('a', ['Old']), 'New');
    expect(meta.groups).toEqual(['Old', 'New']);
    expect(meta.shape).toBe('blobatar');
  });
});
