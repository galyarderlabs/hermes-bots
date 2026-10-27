// Clarify card: blocks the turn until answered. Unanswerable questions
// are refused immediately (empty result) — never left to host timeout.
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/theme-context';
import { fontSize, spacing } from '../theme/tokens';
import { GlassButton } from './glassyui/GlassButton';
import { GlassInput } from './glassyui/GlassInput';

export function ClarifyCard({
  questions,
  onAnswer,
  onRefuse,
}: {
  questions: string[];
  onAnswer: (answers: Record<string, string>) => void;
  onRefuse: () => void;
}) {
  const { palette } = useTheme();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  return (
    <View style={[styles.card, { backgroundColor: palette.tile }]}>
      <Text style={[styles.title, { color: palette.text }]}>Hermes needs clarification</Text>
      {questions.map((q, i) => (
        <GlassInput
          key={`${i}-${q}`}
          label={q}
          value={answers[q] ?? ''}
          onChangeText={(t) => setAnswers((prev) => ({ ...prev, [q]: t }))}
        />
      ))}
      <View style={styles.actions}>
        <GlassButton title="Cannot answer" variant="ghost" onPress={onRefuse} />
        <GlassButton title="Send answers" variant="prominent" onPress={() => onAnswer(answers)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, padding: spacing.lg, margin: spacing.lg, gap: spacing.md },
  title: { fontSize: fontSize.title, fontWeight: '600' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
});
