import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import {
  isValidRoomCode,
  MAX_ACTIVE_ROOMS,
  MAX_RELAY_PACKET_CHARS,
  normalizeRoomCode,
  RATE_LIMIT_MAX_ATTEMPTS,
  RATE_LIMIT_WINDOW_MS,
  ROOM_CODE_CHARSET,
  ROOM_CODE_LENGTH,
  ROOM_TTL_MS,
  type ClientSignalMessage,
  type ServerSignalMessage,
} from '../shared/transfer.ts';

interface PendingRequest {
  requestId: string;
  socket: WebSocket;
  deviceName?: string;
}

interface Room {
  code: string;
  tokenHash: string;
  host: WebSocket;
  hostDeviceName?: string;
  guest: WebSocket | null;
  guestDeviceName?: string;
  pendingRequests: Map<string, PendingRequest>;
  expiresAt: number;
}

interface SocketMeta {
  ip: string;
  roomCode: string | null;
  role: 'host' | 'guest' | null;
}

export interface SignalingOptions {
  roomTtlMs?: number;
  maxActiveRooms?: number;
  rateLimitWindowMs?: number;
  rateLimitMaxAttempts?: number;
  cleanupIntervalMs?: number;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_CHARSET[crypto.randomInt(0, ROOM_CODE_CHARSET.length)];
  }
  return code;
}

function generateSessionToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

function extractClientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim().length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

