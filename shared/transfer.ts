export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_TTL_MS = 10 * 60 * 1000;
export const MAX_ACTIVE_ROOMS = 10_000;
export const RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const RATE_LIMIT_MAX_ATTEMPTS = 12;
export const MAX_RELAY_PACKET_CHARS = 100_000;

export const WEBRTC_CHUNK_SIZE = 64 * 1024;
export const RELAY_CHUNK_SIZE = 44 * 1024;

export type PeerRole = 'host' | 'guest';

export type SignalPayload =
  | { kind: 'offer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit }
  | { kind: 'relay-key'; keyBase64: string }
  | { kind: 'transport-mode'; mode: 'webrtc' | 'relay' };

export type ClientSignalMessage =
  | { type: 'create'; deviceName?: string }
  | { type: 'join'; code: string; token?: string; deviceName?: string }
  | { type: 'pair-approve'; code: string; requestId: string }
  | { type: 'pair-reject'; code: string; requestId: string }
  | { type: 'signal'; code: string; payload: SignalPayload }
  | { type: 'relay'; code: string; packet: string }
  | { type: 'heartbeat'; code: string }
  | { type: 'leave'; code: string };

export type ServerSignalMessage =
  | { type: 'room-created'; code: string; token: string; expiresAt: number }
  | { type: 'pair-request'; code: string; requestId: string; deviceName?: string }
  | { type: 'pair-pending'; code: string }
  | { type: 'paired'; code: string; role: PeerRole; expiresAt: number; peerDeviceName?: string }
  | { type: 'pair-rejected'; code: string; reason?: string }
  | { type: 'signal'; code: string; payload: SignalPayload }
  | { type: 'relay'; code: string; packet: string }
  | { type: 'room-refreshed'; code: string; expiresAt: number }
  | { type: 'peer-disconnected'; code: string }
  | { type: 'error'; code?: string; message: string; reason?: string };

export type TransferControlMessage =
  | {
      kind: 'file-offer';
      transferId: string;
      name: string;
      relativePath: string;
      size: number;
      mimeType: string;
      totalChunks: number;
      chunkSize: number;
    }
  | {
      kind: 'file-accept';
      transferId: string;
      startChunkIndex: number;
    }
  | {
      kind: 'file-complete';
      transferId: string;
    }
  | {
      kind: 'file-cancel';
      transferId: string;
      reason?: string;
    };

export type EncryptedRelayPayload =
  | { kind: 'control'; message: TransferControlMessage }
  | { kind: 'chunk'; transferId: string; chunkIndex: number; dataBase64: string };

export function normalizeRoomCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (let i = 0; i < code.length; i++) {
    if (!ROOM_CODE_CHARSET.includes(code[i])) return false;
  }
  return true;
}

export function sanitizeRelativePath(rawPath: string, fallbackName: string): string {
  const candidate = (rawPath || fallbackName || 'dosya').replace(/\\/g, '/');
  const segments = candidate
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
  if (segments.length === 0) {
    return fallbackName || 'dosya';
  }
  return segments.join('/');
}

export function buildShareUrl(origin: string, code: string, token?: string): string {
  const cleanOrigin = origin.replace(/\/+$/, '');
  const params = new URLSearchParams();
  params.set('code', normalizeRoomCode(code));
  if (token) {
    params.set('token', token);
  }
  return `${cleanOrigin}/?${params.toString()}`;
}

export function parseJoinInput(raw: string): { code: string; token?: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.includes('://') || trimmed.includes('code=')) {
    try {
      const url = trimmed.startsWith('http')
        ? new URL(trimmed)
        : new URL(trimmed, 'https://filedrop.local');
      const codeParam = url.searchParams.get('code');
      const tokenParam = url.searchParams.get('token') ?? undefined;
      if (codeParam) {
        const normalized = normalizeRoomCode(codeParam);
        if (isValidRoomCode(normalized)) {
          return { code: normalized, token: tokenParam || undefined };
        }
      }
    } catch {
      // Fall through to raw code parsing
    }
  }

  const normalized = normalizeRoomCode(trimmed);
  if (isValidRoomCode(normalized)) {
    return { code: normalized };
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value >= 100 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '0 B/sn';
  return `${formatBytes(bytesPerSecond)}/sn`;
}

export function calculateEtaSeconds(remainingBytes: number, bytesPerSecond: number): number | null {
  if (!Number.isFinite(remainingBytes) || remainingBytes <= 0) return 0;
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return null;
  return Math.ceil(remainingBytes / bytesPerSecond);
}

export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '--';
  if (seconds <= 0) return '0 sn';
  if (seconds < 60) return `${seconds} sn`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins} dk ${secs.toString().padStart(2, '0')} sn`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours} sa ${remMins} dk`;
}
