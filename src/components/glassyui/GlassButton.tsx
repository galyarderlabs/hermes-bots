// Variants: prominent (primary action, blue) / primary / soft / ghost.
// Press = slab sets down (opacity), never swells or scales up.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../theme/theme-context';
import { fontSize, radius, spacing } from '../../theme/tokens';

export type GlassButtonVariant = 'prominent' | 'primary' | 'soft' | 'ghost';

export function GlassButton({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  accessibilityLabel,
  destructive = false,
}: {
  title: string;
  onPress: () => void;
  variant?: GlassButtonVariant;
  disabled?: boolean;
  accessibilityLabel?: string;
  destructive?: boolean;
}) {
  const { palette } = useTheme();
  const background =
    variant === 'prominent'
      ? palette.prominentFill
      : variant === 'primary'
        ? palette.tile
        : variant === 'soft'
          ? palette.tile
          : 'transparent';
  const color =
    variant === 'prominent' ? palette.onAccent : destructive ? palette.invalid : palette.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      <Text style={[styles.label, { color }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { borderRadius: radius.capsule, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: fontSize.body, fontWeight: '600' },
});

export function GlassButtonRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
