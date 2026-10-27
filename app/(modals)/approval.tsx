import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../src/theme/theme-context';
import { ApprovalCard } from '../../src/components/ApprovalCard';
import { spacing } from '../../src/theme/tokens';

// Approval modal: Approve / Deny route through the same authenticated
// channel as chat (the pending server request), never through an
// unauthenticated deep link alone. Wiring to the live pending request
// happens in the connection store at connect time; this screen renders
// the card and closes on action.
export default function ApprovalModal() {
  const { palette } = useTheme();
  const { kind, bot, summary } = useLocalSearchParams<{ kind?: string; bot?: string; summary?: string }>();
  return (
    <View style={[styles.wrap, { backgroundColor: palette.bg }]}>
      <ApprovalCard
        item={{
          id: 0,
          kind: kind ?? 'approval',
          bot: bot ?? 'Hermes',
          sessionId: '',
          summary: summary ?? 'Hermes is asking for approval.',
          masked: (kind ?? '').includes('secret') || (kind ?? '').includes('sudo'),
        }}
        onApprove={() => router.back()}
        onDeny={() => router.back()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: spacing.lg },
});
