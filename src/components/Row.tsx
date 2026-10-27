// ONE shared row component for Bots, Sessions and Tasks — do not build
// three row implementations. Variants differ in copy/meta only.
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/theme-context';
import { fontSize, spacing } from '../theme/tokens';
import { GlassAvatar, GlassAvatarGroup } from './glassyui/GlassAvatar';

export type RowVariant = 'bot' | 'session' | 'task' | 'group';

export const Row = memo(function Row({
  title,
  preview,
  time,
  unread = false,
  avatarName,
  avatarImage,
  groupMembers,
  badge,
  onPress,
  onLongPress,
}: {
  title: string;
  preview: string;
  time?: string;
  unread?: boolean;
  avatarName?: string;
  avatarImage?: string | null;
  groupMembers?: string[];
  badge?: string;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const { palette } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${preview}`}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.row, { borderBottomColor: palette.border }]}
    >
      {groupMembers ? (
        <GlassAvatarGroup names={groupMembers} />
      ) : (
        <GlassAvatar name={avatarName ?? title} image={avatarImage} size={40} />
      )}
      <View style={styles.copy}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
            {title}
          </Text>
          {time ? <Text style={[styles.time, { color: palette.secondary }]}>{time}</Text> : null}
        </View>
        <Text style={[styles.preview, { color: palette.secondary, fontWeight: unread ? '600' : '400' }]} numberOfLines={1}>
          {preview}
        </Text>
        {badge ? <Text style={[styles.badge, { color: palette.secondary }]}>{badge}</Text> : null}
      </View>
      {unread ? <View accessibilityLabel="Unread" style={[styles.dot, { backgroundColor: palette.accent }]} /> : null}
    </Pressable>
  );
});

export const BotRow = Row;
export const SessionRow = Row;
export const TaskRow = Row;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, minHeight: 64 },
  copy: { flex: 1 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  title: { fontSize: fontSize.body, fontWeight: '600', flex: 1 },
  time: { fontSize: fontSize.metadata },
  preview: { fontSize: fontSize.secondary, marginTop: 2 },
  badge: { fontSize: fontSize.metadata, marginTop: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
