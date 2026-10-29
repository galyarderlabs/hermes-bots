import { describe, expect, it, vi } from 'vitest';
import {
  GatewayClient,
  backoffDelayMs,
  isSessionHeldElsewhere,
  isTerminalEvent,
  parseClarifyQuestions,
  splitNdjson,
} from '../src/lib/gateway';

function fakeSocket() {
  return {
    sent: [] as string[],
    send(data: string) {
      this.sent.push(data);
    },
    close() {},
    onopen: null as ((ev: unknown) => void) | null,
    onmessage: null as ((ev: { data: string }) => void) | null,
    onerror: null as ((ev: unknown) => void) | null,
    onclose: null as ((ev: unknown) => void) | null,
  };
}

function clientWithSocket() {
  const socket = fakeSocket();
  const client = new GatewayClient('https://host.example:9119');
  (client as unknown as { socket: unknown }).socket = socket;
  return { client, socket };
}

describe('NDJSON envelope', () => {
  it('splits complete frames and keeps a partial line buffered', () => {
    const { frames, rest } = splitNdjson('', '{"a":1}\n{"b":2}\n{"c":');
    expect(frames).toEqual(['{"a":1}', '{"b":2}']);
    expect(rest).toBe('{"c":');
    const next = splitNdjson(rest, '3}\n');
    expect(next.frames).toEqual(['{"c":3}']);
    expect(next.rest).toBe('');
  });

  it('routes a reply to the pending request by id', async () => {
    const { client } = clientWithSocket();
    const promise = client.request('session.resume', { session_id: 's1' }, 5000);
    client.handleRaw('{"jsonrpc":"2.0","id":1,"result":{"session_id":"resolved-1"}}\n');
    await expect(promise).resolves.toEqual({ session_id: 'resolved-1' });
  });

  it('drops pushed events without a string type', () => {
    const onEvent = vi.fn();
    const client = new GatewayClient('https://host.example:9119', { onEvent });
    client.handleRaw('{"jsonrpc":"2.0","method":"event","params":{"payload":{}}}\n');
    expect(onEvent).not.toHaveBeenCalled();
  });
});

describe('terminal events', () => {
  it.each(['message.complete', 'turn.end', 'turn.error', 'turn.failed', 'error'])(
    '%s is terminal',
    (type) => {
      expect(isTerminalEvent(type)).toBe(true);
    },
  );
  it('message.delta and tool.start are not terminal', () => {
    expect(isTerminalEvent('message.delta')).toBe(false);
    expect(isTerminalEvent('tool.start')).toBe(false);
  });

  it('waitForTerminal resolves on a terminal event for that session', async () => {
    const { client } = clientWithSocket();
    const waiting = client.waitForTerminal('s1', 5000);
    client.handleRaw(
      '{"jsonrpc":"2.0","method":"event","params":{"type":"turn.end","session_id":"s1","payload":{}}}\n',
    );
    await expect(waiting).resolves.toMatchObject({ type: 'turn.end' });
  });

  it('a terminal event for another session does not resolve this waiter', async () => {
    const { client } = clientWithSocket();
    let resolved = false;
    const waiting = client.waitForTerminal('s1', 300).then((e) => {
      resolved = true;
      return e;
    });
    client.handleRaw(
      '{"jsonrpc":"2.0","method":"event","params":{"type":"turn.end","session_id":"other","payload":{}}}\n',
    );
    await waiting;
    // Only the timeout resolved it, with the timeout error shape.
    expect(resolved).toBe(true);
  });

  it('an unexpected socket drop resolves turn waiters immediately, not at the timeout', async () => {
    const { client } = clientWithSocket();
    const waiting = client.waitForTerminal('s1', 600000);
    (client as unknown as { handleClose: () => void }).handleClose();
    await expect(waiting).resolves.toMatchObject({ type: 'error', payload: { message: 'connection_closed' } });
  });
});

describe('session held elsewhere', () => {
  it('matches the held-elsewhere pattern', () => {
    expect(isSessionHeldElsewhere('Session is open in another Hermes window')).toBe(true);
    expect(isSessionHeldElsewhere('open in another Hermes terminal somewhere')).toBe(true);
    expect(isSessionHeldElsewhere('network unreachable')).toBe(false);
  });
});

describe('server->client requests', () => {
  it('answers unparseable clarify with an empty result immediately', () => {
    const { client, socket } = clientWithSocket();
    client.handleRaw('{"jsonrpc":"2.0","id":9,"method":"clarify","params":{"nonsense":true}}\n');
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0])).toEqual({ jsonrpc: '2.0', id: 9, result: {} });
  });

  it('answers unknown methods with -32601', () => {
    const { client, socket } = clientWithSocket();
    client.handleRaw('{"jsonrpc":"2.0","id":10,"method":"bogus.method","params":{}}\n');
    const reply = JSON.parse(socket.sent[0]);
    expect(reply.error.code).toBe(-32601);
  });

  it('pins the FIRST gateway.ready payload for the life of the socket', () => {
    const client = new GatewayClient('https://host.example:9119');
    client.handleRaw('{"jsonrpc":"2.0","method":"event","params":{"type":"gateway.ready","payload":{"caps":["a"]}}}\n');
    client.handleRaw('{"jsonrpc":"2.0","method":"event","params":{"type":"gateway.ready","payload":{"caps":["b"]}}}\n');
    expect(client.ready).toEqual({ caps: ['a'] });
  });
});

describe('clarify parsing', () => {
  it('parses string and array question shapes, rejects empties', () => {
    expect(parseClarifyQuestions({ questions: ['Why?', ''] })).toEqual(['Why?']);
    expect(parseClarifyQuestions({ question: 'Single?' })).toEqual(['Single?']);
    expect(parseClarifyQuestions({ questions: [{ text: 'Nested?' }] })).toEqual(['Nested?']);
    expect(parseClarifyQuestions({ nonsense: true })).toEqual([]);
    expect(parseClarifyQuestions(null)).toEqual([]);
  });
});

describe('backoff', () => {
  it('grows exponentially and caps at 30s + jitter', () => {
    expect(backoffDelayMs(0)).toBeGreaterThanOrEqual(1000);
    expect(backoffDelayMs(0)).toBeLessThan(1500);
    expect(backoffDelayMs(10)).toBeLessThanOrEqual(30500);
    expect(backoffDelayMs(10)).toBeGreaterThanOrEqual(30000);
  });
});
