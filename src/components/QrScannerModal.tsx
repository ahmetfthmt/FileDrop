import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { CameraOff, X } from 'lucide-react';

interface QrScannerModalProps {
  open: boolean;
  onClose: () => void;
  onScan: (rawText: string) => void;
}

export const QrScannerModal: React.FC<QrScannerModalProps> = ({ open, onClose, onScan }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    let stream: MediaStream | null = null;
    let rafId = 0;
    let active = true;

    const startCamera = async () => {
      setCameraError(null);
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError(
          'Tarayıcı kamera erişimini desteklemiyor veya HTTPS bağlantısı gerekli. Oda kodunu elle girebilirsiniz.'
        );
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const tick = () => {
          if (!active) return;
          const v = videoRef.current;
          const canvas = canvasRef.current;
          if (v && canvas && v.readyState === v.HAVE_ENOUGH_DATA) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const detected = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: 'dontInvert',
              });
              if (detected?.data) {
                active = false;
                onScan(detected.data);
                onClose();
                return;
              }
            }
          }
          rafId = requestAnimationFrame(tick);
        };

        rafId = requestAnimationFrame(tick);
      } catch {
        setCameraError(
          'Kamera izni verilmedi veya kullanılamıyor. Android/tarayıcı izinlerini kontrol edin ya da 6 karakterli kodu elle girin.'
        );
      }
    };

    void startCamera();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      active = false;
      window.removeEventListener('keydown', onKeyDown);
      if (rafId) cancelAnimationFrame(rafId);
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [open, onClose, onScan]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-scanner-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-[#131924]">
        <div className="flex items-center justify-between gap-4">
          <h3
            id="qr-scanner-title"
            className="text-base font-semibold text-slate-900 dark:text-slate-100"
          >
            QR Kodu Tara
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kamerayı kapat"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-950 dark:border-slate-800">
          {cameraError ? (
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <CameraOff className="h-9 w-9 text-slate-400" aria-hidden="true" />
              <p className="mt-3 text-sm text-slate-200">{cameraError}</p>
            </div>
          ) : (
            <div className="relative aspect-square w-full">
              <video
                ref={videoRef}
                playsInline
                muted
                className="h-full w-full object-cover"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-blue-400/80 shadow-[0_0_0_9999px_rgba(2,6,23,0.45)]"
              />
            </div>
          )}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        <p className="mt-3 text-center text-xs text-slate-500 dark:text-slate-400">
          Oda sahibi cihazındaki QR kodunu kameraya doğrultun.
        </p>
      </div>
    </div>
  );
};
