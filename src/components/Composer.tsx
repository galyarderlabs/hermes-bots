// Glass composer bar: textarea + attach + send. Send disabled on
// empty/whitespace. Attach chips keep order with retry/remove.
// Slash completion via complete.slash; voice = tap for review card,
// ~2.5s hold to send (hold gesture wired by the caller through
// onVoiceTap / onVoiceHold — the hold timer lives here).
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/theme-context';
import { fontSize, radius, spacing } from '../theme/tokens';
import { GlassTextarea } from './glassyui/GlassTextarea';
import { GlassSurface } from './glassyui/GlassSurface';
import { GlassBackdrop } from './glassyui/GlassBackdrop';
import type { Attachment } from '../lib/attachment-routing';
import { attachmentSendBlocker } from '../lib/attachment-routing';

export function Composer({
  draft,
  onDraftChange,
  onSend,
  onStop,
  sending,
  attachments,
  onRemoveAttachment,
  onRetryAttachment,
  onAttach,
  onVoiceTap,
  onVoiceHold,
  slashItems,
  onSlashSelect,
  modelLabel,
}: {
  draft: string;
  onDraftChange: (t: string) => void;
  onSend: () => void;
  onStop: () => void;
  sending: boolean;
  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;
  onRetryAttachment: (id: string) => void;
  onAttach: () => void;
  onVoiceTap: () => void;
  onVoiceHold: () => void;
  slashItems: { label: string; replaceFrom: number; insert: string }[];
  onSlashSelect: (item: { replaceFrom: number; insert: string }) => void;
  modelLabel?: string;
}) {
  const { palette } = useTheme();
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [holding, setHolding] = useState(false);
  const blocker = attachmentSendBlocker(attachments);
  const canSend = draft.trim().length > 0 && !blocker && !sending;

  const startHold = () => {
    setHolding(true);
    holdTimer.current = setTimeout(() => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onVoiceHold();
      setHolding(false);
    }, 2500);
  };
  const endHold = (fired: boolean) => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    if (holding && !fired) onVoiceTap();
    setHolding(false);
  };

  return (
    <GlassBackdrop>
      <GlassSurface borderRadius={radius.composer} style={styles.bar}>
        <View style={styles.row}>
          <Pressable accessibilityRole="button" accessibilityLabel="Attach file" onPress={onAttach} style={styles.iconBtn}>
            <Text style={[styles.icon, { color: palette.accent }]}>+</Text>
          </Pressable>
          <GlassTextarea
            value={draft}
            onChangeText={onDraftChange}
            placeholder="Message…"
            accessibilityLabel="Message"
            style={{ flex: 1, maxHeight: 160 }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Voice input. Tap to dictate and review, hold about 2.5 seconds to dictate and send."
            onPressIn={startHold}
            onPressOut={() => endHold(false)}
            style={styles.iconBtn}
          >
            <Ionicons name="mic-outline" size={22} color={holding ? palette.invalid : palette.accent} />
          </Pressable>
          {sending ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Stop generating" onPress={onStop} style={[styles.sendBtn, { backgroundColor: palette.invalid }]}>
              <Text style={[styles.sendText, { color: palette.onAccent }]}>Stop</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              disabled={!canSend}
              onPress={onSend}
              style={[styles.sendBtn, { backgroundColor: palette.prominentFill, opacity: canSend ? 1 : 0.5 }]}
            >
              <Text style={[styles.sendText, { color: palette.onAccent }]}>↑</Text>
            </Pressable>
          )}
        </View>
        {attachments.length > 0 ? (
          <View style={styles.chips}>
            {attachments.map((a) => (
              <View key={a.localId} style={[styles.chip, { backgroundColor: palette.bg, borderColor: a.status === 'failed' ? palette.invalid : palette.border }]}>
                <Text style={[styles.chipText, { color: palette.text }]} numberOfLines={1}>
                  {a.name} · {a.status}
                </Text>
                {a.status === 'failed' ? (
                  <Pressable accessibilityLabel={`Retry attachment ${a.name}`} onPress={() => onRetryAttachment(a.localId)}>
                    <Text style={{ color: palette.accent }}>Retry</Text>
                  </Pressable>
                ) : null}
                <Pressable accessibilityLabel={`Remove attachment ${a.name}`} onPress={() => onRemoveAttachment(a.localId)}>
                  <Text style={{ color: palette.secondary }}>×</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
        {blocker ? <Text style={[styles.blocker, { color: palette.invalid }]}>{blocker}</Text> : null}
        {slashItems.length > 0 ? (
          <View style={styles.slashList}>
            {slashItems.map((item) => (
              <Pressable key={item.label} accessibilityRole="button" accessibilityLabel={`Insert ${item.label}`} onPress={() => onSlashSelect(item)} style={styles.slashItem}>
                <Text style={{ color: palette.text }}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {modelLabel ? <Text style={[styles.modelLabel, { color: palette.secondary }]}>{modelLabel}</Text> : null}
        {holding ? <Text style={[styles.modelLabel, { color: palette.invalid }]}>Hold to send — release to send now</Text> : null}
      </GlassSurface>
    </GlassBackdrop>
  );
}

const styles = StyleSheet.create({
  bar: { margin: spacing.md, padding: spacing.md },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  iconBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 22 },
  sendBtn: { minWidth: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  sendText: { fontWeight: '700', fontSize: fontSize.body },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  chip: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', borderWidth: 1, borderRadius: radius.badge, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, maxWidth: '100%' },
  chipText: { fontSize: fontSize.caption, maxWidth: 160 },
  blocker: { fontSize: fontSize.caption, marginTop: spacing.sm },
  slashList: { marginTop: spacing.sm, gap: spacing.xs },
  slashItem: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md },
  modelLabel: { fontSize: fontSize.metadata, marginTop: spacing.sm },
});
