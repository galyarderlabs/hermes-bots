// Inline, in-interface feedback (connection lost, send failed with retry,
// permission needed). Feedback lives in the interface, not in alerts.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/theme-context';
import { fontSize, radius, spacing } from '../../theme/tokens';

export type AlertTone = 'info' | 'warning' | 'error' | 'success';

export function GlassAlert({
  tone = 'info',
  message,
  actionLabel,
  onAction,
}: {
  tone?: AlertTone;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { palette } = useTheme();
  const color = tone === 'error' ? palette.invalid : tone === 'warning' ? palette.gold : tone === 'success' ? palette.jade : palette.link;
  return (
    <View accessibilityLiveRegion="polite" style={[styles.alert, { backgroundColor: palette.tile, borderColor: palette.border }]}>
      <Text style={[styles.message, { color: palette.text }]}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" accessibilityLabel={actionLabel} onPress={onAction} style={styles.action}>
          <Text style={{ color, fontWeight: '600' }}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  alert: { borderRadius: radius.card, borderWidth: 1, padding: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  message: { flex: 1, fontSize: fontSize.body, lineHeight: fontSize.body * 1.35 },
  action: { minHeight: 44, justifyContent: 'center' },
});
