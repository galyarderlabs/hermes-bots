import { describe, expect, it } from 'vitest';
import { applyChatEvent, reconcileMessages } from '../src/lib/chat-reconcile';
import type { LiveMessage } from '../src/lib/types';

const msg = (id: number, content: string): LiveMessage => ({ id, role: 'assistant', content });

describe('reconcileMessages idempotency', () => {
  it('duplicate snapshots collapse to the same UI', () => {
    const once = reconcileMessages([msg(1, 'hello')], [msg(1, 'hello'), msg(2, 'world')]);
    const twice = reconcileMessages(once, [msg(1, 'hello'), msg(2, 'world')]);
    expect(twice).toEqual(once);
    expect(twice).toHaveLength(2);
  });

  it('out-of-order snapshots sort by id', () => {
    const out = reconcileMessages([], [msg(3, 'c'), msg(1, 'a'), msg(2, 'b')]);
    expect(out.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it('a fuller snapshot wins; an older empty snapshot never clobbers live text', () => {
    const live = reconcileMessages([], [msg(1, 'streaming text so far')]);
    const stale = reconcileMessages(live, [msg(1, '')]);
    expect(stale[0].content).toBe('streaming text so far');
  });
});

describe('applyChatEvent append-only delta path', () => {
  it('appends deltas to one row without touching other rows', () => {
    const start = [msg(1, 'Hello'), msg(2, 'Other')];
    const next = applyChatEvent(start, { type: 'message.delta', messageId: 1, text: ' world' });
    expect(next[0].content).toBe('Hello world');
    expect(next[1]).toBe(start[1]); // untouched reference
  });

  it('message.complete replaces the streaming row with final text', () => {
    const start = [msg(1, 'partial')];
    const next = applyChatEvent(start, { type: 'message.complete', messageId: 1, text: 'final answer' });
    expect(next[0].content).toBe('final answer');
  });

  it('tool events transition running -> done on one row', () => {
    const running = applyChatEvent([], { type: 'tool.start', messageId: 5, toolName: 'search' });
    expect(running[0].tool_status).toBe('running');
    const done = applyChatEvent(running, { type: 'tool.complete', messageId: 5, toolName: 'search', duration_s: 2 });
    expect(done).toHaveLength(1);
    expect(done[0].tool_status).toBe('done');
    expect(done[0].duration_s).toBe(2);
  });
});
