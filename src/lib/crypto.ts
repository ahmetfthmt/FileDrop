export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function generateRelayKey(): Promise<{ key: CryptoKey; keyBase64: string }> {
  const key = await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const raw = await window.crypto.subtle.exportKey('raw', key);
  return { key, keyBase64: arrayBufferToBase64(raw) };
}

export async function importRelayKey(keyBase64: string): Promise<CryptoKey> {
  const raw = base64ToUint8Array(keyBase64);
  return window.crypto.subtle.importKey('raw', raw.buffer as ArrayBuffer, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptRelayPacket(key: CryptoKey, payload: unknown): Promise<string> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  return JSON.stringify({
    v: 1,
    iv: arrayBufferToBase64(iv),
    ct: arrayBufferToBase64(encrypted),
  });
}

export async function decryptRelayPacket<T = unknown>(key: CryptoKey, packet: string): Promise<T> {
  const parsed = JSON.parse(packet) as { v: number; iv: string; ct: string };
  const iv = base64ToUint8Array(parsed.iv);
  const ct = base64ToUint8Array(parsed.ct);
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    ct.buffer as ArrayBuffer
  );
  const text = new TextDecoder().decode(decrypted);
  return JSON.parse(text) as T;
}
