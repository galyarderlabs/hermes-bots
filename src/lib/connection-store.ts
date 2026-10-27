// One active host + one durable gateway client instance.
// Switching hosts closes the old socket first. Per-connection WS tickets
// are minted per connection and never cached long-lived.
import { useSyncExternalStore } from 'react';
import { GatewayClient } from './gateway';
import { turnJournal } from './turn-journal';
import { disconnectHost as authDisconnect, type SavedHost } from './auth';

export type ConnectionStatus = 'idle' | 'checking' | 'online' | 'offline';

export interface ConnectionState {
  activeHost: SavedHost | null;
  status: ConnectionStatus;
  lastProbeAt: number | null;
  lastSyncAt: number | null;
  pendingJournalCount: number;
  gateway: GatewayClient | null;
  error: string | null;
}

const initial: ConnectionState = {
  activeHost: null,
  status: 'idle',
  lastProbeAt: null,
  lastSyncAt: null,
  pendingJournalCount: 0,
  gateway: null,
  error: null,
};

let state: ConnectionState = initial;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function set(patch: Partial<ConnectionState>): void {
  state = { ...state, ...patch };
  emit();
}

export function getConnectionState(): ConnectionState {
  return state;
}

export function useConnection(): ConnectionState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => state,
  );
}

export function setActiveHost(host: SavedHost | null, gateway: GatewayClient | null): void {
  state.gateway?.disconnect();
  set({ activeHost: host, gateway, status: host ? 'checking' : 'idle', error: null });
}

export function setConnectionStatus(status: ConnectionStatus, error: string | null = null): void {
  set({ status, error, lastProbeAt: status === 'checking' ? state.lastProbeAt : Date.now() });
}

export function markSynced(): void {
  set({ lastSyncAt: Date.now(), status: 'online', error: null });
}

export async function refreshPendingCount(): Promise<void> {
  if (!state.activeHost) {
    set({ pendingJournalCount: 0 });
    return;
  }
  const pending = await turnJournal.pendingForHost(state.activeHost.url);
  set({ pendingJournalCount: pending.length });
}

export async function disconnectActiveHost(): Promise<void> {
  if (!state.activeHost) return;
  const host = state.activeHost;
  await authDisconnect(
    host.id,
    () => state.gateway?.disconnect(),
    (h) => turnJournal.clearForHost(h),
  );
  set({ activeHost: null, gateway: null, status: 'idle', pendingJournalCount: 0, error: null });
}
