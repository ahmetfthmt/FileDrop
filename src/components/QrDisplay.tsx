import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Share2 } from 'lucide-react';

interface QrDisplayProps {
  code: string;
  shareUrl: string;
}

export const QrDisplay: React.FC<QrDisplayProps> = ({ code, shareUrl }) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedType, setCopiedType] = useState<'code' | 'link' | null>(null);

  useEffect(() => {
    let active = true;
    if (!shareUrl) {
      setQrDataUrl('');
      return;
    }

    QRCode.toDataURL(shareUrl, {
      width: 240,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });

    return () => {
      active = false;
    };
  }, [shareUrl]);

  const handleCopy = async (value: string, type: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 1800);
    } catch {
      // Clipboard blocked in non-secure context
    }
  };

  const handleShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'File Drop Odası',
          text: `File Drop oda kodu: ${code}`,
          url: shareUrl,
        });
      } catch {
        // User canceled share sheet
      }
    } else {
      await handleCopy(shareUrl, 'link');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/50">
        {qrDataUrl ? (
          <div className="rounded-xl bg-white p-2.5 shadow-sm">
            <img
              src={qrDataUrl}
              alt={`${code} odası için QR kodu`}
              className="h-44 w-44 sm:h-48 sm:w-48"
              referrerPolicy="no-referrer"
            />
          </div>
        ) : (
          <div className="flex h-44 w-44 items-center justify-center rounded-xl bg-white text-xs text-slate-400">
            QR kodu hazırlanıyor…
          </div>
        )}

        <div className="mt-4 text-center">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Oda Kodu</p>
          <p className="mt-1 font-mono text-3xl font-semibold tracking-[0.22em] text-slate-900 tabular-nums dark:text-slate-50">
            {code}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => void handleCopy(code, 'code')}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
        >
          {copiedType === 'code' ? (
            <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span>{copiedType === 'code' ? 'Kopyalandı' : 'Kodu Kopyala'}</span>
        </button>

        <button
          type="button"
          onClick={() => void handleCopy(shareUrl, 'link')}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
        >
          {copiedType === 'link' ? (
            <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span>{copiedType === 'link' ? 'Kopyalandı' : 'Bağlantı'}</span>
        </button>

        <button
          type="button"
          onClick={() => void handleShare()}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 whitespace-nowrap"
        >
          <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Paylaş</span>
        </button>
      </div>
    </div>
  );
};
