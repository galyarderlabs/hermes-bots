import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useConnection } from '../../src/lib/connection-store';
import { useTheme } from '../../src/theme/theme-context';
import { ChatThread } from '../../src/components/ChatThread';
import { Composer } from '../../src/components/Composer';
import { ConnectionBanner } from '../../src/components/ConnectionBanner';
import { GlassAlert } from '../../src/components/glassyui/GlassAlert';
import { GlassSpinner } from '../../src/components/glassyui/GlassSpinner';
import { turnJournal } from '../../src/lib/turn-journal';
import { applyChatEvent, reconcileMessages } from '../../src/lib/chat-reconcile';
import { buildPromptText, type Attachment } from '../../src/lib/attachment-routing';
import { errorMessage, isSessionHeldElsewhere, isTerminalEvent, type PushedEvent } from '../../src/lib/gateway';
import type { LiveMessage } from '../../src/lib/types';
import { fontSize, spacing } from '../../src/theme/tokens';

const TURN_SILENCE_MS = 60_000;

export default function ChatScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { gateway, activeHost, status } = useConnection();
  const { palette } = useTheme();
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [streaming, setStreaming] = useState('');
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [heldMessage, setHeldMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [slashItems, setSlashItems] = useState<{ label: string; replaceFrom: number; insert: string }[]>([]);
  const [modelOverride, setModelOverride] = useState<string | null>(null);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameQueued = useRef(false);
  const pendingDelta = useRef('');

  const resetSilenceTimer = useCallback(() => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = setTimeout(() => {
      // Silence watchdog: refetch the host transcript and reconcile.
      void (async () => {
        if (!gateway || !activeHost) return;
        try {
          const res = (await gateway.fetchMessages(sessionId, '')) as { messages?: LiveMessage[] };
          const incoming = res.messages ?? [];
          setMessages((prev) => reconcileMessages(prev, incoming));
        } catch {
          /* watchdog refetch failure is non-fatal; the turn waiter still runs */
        }
      })();
    }, TURN_SILENCE_MS);
  }, [gateway, activeHost, sessionId]);

  // Live event routing for this session + transcript load.
  useEffect(() => {
    if (!gateway) return;
    let alive = true;
    gateway
      .request('session.resume', { session_id: sessionId })
      .then((res) => {
        const resolved = (res as { session_id?: string }).session_id;
        return gateway.fetchMessages(resolved ?? sessionId, '');
      })
      .then((res) => {
        const list = (res as { messages?: LiveMessage[] }).messages ?? [];
        if (alive) setMessages(list);
      })
      .catch((e: unknown) => {
        if (alive) {
          if (e instanceof Error && isSessionHeldElsewhere(e.message)) {
            setReadOnly(true);
            setHeldMessage(errorMessage(e, ''));
          } else if (alive) setError(errorMessage(e, 'Could not load this Hermes conversation.'));
        }
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [gateway, sessionId]);

  // Subscribe to pushed events via a fresh gateway client option is not
  // possible post-construction, so this screen relies on the connection
  // store's client onEvent wiring (set at connect time in settings).
  // The handler below is registered through the global event bus below.
  useEffect(() => {
    const handler = (event: PushedEvent) => {
      const sid = event.session_id ?? event.sid;
      if (sid && sid !== sessionId) return;
      resetSilenceTimer();
      if (event.type === 'message.delta') {
        const text = String((event.payload?.text as string) ?? '');
        pendingDelta.current += text;
        if (!frameQueued.current) {
          frameQueued.current = true;
          requestAnimationFrame(() => {
            frameQueued.current = false;
            const chunk = pendingDelta.current;
            pendingDelta.current = '';
            setStreaming((prev) => prev + chunk);
          });
        }
        return;
      }
      if (event.type === 'message.complete') {
        const text = String((event.payload?.text as string) ?? '');
        setStreaming('');
        setMessages((prev) =>
          applyChatEvent(prev, { type: 'message.complete', messageId: event.message_id ?? Date.now(), text }),
        );
        setSending(false);
        return;
      }
      if (isTerminalEvent(event.type)) {
        setStreaming('');
        setSending(false);
        return;
      }
      if (event.type.startsWith('tool.')) {
        const name = String((event.payload?.name as string) ?? (event.payload?.tool_id as string) ?? 'Tool');
        setMessages((prev) =>
          applyChatEvent(prev, {
            type: event.type === 'tool.failed' ? 'tool.failed' : event.type === 'tool.complete' ? 'tool.complete' : 'tool.start',
            messageId: event.message_id ?? Date.now(),
            toolName: name,
            summary: (event.payload?.summary as string) ?? undefined,
            duration_s: event.payload?.duration_s as number | undefined,
          }),
        );
      }
    };
    chatEventBus.add(handler);
    return () => { chatEventBus.delete(handler); };
  }, [sessionId, resetSilenceTimer]);

  const send = useCallback(async () => {
    if (!gateway || !activeHost || sending) return;
    const fullText = buildPromptText(draft, attachments);
    if (!fullText.trim()) return;
    // 1. Persist intent BEFORE submit. Write failure => send zero prompts.
    let intent;
    try {
      intent = await turnJournal.persistIntent({
        session_id: sessionId,
        host: activeHost.url,
        text: draft,
        ref_texts: attachments.filter((a) => a.refText).map((a) => a.refText!),
        seq: Date.now(),
      });
    } catch {
      setError('Could not save this message before sending, so it was not sent. Try again.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      // 2. Attachments first, sequentially, order preserved.
      const refs: string[] = [];
      for (const att of attachments) {
        const res = (await gateway.request(
          'file.attach',
          { session_id: sessionId, name: att.name, data_url: att.dataUrl },
          120_000,
        )) as { attached?: boolean; ref_text?: string };
        if (res.attached !== true || !res.ref_text) throw new Error(`Attachment ${att.name} could not be attached.`);
        refs.push(res.ref_text);
      }
      const text = buildPromptText(draft, attachments.map((a, i) => ({ ...a, refText: refs[i] ?? a.refText })));
      await gateway.request('session.resume', { session_id: sessionId });
      await gateway.request('prompt.submit', { session_id: sessionId, text });
      await turnJournal.associate(intent.client_turn_id, { status: 'accepted' });
      setMessages((prev) => [...prev, { id: Date.now(), role: 'user', content: text }]);
      setDraft('');
      setAttachments([]);
      resetSilenceTimer();
      // 3. prompt.submit is acceptance only — completion is terminal events.
      const terminal = await gateway.waitForTerminal(sessionId);
      if (terminal.type === 'turn.error' || terminal.type === 'turn.failed' || terminal.type === 'error') {
        setError(String((terminal.payload?.message as string) ?? 'The turn failed. Nothing was retried automatically.'));
      }
      await turnJournal.associate(intent.client_turn_id, { status: 'done' });
    } catch (e) {
      setError(errorMessage(e, 'Could not send to Hermes.'));
      setSending(false);
    }
  }, [gateway, activeHost, sending, draft, attachments, sessionId, resetSilenceTimer]);

  const stop = useCallback(() => {
    if (!gateway) return;
    void gateway.interrupt(sessionId);
    setSending(false);
    setStreaming('');
  }, [gateway, sessionId]);

  const onDraftChange = useCallback(
    (text: string) => {
      setDraft(text);
      const lastSlash = text.lastIndexOf('/');
      if (lastSlash >= 0 && gateway) {
        void gateway
          .request('complete.slash', { session_id: sessionId, profile: '', text: text.slice(lastSlash) })
          .then((res) => {
            const items = (res as { items?: { label?: string; name?: string; insert?: string }[]; replace_from?: number }).items ?? [];
            setSlashItems(
              items.map((it) => ({ label: it.label ?? it.name ?? '', replaceFrom: (res as { replace_from?: number }).replace_from ?? lastSlash, insert: it.insert ?? it.label ?? '' })),
            );
          })
          .catch(() => setSlashItems([]));
      } else setSlashItems([]);
    },
    [gateway, sessionId],
  );

  return (
    <View style={[styles.wrap, { backgroundColor: palette.bg }]}>
      <Stack.Screen options={{ title: 'Chat' }} />
      <ConnectionBanner onRetry={() => {}} />
      {readOnly && heldMessage ? <GlassAlert tone="warning" message={heldMessage} /> : null}
      {error ? <GlassAlert tone="error" message={error} /> : null}
      {loading ? (
        <View style={styles.loading}>
          <GlassSpinner label="Loading conversation" />
        </View>
      ) : messages.length === 0 && !streaming ? (
        <View style={styles.loading}>
          <Text style={[styles.empty, { color: palette.secondary }]}>No messages yet</Text>
        </View>
      ) : (
        <ChatThread messages={messages} streamingText={streaming} onEditResend={(text) => setDraft(text)} />
      )}
      {readOnly ? (
        <GlassAlert tone="warning" message="Read-only: this chat is held elsewhere." />
      ) : (
        <Composer
          draft={draft}
          onDraftChange={onDraftChange}
          onSend={send}
          onStop={stop}
          sending={sending}
          attachments={attachments}
          onRemoveAttachment={(id) => setAttachments((prev) => prev.filter((a) => a.localId !== id))}
          onRetryAttachment={(id) => setAttachments((prev) => prev.map((a) => (a.localId === id ? { ...a, status: 'pending' as const } : a)))}
          onAttach={() => setError('Attachment picking needs a file picker grant — attach from your device files in a later build.')}
          onVoiceTap={() => setDraft((prev) => `${prev} [voice transcription — edit before sending]`)}
          onVoiceHold={() => {
            setDraft((prev) => `${prev} [voice transcription]`);
            void send();
          }}
          slashItems={slashItems}
          onSlashSelect={(item) => {
            setDraft((prev) => prev.slice(0, item.replaceFrom) + item.insert);
            setSlashItems([]);
          }}
          modelLabel={modelOverride ? `Session override — set in the composer: ${modelOverride}` : 'Using this Bot’s default model'}
        />
      )}
      {status === 'offline' ? <Text style={[styles.offline, { color: palette.secondary }]}>Hermes unavailable — sending is disabled.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { fontSize: fontSize.body },
  offline: { fontSize: fontSize.caption, textAlign: 'center', paddingBottom: spacing.md },
});

// In-process event bus: the connection store's gateway client forwards
// pushed events here so any mounted chat screen can consume them without
// a second socket. One socket per host is preserved.
export const chatEventBus = new Set<(event: PushedEvent) => void>();
export function forwardChatEvent(event: PushedEvent): void {
  for (const h of chatEventBus) h(event);
}
