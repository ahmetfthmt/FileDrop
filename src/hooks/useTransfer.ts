import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildShareUrl,
  calculateEtaSeconds,
  MAX_RELAY_PACKET_CHARS,
  normalizeRoomCode,
  parseJoinInput,
  RELAY_CHUNK_SIZE,
  sanitizeRelativePath,
  WEBRTC_CHUNK_SIZE,
  type EncryptedRelayPayload,
  type PeerRole,
  type ServerSignalMessage,
  type SignalPayload,
  type TransferControlMessage,
} from '../../shared/transfer';
import {
  arrayBufferToBase64,
  base64ToUint8Array,
  decryptRelayPacket,
  encryptRelayPacket,
  generateRelayKey,
  importRelayKey,
} from '../lib/crypto';
import { createUnifiedSocket, type UnifiedSocket } from '../lib/nativeSocket';
import { detectDeviceLabel, getRemoteOrigin, getSignalingWebSocketUrl } from '../lib/runtime';
import { consumePendingSharedFiles, subscribeNativeSharedFiles } from '../lib/shareIntake';

export type RoomConnectionState =
  | 'idle'
  | 'connecting'
  | 'waiting-peer'
  | 'pending-approval'
  | 'paired'
  | 'disconnected';

export type TransportMode = 'none' | 'negotiating' | 'webrtc' | 'relay';

export interface PairRequestItem {
  requestId: string;
  deviceName?: string;
}

export type TransferStatus =
  | 'queued'
  | 'offering'
  | 'transferring'
  | 'completed'
  | 'canceled'
  | 'error';

export interface OutgoingQueueItem {
  id: string;
  file: File;
  name: string;
  relativePath: string;
  size: number;
  mimeType: string;
  previewUrl?: string;
  status: TransferStatus;
  bytesTransferred: number;
  speedBytesPerSec: number;
  etaSeconds: number | null;
  error?: string;
}

export interface IncomingFileItem {
  id: string;
  name: string;
  relativePath: string;
  size: number;
  mimeType: string;
  status: 'receiving' | 'completed' | 'canceled' | 'error';
  bytesReceived: number;
  totalChunks: number;
  receivedChunksCount: number;
  speedBytesPerSec: number;
  etaSeconds: number | null;
  downloadUrl?: string;
  previewUrl?: string;
}

interface PartialReceiveBuffer {
  id: string;
  name: string;
  relativePath: string;
  size: number;
  mimeType: string;
  totalChunks: number;
  chunkSize: number;
  chunks: Array<Uint8Array | undefined>;
  receivedCount: number;
  bytesReceived: number;
  startedAt: number;
  lastTickAt: number;
  lastTickBytes: number;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function encodeBinaryDataChannelFrame(
  transferId: string,
  chunkIndex: number,
  chunkData: Uint8Array
): ArrayBuffer {
  const headerJson = JSON.stringify({ transferId, chunkIndex });
  const headerBytes = new TextEncoder().encode(headerJson);
  const buffer = new ArrayBuffer(4 + headerBytes.length + chunkData.byteLength);
  const view = new DataView(buffer);
  view.setUint32(0, headerBytes.length, false);
  const out = new Uint8Array(buffer);
  out.set(headerBytes, 4);
  out.set(chunkData, 4 + headerBytes.length);
  return buffer;
}

function decodeBinaryDataChannelFrame(buffer: ArrayBuffer): {
  transferId: string;
  chunkIndex: number;
  data: Uint8Array;
} {
  const view = new DataView(buffer);
  const headerLen = view.getUint32(0, false);
  const bytes = new Uint8Array(buffer);
  const headerJson = new TextDecoder().decode(bytes.subarray(4, 4 + headerLen));
  const header = JSON.parse(headerJson) as { transferId: string; chunkIndex: number };
  const data = bytes.subarray(4 + headerLen);
  return { transferId: header.transferId, chunkIndex: header.chunkIndex, data };
}

export function useTransfer() {
  const [connectionState, setConnectionState] = useState<RoomConnectionState>('idle');
  const [transportMode, setTransportMode] = useState<TransportMode>('none');
  const [roomCode, setRoomCode] = useState<string>('');
  const [roomToken, setRoomToken] = useState<string>('');
  const [role, setRole] = useState<PeerRole | null>(null);
  const [peerDeviceName, setPeerDeviceName] = useState<string>('');
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingRequests, setPendingRequests] = useState<PairRequestItem[]>([]);
  const [outgoingQueue, setOutgoingQueue] = useState<OutgoingQueueItem[]>([]);
  const [incomingFiles, setIncomingFiles] = useState<IncomingFileItem[]>([]);

