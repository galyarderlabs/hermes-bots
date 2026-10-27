import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/theme/theme-context';
import { useConnection } from '../../src/lib/connection-store';
import { useRoster } from '../../src/lib/use-roster';
import { MessageBubble } from '../../src/components/MessageBubble';
import { Composer } from '../../src/components/Composer';
import { GlassAlert } from '../../src/components/glassyui/GlassAlert';
import { findGroupName } from '../../src/lib/roster';
import type { GroupEvent, GroupRoom, LiveMessage } from '../../src/lib/types';
import { fontSize, spacing } from '../../src/theme/tokens';

// Group chat (F15): room log is seq-ordered; driver:false => read-only
// message, never an input that goes nowhere. Send: groups.send with a
// STRING event_id (idempotency key), then re-read groups.log from cursor.
export default function GroupChatScreen() {
  const { groupName } = useLocalSearchParams<{ groupName: string }>();
  const { palette } = useTheme();
  const { gateway } = useConnection();
  const { profiles } = useRoster(false);
  const [room, setRoom] = useState<GroupRoom | null>(null);
  const [events, setEvents] = useState<GroupEvent[]>([]);
  const [driver, setDriver] = useState<boolean | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [readOnlyReason, setReadOnlyReason] = useState<string | null>(null);

  const canonicalName = findGroupName(profiles, groupName) ?? groupName;
  const anchor = room?.members?.[0]?.profile ?? profiles[0]?.name ?? '';

  const loadLog = useCallback(
    async (roomId: string, sinceSeq?: number) => {
      if (!gateway || !anchor) return;
      const res = (await gateway.request('groups.log', {
        profile: anchor,
        room_id: roomId,
        ...(sinceSeq !== undefined ? { since_seq: sinceSeq } : {}),
      })) as { events?: GroupEvent[] };
      const incoming = res.events ?? [];
      setEvents((prev) => {
        const bySeq = new Map(prev.map((e) => [e.seq, e]));
        for (const e of incoming) bySeq.set(e.seq, e);
        return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
      });
    },
    [gateway, anchor],
  );

  useEffect(() => {
    if (!gateway || !anchor) return;
    let alive = true;
    (async () => {
      try {
        const caps = (await gateway.request('groups.capabilities', { profile: anchor })) as { driver?: boolean };
        if (alive) {
          setDriver(caps.driver ?? false);
          if (caps.driver === false) setReadOnlyReason('This gateway cannot drive room turns, so this room is read-only.');
        }
        const rooms = (await gateway.request('groups.list', { profile: anchor })) as { rooms?: GroupRoom[] };
        const found = (rooms.rooms ?? []).find((r) => r.name.toLowerCase() === canonicalName.toLowerCase());
        if (found && alive) {
          setRoom(found);
          await loadLog(found.room_id);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Could not load this group.');
      }
    })();
    return () => { alive = false; };
  }, [gateway, anchor, canonicalName, loadLog]);

  const messages: LiveMessage[] = events
    .filter((e) => e.kind === 'message.user' || e.kind === 'message.member' || e.kind === 'message')
    .map((e, i) => ({
      id: e.seq || i,
      role: e.kind === 'message.user' ? 'user' : 'assistant',
      content: String((e.payload?.text as string) ?? ''),
      timestamp: e.created_at,
    }));

  const send = async () => {
    if (!gateway || !room || !draft.trim()) return;
    try {
      await gateway.request('groups.send', {
        profile: anchor,
        room_id: room.room_id,
        event_id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        payload: { text: draft, thread_id: null },
      });
      setDraft('');
      const latest = events[events.length - 1]?.seq;
      await loadLog(room.room_id, latest);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send to this group.');
    }
  };

  return (
    <View style={[styles.wrap, { backgroundColor: palette.bg }]}>
      <Text style={[styles.title, { color: palette.text }]}>{canonicalName}</Text>
      {room?.members ? <Text style={[styles.members, { color: palette.secondary }]}>{room.members.length} members</Text> : null}
      {readOnlyReason ? <GlassAlert tone="warning" message={readOnlyReason} /> : null}
      {error ? <GlassAlert tone="error" message={error} /> : null}
      <FlatList
        style={{ flex: 1 }}
        data={messages}
        keyExtractor={(m) => String(m.id)}
        renderItem={({ item }) => <MessageBubble message={item} />}
        ListEmptyComponent={<Text style={[styles.empty, { color: palette.secondary }]}>{driver === false ? 'This room is read-only.' : 'Say hello'}</Text>}
      />
      {driver === false ? (
        <GlassAlert tone="warning" message="This gateway cannot drive room turns." />
      ) : (
        <Composer
          draft={draft}
          onDraftChange={setDraft}
          onSend={() => void send()}
          onStop={() => {}}
          sending={false}
          attachments={[]}
          onRemoveAttachment={() => {}}
          onRetryAttachment={() => {}}
          onAttach={() => {}}
          onVoiceTap={() => {}}
          onVoiceHold={() => {}}
          slashItems={[]}
          onSlashSelect={() => {}}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  title: { fontSize: fontSize.headline, fontWeight: '600', paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  members: { fontSize: fontSize.secondary, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  empty: { fontSize: fontSize.body, textAlign: 'center', padding: spacing.xxxl },
});
