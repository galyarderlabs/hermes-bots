import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/theme-context';
import { fontSize, spacing } from '../theme/tokens';
import { GlassButton } from './glassyui/GlassButton';

export function EmptyState({ message, actionLabel, onAction }: { message: string; actionLabel?: string; onAction?: () => void }) {
  const { palette } = useTheme();
  return (
    <View style={styles.wrap}>
      <Text style={[styles.message, { color: palette.secondary }]}>{message}</Text>
      {actionLabel && onAction ? <GlassButton title={actionLabel} variant="prominent" onPress={onAction} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xxxl },
  message: { fontSize: fontSize.body, textAlign: 'center', lineHeight: fontSize.body * 1.35 },
});
