import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  KeyRound,
  Laptop,
  Lock,
  LogOut,
  Monitor,
  Moon,
  PlusCircle,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Sun,
  Wifi,
  X,
} from 'lucide-react';
import { normalizeRoomCode } from '../../shared/transfer';
import { OfflineBanner, PWAInstallButton } from '../components/PWAInstallButton';
import { QrDisplay } from '../components/QrDisplay';
import { QrScannerModal } from '../components/QrScannerModal';
import { TransferWorkspace } from '../components/TransferWorkspace';
import { useTheme, type ThemePreference } from '../hooks/useTheme';
import { useTransfer } from '../hooks/useTransfer';

function formatCountdown(expiresAt: number | null, now: number): string {
  if (!expiresAt) return '--:--';
  const remainingSec = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const mins = Math.floor(remainingSec / 60);
  const secs = remainingSec % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export const Home: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const transfer = useTransfer();

  const [joinInput, setJoinInput] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!transfer.expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [transfer.expiresAt]);

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinInput.trim()) return;
    transfer.joinRoom(joinInput);
  };

  const cycleTheme = () => {
    const order: ThemePreference[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
  };

  const themeLabel = theme === 'light' ? 'Açık' : theme === 'dark' ? 'Koyu' : 'Sistem';
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;

  const isInRoom =
    transfer.connectionState === 'waiting-peer' ||
    transfer.connectionState === 'paired' ||
    transfer.connectionState === 'pending-approval' ||
    transfer.connectionState === 'connecting';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#0b0f17] dark:text-slate-100">
      {/* Compact Sticky Top Bar (3-Zone Contract, <= 56px height) */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-md dark:border-slate-800/80 dark:bg-[#0b0f17]/90">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <a
            href="#top"
            className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-50 whitespace-nowrap shrink-0"
          >
            File Drop
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
            <a
              href="#aktarim"
              className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Aktarım
            </a>
            <a
              href="#nasil-calisir"
              className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Nasıl Çalışır
            </a>
            <a
              href="#guvenlik"
              className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Güvenlik
            </a>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={cycleTheme}
              aria-label={`Tema: ${themeLabel}. Değiştirmek için tıklayın.`}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <ThemeIcon className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{themeLabel}</span>
            </button>
            <PWAInstallButton />
          </div>
        </div>
      </header>

      <OfflineBanner />

      <main id="top" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Clean Editorial Intro */}
        <section className="mb-6 sm:mb-8">
          <h1
            className="max-w-2xl text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-50"
            style={{ textWrap: 'balance' }}
          >
            Cihazlar arasında doğrudan ve şifreli dosya aktarımı
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-slate-500 dark:text-slate-400">
            <span>Hesap açmadan</span>
            <span aria-hidden="true">·</span>
            <span>Kalıcı depolama olmadan</span>
            <span aria-hidden="true">·</span>
            <span>WebRTC ve AES-GCM şifreli relay</span>
          </p>
        </section>

        {/* Error Alert */}
        {transfer.errorMessage && (
          <div
            role="alert"
            className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
          >
            <div className="flex items-center gap-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
              <span>{transfer.errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={transfer.dismissError}
              aria-label="Uyarıyı kapat"
              className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Primary 2-Column Workspace */}
        <div id="aktarim" className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
          {/* Left Column: Room & Pairing Controls */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 lg:col-span-5 dark:border-slate-800 dark:bg-[#131924]">
            {!isInRoom && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                    Bağlantı Kur
                  </h2>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Yeni bir oda başlatın veya diğer cihazdaki 6 karakterli kodu girin.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={transfer.createRoom}
                  className="flex w-full min-h-[48px] items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#131924]"
                >
                  <PlusCircle className="h-4 w-4" aria-hidden="true" />
                  <span>Oda Oluştur</span>
                </button>

                <div className="relative flex items-center py-1">
                  <div className="grow border-t border-slate-200 dark:border-slate-800" />
                  <span className="mx-3 shrink-0 text-xs font-medium text-slate-400">veya</span>
                  <div className="grow border-t border-slate-200 dark:border-slate-800" />
                </div>

                <form onSubmit={handleJoinSubmit} className="space-y-3">
                  <label
                    htmlFor="room-code-input"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Oda Kodu veya Paylaşım Bağlantısı
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="room-code-input"
                      type="text"
                      value={joinInput}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val.includes('://') || val.includes('code=')) {
                          setJoinInput(val);
                        } else {
                          setJoinInput(normalizeRoomCode(val));
                        }
                      }}
                      placeholder="Örn. K9M4P2"
                      autoComplete="off"
                      autoCapitalize="characters"
                      className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 font-mono text-sm font-semibold tracking-wider text-slate-900 placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:bg-slate-900"
                    />
                    <button
                      type="submit"
                      disabled={!joinInput.trim()}
                      className="min-h-[44px] shrink-0 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white whitespace-nowrap"
                    >
                      Katıl
                    </button>
                  </div>
                </form>

                <button
                  type="button"
                  onClick={() => setScannerOpen(true)}
                  className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <QrCode className="h-4 w-4" aria-hidden="true" />
                  <span>Kamera ile QR Tara</span>
                </button>
              </div>
            )}

            {transfer.connectionState === 'connecting' && (
              <div className="py-8 text-center">
                <RefreshCw
                  className="mx-auto h-7 w-7 animate-spin text-blue-600"
                  aria-hidden="true"
                />
                <p className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-100">
                  Sinyalleşme sunucusuna bağlanılıyor…
                </p>
                <button
                  type="button"
                  onClick={transfer.leaveRoom}
                  className="mt-5 min-h-[40px] rounded-lg px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  İptal Et
                </button>
              </div>
            )}

            {transfer.connectionState === 'pending-approval' && (
              <div className="py-6 text-center">
                <KeyRound
                  className="mx-auto h-8 w-8 text-amber-500"
                  aria-hidden="true"
                />
                <h2 className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">
                  Oda Sahibi Onayı Bekleniyor
                </h2>
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                    {transfer.roomCode}
                  </span>{' '}
                  odasına katılım isteğiniz gönderildi. Karşı cihaz onayladığında aktarım başlayacak.
                </p>
                <button
                  type="button"
                  onClick={transfer.leaveRoom}
                  className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Vazgeç
                </button>
              </div>
            )}

            {transfer.connectionState === 'waiting-peer' && (
              <div className="space-y-5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                      Cihaz Bekleniyor
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500 tabular-nums dark:text-slate-400">
                      Kalan süre: {formatCountdown(transfer.expiresAt, now)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={transfer.leaveRoom}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap"
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Kapat</span>
                  </button>
                </div>

                <QrDisplay code={transfer.roomCode} shareUrl={transfer.shareUrl} />

                {/* Manual Code Pairing Approval Requests */}
                {transfer.pendingRequests.length > 0 && (
                  <div className="space-y-2.5 border-t border-slate-200 pt-4 dark:border-slate-800">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Katılım İsteği
                    </p>
                    {transfer.pendingRequests.map((req) => (
                      <div
                        key={req.requestId}
                        className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900/50 dark:bg-amber-950/30"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                            {req.deviceName || 'Bilinmeyen Cihaz'}
                          </p>
                          <p className="text-xs text-slate-600 dark:text-slate-400">
                            Oda koduyla bağlanmak istiyor
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => transfer.rejectPairRequest(req.requestId)}
                            aria-label="Reddet"
                            className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                          >
                            <X className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => transfer.approvePairRequest(req.requestId)}
                            className="inline-flex min-h-[40px] items-center gap-1 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700"
                          >
                            <Check className="h-4 w-4" aria-hidden="true" />
                            <span>Onayla</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {transfer.connectionState === 'paired' && (
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                      <span className="text-xs font-semibold">Eşleşme Aktif</span>
                    </div>
                    <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
                      {transfer.peerDeviceName || 'Karşı Cihaz'}
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500 tabular-nums dark:text-slate-400">
                      <span>Oda: {transfer.roomCode}</span>
                      <span className="mx-1.5" aria-hidden="true">·</span>
                      <span>{transfer.role === 'host' ? 'Oda Sahibi' : 'Katılımcı'}</span>
                      <span className="mx-1.5" aria-hidden="true">·</span>
                      <span>{formatCountdown(transfer.expiresAt, now)}</span>
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={transfer.leaveRoom}
                    className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Bağlantıyı Kes</span>
                  </button>
                </div>

                <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 dark:text-slate-400">Aktarım Kanalı</span>
                    <span className="inline-flex items-center gap-1.5 font-medium text-slate-900 dark:text-slate-100">
                      {transfer.transportMode === 'webrtc' ? (
                        <>
                          <Wifi className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                          <span>WebRTC DataChannel (Doğrudan P2P)</span>
                        </>
                      ) : transfer.transportMode === 'relay' ? (
                        <>
                          <Lock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                          <span>Şifreli Relay (AES-GCM-256)</span>
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 animate-spin text-blue-600" aria-hidden="true" />
                          <span>Doğrudan bağlantı deneniyor…</span>
                        </>
                      )}
                    </span>
                  </div>

                  {transfer.transportMode !== 'relay' && (
                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={transfer.switchToEncryptedRelay}
                        className="text-xs font-medium text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-400"
                      >
                        Doğrudan bağlantı yavaşsa Şifreli Relay&rsquo;e geç
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Right Column: Bidirectional File & Folder Transfer Workspace */}
          <div className="lg:col-span-7">
            <TransferWorkspace
              connectionState={transfer.connectionState}
              transportMode={transfer.transportMode}
              outgoingQueue={transfer.outgoingQueue}
              incomingFiles={transfer.incomingFiles}
              onAddFiles={transfer.addFiles}
              onMoveItem={transfer.moveQueueItem}
              onRemoveItem={transfer.removeQueueItem}
              onCancelTransfer={transfer.cancelOutgoingTransfer}
              onResumeTransfer={transfer.resumeOutgoingTransfer}
              onClearCompleted={transfer.clearCompletedOutgoing}
              onClearReceived={transfer.clearReceivedFiles}
            />
          </div>
        </div>

        {/* How It Works & Security Overview */}
        <section
          id="nasil-calisir"
          className="mt-12 border-t border-slate-200 pt-10 dark:border-slate-800"
        >
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Nasıl çalışır ve verileriniz nasıl korunur?
          </h2>

          <div id="guvenlik" className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#131924]">
              <Laptop className="h-5 w-5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <h3 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                1. Geçici Oda ve Onaylı Eşleşme
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                Oturum token&rsquo;ı sunucuda yalnızca SHA-256 özeti olarak tutulur. QR ile doğrudan
                veya 6 karakterli kodla oda sahibi onayından sonra eşleşme tamamlanır. Odalar 10
                dakika sonra otomatik silinir.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#131924]">
              <Wifi className="h-5 w-5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <h3 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                2. Doğrudan WebRTC Aktarımı
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                Uygun ağlarda dosyalar ve klasör yapıları WebRTC DataChannel üzerinden doğrudan
                iki cihaz arasında aktarılır; dosya içeriği sinyalleşme sunucusuna uğramaz.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#131924]">
              <ShieldCheck className="h-5 w-5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <h3 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                3. AES-GCM Şifreli Relay Yedeği
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                NAT veya güvenlik duvarı P2P bağlantıyı engellediğinde aktarım otomatik olarak
                AES-GCM-256 ile şifrelenmiş geçici relay kanalına geçer. Sunucu şifreli paketleri
                saklamaz, yalnızca iletir.
              </p>
            </div>
          </div>

          <p className="mt-5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Android cihazlarda uygulamayı &ldquo;Uygulamayı Kur&rdquo; ile PWA olarak yüklediğinizde
            veya Capacitor Android projesinden derlenen APK kurulduğunda, herhangi bir dosyada
            <span className="font-medium text-slate-700 dark:text-slate-300"> Paylaş</span> menüsüne
            dokunduğunuzda File Drop doğrudan paylaşım hedefi olarak listelenir.
          </p>
        </section>
      </main>

      <QrScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={(rawText) => {
          setJoinInput(rawText);
          transfer.joinRoom(rawText);
        }}
      />
    </div>
  );
};
