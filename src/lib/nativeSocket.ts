interface CapacitorNativeSocketPlugin {
  connect(options: { url: string }): Promise<{ socketId: string }>;
  send(options: { socketId: string; data: string }): Promise<void>;
  close(options: { socketId: string }): Promise<void>;
  addListener(
    eventName: 'open' | 'message' | 'close' | 'error',
    callback: (event: { socketId: string; data?: string; reason?: string }) => void
  ): Promise<{ remove: () => Promise<void> }>;
}

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      Plugins?: {
        NativeSocket?: CapacitorNativeSocketPlugin;
      };
    };
  }
}

export interface UnifiedSocket {
  send(data: string): void;
  close(): void;
  onOpen(cb: () => void): void;
  onMessage(cb: (data: string) => void): void;
  onClose(cb: (reason?: string) => void): void;
  onError(cb: (message: string) => void): void;
  isOpen(): boolean;
}

export function createUnifiedSocket(url: string): UnifiedSocket {
  const nativePlugin =
    typeof window !== 'undefined' ? window.Capacitor?.Plugins?.NativeSocket : undefined;
  const isCapacitorNative =
    typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() === true;

  if (isCapacitorNative && nativePlugin) {
    let socketId: string | null = null;
    let opened = false;
    let closed = false;
    const openCbs: Array<() => void> = [];
    const msgCbs: Array<(data: string) => void> = [];
    const closeCbs: Array<(reason?: string) => void> = [];
    const errCbs: Array<(msg: string) => void> = [];
    const cleanups: Array<() => void> = [];

    const setup = async () => {
      try {
        const l1 = await nativePlugin.addListener('open', (ev) => {
          if (ev.socketId !== socketId) return;
          opened = true;
          openCbs.forEach((cb) => cb());
        });
        const l2 = await nativePlugin.addListener('message', (ev) => {
          if (ev.socketId !== socketId || typeof ev.data !== 'string') return;
          msgCbs.forEach((cb) => cb(ev.data!));
        });
        const l3 = await nativePlugin.addListener('close', (ev) => {
          if (ev.socketId !== socketId) return;
          opened = false;
          closed = true;
          closeCbs.forEach((cb) => cb(ev.reason));
          cleanups.forEach((fn) => fn());
        });
        const l4 = await nativePlugin.addListener('error', (ev) => {
          if (ev.socketId !== socketId) return;
          errCbs.forEach((cb) => cb(ev.reason || 'Native WebSocket hatası'));
        });
        cleanups.push(
          () => void l1.remove(),
          () => void l2.remove(),
          () => void l3.remove(),
          () => void l4.remove()
        );

        const res = await nativePlugin.connect({ url });
        socketId = res.socketId;
        if (closed) {
          await nativePlugin.close({ socketId });
        }
      } catch (err) {
        errCbs.forEach((cb) =>
          cb(err instanceof Error ? err.message : 'Native socket bağlantısı kurulamadı')
        );
      }
    };

    void setup();

    return {
      send(data: string) {
        if (socketId && opened) {
          void nativePlugin.send({ socketId, data });
        }
      },
      close() {
        closed = true;
        opened = false;
        if (socketId) {
          void nativePlugin.close({ socketId });
        }
        cleanups.forEach((fn) => fn());
      },
      onOpen(cb) {
        openCbs.push(cb);
      },
      onMessage(cb) {
        msgCbs.push(cb);
      },
      onClose(cb) {
        closeCbs.push(cb);
      },
      onError(cb) {
        errCbs.push(cb);
      },
      isOpen() {
        return opened;
      },
    };
  }

  const ws = new WebSocket(url);

  return {
    send(data: string) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    },
    close() {
      ws.close();
    },
    onOpen(cb) {
      ws.addEventListener('open', () => cb());
    },
    onMessage(cb) {
      ws.addEventListener('message', (event) => {
        if (typeof event.data === 'string') {
          cb(event.data);
        }
      });
    },
    onClose(cb) {
      ws.addEventListener('close', (event) => cb(event.reason || undefined));
    },
    onError(cb) {
      ws.addEventListener('error', () => cb('Bağlantı sunucusuna ulaşılamadı.'));
    },
    isOpen() {
      return ws.readyState === WebSocket.OPEN;
    },
  };
}
