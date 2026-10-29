// Bottom sheet: scrim tap or the Close button dismisses it, grabber
// shown, one sheet at a time, an obvious way out besides Done. On
// phones this backs the sheet screens; full-screen routes are used
// where the spec requires a full screen.
import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/theme-context';
import { fontSize, radius, spacing } from '../../theme/tokens';

export function GlassSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const { palette } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close sheet" />
      <View style={[styles.sheet, { backgroundColor: palette.tile }]}>
        <View style={[styles.grabber, { backgroundColor: palette.secondary }]} />
        <View style={styles.header}>
          <Text style={[styles.title, { color: palette.text }]}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close sheet" onPress={onClose} style={styles.close}>
            <Text style={{ color: palette.secondary, fontSize: fontSize.body }}>Close</Text>
          </Pressable>
        </View>
        {children}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: spacing.lg, paddingBottom: spacing.xxxl, maxHeight: '85%' },
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  title: { fontSize: fontSize.headline, fontWeight: '600' },
  close: { minHeight: 44, justifyContent: 'center' },
});
