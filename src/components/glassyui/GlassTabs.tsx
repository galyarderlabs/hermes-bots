// Top-level navigation tabs: Bots / Sessions / Tasks. Tabs navigate, never act.
// The selected bubble springs under normal motion and jumps under reduced motion.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../theme/theme-context';
import { fontSize, radius, spacing } from '../../theme/tokens';

export function GlassTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly T[];
  value: T;
  onChange: (t: T) => void;
}) {
  const { palette } = useTheme();
  return (
    <View style={[styles.bar, { backgroundColor: palette.tile }]}>
      {tabs.map((t) => (
        <Pressable
          key={t}
          accessibilityRole="tab"
          accessibilityState={{ selected: t === value }}
          accessibilityLabel={`${t} tab`}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onChange(t);
          }}
          style={[styles.tab, t === value ? { backgroundColor: palette.accent } : null]}
        >
          <Text style={[styles.label, { color: t === value ? palette.onAccent : palette.text }]}>{t}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderRadius: radius.capsule, padding: spacing.xs, position: 'relative' },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.capsule },
  label: { fontSize: fontSize.body, fontWeight: '600', textTransform: 'capitalize' },
});
