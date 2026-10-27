// Determinate progress only, where length is known (upload, sync).
// Never a fake determinate bar for an unknown wait.
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme/theme-context';
import { spacing } from '../../theme/tokens';

export function GlassProgress({ value, label = 'Progress' }: { value: number; label?: string }) {
  const { palette } = useTheme();
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ now: Math.round(clamped * 100), min: 0, max: 100 }} style={[styles.track, { backgroundColor: palette.border }]}>
      <View style={[styles.fill, { width: `${clamped * 100}%`, backgroundColor: palette.accent }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 6, borderRadius: 3, overflow: 'hidden', marginVertical: spacing.sm },
  fill: { height: '100%' },
});
