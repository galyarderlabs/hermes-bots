import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, router } from 'expo-router';
import { useTheme } from '../../src/theme/theme-context';
import { useRoster } from '../../src/lib/use-roster';
import { useConnection } from '../../src/lib/connection-store';
import { Row } from '../../src/components/Row';
import { GlassInput } from '../../src/components/glassyui/GlassInput';
import { GlassButton } from '../../src/components/glassyui/GlassButton';
import { RowSkeleton } from '../../src/components/glassyui/GlassSkeleton';
import { EmptyState } from '../../src/components/EmptyState';
import { ConnectionBanner } from '../../src/components/ConnectionBanner';
import { GlassBadge } from '../../src/components/glassyui/GlassBadge';
import { canonicalSessionId } from '../../src/lib/roster';
import { fontSize, spacing } from '../../src/theme/tokens';

function fmtTime(ts?: number): string {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function BotsTab() {
  const { palette } = useTheme();
  const { activeHost, status } = useConnection();
  const { entries, loading, error, refresh } = useRoster(true);
  const [query, setQuery] = useState('');

  if (!activeHost) {
    return (
      <View style={[styles.wrap, { backgroundColor: palette.bg }]}>
        <Text style={[styles.title, { color: palette.text }]}>Connect Hermes first</Text>
        <Text style={[styles.sub, { color: palette.secondary }]}>Pair this phone with your Hermes host to see your bots.</Text>
        <Link href="/settings/connection" asChild>
          <GlassButton title="Open connection settings" variant="prominent" onPress={() => {}} />
        </Link>
      </View>
    );
  }

  const filtered = entries.filter((e) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return e.kind === 'bot'
      ? (e.profile.display_name ?? e.profile.name).toLowerCase().includes(q)
      : e.name.toLowerCase().includes(q);
  });

  return (
    <ScrollView
      style={{ backgroundColor: palette.bg }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]}>Bots</Text>
        <GlassBadge label={status === 'online' ? 'Hermes Desktop · online' : status === 'checking' ? 'Hermes Desktop · checking' : 'Hermes Desktop · unavailable'} tone={status === 'online' ? 'jade' : status === 'checking' ? 'gray' : 'rose'} />
      </View>
      <ConnectionBanner onRetry={refresh} />
      {error ? <Text style={[styles.error, { color: palette.invalid }]}>{error}</Text> : null}
      <View style={{ paddingHorizontal: spacing.lg }}>
        <GlassInput value={query} onChangeText={setQuery} placeholder="Search bots and groups" accessibilityLabel="Search bots and groups" />
      </View>
      {loading && entries.length === 0 ? (
        <>
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
        </>
      ) : filtered.length === 0 ? (
        <EmptyState
          message={query ? `No bots match '${query}'` : 'No bots yet — create your first bot'}
          actionLabel={query ? 'Clear search' : 'Create your first bot'}
          onAction={() => (query ? setQuery('') : router.push('/bot/new'))}
        />
      ) : (
        filtered.map((e) => {
          if (e.kind === 'group') {
            return (
              <Row
                key={`group:${e.name}`}
                title={e.name}
                preview={`${e.members.length} bots · ${e.members.join(', ')}`}
                time={fmtTime(e.lastActive)}
                groupMembers={e.members}
                onPress={() => router.push(`/group/${encodeURIComponent(e.name)}`)}
              />
            );
          }
          const sessionId = canonicalSessionId(e.profile.canonical_session) ?? canonicalSessionId(e.profile.last_session);
          return (
            <Row
              key={`bot:${e.profile.name}`}
              title={e.profile.display_name ?? e.profile.name}
              preview={e.profile.canonical_session?.preview ?? e.profile.description ?? 'No messages yet'}
              time={fmtTime(e.lastActive)}
              avatarName={e.profile.display_name ?? e.profile.name}
              avatarImage={e.profile.ui_meta?.['hermes-bots']?.image ?? null}
              onPress={() => sessionId && router.push(`/chat/${encodeURIComponent(sessionId)}`)}
              onLongPress={() => router.push(`/bot/${encodeURIComponent(e.profile.name)}/settings`)}
            />
          );
        })
      )}
      <View style={styles.footer}>
        <GlassButton title="New group" variant="primary" onPress={() => router.push('/group/new')} />
        <GlassButton title="New bot" variant="prominent" onPress={() => router.push('/bot/new')} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: spacing.xl, gap: spacing.lg, justifyContent: 'center' },
  header: { padding: spacing.lg, gap: spacing.sm },
  title: { fontSize: fontSize.display, fontWeight: '600' },
  sub: { fontSize: fontSize.body, lineHeight: fontSize.body * 1.35 },
  error: { fontSize: fontSize.body, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  footer: { flexDirection: 'row', gap: spacing.md, padding: spacing.lg, justifyContent: 'center' },
});
