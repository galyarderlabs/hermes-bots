// Message bubble: 20r, tail corner 6 on the sender side.
// Own: bottom-right 6. Bot: bottom-left 6. Radius carries who spoke.
// Usage (model/tokens/tps/latency) reveals on tap; reasoning shown only
// as the host's published summary snippet — never raw chain-of-thought.
import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/theme-context';
import { fontSize, radius, spacing } from '../theme/tokens';
import type { LiveMessage } from '../lib/types';

export const MessageBubble = memo(function MessageBubble({
  message,
  onEditResend,
  onRetry,
}: {
  message: LiveMessage;
  onEditResend?: (text: string) => void;
  onRetry?: () => void;
}) {
  const { palette } = useTheme();
  const [showUsage, setShowUsage] = useState(false);
  const own = message.role === 'user';
  const isTool = message.role === 'tool';
  const failed = message.tool_status === 'failed';
  return (
    <View style={[styles.row, own ? styles.ownRow : styles.botRow]}>
      <Pressable
        accessibilityLabel={own ? 'Your message' : 'Bot message'}
        onPress={() => setShowUsage((v) => !v)}
        style={[
          styles.bubble,
          {
            backgroundColor: own ? palette.accent : palette.tile,
            borderBottomRightRadius: own ? radius.bubbleTail : radius.bubble,
            borderBottomLeftRadius: own ? radius.bubble : radius.bubbleTail,
            borderColor: failed ? palette.invalid : undefined,
            borderWidth: failed ? 1 : 0,
            maxWidth: '80%',
          },
        ]}
      >
        {isTool ? (
          <Text style={[styles.toolLabel, { color: palette.secondary }]}>
            {message.tool_name ?? 'Tool'} · {message.tool_status ?? 'running'}
            {message.duration_s !== undefined ? ` · ${message.duration_s}s` : ''}
          </Text>
        ) : null}
        <Text style={[styles.text, { color: own ? palette.onAccent : palette.text }]}>{message.content}</Text>
        {message.reasoning ? (
          <Text style={[styles.reasoning, { color: palette.secondary }]}>{message.reasoning}</Text>
        ) : null}
        {showUsage && message.usage ? (
          <Text style={[styles.usage, { color: own ? palette.onAccent : palette.secondary }]}>
            {message.usage.model ?? 'Model unknown'}
            {message.usage.total !== undefined ? ` · ${message.usage.total} tokens` : ''}
            {message.usage.avg_tps !== undefined ? ` · ${message.usage.avg_tps} tok/s` : ''}
            {message.usage.avg_latency_s !== undefined ? ` · ${message.usage.avg_latency_s}s` : ''}
          </Text>
        ) : null}
        {failed && onRetry ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Retry sending" onPress={onRetry} style={styles.retry}>
            <Text style={{ color: palette.invalid, fontWeight: '600' }}>Not sent — Retry</Text>
          </Pressable>
        ) : null}
        {own && onEditResend ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Edit and resend message" onPress={() => onEditResend(message.content)} style={styles.retry}>
            <Text style={{ color: palette.onAccent, opacity: 0.8 }}>Edit and resend</Text>
          </Pressable>
        ) : null}
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  ownRow: { alignItems: 'flex-end' },
  botRow: { alignItems: 'flex-start' },
  bubble: { borderRadius: radius.bubble, padding: spacing.md },
  text: { fontSize: fontSize.body, lineHeight: fontSize.body * 1.35 },
  toolLabel: { fontSize: fontSize.metadata, marginBottom: spacing.xs, fontWeight: '600' },
  reasoning: { fontSize: fontSize.caption, marginTop: spacing.sm, fontStyle: 'italic' },
  usage: { fontSize: fontSize.metadata, marginTop: spacing.sm },
  retry: { marginTop: spacing.sm, minHeight: 44, justifyContent: 'center' },
});
