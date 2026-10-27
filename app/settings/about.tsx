import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../src/theme/theme-context';
import { fontSize, spacing } from '../../src/theme/tokens';

export default function AboutScreen() {
  const { palette } = useTheme();
  return (
    <ScrollView style={{ backgroundColor: palette.bg }}>
      <View style={styles.wrap}>
        <Text style={[styles.title, { color: palette.text }]}>About Hermes</Text>
        <Text style={[styles.body, { color: palette.text }]}>Hermes Mobile for Expo — version 0.3.0.</Text>
        <Text style={[styles.body, { color: palette.secondary }]}>
          Attribution: Hermes Mobile by CodeUpdaterBot; Hermes Agent by Nous Research; the Remote Gateway work by rusty4444/hermes-android, whose contract this port follows.
        </Text>
        <Text style={[styles.body, { color: palette.secondary }]}>
          Disclaimer: this is an independent community project. It is not affiliated with or endorsed by Nous Research.
        </Text>
        <Text style={[styles.body, { color: palette.secondary }]}>
          Licence: AGPL-3.0. Glass components in this app are inspired by alexburlis/glassyui (MIT) and reimplemented for this repo — see src/components/glassyui/THIRD_PARTY_NOTICES.md.
        </Text>
        <Text style={[styles.body, { color: palette.secondary }]}>Update channel: none in v1 — no auto-update.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md },
  title: { fontSize: fontSize.headline, fontWeight: '600' },
  body: { fontSize: fontSize.body, lineHeight: fontSize.body * 1.35 },
});
