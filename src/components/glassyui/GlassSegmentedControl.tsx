import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/theme-context';
import { fontSize, radius, spacing } from '../../theme/tokens';

export function GlassSegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: readonly T[];
  value: T;
  onChange: (t: T) => void;
  accessibilityLabel: string;
}) {
  const { palette } = useTheme();
  return (
    <View accessibilityLabel={accessibilityLabel} style={[styles.bar, { backgroundColor: palette.tile }]}>
      {options.map((o) => (
        <Pressable
          key={o}
          accessibilityRole="button"
          accessibilityState={{ selected: o === value }}
          accessibilityLabel={o}
          onPress={() => onChange(o)}
          style={[styles.option, o === value ? { backgroundColor: palette.accent } : null]}
        >
          <Text style={[styles.label, { color: o === value ? palette.onAccent : palette.text }]}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderRadius: radius.capsule, padding: spacing.xs },
  option: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.capsule, paddingHorizontal: spacing.sm },
  label: { fontSize: fontSize.secondary, fontWeight: '600', textTransform: 'capitalize' },
});