  const socketRef = useRef<UnifiedSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const relayKeyRef = useRef<CryptoKey | null>(null);
  const webrtcFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const roomCodeRef = useRef<string>('');
  const roleRef = useRef<PeerRole | null>(null);
  const transportModeRef = useRef<TransportMode>('none');
  const outgoingQueueRef = useRef<OutgoingQueueItem[]>([]);
  const activeSendIdRef = useRef<string | null>(null);
  const canceledIdsRef = useRef<Set<string>>(new Set());
  const pendingOfferAcceptRef = useRef<
    Map<string, (startChunkIndex: number) => void>
  >(new Map());
  const partialReceivesRef = useRef<Map<string, PartialReceiveBuffer>>(new Map());
  const isSendingLoopRunningRef = useRef(false);

  useEffect(() => {
    outgoingQueueRef.current = outgoingQueue;
  }, [outgoingQueue]);

  useEffect(() => {
    transportModeRef.current = transportMode;
  }, [transportMode]);

  const shareUrl =
    roomCode && role === 'host'
      ? buildShareUrl(getRemoteOrigin(), roomCode, roomToken || undefined)
      : roomCode
      ? buildShareUrl(getRemoteOrigin(), roomCode)
      : '';

  const clearRtc = useCallback(() => {
    if (webrtcFallbackTimerRef.current) {
      clearTimeout(webrtcFallbackTimerRef.current);
      webrtcFallbackTimerRef.current = null;
    }
    if (dcRef.current) {
      try {
        dcRef.current.close();
      } catch {
        // ignore
      }
      dcRef.current = null;
    }
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {
        // ignore
      }
      pcRef.current = null;
    }
  }, []);

  const cleanupSession = useCallback(
    (preserveError = false) => {
      clearRtc();
      if (socketRef.current) {
        try {
          socketRef.current.close();
        } catch {
          // ignore
        }
        socketRef.current = null;
      }
      relayKeyRef.current = null;
      roomCodeRef.current = '';
      roleRef.current = null;
      activeSendIdRef.current = null;
      isSendingLoopRunningRef.current = false;
      pendingOfferAcceptRef.current.clear();

      setRoomCode('');
      setRoomToken('');
      setRole(null);
      setPeerDeviceName('');
      setExpiresAt(null);
      setPendingRequests([]);
      setTransportMode('none');
      if (!preserveError) {
        setErrorMessage(null);
      }
    },
    [clearRtc]
  );

  const sendSignalMessage = useCallback((msg: object) => {
    if (socketRef.current?.isOpen()) {
      socketRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const sendEncryptedRelayPayload = useCallback(
    async (payload: EncryptedRelayPayload) => {
      const key = relayKeyRef.current;
      const code = roomCodeRef.current;
      if (!key || !code) {
        throw new Error('Şifreli relay anahtarı henüz hazır değil.');
      }
      const packet = await encryptRelayPacket(key, payload);
      if (packet.length > MAX_RELAY_PACKET_CHARS) {
        throw new Error('Paket boyutu 100.000 karakter relay sınırını aştı.');
      }
      sendSignalMessage({ type: 'relay', code, packet });
    },
    [sendSignalMessage]
  );

  const sendControlMessage = useCallback(
    async (message: TransferControlMessage) => {
      const dc = dcRef.current;
      if (transportModeRef.current === 'webrtc' && dc && dc.readyState === 'open') {
        dc.send(JSON.stringify(message));
        return;
      }
      await sendEncryptedRelayPayload({ kind: 'control', message });
    },
    [sendEncryptedRelayPayload]
  );

  const activateRelayFallback = useCallback(
    (notifyPeer = true) => {
      if (transportModeRef.current === 'relay') return;
      if (webrtcFallbackTimerRef.current) {
        clearTimeout(webrtcFallbackTimerRef.current);
        webrtcFallbackTimerRef.current = null;
      }
      transportModeRef.current = 'relay';
      setTransportMode('relay');
      if (notifyPeer && roomCodeRef.current) {
        sendSignalMessage({
          type: 'signal',
          code: roomCodeRef.current,
          payload: { kind: 'transport-mode', mode: 'relay' },
        });
      }
    },
    [sendSignalMessage]
  );

  const handleTransferControl = useCallback(
    async (msg: TransferControlMessage) => {
      if (msg.kind === 'file-offer') {
        let existing = partialReceivesRef.current.get(msg.transferId);
        if (
          !existing ||
          existing.size !== msg.size ||
          existing.totalChunks !== msg.totalChunks
        ) {
          existing = {
            id: msg.transferId,
            name: msg.name,
            relativePath: sanitizeRelativePath(msg.relativePath, msg.name),
            size: msg.size,
            mimeType: msg.mimeType || 'application/octet-stream',
            totalChunks: msg.totalChunks,
            chunkSize: msg.chunkSize,
            chunks: new Array<Uint8Array | undefined>(msg.totalChunks),
            receivedCount: 0,
            bytesReceived: 0,
            startedAt: Date.now(),
            lastTickAt: Date.now(),
            lastTickBytes: 0,
          };
          partialReceivesRef.current.set(msg.transferId, existing);
        }

        // Compute contiguous received chunk index for resume
        let contiguous = 0;
        while (contiguous < existing.totalChunks && existing.chunks[contiguous] !== undefined) {
          contiguous++;
        }

        setIncomingFiles((prev) => {
          const idx = prev.findIndex((item) => item.id === msg.transferId);
          const nextEntry: IncomingFileItem = {
            id: msg.transferId,
            name: existing!.name,
            relativePath: existing!.relativePath,
            size: existing!.size,
            mimeType: existing!.mimeType,
            status: 'receiving',
            bytesReceived: existing!.bytesReceived,
            totalChunks: existing!.totalChunks,
            receivedChunksCount: contiguous,
            speedBytesPerSec: 0,
            etaSeconds: null,
          };
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = { ...copy[idx], ...nextEntry };
            return copy;
          }
          return [nextEntry, ...prev];
        });

        await sendControlMessage({
          kind: 'file-accept',
          transferId: msg.transferId,
          startChunkIndex: contiguous,
        });

        if (msg.size === 0 || contiguous >= msg.totalChunks) {
          // Finalize immediately if zero-byte or all chunks already received
          const blob = new Blob(
            existing.chunks.filter((c): c is Uint8Array => !!c).map((c) => c.slice().buffer),
            { type: existing.mimeType }
          );
          const downloadUrl = URL.createObjectURL(blob);
          const previewUrl = existing.mimeType.startsWith('image/') ? downloadUrl : undefined;
          setIncomingFiles((prev) =>
            prev.map((item) =>
              item.id === msg.transferId
                ? {
                    ...item,
                    status: 'completed',
                    bytesReceived: existing!.size,
                    speedBytesPerSec: 0,
                    etaSeconds: 0,
                    downloadUrl,
                    previewUrl,
                  }
                : item
            )
          );
        }
        return;
      }

      if (msg.kind === 'file-accept') {
        const resolver = pendingOfferAcceptRef.current.get(msg.transferId);
        if (resolver) {
          pendingOfferAcceptRef.current.delete(msg.transferId);
          resolver(msg.startChunkIndex);
        }
        return;
      }

      if (msg.kind === 'file-complete') {
        const buf = partialReceivesRef.current.get(msg.transferId);
        if (!buf) return;
        const parts = buf.chunks
          .filter((c): c is Uint8Array => c !== undefined)
          .map((c) => c.slice().buffer);
        const blob = new Blob(parts, { type: buf.mimeType });
        const downloadUrl = URL.createObjectURL(blob);
        const previewUrl = buf.mimeType.startsWith('image/') ? downloadUrl : undefined;

        partialReceivesRef.current.delete(msg.transferId);
        setIncomingFiles((prev) =>
          prev.map((item) =>
            item.id === msg.transferId
              ? {
                  ...item,
                  status: 'completed',
                  bytesReceived: buf.size,
                  receivedChunksCount: buf.totalChunks,
                  speedBytesPerSec: 0,
                  etaSeconds: 0,
                  downloadUrl,
                  previewUrl,
                }
              : item
          )
        );
        return;
      }

      if (msg.kind === 'file-cancel') {
        // Keep partial chunks in partialReceivesRef so resume works!
        setIncomingFiles((prev) =>
          prev.map((item) =>
            item.id === msg.transferId && item.status === 'receiving'
              ? { ...item, status: 'canceled', speedBytesPerSec: 0, etaSeconds: null }
              : item
          )
        );
      }
    },
    [sendControlMessage]
  );

  const handleIncomingChunk = useCallback(
    (transferId: string, chunkIndex: number, data: Uint8Array) => {
      const buf = partialReceivesRef.current.get(transferId);
      if (!buf) return;
      if (chunkIndex < 0 || chunkIndex >= buf.totalChunks) return;

      if (!buf.chunks[chunkIndex]) {
        buf.chunks[chunkIndex] = data;
        buf.receivedCount += 1;
        buf.bytesReceived = Math.min(buf.size, buf.bytesReceived + data.byteLength);
      }

      const now = Date.now();
      const elapsedMs = now - buf.lastTickAt;
      if (elapsedMs >= 160 || buf.receivedCount === buf.totalChunks) {
        const deltaBytes = buf.bytesReceived - buf.lastTickBytes;
        const speed = elapsedMs > 0 ? Math.round((deltaBytes * 1000) / elapsedMs) : 0;
        const eta = calculateEtaSeconds(buf.size - buf.bytesReceived, speed);
        buf.lastTickAt = now;
        buf.lastTickBytes = buf.bytesReceived;

        setIncomingFiles((prev) =>
          prev.map((item) =>
            item.id === transferId
              ? {
                  ...item,
                  status: 'receiving',
                  bytesReceived: buf.bytesReceived,
                  receivedChunksCount: buf.receivedCount,
                  speedBytesPerSec: speed,
                  etaSeconds: eta,
                }
              : item
          )
        );
      }
    },
    []
  );

  const wireDataChannel = useCallback(
    (dc: RTCDataChannel) => {
      dcRef.current = dc;
      dc.binaryType = 'arraybuffer';
      dc.bufferedAmountLowThreshold = 256 * 1024;

      dc.onopen = () => {
        if (webrtcFallbackTimerRef.current) {
          clearTimeout(webrtcFallbackTimerRef.current);
          webrtcFallbackTimerRef.current = null;
        }
        transportModeRef.current = 'webrtc';
        setTransportMode('webrtc');
      };

      dc.onclose = () => {
        if (connectionState === 'paired' && transportModeRef.current === 'webrtc') {
          activateRelayFallback(true);
        }
      };

      dc.onerror = () => {
        activateRelayFallback(true);
      };

      dc.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const control = JSON.parse(event.data) as TransferControlMessage;
            void handleTransferControl(control);
          } catch {
            // ignore malformed control
          }
          return;
        }
        if (event.data instanceof ArrayBuffer) {
          try {
            const frame = decodeBinaryDataChannelFrame(event.data);
            handleIncomingChunk(frame.transferId, frame.chunkIndex, frame.data);
          } catch {
            // ignore malformed binary frame
          }
        }
      };
    },
    [activateRelayFallback, connectionState, handleIncomingChunk, handleTransferControl]
  );

  const startWebRtcPeerConnection = useCallback(
    async (currentRole: PeerRole, code: string) => {
      clearRtc();
      transportModeRef.current = 'negotiating';
      setTransportMode('negotiating');

      // Always prepare fallback timer in case NAT/firewall blocks P2P ICE
      webrtcFallbackTimerRef.current = setTimeout(() => {
        if (dcRef.current?.readyState !== 'open') {
          activateRelayFallback(true);
        }
      }, 5500);

      if (typeof RTCPeerConnection === 'undefined') {
        activateRelayFallback(true);
        return;
      }

      const pc = new RTCPeerConnection(RTC_CONFIG);
      pcRef.current = pc;

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignalMessage({
            type: 'signal',
            code,
            payload: { kind: 'ice', candidate: event.candidate.toJSON() },
          });
        }
      };

      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        if (state === 'failed' || state === 'disconnected') {
          if (dcRef.current?.readyState !== 'open') {
            activateRelayFallback(true);
          }
        }
      };

      if (currentRole === 'host') {
        const { key, keyBase64 } = await generateRelayKey();
        relayKeyRef.current = key;
        sendSignalMessage({
          type: 'signal',
          code,
          payload: { kind: 'relay-key', keyBase64 },
        });

        const dc = pc.createDataChannel('file-drop', { ordered: true });
        wireDataChannel(dc);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignalMessage({
          type: 'signal',
          code,
          payload: { kind: 'offer', sdp: offer },
        });
      } else {
        pc.ondatachannel = (event) => {
          wireDataChannel(event.channel);
        };
      }
    },
    [activateRelayFallback, clearRtc, sendSignalMessage, wireDataChannel]
  );

  const handleSignalPayload = useCallback(
    async (code: string, payload: SignalPayload) => {
      if (payload.kind === 'relay-key') {
        relayKeyRef.current = await importRelayKey(payload.keyBase64);
        return;
      }

      if (payload.kind === 'transport-mode' && payload.mode === 'relay') {
        activateRelayFallback(false);
        return;
      }

      const pc = pcRef.current;
      if (!pc) return;

      if (payload.kind === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignalMessage({
          type: 'signal',
          code,
          payload: { kind: 'answer', sdp: answer },
        });
        return;
      }

      if (payload.kind === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        return;
      }

      if (payload.kind === 'ice') {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch {
          // ignore late/stale ICE candidates
        }
      }
    },
    [activateRelayFallback, sendSignalMessage]
  );

  const processOutgoingQueue = useCallback(async () => {
    if (isSendingLoopRunningRef.current) return;
    if (transportModeRef.current !== 'webrtc' && transportModeRef.current !== 'relay') return;

    isSendingLoopRunningRef.current = true;
    try {
      while (true) {
        const nextItem = outgoingQueueRef.current.find((item) => item.status === 'queued');
        if (!nextItem) break;
        if (transportModeRef.current !== 'webrtc' && transportModeRef.current !== 'relay') break;

        const transferId = nextItem.id;
        canceledIdsRef.current.delete(transferId);
        activeSendIdRef.current = transferId;

        const useWebRtc =
          transportModeRef.current === 'webrtc' && dcRef.current?.readyState === 'open';
        const chunkSize = useWebRtc ? WEBRTC_CHUNK_SIZE : RELAY_CHUNK_SIZE;
        const totalChunks = Math.max(1, Math.ceil(nextItem.size / chunkSize));

        setOutgoingQueue((prev) =>
          prev.map((q) => (q.id === transferId ? { ...q, status: 'offering', error: undefined } : q))
        );

        let startChunkIndex = 0;
        try {
          const acceptPromise = new Promise<number>((resolve, reject) => {
            const timeout = setTimeout(() => {
              pendingOfferAcceptRef.current.delete(transferId);
              reject(new Error('Karşı cihaz yanıt vermedi.'));
            }, 15_000);
            pendingOfferAcceptRef.current.set(transferId, (idx) => {
              clearTimeout(timeout);
              resolve(idx);
            });
          });

          await sendControlMessage({
            kind: 'file-offer',
            transferId,
            name: nextItem.name,
            relativePath: nextItem.relativePath,
            size: nextItem.size,
            mimeType: nextItem.mimeType,
            totalChunks,
            chunkSize,
          });

          startChunkIndex = await acceptPromise;
        } catch (err) {
          setOutgoingQueue((prev) =>
            prev.map((q) =>
              q.id === transferId
                ? {
                    ...q,
                    status: 'error',
                    error: err instanceof Error ? err.message : 'Aktarım başlatılamadı.',
                  }
                : q
            )
          );
          activeSendIdRef.current = null;
          continue;
        }

        if (canceledIdsRef.current.has(transferId)) {
          activeSendIdRef.current = null;
          continue;
        }

        let bytesSent = Math.min(nextItem.size, startChunkIndex * chunkSize);
        let lastTickAt = Date.now();
        let lastTickBytes = bytesSent;

        setOutgoingQueue((prev) =>
          prev.map((q) =>
            q.id === transferId
              ? { ...q, status: 'transferring', bytesTransferred: bytesSent }
              : q
          )
        );

        let failed = false;
        for (let chunkIndex = startChunkIndex; chunkIndex < totalChunks; chunkIndex++) {
          if (canceledIdsRef.current.has(transferId)) {
            break;
          }

          const start = chunkIndex * chunkSize;
          const end = Math.min(nextItem.size, start + chunkSize);
          const sliceBuffer = await nextItem.file.slice(start, end).arrayBuffer();
          const chunkBytes = new Uint8Array(sliceBuffer);

          try {
            const dc = dcRef.current;
            if (transportModeRef.current === 'webrtc' && dc && dc.readyState === 'open') {
              if (dc.bufferedAmount > 1024 * 1024) {
                await new Promise<void>((resolve) => {
                  const onLow = () => {
                    dc.removeEventListener('bufferedamountlow', onLow);
                    resolve();
                  };
                  dc.addEventListener('bufferedamountlow', onLow);
                  setTimeout(() => {
                    dc.removeEventListener('bufferedamountlow', onLow);
                    resolve();
                  }, 250);
                });
              }
              dc.send(encodeBinaryDataChannelFrame(transferId, chunkIndex, chunkBytes));
            } else {
              await sendEncryptedRelayPayload({
                kind: 'chunk',
                transferId,
                chunkIndex,
                dataBase64: arrayBufferToBase64(chunkBytes),
              });
              // Tiny yield on relay to keep UI smooth and socket buffer healthy
              if (chunkIndex % 4 === 3) {
                await new Promise((r) => setTimeout(r, 8));
              }
            }
          } catch (err) {
            failed = true;
            setOutgoingQueue((prev) =>
              prev.map((q) =>
                q.id === transferId
                  ? {
                      ...q,
                      status: 'error',
                      error: err instanceof Error ? err.message : 'Aktarım kesildi.',
                    }
                  : q
              )
            );
            break;
          }

          bytesSent += chunkBytes.byteLength;
          const now = Date.now();
          const elapsedMs = now - lastTickAt;
          if (elapsedMs >= 160 || chunkIndex === totalChunks - 1) {
            const deltaBytes = bytesSent - lastTickBytes;
            const speed = elapsedMs > 0 ? Math.round((deltaBytes * 1000) / elapsedMs) : 0;
            const eta = calculateEtaSeconds(nextItem.size - bytesSent, speed);
            lastTickAt = now;
            lastTickBytes = bytesSent;

            setOutgoingQueue((prev) =>
              prev.map((q) =>
                q.id === transferId
                  ? {
                      ...q,
                      bytesTransferred: bytesSent,
                      speedBytesPerSec: speed,
                      etaSeconds: eta,
                    }
                  : q
              )
            );
          }
        }

        if (!failed && !canceledIdsRef.current.has(transferId)) {
          await sendControlMessage({ kind: 'file-complete', transferId });
          setOutgoingQueue((prev) =>
            prev.map((q) =>
              q.id === transferId
                ? {
                    ...q,
                    status: 'completed',
                    bytesTransferred: nextItem.size,
                    speedBytesPerSec: 0,
                    etaSeconds: 0,
                  }
                : q
            )
          );
        }
        activeSendIdRef.current = null;
      }
    } finally {
      isSendingLoopRunningRef.current = false;
    }
  }, [sendControlMessage, sendEncryptedRelayPayload]);

  // Trigger queue processing when transport becomes ready or new queued items arrive
  useEffect(() => {
    if (
      connectionState === 'paired' &&
      (transportMode === 'webrtc' || transportMode === 'relay') &&
      outgoingQueue.some((item) => item.status === 'queued')
    ) {
      void processOutgoingQueue();
    }
  }, [connectionState, transportMode, outgoingQueue, processOutgoingQueue]);

  // Room heartbeat while active
  useEffect(() => {
    if (!roomCode || (connectionState !== 'waiting-peer' && connectionState !== 'paired')) return;
    const timer = setInterval(() => {
      sendSignalMessage({ type: 'heartbeat', code: roomCode });
    }, 60_000);
    return () => clearInterval(timer);
  }, [roomCode, connectionState, sendSignalMessage]);

  const connectAndRun = useCallback(
    (onReady: (socket: UnifiedSocket) => void) => {
      cleanupSession(false);
      setConnectionState('connecting');
      setErrorMessage(null);

      const url = getSignalingWebSocketUrl();
      const socket = createUnifiedSocket(url);
      socketRef.current = socket;

      socket.onOpen(() => {
        onReady(socket);
      });

      socket.onMessage((raw) => {
        let msg: ServerSignalMessage;
        try {
          msg = JSON.parse(raw) as ServerSignalMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case 'room-created': {
            roomCodeRef.current = msg.code;
            roleRef.current = 'host';
            setRoomCode(msg.code);
            setRoomToken(msg.token);
            setRole('host');
            setExpiresAt(msg.expiresAt);
            setConnectionState('waiting-peer');
            break;
          }

          case 'pair-pending': {
            roomCodeRef.current = msg.code;
            setRoomCode(msg.code);
            setConnectionState('pending-approval');
            break;
          }

          case 'pair-request': {
            setPendingRequests((prev) => {
              if (prev.some((r) => r.requestId === msg.requestId)) return prev;
              return [...prev, { requestId: msg.requestId, deviceName: msg.deviceName }];
            });
            break;
          }

          case 'paired': {
            roomCodeRef.current = msg.code;
            roleRef.current = msg.role;
            setRoomCode(msg.code);
            setRole(msg.role);
            setExpiresAt(msg.expiresAt);
            setPeerDeviceName(msg.peerDeviceName || 'Karşı Cihaz');
            setPendingRequests([]);
            setConnectionState('paired');
            void startWebRtcPeerConnection(msg.role, msg.code);
            break;
          }

          case 'pair-rejected': {
            setErrorMessage(msg.reason || 'Eşleşme isteği reddedildi.');
            cleanupSession(true);
            setConnectionState('idle');
            break;
          }

          case 'signal': {
            void handleSignalPayload(msg.code, msg.payload);
            break;
          }

          case 'relay': {
            const key = relayKeyRef.current;
            if (!key) return;
            void decryptRelayPacket<EncryptedRelayPayload>(key, msg.packet)
              .then((payload) => {
                if (payload.kind === 'control') {
                  void handleTransferControl(payload.message);
                } else if (payload.kind === 'chunk') {
                  handleIncomingChunk(
                    payload.transferId,
                    payload.chunkIndex,
                    base64ToUint8Array(payload.dataBase64)
                  );
                }
              })
              .catch(() => {
                // ignore undecryptable packet
              });
            break;
          }

          case 'room-refreshed': {
            setExpiresAt(msg.expiresAt);
            break;
          }

          case 'peer-disconnected': {
            clearRtc();
            setPeerDeviceName('');
            setTransportMode('none');
            if (roleRef.current === 'host') {
              setConnectionState('waiting-peer');
            } else {
              setErrorMessage('Oda sahibi bağlantıyı kapattı.');
              cleanupSession(true);
              setConnectionState('disconnected');
            }
            break;
          }

          case 'error': {
            setErrorMessage(msg.message);
            if (msg.reason === 'expired' || msg.reason === 'not-found' || msg.reason === 'occupied') {
              cleanupSession(true);
              setConnectionState('idle');
            }
            break;
          }
        }
      });

      socket.onError((msg) => {
        setErrorMessage(msg || 'Bağlantı sunucusuna ulaşılamadı.');
        setConnectionState('disconnected');
      });

      socket.onClose(() => {
        setConnectionState((prev) => {
          if (prev === 'idle' || prev === 'disconnected') return prev;
          return 'disconnected';
        });
      });
    },
    [
      cleanupSession,
      clearRtc,
      handleIncomingChunk,
      handleSignalPayload,
      handleTransferControl,
      startWebRtcPeerConnection,
    ]
  );

  const createRoom = useCallback(() => {
    connectAndRun((socket) => {
      socket.send(JSON.stringify({ type: 'create', deviceName: detectDeviceLabel() }));
    });
  }, [connectAndRun]);

  const joinRoom = useCallback(
    (rawInput: string, explicitToken?: string) => {
      const parsed = parseJoinInput(rawInput);
      if (!parsed) {
        setErrorMessage('Lütfen geçerli bir 6 karakterli oda kodu veya QR bağlantısı girin.');
        return;
      }
      const code = normalizeRoomCode(parsed.code);
      const token = explicitToken ?? parsed.token;

      connectAndRun((socket) => {
        socket.send(
          JSON.stringify({
            type: 'join',
            code,
            token,
            deviceName: detectDeviceLabel(),
          })
        );
      });
    },
    [connectAndRun]
  );

  // Auto-join if opened from a QR share link (?code=XXXXXX&token=...)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const urlCode = params.get('code');
    const urlToken = params.get('token') ?? undefined;
    if (urlCode) {
      const normalized = normalizeRoomCode(urlCode);
      if (normalized.length === 6) {
        // Clean URL query params so reload doesn't stale-rejoin
        window.history.replaceState({}, '', window.location.pathname);
        joinRoom(normalized, urlToken);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const approvePairRequest = useCallback(
    (requestId: string) => {
      if (!roomCodeRef.current) return;
      setPendingRequests((prev) => prev.filter((r) => r.requestId !== requestId));
      sendSignalMessage({
        type: 'pair-approve',
        code: roomCodeRef.current,
        requestId,
      });
    },
    [sendSignalMessage]
  );

  const rejectPairRequest = useCallback(
    (requestId: string) => {
      if (!roomCodeRef.current) return;
      setPendingRequests((prev) => prev.filter((r) => r.requestId !== requestId));
      sendSignalMessage({
        type: 'pair-reject',
        code: roomCodeRef.current,
        requestId,
      });
    },
    [sendSignalMessage]
  );

  const leaveRoom = useCallback(() => {
    if (roomCodeRef.current) {
      sendSignalMessage({ type: 'leave', code: roomCodeRef.current });
    }
    cleanupSession(false);
    setConnectionState('idle');
  }, [cleanupSession, sendSignalMessage]);

  const addFiles = useCallback((files: FileList | File[], explicitPaths?: string[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    const newItems: OutgoingQueueItem[] = fileArray.map((file, index) => {
      const webkitPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      const rawRel = explicitPaths?.[index] || webkitPath || file.name;
      const relativePath = sanitizeRelativePath(rawRel, file.name);
      const isImage = file.type.startsWith('image/');
      return {
        id: crypto.randomUUID(),
        file,
        name: file.name,
        relativePath,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        previewUrl: isImage ? URL.createObjectURL(file) : undefined,
        status: 'queued',
        bytesTransferred: 0,
        speedBytesPerSec: 0,
        etaSeconds: null,
      };
    });

    setOutgoingQueue((prev) => [...prev, ...newItems]);
  }, []);

  // Consume files shared from Android system Share Sheet (PWA Web Share Target or Capacitor Intent)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('shared') === '1') {
      window.history.replaceState({}, '', window.location.pathname);
    }

    void consumePendingSharedFiles().then((sharedFiles) => {
      if (sharedFiles.length > 0) {
        addFiles(sharedFiles);
      }
    });

    return subscribeNativeSharedFiles((sharedFiles) => {
      if (sharedFiles.length > 0) {
        addFiles(sharedFiles);
      }
    });
  }, [addFiles]);

  const moveQueueItem = useCallback((id: string, direction: 'up' | 'down') => {
    setOutgoingQueue((prev) => {
      const idx = prev.findIndex((item) => item.id === id);
      if (idx < 0) return prev;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(idx, 1);
      copy.splice(targetIdx, 0, moved);
      return copy;
    });
  }, []);

  const removeQueueItem = useCallback((id: string) => {
    canceledIdsRef.current.add(id);
    setOutgoingQueue((prev) => {
      const item = prev.find((q) => q.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((q) => q.id !== id);
    });
  }, []);

  const cancelOutgoingTransfer = useCallback(
    (id: string) => {
      canceledIdsRef.current.add(id);
      void sendControlMessage({ kind: 'file-cancel', transferId: id, reason: 'canceled' });
      setOutgoingQueue((prev) =>
        prev.map((q) =>
          q.id === id
            ? { ...q, status: 'canceled', speedBytesPerSec: 0, etaSeconds: null }
            : q
        )
      );
    },
    [sendControlMessage]
  );

  const resumeOutgoingTransfer = useCallback((id: string) => {
    canceledIdsRef.current.delete(id);
    setOutgoingQueue((prev) =>
      prev.map((q) => (q.id === id ? { ...q, status: 'queued', error: undefined } : q))
    );
  }, []);

  const clearCompletedOutgoing = useCallback(() => {
    setOutgoingQueue((prev) => {
      for (const item of prev) {
        if ((item.status === 'completed' || item.status === 'canceled') && item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      }
      return prev.filter((item) => item.status !== 'completed' && item.status !== 'canceled');
    });
  }, []);

  const clearReceivedFiles = useCallback(() => {
    setIncomingFiles((prev) => {
      for (const item of prev) {
        if (item.downloadUrl) URL.revokeObjectURL(item.downloadUrl);
      }
      return prev.filter((item) => item.status === 'receiving');
    });
  }, []);

  return {
    connectionState,
    transportMode,
    roomCode,
    roomToken,
    shareUrl,
    role,
    peerDeviceName,
    expiresAt,
    errorMessage,
    pendingRequests,
    outgoingQueue,
    incomingFiles,
    createRoom,
    joinRoom,
    approvePairRequest,
    rejectPairRequest,
    leaveRoom,
    switchToEncryptedRelay: () => activateRelayFallback(true),
    addFiles,
    moveQueueItem,
    removeQueueItem,
    cancelOutgoingTransfer,
    resumeOutgoingTransfer,
    clearCompletedOutgoing,
    clearReceivedFiles,
    dismissError: () => setErrorMessage(null),
  };
}
