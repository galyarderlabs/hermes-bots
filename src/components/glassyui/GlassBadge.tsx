// Contrast-gated badge. Status tones are used as FILL only, never as text:
// light jade on light bg is 2.90:1 and fails even large-text 3:1,
// so badge text is always dark ink on the tinted fill.
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/theme-context';
import { fontSize, radius, spacing } from '../../theme/tokens';

export type BadgeTone = 'jade' | 'gold' | 'rose' | 'violet' | 'gray';

export function GlassBadge({ label, tone = 'gray' }: { label: string; tone?: BadgeTone }) {
  const { palette } = useTheme();
  const fill = palette[tone];
  return (
    <View style={[styles.badge, { backgroundColor: fill }]}>
      <Text style={[styles.label, { color: palette.badgeInk }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderRadius: radius.badge, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, alignSelf: 'flex-start' },
  label: { fontSize: fontSize.metadata, fontWeight: '600' },
});
