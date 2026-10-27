// Turn journal (port-spec §8, required not optional).
// The intent is persisted BEFORE prompt.submit. Journal write failure
// means zero prompts are sent — the caller must abort the send.
// NEVER auto-resend: resend is an explicit user action via resendIntent().
// Storage is durable AsyncStorage — NOT the credential store.
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface TurnIntent {
  client_turn_id: string;
  turn_id?: string;
  message_id?: number;
  session_id: string;
  host: string;
  text: string;
  ref_texts: string[];
  seq: number;
  digest: string;
  created_at: number;
  status: 'pending' | 'accepted' | 'done' | 'failed';
}

export interface JournalStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const JOURNAL_KEY = 'hermes.turn-journal.v1';

/** Small deterministic digest (FNV-1a) — identity, not security. */
export function digestIntent(text: string, refTexts: string[]): string {
  const input = `${text}\n${refTexts.join('\n')}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function newClientTurnId(): string {
  return `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export class TurnJournal {
  private storage: JournalStorage;
  constructor(storage: JournalStorage = AsyncStorage) {
    this.storage = storage;
  }

  private async load(): Promise<TurnIntent[]> {
    const raw = await this.storage.getItem(JOURNAL_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as TurnIntent[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async save(intents: TurnIntent[]): Promise<void> {
    await this.storage.setItem(JOURNAL_KEY, JSON.stringify(intents));
  }

  /** Persist BEFORE submit. Throws on failure — caller must send nothing. */
  async persistIntent(intent: Omit<TurnIntent, 'client_turn_id' | 'digest' | 'created_at' | 'status'>): Promise<TurnIntent> {
    const entry: TurnIntent = {
      ...intent,
      client_turn_id: newClientTurnId(),
      digest: digestIntent(intent.text, intent.ref_texts),
      created_at: Date.now(),
      status: 'pending',
    };
    const intents = await this.load();
    intents.push(entry);
    await this.save(intents); // throws => no submit may follow
    return entry;
  }

  async associate(clientTurnId: string, patch: Partial<Pick<TurnIntent, 'turn_id' | 'message_id' | 'seq' | 'status'>>): Promise<void> {
    const intents = await this.load();
    const found = intents.find((i) => i.client_turn_id === clientTurnId);
    if (found) Object.assign(found, patch);
    await this.save(intents);
  }

  async pendingForHost(host: string): Promise<TurnIntent[]> {
    return (await this.load()).filter((i) => i.host === host && i.status === 'pending');
  }

  async pendingForSession(sessionId: string): Promise<TurnIntent[]> {
    return (await this.load()).filter((i) => i.session_id === sessionId && i.status === 'pending');
  }

  /** Explicit user action only. Never called automatically on reconnect. */
  async resendIntent(clientTurnId: string): Promise<TurnIntent | null> {
    const intents = await this.load();
    return intents.find((i) => i.client_turn_id === clientTurnId) ?? null;
  }

  async clearForHost(host: string): Promise<void> {
    const intents = await this.load();
    await this.save(intents.filter((i) => i.host !== host));
  }
}

export const turnJournal = new TurnJournal();
