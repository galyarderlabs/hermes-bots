import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../../src/theme/theme-context';
import { useConnection } from '../../src/lib/connection-store';
import { Row } from '../../src/components/Row';
import { GlassInput } from '../../src/components/glassyui/GlassInput';
import { GlassSegmentedControl } from '../../src/components/glassyui/GlassSegmentedControl';
import { RowSkeleton } from '../../src/components/glassyui/GlassSkeleton';
import { EmptyState } from '../../src/components/EmptyState';
import type { LiveSession } from '../../src/lib/types';
import { fontSize, spacing } from '../../src/theme/tokens';

export default function SessionsTab() {
  const { palette } = useTheme();
  const { gateway } = useConnection();
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'All' | 'Active' | 'Archived'>('All');

  useEffect(() => {
    if (!gateway) {
      // No gateway (unpaired or disconnected): do not strand the tab on
      // skeletons forever — show the empty state instead.
      setLoading(false);
      return;
    }
    let alive = true;
    gateway
      .fetchSessions()
      .then((res) => {
        const list = (res as { sessions?: LiveSession[] }).sessions ?? (Array.isArray(res) ? (res as LiveSession[]) : []);
        if (alive) setSessions(list);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [gateway]);

  const filtered = sessions.filter((s) => {
    if (query.trim() && !`${s.title} ${s.profile}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true; // archived flag is not part of the projection contract; filter kept for UI parity
  });

  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]}>Sessions</Text>
        <GlassInput value={query} onChangeText={setQuery} placeholder="Search sessions" accessibilityLabel="Search sessions" />
        <GlassSegmentedControl options={['All', 'Active', 'Archived'] as const} value={filter} onChange={setFilter} accessibilityLabel="Session filter" />
      </View>
      {loading ? (
        <>
          <RowSkeleton />
          <RowSkeleton />
        </>
      ) : filtered.length === 0 ? (
        <EmptyState message="No sessions yet" actionLabel="Back to Bots" onAction={() => router.push('/(tabs)/bots')} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <Row
              title={item.title || 'Untitled session'}
              preview={`${item.profile} · ${item.preview}`}
              time={item.last_active ? new Date(item.last_active * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
              avatarName={item.profile}
              unread={item.unread}
              onPress={() => router.push(`/chat/${encodeURIComponent(item.id)}`)}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { padding: spacing.lg, gap: spacing.md },
  title: { fontSize: fontSize.display, fontWeight: '600' },
});
