// Idempotent chat reconciliation (port-spec §4.1 silence watchdog).
// Replay / recovery snapshots must produce the same UI as live events:
// merge by message id, never blindly re-render, duplicates collapse.
import type { LiveMessage } from './types';

export function reconcileMessages(existing: LiveMessage[], incoming: LiveMessage[]): LiveMessage[] {
  const byId = new Map<number, LiveMessage>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) {
    const prev = byId.get(m.id);
    // A later snapshot wins only where it carries more content; a live
    // streaming row is never clobbered by an older empty snapshot.
    if (!prev || m.content.length >= prev.content.length) byId.set(m.id, { ...prev, ...m });
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

export type ChatEvent =
  | { type: 'message.delta'; messageId: number; text: string }
  | { type: 'message.complete'; messageId: number; text: string; usage?: LiveMessage['usage'] }
  | { type: 'tool.start' | 'tool.complete' | 'tool.failed'; messageId: number; toolName: string; summary?: string; duration_s?: number };

/** Append-only delta path: streamed tokens update one row, never the whole thread. */
export function applyChatEvent(messages: LiveMessage[], event: ChatEvent): LiveMessage[] {
  if (event.type === 'message.delta') {
    const prev = messages.find((m) => m.id === event.messageId);
    if (prev) {
      return messages.map((m) => (m.id === event.messageId ? { ...m, content: m.content + event.text } : m));
    }
    return [...messages, { id: event.messageId, role: 'assistant', content: event.text }];
  }
  if (event.type === 'message.complete') {
    const prev = messages.find((m) => m.id === event.messageId);
    if (prev) {
      return messages.map((m) => (m.id === event.messageId ? { ...m, content: event.text, usage: event.usage ?? m.usage } : m));
    }
    return [...messages, { id: event.messageId, role: 'assistant', content: event.text, usage: event.usage }];
  }
  const status = event.type === 'tool.start' ? 'running' : event.type === 'tool.complete' ? 'done' : 'failed';
  const prev = messages.find((m) => m.id === event.messageId);
  const row: LiveMessage = {
    id: event.messageId,
    role: 'tool',
    content: event.summary ?? event.toolName,
    tool_name: event.toolName,
    tool_status: status,
    duration_s: event.duration_s,
  };
  if (prev) return messages.map((m) => (m.id === event.messageId ? { ...m, ...row } : m));
  return [...messages, row];
}
