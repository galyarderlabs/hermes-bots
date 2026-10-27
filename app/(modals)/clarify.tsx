import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/theme/theme-context';
import { ClarifyCard } from '../../src/components/ClarifyCard';
import { spacing } from '../../src/theme/tokens';

// Clarify modal over Chat: resolves the same pending server request the
// in-chat card would. Rendered as a modal so it survives navigation.
export default function ClarifyModal() {
  const { palette } = useTheme();
  const { questions } = useLocalSearchParams<{ questions?: string }>();
  const list = questions ? questions.split('\n').filter(Boolean) : ['Hermes asked a question that could not be parsed.'];
  return (
    <View style={[styles.wrap, { backgroundColor: palette.bg }]}>
      <ClarifyCard
        questions={list}
        onAnswer={() => router.back()}
        onRefuse={() => router.back()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: spacing.lg },
});
