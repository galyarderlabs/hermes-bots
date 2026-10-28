// ONE durable /api/ws NDJSON JSON-RPC client per host.
// Clean-room implementation from port-spec §5/§6 — no upstream code copied.
// Transport rules honoured here:
//  - one socket per host, not per RPC/prompt
//  - replies routed by id; pushed events routed by session_id (fallback sid)
//  - gateway.ready pinned for the life of the socket (15s open + 15s ready)
//  - RPC 30s default, file.attach 120s, turn wait 10min
//  - NEVER auto-resubmit, even if safe_to_resubmit is true (see turn-journal)
//  - server->client requests are always answered (clarify -> {} if
//    unparseable, unknown -> -32601, handler error -> -32603)

import type { GbotInfo, GatewayInfo } from './types';

export const CONNECT_TIMEOUT_MS = 15_000;
export const READY_TIMEOUT_MS = 15_000;
export const RPC_TIMEOUT_MS = 30_000;
export const FILE_ATTACH_TIMEOUT_MS = 120_000;
export const TURN_WAIT_MS = 10 * 60_000;
export const STATUS_PROBE_TIMEOUT_MS = 10_000;

/** Terminal event types (normative, port-spec §5.2). */
export const TERMINAL_EVENTS = new Set([
  'message.complete',
  'turn.end',
  'turn.error',
  'turn.failed',
  'error',
]);

export function isTerminalEvent(type: string | undefined): boolean {
  return !!type && TERMINAL_EVENTS.has(type);
}

/** Matches the held-elsewhere condition: read-only, not a retryable error. */
export const HELD_ELSEWHERE_RE = /open in another Hermes (window|terminal)/i;

export function isSessionHeldElsewhere(message: string | undefined): boolean {
  return !!message && HELD_ELSEWHERE_RE.test(message);
}

export class GatewayRpcError extends Error {
  method: string;
  code?: number;
  data?: Record<string, unknown>;
  constructor(method: string, message: string, code?: number, data?: Record<string, unknown>) {
    super(message);
    this.name = 'GatewayRpcError';
    this.method = method;
    this.code = code;
    this.data = data;
  }
  get heldElsewhere(): boolean {
    return isSessionHeldElsewhere(this.message);
  }
  /** safe_to_resubmit is honoured by NOT acting on it — resend is explicit only. */
  get safeToResubmit(): boolean {
    return this.data?.safe_to_resubmit === true;
  }
}

export interface PushedEvent {
  type: string;
  payload?: Record<string, unknown>;
  session_id?: string;
  sid?: string;
  turn_id?: string;
  message_id?: number;
  seq?: number;
}

export type ServerRequestHandler = (
  method: string,
  params: unknown,
) => Promise<unknown> | unknown;

export interface GatewayClientOptions {
  /** Called for every pushed event (method 'event'). */
  onEvent?: (event: PushedEvent) => void;
  /** Handles server->client requests other than the built-in clarify rule. */
  onServerRequest?: ServerRequestHandler;
  /** Mint a short-lived single-use WS ticket per connection (never cached). */
  getTicket?: () => Promise<string | null>;
  /**
   * Device credential for the gateway/proxy (SecureStore-backed).
   * The proxy requires device verification on every request (see
   * BUILD-NOTES gateway section); the phone probe sends URL + device
   * token together once a token exists. Before pairing there is no
   * token, so the probe goes out unauthenticated (direct-host path).
   */
  getAuthToken?: () => Promise<string | null> | string | null;
  /** Socket factory (tests inject a fake). Defaults to the global WebSocket. */
  socketFactory?: (url: string) => WebSocketLike;
}

export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
}

/** Split NDJSON input: returns complete frames and the leftover partial line. */
export function splitNdjson(buffer: string, chunk: string): { frames: string[]; rest: string } {
  const combined = buffer + chunk;
  const lines = combined.split('\n');
  const rest = lines.pop() ?? '';
  const frames = lines.map((l) => l.trim()).filter((l) => l.length > 0);
  return { frames, rest };
}

/** Parse clarify questions from server->client clarify params. Empty = unparseable. */
export function parseClarifyQuestions(params: unknown): string[] {
  if (!params || typeof params !== 'object') return [];
  const p = params as Record<string, unknown>;
  const raw = p.questions ?? p.question ?? p.prompts;
  if (typeof raw === 'string') return raw.trim() ? [raw] : [];
  if (Array.isArray(raw)) {
    return raw
      .map((q) => (typeof q === 'string' ? q : (q as Record<string, unknown>)?.text ?? (q as Record<string, unknown>)?.question))
      .filter((q): q is string => typeof q === 'string' && q.trim().length > 0);
  }
  return [];
}

