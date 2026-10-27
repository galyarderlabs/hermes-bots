// Overflow menu: grows from its trigger. Primary actions stay visible;
// overflow holds the non-primary ones. Never the only path to an action
// that also exists as a swipe action.
import { useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme/theme-context';
import { fontSize, radius, spacing } from '../../theme/tokens';

export interface MenuItem {
  label: string;
  onPress: () => void;
  destructive?: boolean;
}

export function GlassMenu({ trigger, items, label }: { trigger: ReactNode; items: MenuItem[]; label: string }) {
  const { palette } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => setOpen(true)}>
        {trigger}
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setOpen(false)} accessibilityLabel="Close menu" />
        <View style={[styles.menu, { backgroundColor: palette.tile }]}>
          {items.map((item) => (
            <Pressable
              key={item.label}
              accessibilityRole="menuitem"
              accessibilityLabel={item.label}
              onPress={() => {
                setOpen(false);
                item.onPress();
              }}
              style={styles.item}
            >
              <Text style={{ color: item.destructive ? palette.invalid : palette.text, fontSize: fontSize.body }}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  menu: { position: 'absolute', top: 80, right: 16, borderRadius: radius.card, padding: spacing.sm, minWidth: 200 },
  item: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 44, justifyContent: 'center' },
});
