import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import { precacheAndRoute, type PrecacheEntry } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';

interface SWFetchEvent extends Event {
  request: Request;
  respondWith(response: Response | Promise<Response>): void;
  waitUntil(promise: Promise<unknown>): void;
}

interface SWGlobal {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
  skipWaiting(): Promise<void>;
  addEventListener(type: 'fetch', listener: (event: SWFetchEvent) => void): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

declare const self: SWGlobal;

self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com',
  new CacheFirst({
    cacheName: 'google-fonts-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'gstatic-fonts-cache',
    plugins: [
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

const SHARE_DB_NAME = 'file-drop-share-db';
const SHARE_STORE_NAME = 'incoming-shares';

function openShareDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SHARE_STORE_NAME)) {
        db.createObjectStore(SHARE_STORE_NAME, { autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeSharedFiles(files: File[]): Promise<void> {
  if (files.length === 0) return;
  const db = await openShareDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SHARE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(SHARE_STORE_NAME);
    for (const file of files) {
      store.add(file);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

self.addEventListener('fetch', (event: SWFetchEvent) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const entries = formData.getAll('files');
          const files: File[] = [];

          for (const entry of entries) {
            if (entry instanceof File && entry.size >= 0) {
              files.push(entry);
            }
          }

          if (files.length === 0) {
            const title = String(formData.get('title') || '').trim();
            const text = String(formData.get('text') || '').trim();
            const sharedUrl = String(formData.get('url') || '').trim();
            const combined = [title, text, sharedUrl].filter(Boolean).join('\n');
            if (combined) {
              files.push(
                new File([combined], 'paylasilan-metin.txt', {
                  type: 'text/plain;charset=utf-8',
                })
              );
            }
          }

          await storeSharedFiles(files);
        } catch {
          // Ignore malformed share target form data and still redirect back into app
        }
        return Response.redirect('/?shared=1', 303);
      })()
    );
  }
});
