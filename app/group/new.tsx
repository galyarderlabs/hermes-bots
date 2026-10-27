import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../../src/theme/theme-context';
import { useConnection } from '../../src/lib/connection-store';
import { useRoster } from '../../src/lib/use-roster';
import { GlassInput } from '../../src/components/glassyui/GlassInput';
import { GlassButton } from '../../src/components/glassyui/GlassButton';
import { GlassAlert } from '../../src/components/glassyui/GlassAlert';
import { GlassSwitch } from '../../src/components/glassyui/GlassSwitch';
import { createGroup } from '../../src/lib/group-create';
import { fontSize, spacing } from '../../src/theme/tokens';

export default function NewGroupScreen() {
  const { palette } = useTheme();
  const { gateway } = useConnection();
  const { profiles } = useRoster(false);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!gateway || !name.trim() || selected.length < 1) return;
    const { room, membershipWarning } = await createGroup(
      {
        configure: (p) => gateway.request('profiles.configure', p),
        create: (p) => gateway.request('groups.create', p),
      },
      profiles,
      name.trim(),
      selected,
    );
    if (membershipWarning) setWarning(membershipWarning);
    if (room) router.replace(`/group/${encodeURIComponent(room.name)}`);
    else if (!membershipWarning) setError('Group creation failed.');
    else router.replace('/(tabs)/bots');
  };

  return (
    <ScrollView style={{ backgroundColor: palette.bg }}>
      <View style={styles.wrap}>
        <Text style={[styles.title, { color: palette.text }]}>New group</Text>
        <GlassInput label="Group name" value={name} onChangeText={setName} placeholder="Group name" />
        <Text style={[styles.label, { color: palette.text }]}>Members ({selected.length} selected)</Text>
        {profiles.map((p) => {
          const on = selected.includes(p.name);
          return (
            <View key={p.name} style={styles.member}>
              <Text style={[styles.memberName, { color: palette.text }]}>{p.display_name ?? p.name}</Text>
              <GlassSwitch
                value={on}
                onValueChange={(v) => setSelected((prev) => (v ? [...prev, p.name] : prev.filter((x) => x !== p.name)))}
                accessibilityLabel={`Include ${p.display_name ?? p.name} in group`}
              />
            </View>
          );
        })}
        {warning ? <GlassAlert tone="warning" message={warning} /> : null}
        {error ? <GlassAlert tone="error" message={error} /> : null}
        <GlassButton title="Create group" variant="prominent" disabled={!name.trim() || selected.length < 1} onPress={() => void create()} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg },
  title: { fontSize: fontSize.headline, fontWeight: '600' },
  label: { fontSize: fontSize.body, fontWeight: '600' },
  member: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  memberName: { fontSize: fontSize.body },
});
