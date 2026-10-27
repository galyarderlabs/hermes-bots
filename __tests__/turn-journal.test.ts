import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}));

import { TurnJournal, digestIntent, type JournalStorage } from '../src/lib/turn-journal';

function memoryStorage(): JournalStorage & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: async (k) => store.get(k) ?? null,
    setItem: async (k, v) => {
      store.set(k, v);
    },
    removeItem: async (k) => {
      store.delete(k);
    },
  };
}

describe('turn journal', () => {
  it('persists intent with client_turn_id, seq and digest before any submit', async () => {
    const journal = new TurnJournal(memoryStorage());
    const entry = await journal.persistIntent({
      session_id: 's1',
      host: 'https://host.example:9119',
      text: 'hello',
      ref_texts: ['[file:a]'],
      seq: 7,
    });
    expect(entry.client_turn_id).toMatch(/^turn_/);
    expect(entry.seq).toBe(7);
    expect(entry.digest).toBe(digestIntent('hello', ['[file:a]']));
    expect(entry.status).toBe('pending');
    const pending = await journal.pendingForHost('https://host.example:9119');
    expect(pending).toHaveLength(1);
  });

  it('journal write failure means the intent is NOT stored — caller sends zero prompts', async () => {
    const failing: JournalStorage = {
      getItem: async () => null,
      setItem: async () => {
        throw new Error('disk full');
      },
      removeItem: async () => {},
    };
    const journal = new TurnJournal(failing);
    await expect(
      journal.persistIntent({ session_id: 's1', host: 'h', text: 'hi', ref_texts: [], seq: 1 }),
    ).rejects.toThrow('disk full');
    // Nothing was persisted, so there is nothing to resend.
    expect(await journal.pendingForHost('h')).toEqual([]);
  });

  it('never auto-resends: resend returns the intent for an EXPLICIT user action only', async () => {
    const journal = new TurnJournal(memoryStorage());
    const entry = await journal.persistIntent({ session_id: 's1', host: 'h', text: 'hi', ref_texts: [], seq: 1 });
    // No background step changed the intent: it is still pending.
    expect((await journal.pendingForHost('h')).map((i) => i.client_turn_id)).toEqual([entry.client_turn_id]);
    const explicit = await journal.resendIntent(entry.client_turn_id);
    expect(explicit?.text).toBe('hi');
    // And it is still pending afterwards — resendIntent itself sends nothing.
    expect((await journal.pendingForHost('h'))).toHaveLength(1);
  });

  it('disconnect clears pending intents for that host only', async () => {
    const journal = new TurnJournal(memoryStorage());
    await journal.persistIntent({ session_id: 's1', host: 'h1', text: 'a', ref_texts: [], seq: 1 });
    await journal.persistIntent({ session_id: 's2', host: 'h2', text: 'b', ref_texts: [], seq: 1 });
    await journal.clearForHost('h1');
    expect(await journal.pendingForHost('h1')).toEqual([]);
    expect(await journal.pendingForHost('h2')).toHaveLength(1);
  });

  it('digest is deterministic for the same text + refs', () => {
    expect(digestIntent('a', ['x'])).toBe(digestIntent('a', ['x']));
    expect(digestIntent('a', ['x'])).not.toBe(digestIntent('a', ['y']));
  });
});
