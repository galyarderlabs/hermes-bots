import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme, type ThemeChoice } from '../../src/theme/theme-context';
import { GlassSegmentedControl } from '../../src/components/glassyui/GlassSegmentedControl';
import { GlassSwitch } from '../../src/components/glassyui/GlassSwitch';
import { fontSize, spacing } from '../../src/theme/tokens';

// Appearance: System / Dark / Light (default System). Reduce motion and
// reduce transparency are honoured, not just stored.
export default function AppearanceScreen() {
  const { palette, choice, setChoice, reduceMotion, setReduceMotion, reduceTransparency, setReduceTransparency } = useTheme();
  return (
    <ScrollView style={{ backgroundColor: palette.bg }}>
      <View style={styles.wrap}>
        <Text style={[styles.title, { color: palette.text }]}>Appearance</Text>
        <GlassSegmentedControl
          options={['system', 'dark', 'light'] as ThemeChoice[]}
          value={choice}
          onChange={setChoice}
          accessibilityLabel="Appearance"
        />
        <View style={styles.row}>
          <Text style={[styles.label, { color: palette.text }]}>Reduce motion</Text>
          <GlassSwitch value={reduceMotion} onValueChange={setReduceMotion} accessibilityLabel="Reduce motion" />
        </View>
        <View style={styles.row}>
          <Text style={[styles.label, { color: palette.text }]}>Reduce transparency</Text>
          <GlassSwitch value={reduceTransparency} onValueChange={setReduceTransparency} accessibilityLabel="Reduce transparency" />
        </View>
        <Text style={[styles.hint, { color: palette.secondary }]}>Reduce transparency collapses glass to its opaque tile fallback everywhere — the appearance a large share of Android users will actually see.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md },
  title: { fontSize: fontSize.headline, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  label: { fontSize: fontSize.body },
  hint: { fontSize: fontSize.caption, lineHeight: fontSize.caption * 1.3 },
});
