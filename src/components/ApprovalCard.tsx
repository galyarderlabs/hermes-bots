// Approval inbox item. Secrets are never shown raw — sudo/secret prompts
// are masked. Approve / Deny / Reply only where the host method allows.
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/theme-context';
import { fontSize, spacing } from '../theme/tokens';
import { GlassButton } from './glassyui/GlassButton';

export interface ApprovalItem {
  id: number;
  kind: string;
  bot: string;
  sessionId: string;
  summary: string;
  masked?: boolean;
}

export function ApprovalCard({ item, onApprove, onDeny }: { item: ApprovalItem; onApprove: () => void; onDeny: () => void }) {
  const { palette } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: palette.tile }]}>
      <Text style={[styles.kind, { color: palette.secondary }]}>
        {item.kind} · {item.bot}
      </Text>
      <Text style={[styles.summary, { color: palette.text }]}>{item.masked ? '•••••••• (secret hidden)' : item.summary}</Text>
      <View style={styles.actions}>
        <GlassButton title="Deny" variant="ghost" onPress={onDeny} />
        <GlassButton title="Approve" variant="prominent" onPress={onApprove} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, padding: spacing.lg, gap: spacing.sm },
  kind: { fontSize: fontSize.metadata, fontWeight: '600' },
  summary: { fontSize: fontSize.body, lineHeight: fontSize.body * 1.35 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
});
