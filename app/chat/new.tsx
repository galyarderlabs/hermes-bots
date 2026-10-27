import { useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../../src/theme/theme-context';
import { useConnection } from '../../src/lib/connection-store';
import { useRoster } from '../../src/lib/use-roster';
import { Row } from '../../src/components/Row';
import { GlassAlert } from '../../src/components/glassyui/GlassAlert';
import { fontSize, spacing } from '../../src/theme/tokens';

// New Chat (F12): pick a Bot, session.create with hidden:false, seeded with
// one hidden user message 'New chat' (non-empty — host drops whitespace
// seeds). Open by the STORED id (stored_session_id || session_id).
// Do NOT re-title afterwards — 'Bot Chat' is owned by the canonical chat.
export default function NewChatScreen() {
  const { palette } = useTheme();
  const { gateway } = useConnection();
  const { profiles, error } = useRoster(false);
  const [creating, setCreating] = useState<string | null>(null);

  const create = async (profile: string) => {
    if (!gateway) return;
    setCreating(profile);
    try {
      const res = (await gateway.request('session.create', {
        profile,
        title: 'Bot Chat',
        hidden: false,
        follow_profile_config: true,
        messages: [{ role: 'user', content: 'New chat', display_kind: 'hidden' }],
      })) as { session_id?: string; stored_session_id?: string };
      const id = res.stored_session_id || res.session_id;
      if (!id) throw new Error('Hermes did not return a session id.');
      router.replace(`/chat/${encodeURIComponent(id)}`);
    } catch (e) {
      setCreating(null);
      // Error surfaces via the alert below through a re-render guard:
      (globalThis as Record<string, unknown>).__newChatError = e instanceof Error ? e.message : 'Could not create a chat.';
    }
  };

  return (
    <View style={[styles.wrap, { backgroundColor: palette.bg }]}>
      <Text style={[styles.title, { color: palette.text }]}>Pick a bot for a new chat</Text>
      {error ? <GlassAlert tone="error" message={error} /> : null}
      <FlatList
        data={profiles}
        keyExtractor={(p) => p.name}
        renderItem={({ item }) => (
          <Row
            title={item.display_name ?? item.name}
            preview={item.description ?? ''}
            avatarName={item.display_name ?? item.name}
            onPress={() => void create(item.name)}
          />
        )}
      />
      {creating ? <Text style={{ color: palette.secondary, padding: spacing.lg }}>Creating chat with {creating}…</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  title: { fontSize: fontSize.headline, fontWeight: '600', padding: spacing.lg },
});
