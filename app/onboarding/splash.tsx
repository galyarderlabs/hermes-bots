// Onboarding splash: flow-board section 01 screen 1, as sent by Galih.
// Full-bleed plain asset (assets/splash-bg.jpg) with native UI on top:
// the wordmark, tagline, and buttons are real components, not baked
// into the image. Board light colors are forced here, not the app
// theme (see tokens.brand). Header hidden; system back works.
import { ImageBackground, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';
import { brand, lightPalette, radius, spacing } from '../../src/theme/tokens';

export default function SplashScreen() {
  return (
    <View style={styles.root}>
      <ImageBackground
        source={require('../../assets/splash-bg.jpg')}
        style={styles.bg}
        resizeMode="cover"
      >
        <StatusBar style="dark" />
        <SafeAreaView style={styles.overlay}>
          <View style={styles.top}>
            <Text style={styles.wordmark}>GBots</Text>
            <Text style={styles.tagline}>Your AI team, on your phone.</Text>
          </View>
          <View style={styles.bottom}>
            <Pressable
              style={styles.primary}
              onPress={() => router.push('/onboarding/welcome')}
            >
              <Text style={[styles.primaryText, { color: lightPalette.onAccent }]}>Get started</Text>
            </Pressable>
            <Pressable
              style={styles.secondary}
              onPress={() => router.push('/settings/connection')}
            >
              <Text style={styles.secondaryText}>I already have a host</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bg: { flex: 1 },
  overlay: { flex: 1 },
  top: { paddingTop: spacing.huge, alignItems: 'center' },
  wordmark: {
    fontSize: 56,
    fontWeight: '800',
    color: brand.navy,
    letterSpacing: -1,
  },
  tagline: { fontSize: 18, color: brand.tagline, marginTop: spacing.sm },
  bottom: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.xxxl,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  primary: {
    backgroundColor: brand.blue,
    paddingVertical: spacing.lg,
    borderRadius: radius.capsule,
    alignItems: 'center',
  },
  primaryText: { fontSize: 18, fontWeight: '700' },
  secondary: {
    backgroundColor: brand.glass,
    borderWidth: 1,
    borderColor: brand.glassBorder,
    paddingVertical: spacing.lg,
    borderRadius: radius.capsule,
    alignItems: 'center',
  },
  secondaryText: { color: brand.navy, fontSize: 18, fontWeight: '700' },
});
