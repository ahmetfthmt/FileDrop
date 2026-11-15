const SHARE_DB_NAME = 'file-drop-share-db';
const SHARE_STORE_NAME = 'incoming-shares';

interface CapacitorSharedFilePayload {
  name: string;
  mimeType: string;
  dataBase64: string;
}

interface CapacitorShareIntakePlugin {
  getPendingSharedFiles(): Promise<{ files: CapacitorSharedFilePayload[] }>;
  addListener(
    eventName: 'sharedFilesReceived',
    callback: (event: { files: CapacitorSharedFilePayload[] }) => void
  ): Promise<{ remove: () => Promise<void> }>;
}

function base64ToFile(payload: CapacitorSharedFilePayload): File {
  const binary = atob(payload.dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], payload.name || 'paylasilan-dosya', {
    type: payload.mimeType || 'application/octet-stream',
  });
}

async function readAndClearIndexedDbShares(): Promise<File[]> {
  if (typeof indexedDB === 'undefined') return [];
  return new Promise((resolve) => {
    const req = indexedDB.open(SHARE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SHARE_STORE_NAME)) {
        db.createObjectStore(SHARE_STORE_NAME, { autoIncrement: true });
      }
    };
    req.onerror = () => resolve([]);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SHARE_STORE_NAME)) {
        db.close();
        resolve([]);
        return;
      }
      const tx = db.transaction(SHARE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(SHARE_STORE_NAME);
      const getAllReq = store.getAll();
      getAllReq.onsuccess = () => {
        const items = (getAllReq.result || []).filter((f): f is File => f instanceof File);
        store.clear();
        tx.oncomplete = () => {
          db.close();
          resolve(items);
        };
      };
      getAllReq.onerror = () => {
        db.close();
        resolve([]);
      };
    };
  });
}

export async function consumePendingSharedFiles(): Promise<File[]> {
  const files: File[] = [];

  const idbFiles = await readAndClearIndexedDbShares();
  files.push(...idbFiles);

  const sharePlugin = (
    window as unknown as {
      Capacitor?: { Plugins?: { ShareIntake?: CapacitorShareIntakePlugin } };
    }
  ).Capacitor?.Plugins?.ShareIntake;

  if (sharePlugin) {
    try {
      const res = await sharePlugin.getPendingSharedFiles();
      for (const item of res.files || []) {
        files.push(base64ToFile(item));
      }
    } catch {
      // Ignore native share read errors
    }
  }

  return files;
}

export function subscribeNativeSharedFiles(onFiles: (files: File[]) => void): () => void {
  const sharePlugin = (
    window as unknown as {
      Capacitor?: { Plugins?: { ShareIntake?: CapacitorShareIntakePlugin } };
    }
  ).Capacitor?.Plugins?.ShareIntake;

  if (!sharePlugin) return () => {};

  let cleanup: (() => void) | null = null;
  let disposed = false;

  void sharePlugin
    .addListener('sharedFilesReceived', (ev) => {
      const converted = (ev.files || []).map(base64ToFile);
      if (converted.length > 0) {
        onFiles(converted);
      }
    })
    .then((handle) => {
      if (disposed) {
        void handle.remove();
      } else {
        cleanup = () => void handle.remove();
      }
    });

  return () => {
    disposed = true;
    cleanup?.();
  };
}
