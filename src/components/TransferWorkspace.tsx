import React, { useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Download,
  File as FileIcon,
  FolderOpen,
  Image as ImageIcon,
  Play,
  Plus,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { formatBytes, formatEta, formatSpeed } from '../../shared/transfer';
import type { IncomingFileItem, OutgoingQueueItem, RoomConnectionState, TransportMode } from '../hooks/useTransfer';

interface TransferWorkspaceProps {
  connectionState: RoomConnectionState;
  transportMode: TransportMode;
  outgoingQueue: OutgoingQueueItem[];
  incomingFiles: IncomingFileItem[];
  onAddFiles: (files: FileList | File[], explicitPaths?: string[]) => void;
  onMoveItem: (id: string, direction: 'up' | 'down') => void;
  onRemoveItem: (id: string) => void;
  onCancelTransfer: (id: string) => void;
  onResumeTransfer: (id: string) => void;
  onClearCompleted: () => void;
  onClearReceived: () => void;
}

interface DroppedEntryResult {
  files: File[];
  paths: string[];
}

async function readFileEntry(entry: FileSystemFileEntry, basePath: string): Promise<DroppedEntryResult> {
  return new Promise((resolve) => {
    entry.file(
      (file) => {
        const relPath = basePath ? `${basePath}/${file.name}` : file.name;
        resolve({ files: [file], paths: [relPath] });
      },
      () => resolve({ files: [], paths: [] })
    );
  });
}

async function readDirectoryEntry(
  entry: FileSystemDirectoryEntry,
  basePath: string
): Promise<DroppedEntryResult> {
  const reader = entry.createReader();
  const allEntries: FileSystemEntry[] = [];

  const readBatch = (): Promise<FileSystemEntry[]> =>
    new Promise((resolve) => {
      reader.readEntries(
        (entries) => resolve(entries),
        () => resolve([])
      );
    });

  while (true) {
    const batch = await readBatch();
    if (batch.length === 0) break;
    allEntries.push(...batch);
  }

  const nextBase = basePath ? `${basePath}/${entry.name}` : entry.name;
  const files: File[] = [];
  const paths: string[] = [];

  for (const child of allEntries) {
    if (child.isFile) {
      const res = await readFileEntry(child as FileSystemFileEntry, nextBase);
      files.push(...res.files);
      paths.push(...res.paths);
    } else if (child.isDirectory) {
      const res = await readDirectoryEntry(child as FileSystemDirectoryEntry, nextBase);
      files.push(...res.files);
      paths.push(...res.paths);
    }
  }

  return { files, paths };
}

export const TransferWorkspace: React.FC<TransferWorkspaceProps> = ({
  connectionState,
  transportMode,
  outgoingQueue,
  incomingFiles,
  onAddFiles,
  onMoveItem,
  onRemoveItem,
  onCancelTransfer,
  onResumeTransfer,
  onClearCompleted,
  onClearReceived,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [previewModal, setPreviewModal] = useState<{ url: string; name: string } | null>(null);

  const isPaired = connectionState === 'paired';
  const transportLabel =
    transportMode === 'webrtc'
      ? 'WebRTC Doğrudan'
      : transportMode === 'relay'
      ? 'Şifreli Relay (AES-GCM)'
      : transportMode === 'negotiating'
      ? 'Bağlantı kuruluyor…'
      : 'Eşleşme bekleniyor';

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const items = e.dataTransfer?.items;
    if (items && items.length > 0 && typeof items[0].webkitGetAsEntry === 'function') {
      const files: File[] = [];
      const paths: string[] = [];
      const entries: FileSystemEntry[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry();
        if (entry) entries.push(entry);
      }

      for (const entry of entries) {
        if (entry.isFile) {
          const res = await readFileEntry(entry as FileSystemFileEntry, '');
          files.push(...res.files);
          paths.push(...res.paths);
        } else if (entry.isDirectory) {
          const res = await readDirectoryEntry(entry as FileSystemDirectoryEntry, '');
          files.push(...res.files);
          paths.push(...res.paths);
        }
      }

      if (files.length > 0) {
        onAddFiles(files, paths);
        return;
      }
    }

    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      onAddFiles(e.dataTransfer.files);
    }
  };

  const completedIncoming = incomingFiles.filter((f) => f.status === 'completed' && f.downloadUrl);

  const handleDownloadAll = () => {
    completedIncoming.forEach((item, index) => {
      if (!item.downloadUrl) return;
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = item.downloadUrl!;
        a.download = item.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, index * 150);
    });
  };

  return (
    <div className="space-y-6">
      {/* Dropzone & Queue Picker */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-[#131924]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Dosya ve Klasör Gönder
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              <span>İki yönlü aktarım</span>
              <span className="mx-1.5" aria-hidden="true">·</span>
              <span>{transportLabel}</span>
            </p>
          </div>
          {outgoingQueue.some((i) => i.status === 'completed' || i.status === 'canceled') && (
            <button
              type="button"
              onClick={onClearCompleted}
              className="min-h-[40px] rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              Tamamlananları Temizle
            </button>
          )}
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => void handleDrop(e)}
          className={`mt-4 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
            isDragging
              ? 'border-blue-600 bg-blue-50/70 dark:border-blue-500 dark:bg-blue-950/30'
              : 'border-slate-200 bg-slate-50/60 dark:border-slate-700/80 dark:bg-slate-900/40'
          }`}
        >
          <Upload
            className="mx-auto h-7 w-7 text-slate-400 dark:text-slate-500"
            aria-hidden="true"
          />
          <p className="mt-2.5 text-sm font-medium text-slate-800 dark:text-slate-200">
            Dosyaları veya klasörleri buraya sürükleyip bırakın
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {isPaired
              ? 'Kuyruğa eklenen dosyalar karşı cihaza otomatik aktarılır.'
              : 'Eşleşme öncesi kuyruk hazırlayabilirsiniz; bağlantı kurulunca aktarım başlar.'}
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#131924] whitespace-nowrap"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Dosya Seç</span>
            </button>

            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <FolderOpen className="h-4 w-4" aria-hidden="true" />
              <span>Klasör Seç</span>
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) onAddFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            // @ts-expect-error webkitdirectory is supported by Chromium/WebKit/Firefox
            webkitdirectory=""
            directory=""
            className="hidden"
            onChange={(e) => {
              if (e.target.files) onAddFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {/* Outgoing Queue */}
        {outgoingQueue.length > 0 && (
          <div className="mt-5 divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
            {outgoingQueue.map((item, idx) => {
              const pct =
                item.size > 0
                  ? Math.min(100, Math.round((item.bytesTransferred / item.size) * 100))
                  : item.status === 'completed'
                  ? 100
                  : 0;
              const isActive = item.status === 'transferring' || item.status === 'offering';
              const isQueued = item.status === 'queued';

              return (
                <div key={item.id} className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    {item.previewUrl ? (
                      <button
                        type="button"
                        onClick={() => setPreviewModal({ url: item.previewUrl!, name: item.name })}
                        aria-label={`${item.name} görselini büyüt`}
                        className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-700 dark:bg-slate-800"
                      >
                        <img
                          src={item.previewUrl}
                          alt={item.name}
                          className="h-full w-full object-cover"
                        />
                      </button>
                    ) : (
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {item.mimeType.startsWith('image/') ? (
                          <ImageIcon className="h-5 w-5" aria-hidden="true" />
                        ) : (
                          <FileIcon className="h-5 w-5" aria-hidden="true" />
                        )}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {item.relativePath}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 tabular-nums dark:text-slate-400">
                        <span>{formatBytes(item.size)}</span>
                        <span aria-hidden="true">·</span>
                        {item.status === 'queued' && <span>Sırada bekliyor</span>}
                        {item.status === 'offering' && <span>Alıcı onayı bekleniyor…</span>}
                        {item.status === 'transferring' && (
                          <span className="text-blue-600 dark:text-blue-400">
                            %{pct} · {formatSpeed(item.speedBytesPerSec)} · Kalan:{' '}
                            {formatEta(item.etaSeconds)}
                          </span>
                        )}
                        {item.status === 'completed' && (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Gönderildi</span>
                          </span>
                        )}
                        {item.status === 'canceled' && (
                          <span className="text-amber-600 dark:text-amber-400">
                            Duraklatıldı (%{pct})
                          </span>
                        )}
                        {item.status === 'error' && (
                          <span className="text-rose-600 dark:text-rose-400">
                            {item.error || 'Hata oluştu'}
                          </span>
                        )}
                      </div>

                      {(isActive || item.status === 'canceled') && (
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            className={`h-full transition-all ${
                              item.status === 'canceled' ? 'bg-amber-500' : 'bg-blue-600'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center justify-end gap-1">
                    {isQueued && (
                      <>
                        <button
                          type="button"
                          onClick={() => onMoveItem(item.id, 'up')}
                          disabled={idx === 0}
                          aria-label={`${item.name} sırasını yukarı taşı`}
                          className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-slate-400 dark:hover:bg-slate-800"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onMoveItem(item.id, 'down')}
                          disabled={idx === outgoingQueue.length - 1}
                          aria-label={`${item.name} sırasını aşağı taşı`}
                          className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-slate-400 dark:hover:bg-slate-800"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>
                      </>
                    )}

                    {isActive && (
                      <button
                        type="button"
                        onClick={() => onCancelTransfer(item.id)}
                        aria-label={`${item.name} aktarımını iptal et`}
                        className="inline-flex min-h-[40px] items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-rose-600 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-rose-400 dark:hover:bg-rose-950/40"
                      >
                        <XCircle className="h-4 w-4" aria-hidden="true" />
                        <span>İptal</span>
                      </button>
                    )}

                    {(item.status === 'canceled' || item.status === 'error') && (
                      <button
                        type="button"
                        onClick={() => onResumeTransfer(item.id)}
                        className="inline-flex min-h-[40px] items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-blue-600 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-400 dark:hover:bg-blue-950/40"
                      >
                        <Play className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Sürdür</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onRemoveItem(item.id)}
                      aria-label={`${item.name} dosyasını listeden çıkar`}
                      className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Incoming / Received Files */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-[#131924]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Gelen Dosyalar
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {incomingFiles.length === 0
                ? 'Henüz dosya alınmadı'
                : `${incomingFiles.length} dosya · Yalnızca tarayıcı belleğinde geçici olarak tutulur`}
            </p>
          </div>

          {completedIncoming.length > 0 && (
            <div className="flex items-center gap-2">
              {completedIncoming.length > 1 && (
                <button
                  type="button"
                  onClick={handleDownloadAll}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Tümünü İndir</span>
                </button>
              )}
              <button
                type="button"
                onClick={onClearReceived}
                className="min-h-[40px] rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                Temizle
              </button>
            </div>
          )}
        </div>

        {incomingFiles.length === 0 ? (
          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-800/70 dark:bg-slate-900/30 dark:text-slate-400">
            Karşı cihaz dosya gönderdiğinde burada ilerleme durumu, görsel önizleme ve indirme bağlantısı görünür.
          </div>
        ) : (
          <div className="mt-4 divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
            {incomingFiles.map((file) => {
              const pct =
                file.size > 0
                  ? Math.min(100, Math.round((file.bytesReceived / file.size) * 100))
                  : file.status === 'completed'
                  ? 100
                  : 0;

              return (
                <div
                  key={file.id}
                  className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {file.previewUrl ? (
                      <button
                        type="button"
                        onClick={() => setPreviewModal({ url: file.previewUrl!, name: file.name })}
                        aria-label={`${file.name} görselini büyüt`}
                        className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:border-slate-700 dark:bg-slate-800"
                      >
                        <img
                          src={file.previewUrl}
                          alt={file.name}
                          className="h-full w-full object-cover"
                        />
                      </button>
                    ) : (
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        <FileIcon className="h-5 w-5" aria-hidden="true" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {file.relativePath}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 tabular-nums dark:text-slate-400">
                        <span>{formatBytes(file.size)}</span>
                        <span aria-hidden="true">·</span>
                        {file.status === 'receiving' && (
                          <span className="text-blue-600 dark:text-blue-400">
                            %{pct} · {formatSpeed(file.speedBytesPerSec)} · Kalan:{' '}
                            {formatEta(file.etaSeconds)}
                          </span>
                        )}
                        {file.status === 'completed' && (
                          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Hazır</span>
                          </span>
                        )}
                        {file.status === 'canceled' && (
                          <span className="text-amber-600 dark:text-amber-400">
                            Gönderici duraklattı (%{pct})
                          </span>
                        )}
                      </div>

                      {file.status === 'receiving' && (
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            className="h-full bg-blue-600 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {file.status === 'completed' && file.downloadUrl && (
                    <a
                      href={file.downloadUrl}
                      download={file.name}
                      className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white whitespace-nowrap"
                    >
                      <Download className="h-4 w-4" aria-hidden="true" />
                      <span>İndir</span>
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Lightbox Image Preview Modal */}
      {previewModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={previewModal.name}
          onClick={() => setPreviewModal(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-2xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 p-3 shadow-2xl"
          >
            <img
              src={previewModal.url}
              alt={previewModal.name}
              className="max-h-[75vh] w-auto rounded-xl object-contain"
            />
            <div className="mt-2 flex items-center justify-between gap-4 px-1">
              <span className="truncate text-xs font-medium text-slate-200">{previewModal.name}</span>
              <button
                type="button"
                onClick={() => setPreviewModal(null)}
                className="min-h-[36px] rounded-lg bg-slate-800 px-3 text-xs font-medium text-slate-200 hover:bg-slate-700"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
