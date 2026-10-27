import { StyleSheet, TextInput, type TextInputProps } from 'react-native';
import { useTheme } from '../../theme/theme-context';
import { fontSize, radius, spacing } from '../../theme/tokens';

// Composer multiline field: grows as you type, then scrolls internally
// past a max height (enforced by the caller via maxHeight).
export function GlassTextarea(props: TextInputProps) {
  const { palette } = useTheme();
  return (
    <TextInput
      {...props}
      multiline
      placeholderTextColor={palette.secondary}
      style={[styles.field, { backgroundColor: palette.tile, color: palette.text }, props.style]}
    />
  );
}

const styles = StyleSheet.create({
  field: { borderRadius: radius.composer, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: fontSize.body, lineHeight: fontSize.body * 1.35 },
});
