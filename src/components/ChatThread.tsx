// Virtualised thread (FlashList). The streaming bubble is isolated: it
// subscribes to the token stream via its own component so streamed tokens
// do not re-render the whole thread. Updates coalesce to one per frame —
// the caller batches deltas with requestAnimationFrame before setState.
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useTheme } from '../theme/theme-context';
import { fontSize, spacing } from '../theme/tokens';
import type { LiveMessage } from '../lib/types';
import { MessageBubble } from './MessageBubble';

export const StreamingBubble = memo(function StreamingBubble({ text }: { text: string }) {
  const { palette } = useTheme();
  return (
    <View style={[styles.streamRow, { paddingHorizontal: spacing.lg }]}>
      <View style={[styles.streamBubble, { backgroundColor: palette.tile }]}>
        <Text style={[styles.streamText, { color: palette.text }]}>{text}▍</Text>
      </View>
    </View>
  );
});

export function ChatThread({
  messages,
  streamingText,
  onEditResend,
}: {
  messages: LiveMessage[];
  streamingText: string;
  onEditResend: (text: string) => void;
}) {
  const { palette } = useTheme();
  const listRef = useRef<FlashListRef<LiveMessage>>(null);
  const [following, setFollowing] = useState(true);
  const [unread, setUnread] = useState(0);
  const prevLen = useRef(messages.length);

  useEffect(() => {
    if (messages.length > prevLen.current) {
      if (following) listRef.current?.scrollToEnd({ animated: true });
      else setUnread((u) => u + (messages.length - prevLen.current));
    }
    prevLen.current = messages.length;
  }, [messages.length, following]);

  const renderItem = useCallback(
    ({ item }: { item: LiveMessage }) => <MessageBubble message={item} onEditResend={onEditResend} />,
    [onEditResend],
  );

  return (
    <View style={{ flex: 1 }}>
      <FlashList
        ref={listRef}
        data={messages}
        renderItem={renderItem}
        keyExtractor={(m) => String(m.id)}
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          const nearBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 120;
          setFollowing(nearBottom);
        }}
        ListFooterComponent={streamingText ? <StreamingBubble text={streamingText} /> : null}
      />
      {!following ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Jump to latest messages"
          onPress={() => {
            setFollowing(true);
            setUnread(0);
            listRef.current?.scrollToEnd({ animated: true });
          }}
          style={[styles.latestPill, { backgroundColor: palette.accent }]}
        >
          <Text style={[styles.latestText, { color: palette.onAccent }]}>↓ Latest{unread > 0 ? ` (${unread})` : ''}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  streamRow: { alignItems: 'flex-start', paddingVertical: spacing.xs },
  streamBubble: { borderRadius: 20, borderBottomLeftRadius: 6, padding: spacing.md, maxWidth: '80%' },
  streamText: { fontSize: fontSize.body, lineHeight: fontSize.body * 1.35 },
  latestPill: { position: 'absolute', bottom: 16, alignSelf: 'center', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  latestText: { fontWeight: '600' },
});