/** Exponential backoff with jitter, capped at 30s. Pure (testable) helper. */
export function backoffDelayMs(attempt: number): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt));
  return base + Math.floor(Math.random() * 500);
}

type PendingRpc = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class GatewayClient {
  readonly baseUrl: string;
  private opts: GatewayClientOptions;
  private socket: WebSocketLike | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRpc>();
  private buffer = '';
  private readyPayload: unknown = null;
  private readyWaiters: Array<{ resolve: (v: unknown) => void; reject: (e: Error) => void }> = [];
  private terminalWaiters = new Map<string, Array<{ resolve: (e: PushedEvent) => void; timer: ReturnType<typeof setTimeout> }>>();
  private closed = false;
  private reconnectAttempt = 0;

  constructor(baseUrl: string, opts: GatewayClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.opts = opts;
  }

  get ready(): unknown {
    return this.readyPayload;
  }

  get isConnected(): boolean {
    return this.socket !== null && !this.closed;
  }

  wsUrl(): string {
    const http = this.baseUrl.replace(/^http/, 'ws');
    return `${http}/api/ws`;
  }

  async connect(): Promise<unknown> {
    this.closed = false;
    const ticket = await this.opts.getTicket?.();
    const url = ticket ? `${this.wsUrl()}?ticket=${encodeURIComponent(ticket)}` : this.wsUrl();
    const factory = this.opts.socketFactory ?? ((u: string) => new WebSocket(u) as unknown as WebSocketLike);
    const socket = factory(url);
    this.socket = socket;
    const openPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Connection timed out while opening the Hermes socket.')), CONNECT_TIMEOUT_MS);
      socket.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Could not connect to Hermes.'));
      };
    });
    const readyPromise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Hermes did not become ready in time.')), READY_TIMEOUT_MS);
      this.readyWaiters.push({
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
    socket.onmessage = (ev) => this.handleRaw(ev.data);
    socket.onclose = () => this.handleClose();
    await openPromise;
    const ready = await readyPromise;
    this.reconnectAttempt = 0;
    return ready;
  }

  /** Reconnect with exponential backoff. Never re-sends a turn. */
  async reconnect(): Promise<unknown> {
    const delay = backoffDelayMs(this.reconnectAttempt);
    this.reconnectAttempt += 1;
    await new Promise((r) => setTimeout(r, delay));
    return this.connect();
  }

  disconnect(): void {
    this.closed = true;
    try {
      this.socket?.close();
    } catch {
      /* already closed */
    }
    this.socket = null;
    const err = new GatewayRpcError('connection', 'connection_closed');
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    for (const waiters of this.terminalWaiters.values()) {
      for (const w of waiters) {
        clearTimeout(w.timer);
        w.resolve({ type: 'error', payload: { message: 'connection_closed' } });
      }
    }
    this.terminalWaiters.clear();
  }

  request(method: string, params: unknown, timeoutMs = RPC_TIMEOUT_MS): Promise<unknown> {
    if (!this.socket) return Promise.reject(new GatewayRpcError(method, 'Not connected to Hermes.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new GatewayRpcError(method, `Hermes did not answer ${method} in time.`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.socket?.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  /** Wait for a terminal event for a session (turn wait up to 10 min). */
  waitForTerminal(sessionId: string, timeoutMs = TURN_WAIT_MS): Promise<PushedEvent> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({ type: 'error', payload: { message: 'Turn timed out — the host may still have finished. Refetch the transcript.' } });
      }, timeoutMs);
      const list = this.terminalWaiters.get(sessionId) ?? [];
      list.push({ resolve, timer });
      this.terminalWaiters.set(sessionId, list);
    });
  }

  interrupt(sessionId: string): Promise<unknown> {
    return this.request('session.interrupt', { session_id: sessionId });
  }

  private handleClose(): void {
    this.socket = null;
    const err = new GatewayRpcError('connection', 'connection_closed');
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  /** Entry point for raw socket data; also used directly by tests. */
  handleRaw(data: string): void {
    const { frames, rest } = splitNdjson(this.buffer, data);
    this.buffer = rest;
    for (const frame of frames) {
      try {
        this.handleFrame(JSON.parse(frame) as Record<string, unknown>);
      } catch {
        // A malformed frame must never kill the socket.
      }
    }
    // A single JSON object sent without a trailing newline is still a frame
    // once the socket delivers it whole; handle it on the next chunk or flush.
    if (this.buffer.trim().startsWith('{')) {
      try {
        const obj = JSON.parse(this.buffer) as Record<string, unknown>;
        this.buffer = '';
        this.handleFrame(obj);
      } catch {
        /* still partial — keep buffering */
      }
    }
  }

  private handleFrame(frame: Record<string, unknown>): void {
    // Reply to one of our requests: id present, no method.
    if (typeof frame.id === 'number' && frame.method === undefined) {
      const pending = this.pending.get(frame.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(frame.id);
      if (frame.error && typeof frame.error === 'object') {
        const e = frame.error as Record<string, unknown>;
        pending.reject(new GatewayRpcError('rpc', String(e.message ?? 'Hermes returned an error.'), typeof e.code === 'number' ? e.code : undefined, e.data as Record<string, unknown> | undefined));
      } else {
        pending.resolve(frame.result);
      }
      return;
    }
    // Server->client request: id AND method together.
    if (typeof frame.id === 'number' && typeof frame.method === 'string') {
      void this.answerServerRequest(frame.id, frame.method, frame.params);
      return;
    }
    // Pushed event.
    if (frame.method === 'event' && frame.params && typeof frame.params === 'object') {
      const params = frame.params as Record<string, unknown>;
      const type = params.type;
      if (typeof type !== 'string') return; // events without a string type are dropped
      const event: PushedEvent = {
        type,
        payload: (params.payload as Record<string, unknown>) ?? {},
        session_id: params.session_id as string | undefined,
        sid: params.sid as string | undefined,
        turn_id: params.turn_id as string | undefined,
        message_id: params.message_id as number | undefined,
        seq: params.seq as number | undefined,
      };
      if (type === 'gateway.ready') {
        // Pin capabilities for the life of the socket; unexpected change
        // fails closed upstream — here we keep the FIRST payload pinned.
        if (this.readyPayload === null) {
          this.readyPayload = params.payload ?? params;
          const waiters = this.readyWaiters;
          this.readyWaiters = [];
          for (const w of waiters) w.resolve(this.readyPayload);
        }
        return;
      }
      if (isTerminalEvent(type)) {
        const sid = event.session_id ?? event.sid;
        if (sid) {
          const waiters = this.terminalWaiters.get(sid) ?? [];
          this.terminalWaiters.delete(sid);
          for (const w of waiters) {
            clearTimeout(w.timer);
            w.resolve(event);
          }
        }
      }
      this.opts.onEvent?.(event);
      return;
    }
  }

  private async answerServerRequest(id: number, method: string, params: unknown): Promise<void> {
    const send = (obj: Record<string, unknown>) => {
      try {
        this.socket?.send(JSON.stringify(obj));
      } catch {
        /* socket gone — nothing to answer on */
      }
    };
    try {
      if (method === 'clarify') {
        const questions = parseClarifyQuestions(params);
        if (questions.length === 0) {
          // Unparseable -> resolve immediately with {} so the host turn
          // is released instead of stalling to the host clarify timeout.
          send({ jsonrpc: '2.0', id, result: {} });
          return;
        }
        if (this.opts.onServerRequest) {
          const result = await this.opts.onServerRequest(method, params);
          send({ jsonrpc: '2.0', id, result });
          return;
        }
        // No UI handler registered: refuse immediately rather than stall.
        send({ jsonrpc: '2.0', id, result: {} });
        return;
      }
      if (this.opts.onServerRequest) {
        const result = await this.opts.onServerRequest(method, params);
        send({ jsonrpc: '2.0', id, result });
        return;
      }
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    } catch {
      send({ jsonrpc: '2.0', id, error: { code: -32603, message: 'Internal error handling server request.' } });
    }
  }

  // ---- REST helpers (all via the gateway/proxy base URL) ----

  private async rest<T>(path: string, init?: RequestInit, timeoutMs = STATUS_PROBE_TIMEOUT_MS): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const token = await this.opts.getAuthToken?.();
      const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers, signal: controller.signal });
      if (!res.ok) throw new Error(`Hermes request failed (${res.status}).`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  probeStatus(): Promise<GatewayInfo> {
    return this.rest<GatewayInfo>('/api/status');
  }

  /** GET /api/gbots — public pairing discovery. No credential yet, so
   * the REST helper sends no Authorization header when getAuthToken
   * returns null. */
  gbotsInfo(): Promise<GbotInfo> {
    return this.rest<GbotInfo>('/api/gbots');
  }

  /** POST /api/pair — exchange a sealed pair request for a per-device
   * credential. Status-mapped errors: 401 means the code is invalid,
   * expired, or already used; 429 means the per-IP attempt limit. */
  async pairRequest(sealed: string): Promise<{ device_id: string; token: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STATUS_PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.baseUrl}/api/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sealed }),
        signal: controller.signal,
      });
      if (res.status === 401) {
        throw new Error('That code is invalid, expired, or already used. Ask the server for a fresh QR.');
      }
      if (res.status === 429) {
        throw new Error('Too many pairing attempts. Wait a minute and try again.');
      }
      if (!res.ok) {
        throw new Error(`Pairing failed (${res.status}).`);
      }
      const data = (await res.json()) as { device_id?: unknown; token?: unknown };
      if (typeof data.device_id !== 'string' || typeof data.token !== 'string') {
        throw new Error('Pairing failed: unexpected server response.');
      }
      return { device_id: data.device_id, token: data.token };
    } finally {
      clearTimeout(timer);
    }
  }

  fetchSessions(): Promise<unknown> {
    return this.rest('/api/profiles/sessions?limit=100&offset=0&min_messages=1&archived=exclude&order=recent&profile=all');
  }

  fetchMessages(sessionId: string, profile: string): Promise<unknown> {
    return this.rest(`/api/sessions/${encodeURIComponent(sessionId)}/messages?profile=${encodeURIComponent(profile)}&limit=120&order=latest&include_compacted=true`);
  }

  fetchModelOptions(profile: string): Promise<unknown> {
    return this.rest(`/api/model/options?explicit_only=1&profile=${encodeURIComponent(profile)}`);
  }

  async transcribe(profile: string, dataUrl: string): Promise<string> {
    const out = await this.rest<{ text?: string; transcript?: string }>(
      `/api/audio/transcribe?profile=${encodeURIComponent(profile)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audio: dataUrl }) },
      RPC_TIMEOUT_MS,
    );
    return out.text ?? out.transcript ?? '';
  }

  cronList(profile?: string): Promise<unknown> {
    return this.request('cron.manage', { action: 'list', include_disabled: true, ...(profile ? { profile } : {}) });
  }

  cronDetail(jobId: string, profile?: string): Promise<unknown> {
    const q = profile ? `?profile=${encodeURIComponent(profile)}` : '';
    return this.rest(`/api/cron/jobs/${encodeURIComponent(jobId)}${q}`);
  }

  cronRuns(jobId: string, profile?: string): Promise<unknown> {
    const q = profile ? `?profile=${encodeURIComponent(profile)}` : '';
    return this.rest(`/api/cron/jobs/${encodeURIComponent(jobId)}/runs${q}`);
  }

  cronTrigger(jobId: string, profile?: string): Promise<unknown> {
    const q = profile ? `?profile=${encodeURIComponent(profile)}` : '';
    return this.rest(`/api/cron/jobs/${encodeURIComponent(jobId)}/trigger${q}`, { method: 'POST' });
  }

  cronCreate(body: Record<string, unknown>, profile?: string): Promise<unknown> {
    const q = profile ? `?profile=${encodeURIComponent(profile)}` : '';
    return this.rest(`/api/cron/jobs${q}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  cronBlueprints(): Promise<unknown> {
    return this.rest('/api/cron/blueprints');
  }

  cronInstantiateBlueprint(body: Record<string, unknown>, profile?: string): Promise<unknown> {
    const q = profile ? `?profile=${encodeURIComponent(profile)}` : '';
    return this.rest(`/api/cron/blueprints/instantiate${q}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  cronDeliveryTargets(): Promise<unknown> {
    return this.rest('/api/cron/delivery-targets');
  }

  cronUpdatePrompt(jobId: string, prompt: string): Promise<unknown> {
    return this.rest(`/api/cron/jobs/${encodeURIComponent(jobId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
  }
}

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof GatewayRpcError && err.heldElsewhere) {
    return 'This chat is open in another Hermes window, so it cannot take a message from this device. Close it there to continue here, or start a new chat with this Bot.';
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
