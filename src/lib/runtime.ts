export function getRemoteOrigin(): string {
  const configured = import.meta.env.VITE_REMOTE_ORIGIN;
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return configured.trim().replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return 'http://localhost:3000';
}

export function getSignalingWebSocketUrl(): string {
  const origin = getRemoteOrigin();
  const parsed = new URL(origin);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  parsed.pathname = '/api/signal';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

export function detectDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Cihaz';
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'Android Cihaz';
  if (/iphone/i.test(ua)) return 'iPhone';
  if (/ipad/i.test(ua)) return 'iPad';
  if (/macintosh|mac os x/i.test(ua)) return 'Mac';
  if (/windows/i.test(ua)) return 'Windows PC';
  if (/linux/i.test(ua)) return 'Linux PC';
  return 'Tarayıcı Cihazı';
}