export class SignalingService {
  private readonly rooms = new Map<string, Room>();
  private readonly socketMeta = new WeakMap<WebSocket, SocketMeta>();
  private readonly ipAttempts = new Map<string, number[]>();
  private readonly roomTtlMs: number;
  private readonly maxActiveRooms: number;
  private readonly rateLimitWindowMs: number;
  private readonly rateLimitMaxAttempts: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SignalingOptions = {}) {
    this.roomTtlMs = options.roomTtlMs ?? ROOM_TTL_MS;
    this.maxActiveRooms = options.maxActiveRooms ?? MAX_ACTIVE_ROOMS;
    this.rateLimitWindowMs = options.rateLimitWindowMs ?? RATE_LIMIT_WINDOW_MS;
    this.rateLimitMaxAttempts = options.rateLimitMaxAttempts ?? RATE_LIMIT_MAX_ATTEMPTS;

    const intervalMs = options.cleanupIntervalMs ?? 30_000;
    this.cleanupTimer = setInterval(() => this.pruneExpiredRooms(), intervalMs);
    if (typeof this.cleanupTimer.unref === 'function') {
      this.cleanupTimer.unref();
    }
  }

  public dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.rooms.clear();
    this.ipAttempts.clear();
  }

  public getRoomCount(): number {
    this.pruneExpiredRooms();
    return this.rooms.size;
  }

  public getRoomTokenHashForTesting(code: string): string | null {
    return this.rooms.get(code)?.tokenHash ?? null;
  }

  public attachSocket(ws: WebSocket, req: IncomingMessage): void {
    const ip = extractClientIp(req);
    this.socketMeta.set(ws, { ip, roomCode: null, role: null });

    ws.on('message', (raw) => {
      try {
        const text = typeof raw === 'string' ? raw : raw.toString('utf8');
        const msg = JSON.parse(text) as ClientSignalMessage;
        this.handleMessage(ws, msg);
      } catch {
        this.send(ws, { type: 'error', message: 'Geçersiz sinyalleşme mesajı.' });
      }
    });

    ws.on('close', () => {
      this.handleDisconnect(ws);
    });
  }

  private send(ws: WebSocket, message: ServerSignalMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private checkRateLimit(ip: string, now = Date.now()): boolean {
    const windowStart = now - this.rateLimitWindowMs;
    const recent = (this.ipAttempts.get(ip) ?? []).filter((ts) => ts > windowStart);
    if (recent.length >= this.rateLimitMaxAttempts) {
      this.ipAttempts.set(ip, recent);
      return false;
    }
    recent.push(now);
    this.ipAttempts.set(ip, recent);
    return true;
  }

  public pruneExpiredRooms(now = Date.now()): void {
    for (const [code, room] of this.rooms.entries()) {
      if (room.expiresAt <= now) {
        this.closeRoom(code, 'Oda süresi doldu.');
      }
    }
  }

  private closeRoom(code: string, reason?: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    this.rooms.delete(code);

    if (reason) {
      this.send(room.host, { type: 'error', code, message: reason, reason: 'expired' });
      if (room.guest) {
        this.send(room.guest, { type: 'error', code, message: reason, reason: 'expired' });
      }
    }

    const hostMeta = this.socketMeta.get(room.host);
    if (hostMeta && hostMeta.roomCode === code) {
      hostMeta.roomCode = null;
      hostMeta.role = null;
    }

    if (room.guest) {
      const guestMeta = this.socketMeta.get(room.guest);
      if (guestMeta && guestMeta.roomCode === code) {
        guestMeta.roomCode = null;
        guestMeta.role = null;
      }
    }

    for (const pending of room.pendingRequests.values()) {
      if (reason) {
        this.send(pending.socket, { type: 'pair-rejected', code, reason });
      }
      const meta = this.socketMeta.get(pending.socket);
      if (meta && meta.roomCode === code) {
        meta.roomCode = null;
        meta.role = null;
      }
    }
    room.pendingRequests.clear();
  }

  private refreshRoom(room: Room, notify = false): void {
    room.expiresAt = Date.now() + this.roomTtlMs;
    if (notify) {
      this.send(room.host, { type: 'room-refreshed', code: room.code, expiresAt: room.expiresAt });
      if (room.guest) {
        this.send(room.guest, { type: 'room-refreshed', code: room.code, expiresAt: room.expiresAt });
      }
    }
  }

  private handleMessage(ws: WebSocket, msg: ClientSignalMessage): void {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
      this.send(ws, { type: 'error', message: 'Geçersiz mesaj formatı.' });
      return;
    }

    const meta = this.socketMeta.get(ws);
    if (!meta) return;

    switch (msg.type) {
      case 'create': {
        this.pruneExpiredRooms();
        if (!this.checkRateLimit(meta.ip)) {
          this.send(ws, {
            type: 'error',
            reason: 'rate-limit',
            message: 'Çok fazla deneme yapıldı. Lütfen bir dakika bekleyin.',
          });
          return;
        }
        if (this.rooms.size >= this.maxActiveRooms) {
          this.send(ws, {
            type: 'error',
            reason: 'capacity',
            message: 'Sunucu oda kapasitesi dolu. Lütfen daha sonra tekrar deneyin.',
          });
          return;
        }
        if (meta.roomCode) {
          this.leaveCurrentRoom(ws);
        }

        let code = generateRoomCode();
        let guard = 0;
        while (this.rooms.has(code) && guard < 20) {
          code = generateRoomCode();
          guard++;
        }
        if (this.rooms.has(code)) {
          this.send(ws, { type: 'error', message: 'Oda kodu oluşturulamadı.' });
          return;
        }

        const token = generateSessionToken();
        const expiresAt = Date.now() + this.roomTtlMs;
        const room: Room = {
          code,
          tokenHash: hashToken(token),
          host: ws,
          hostDeviceName: typeof msg.deviceName === 'string' ? msg.deviceName.slice(0, 60) : undefined,
          guest: null,
          pendingRequests: new Map(),
          expiresAt,
        };

        this.rooms.set(code, room);
        meta.roomCode = code;
        meta.role = 'host';

        this.send(ws, { type: 'room-created', code, token, expiresAt });
        return;
      }

      case 'join': {
        this.pruneExpiredRooms();
        if (!this.checkRateLimit(meta.ip)) {
          this.send(ws, {
            type: 'error',
            reason: 'rate-limit',
            message: 'Çok fazla katılım denemesi. Lütfen bir dakika bekleyin.',
          });
          return;
        }

        const code = normalizeRoomCode(msg.code || '');
        if (!isValidRoomCode(code)) {
          this.send(ws, { type: 'error', code, message: '6 karakterli geçerli bir oda kodu girin.' });
          return;
        }

        const room = this.rooms.get(code);
        if (!room) {
          this.send(ws, {
            type: 'error',
            code,
            reason: 'not-found',
            message: 'Oda bulunamadı veya süresi doldu.',
          });
          return;
        }
        if (room.host === ws) {
          this.send(ws, { type: 'error', code, message: 'Kendi odanıza katılamazsınız.' });
          return;
        }
        if (room.guest && room.guest.readyState === WebSocket.OPEN) {
          this.send(ws, {
            type: 'error',
            code,
            reason: 'occupied',
            message: 'Bu odada zaten başka bir cihaz eşleşmiş.',
          });
          return;
        }

        if (meta.roomCode && meta.roomCode !== code) {
          this.leaveCurrentRoom(ws);
        }

        const guestDeviceName =
          typeof msg.deviceName === 'string' ? msg.deviceName.slice(0, 60) : undefined;

        if (typeof msg.token === 'string' && msg.token.length > 0) {
          const incomingHash = hashToken(msg.token);
          if (timingSafeHexEqual(incomingHash, room.tokenHash)) {
            this.completePairing(room, ws, guestDeviceName);
            return;
          }
        }

        // Manual room code without token: ask host to approve
        const requestId = crypto.randomUUID();
        room.pendingRequests.set(requestId, {
          requestId,
          socket: ws,
          deviceName: guestDeviceName,
        });
        meta.roomCode = code;
        meta.role = 'guest';

        this.refreshRoom(room, false);
        this.send(ws, { type: 'pair-pending', code });
        this.send(room.host, {
          type: 'pair-request',
          code,
          requestId,
          deviceName: guestDeviceName,
        });
        return;
      }

      case 'pair-approve': {
        const code = normalizeRoomCode(msg.code || '');
        const room = this.rooms.get(code);
        if (!room || room.host !== ws) return;

        const pending = room.pendingRequests.get(msg.requestId);
        if (!pending || pending.socket.readyState !== WebSocket.OPEN) {
          room.pendingRequests.delete(msg.requestId);
          this.send(ws, { type: 'error', code, message: 'Katılım isteği artık aktif değil.' });
          return;
        }

        if (room.guest && room.guest.readyState === WebSocket.OPEN) {
          this.send(pending.socket, {
            type: 'pair-rejected',
            code,
            reason: 'Oda başka bir cihazla eşleşti.',
          });
          room.pendingRequests.delete(msg.requestId);
          return;
        }

        room.pendingRequests.delete(msg.requestId);
        // Reject any other pending requests cleanly
        for (const [otherId, other] of room.pendingRequests.entries()) {
          this.send(other.socket, {
            type: 'pair-rejected',
            code,
            reason: 'Başka bir cihaz onaylandı.',
          });
          room.pendingRequests.delete(otherId);
        }

        this.completePairing(room, pending.socket, pending.deviceName);
        return;
      }

      case 'pair-reject': {
        const code = normalizeRoomCode(msg.code || '');
        const room = this.rooms.get(code);
        if (!room || room.host !== ws) return;

        const pending = room.pendingRequests.get(msg.requestId);
        if (pending) {
          room.pendingRequests.delete(msg.requestId);
          const pendingMeta = this.socketMeta.get(pending.socket);
          if (pendingMeta && pendingMeta.roomCode === code) {
            pendingMeta.roomCode = null;
            pendingMeta.role = null;
          }
          this.send(pending.socket, {
            type: 'pair-rejected',
            code,
            reason: 'Oda sahibi eşleşme isteğini reddetti.',
          });
        }
        return;
      }

      case 'signal': {
        const code = normalizeRoomCode(msg.code || '');
        const room = this.rooms.get(code);
        if (!room) return;
        const peer = this.getPairedPeer(room, ws);
        if (!peer) return;
        this.refreshRoom(room, false);
        this.send(peer, { type: 'signal', code, payload: msg.payload });
        return;
      }

      case 'relay': {
        const code = normalizeRoomCode(msg.code || '');
        const room = this.rooms.get(code);
        if (!room) return;
        const peer = this.getPairedPeer(room, ws);
        if (!peer) return;
        if (typeof msg.packet !== 'string' || msg.packet.length > MAX_RELAY_PACKET_CHARS) {
          this.send(ws, {
            type: 'error',
            code,
            message: `Relay paketi ${MAX_RELAY_PACKET_CHARS} karakter sınırını aştı.`,
          });
          return;
        }
        this.refreshRoom(room, false);
        this.send(peer, { type: 'relay', code, packet: msg.packet });
        return;
      }

      case 'heartbeat': {
        const code = normalizeRoomCode(msg.code || '');
        const room = this.rooms.get(code);
        if (!room) return;
        if (room.host === ws || room.guest === ws) {
          this.refreshRoom(room, true);
        }
        return;
      }

      case 'leave': {
        this.leaveCurrentRoom(ws);
        return;
      }
    }
  }

  private completePairing(room: Room, guestSocket: WebSocket, guestDeviceName?: string): void {
    room.guest = guestSocket;
    room.guestDeviceName = guestDeviceName;

    const guestMeta = this.socketMeta.get(guestSocket);
    if (guestMeta) {
      guestMeta.roomCode = room.code;
      guestMeta.role = 'guest';
    }

    this.refreshRoom(room, false);

    this.send(room.host, {
      type: 'paired',
      code: room.code,
      role: 'host',
      expiresAt: room.expiresAt,
      peerDeviceName: guestDeviceName,
    });
    this.send(guestSocket, {
      type: 'paired',
      code: room.code,
      role: 'guest',
      expiresAt: room.expiresAt,
      peerDeviceName: room.hostDeviceName,
    });
  }

  private getPairedPeer(room: Room, sender: WebSocket): WebSocket | null {
    if (room.host === sender && room.guest && room.guest.readyState === WebSocket.OPEN) {
      return room.guest;
    }
    if (room.guest === sender && room.host.readyState === WebSocket.OPEN) {
      return room.host;
    }
    return null;
  }

  private leaveCurrentRoom(ws: WebSocket): void {
    const meta = this.socketMeta.get(ws);
    if (!meta || !meta.roomCode) return;

    const code = meta.roomCode;
    const room = this.rooms.get(code);
    meta.roomCode = null;
    meta.role = null;
    if (!room) return;

    if (room.host === ws) {
      if (room.guest) {
        this.send(room.guest, { type: 'peer-disconnected', code });
      }
      this.closeRoom(code);
      return;
    }

    if (room.guest === ws) {
      room.guest = null;
      room.guestDeviceName = undefined;
      this.send(room.host, { type: 'peer-disconnected', code });
      return;
    }

    for (const [reqId, pending] of room.pendingRequests.entries()) {
      if (pending.socket === ws) {
        room.pendingRequests.delete(reqId);
      }
    }
  }

  private handleDisconnect(ws: WebSocket): void {
    this.leaveCurrentRoom(ws);
  }
}

export function attachSignalingServer(
  httpServer: HttpServer,
  options: SignalingOptions = {}
): { wss: WebSocketServer; service: SignalingService } {
  const service = new SignalingService(options);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  wss.on('connection', (ws, req) => {
    service.attachSocket(ws, req);
  });

  httpServer.on('upgrade', (req, socket, head) => {
    const rawUrl = req.url || '/';
    const pathname = rawUrl.split('?')[0];
    if (pathname !== '/api/signal') {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  return { wss, service };
}
