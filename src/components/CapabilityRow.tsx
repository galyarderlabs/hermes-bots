import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/theme-context';
import { fontSize, spacing } from '../theme/tokens';
import { GlassSwitch } from './glassyui/GlassSwitch';
import type { Capability } from '../lib/types';

export function CapabilityRow({ capability, onToggle }: { capability: Capability; onToggle: (enabled: boolean) => void }) {
  const { palette } = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: palette.border }]}>
      <View style={styles.copy}>
        <Text style={[styles.name, { color: palette.text }]}>{capability.label ?? capability.name}</Text>
        {capability.description ? <Text style={[styles.desc, { color: palette.secondary }]}>{capability.description}</Text> : null}
        {capability.tool_count !== undefined ? <Text style={[styles.desc, { color: palette.secondary }]}>{capability.tool_count} tools</Text> : null}
      </View>
      <GlassSwitch value={capability.enabled} onValueChange={onToggle} accessibilityLabel={`Toggle ${capability.label ?? capability.name}`} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1 },
  copy: { flex: 1 },
  name: { fontSize: fontSize.body, fontWeight: '600' },
  desc: { fontSize: fontSize.secondary, marginTop: 2 },
});
