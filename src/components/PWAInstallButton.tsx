import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#0b0f17] whitespace-nowrap shrink-0"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        <span>Uygulamayı Kur</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
        >
          <Smartphone className="h-4 w-4" aria-hidden="true" />
          <span>Ana Ekrana Ekle</span>
        </button>

        {showIOSGuide && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-pwa-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
          >
            <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-[#131924]">
              <div className="flex items-start justify-between gap-4">
                <h3
                  id="ios-pwa-title"
                  className="text-base font-semibold text-slate-900 dark:text-slate-100"
                >
                  iPhone / iPad Kurulumu
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Kapat"
                  className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ol className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                <li>1. Safari alt çubuğundaki Paylaş simgesine dokunun.</li>
                <li>2. Aşağı kaydırıp &ldquo;Ana Ekrana Ekle&rdquo; seçeneğini seçin.</li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full min-h-[44px] rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
              >
                Anladım
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineBanner: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-200"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-2">
        <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>Çevrimdışı moddasınız. Oda eşleştirmesi için ağ bağlantısı gereklidir.</span>
      </div>
    </div>
  );
};
