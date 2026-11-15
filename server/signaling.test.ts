import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerSignalMessage } from '../shared/transfer.ts';
import { attachSignalingServer } from './signaling.ts';

function waitForMessage(ws: WebSocket): Promise<ServerSignalMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for message')), 3000);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()) as ServerSignalMessage);
    });
  });
}

function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/signal`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

describe('signaling server', () => {
  const servers: http.Server[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const s of sockets) {
      if (s.readyState === WebSocket.OPEN) s.close();
    }
    sockets.length = 0;
    await Promise.all(
      servers.map(
        (srv) =>
          new Promise<void>((resolve) => {
            srv.close(() => resolve());
          })
      )
    );
    servers.length = 0;
  });

  async function setup(options = {}) {
    const server = http.createServer();
    const { wss, service } = attachSignalingServer(server, options);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Invalid address');
    servers.push(server);
    return { port: address.port, wss, service };
  }

  it('creates a room, hashes session token with SHA-256, and pairs directly with token', async () => {
    const { port, service } = await setup();
    const host = await connectClient(port);
    const guest = await connectClient(port);
    sockets.push(host, guest);

    const hostMsgPromise = waitForMessage(host);
    host.send(JSON.stringify({ type: 'create', deviceName: 'Laptop' }));
    const created = await hostMsgPromise;

    expect(created.type).toBe('room-created');
    if (created.type !== 'room-created') throw new Error('Expected room-created');

    // Stored hash must not equal raw token
    const storedHash = service.getRoomTokenHashForTesting(created.code);
    expect(storedHash).toBeTruthy();
    expect(storedHash).not.toBe(created.token);
    expect(storedHash).toHaveLength(64);

    const hostPaired = waitForMessage(host);
    const guestPaired = waitForMessage(guest);
    guest.send(
      JSON.stringify({
        type: 'join',
        code: created.code,
        token: created.token,
        deviceName: 'Telefon',
      })
    );

    const [hMsg, gMsg] = await Promise.all([hostPaired, guestPaired]);
    expect(hMsg.type).toBe('paired');
    expect(gMsg.type).toBe('paired');
  });

  it('requires host approval when joining with manual 6-char room code only', async () => {
    const { port } = await setup();
    const host = await connectClient(port);
    const guest = await connectClient(port);
    sockets.push(host, guest);

    host.send(JSON.stringify({ type: 'create' }));
    const created = await waitForMessage(host);
    if (created.type !== 'room-created') throw new Error('Expected room-created');

    const hostReqPromise = waitForMessage(host);
    const guestPendingPromise = waitForMessage(guest);
    guest.send(JSON.stringify({ type: 'join', code: created.code, deviceName: 'Tablet' }));

    const [hostReq, guestPending] = await Promise.all([hostReqPromise, guestPendingPromise]);
    expect(guestPending.type).toBe('pair-pending');
    expect(hostReq.type).toBe('pair-request');
    if (hostReq.type !== 'pair-request') throw new Error('Expected pair-request');

    const hostPaired = waitForMessage(host);
    const guestPaired = waitForMessage(guest);
    host.send(
      JSON.stringify({ type: 'pair-approve', code: created.code, requestId: hostReq.requestId })
    );

    const [hMsg, gMsg] = await Promise.all([hostPaired, guestPaired]);
    expect(hMsg.type).toBe('paired');
    expect(gMsg.type).toBe('paired');
  });

  it('forwards encrypted relay packets and rejects packets exceeding 100,000 chars', async () => {
    const { port } = await setup();
    const host = await connectClient(port);
    const guest = await connectClient(port);
    sockets.push(host, guest);

    host.send(JSON.stringify({ type: 'create' }));
    const created = await waitForMessage(host);
    if (created.type !== 'room-created') throw new Error('Expected room-created');

    const p1 = waitForMessage(host);
    const p2 = waitForMessage(guest);
    guest.send(JSON.stringify({ type: 'join', code: created.code, token: created.token }));
    await Promise.all([p1, p2]);

    const guestRelayPromise = waitForMessage(guest);
    host.send(JSON.stringify({ type: 'relay', code: created.code, packet: 'encrypted-payload-1' }));
    const relayed = await guestRelayPromise;
    expect(relayed).toEqual({
      type: 'relay',
      code: created.code,
      packet: 'encrypted-payload-1',
    });

    const hostErrPromise = waitForMessage(host);
    host.send(JSON.stringify({ type: 'relay', code: created.code, packet: 'x'.repeat(100_001) }));
    const err = await hostErrPromise;
    expect(err.type).toBe('error');
  });

  it('enforces per-IP rate limiting for create/join attempts', async () => {
    const { port } = await setup({ rateLimitMaxAttempts: 2, rateLimitWindowMs: 60_000 });
    const client = await connectClient(port);
    sockets.push(client);

    client.send(JSON.stringify({ type: 'create' }));
    const m1 = await waitForMessage(client);
    expect(m1.type).toBe('room-created');

    client.send(JSON.stringify({ type: 'create' }));
    const m2 = await waitForMessage(client);
    expect(m2.type).toBe('room-created');

    client.send(JSON.stringify({ type: 'create' }));
    const m3 = await waitForMessage(client);
    expect(m3.type).toBe('error');
    if (m3.type === 'error') {
      expect(m3.reason).toBe('rate-limit');
    }
  });

  it('expires rooms after TTL elapses', async () => {
    const { port, service } = await setup({ roomTtlMs: 50, cleanupIntervalMs: 15 });
    const host = await connectClient(port);
    sockets.push(host);

    host.send(JSON.stringify({ type: 'create' }));
    const created = await waitForMessage(host);
    expect(created.type).toBe('room-created');
    expect(service.getRoomCount()).toBe(1);

    const expiredMsg = await waitForMessage(host);
    expect(expiredMsg.type).toBe('error');
    expect(service.getRoomCount()).toBe(0);
  });
});
