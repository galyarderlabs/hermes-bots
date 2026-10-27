// Modal dialog for destructive confirmations. Holds focus until it closes;
// the confirm action keeps its name through the flow ("Delete task", not "OK").
import type { ReactNode } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/theme-context';
import { fontSize, radius, spacing } from '../../theme/tokens';
import { GlassButton } from './GlassButton';

export function GlassDialog({
  visible,
  onClose,
  title,
  message,
  confirmLabel,
  onConfirm,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  const { palette } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={[styles.dialog, { backgroundColor: palette.tile }]}>
          <Text style={[styles.title, { color: palette.text }]}>{title}</Text>
          <Text style={[styles.message, { color: palette.secondary }]}>{message}</Text>
          {children}
          <View style={styles.actions}>
            <GlassButton title="Cancel" variant="ghost" onPress={onClose} />
            <GlassButton title={confirmLabel} variant="prominent" destructive onPress={onConfirm} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  dialog: { borderRadius: radius.dialog, padding: spacing.xl, width: '100%', maxWidth: 400 },
  title: { fontSize: fontSize.title, fontWeight: '600', marginBottom: spacing.sm },
  message: { fontSize: fontSize.body, lineHeight: fontSize.body * 1.35, marginBottom: spacing.xl },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
});
