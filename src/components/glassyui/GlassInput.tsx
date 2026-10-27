import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from '../../theme/theme-context';
import { fontSize, radius, spacing } from '../../theme/tokens';

export function GlassInput({
  label,
  hint,
  ...props
}: TextInputProps & { label?: string; hint?: string }) {
  const { palette } = useTheme();
  return (
    <View>
      {label ? <Text style={[styles.label, { color: palette.text }]}>{label}</Text> : null}
      <TextInput
        {...props}
        placeholderTextColor={palette.secondary}
        style={[styles.input, { backgroundColor: palette.tile, color: palette.text, borderColor: palette.border }]}
      />
      {hint ? <Text style={[styles.hint, { color: palette.secondary }]}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: fontSize.secondary, fontWeight: '600', marginBottom: spacing.sm },
  input: { borderRadius: radius.fieldExpanded, borderWidth: 1, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: fontSize.body, minHeight: 44 },
  hint: { fontSize: fontSize.caption, marginTop: spacing.sm },
});
