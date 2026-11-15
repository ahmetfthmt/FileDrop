# File Drop

Cihazlar arasında (telefon, tablet ve bilgisayar) hesap açmadan ve dosyaları kalıcı olarak depolamadan, QR kodu veya 6 karakterli oda koduyla doğrudan dosya ve klasör aktarımı yapan mobil öncelikli web (PWA) ve Android (Capacitor) uygulaması.

## Özellikler

- **Hızlı Eşleşme**: 6 karakterli oda kodu, paylaşılabilir bağlantı, QR kod oluşturma ve kamera ile QR tarama (`qrcode`, `jsqr`).
- **Doğrudan P2P Aktarım**: Uygun ağlarda dosyalar WebRTC DataChannel üzerinden doğrudan cihazdan cihaza gider.
- **Şifreli Relay Yedeği**: NAT veya güvenlik duvarı P2P bağlantıyı engellediğinde aktarım otomatik olarak **AES-GCM-256** ile şifrelenmiş geçici relay kanalına geçer; sunucu dosyaları saklamaz.
- **İki Yönlü Kuyruk ve Klasör Desteği**: Çoklu dosya/klasör seçimi, göreli klasör yolu koruması, sıra değiştirme, görsel önizleme, hız/kalan süre (ETA) takibi, iptal ve kaldığı yerden sürdürme.
- **PWA ve Android Paylaşım Hedefi**: Android'de PWA olarak kurulduğunda (`Web Share Target`) veya Capacitor APK üzerinden kurulduğunda sistem **Paylaş** menüsünde görünür; paylaşılan dosyalar doğrudan gönderim kuyruğuna eklenir.
- **Güvenlik ve Sınırlar**: SHA-256 özetli oturum token'ları, manuel kodda oda sahibi onayı, 10 dakikalık yenilenebilir oda süresi, IP başına hız sınırı ve 100.000 karakter relay paket limiti.

## Teknoloji Yığını

- **İstemci**: React 19, TypeScript, Vite, Tailwind CSS 4, `vite-plugin-pwa`, WebRTC DataChannel, Web Crypto API (AES-GCM)
- **Sunucu**: Node.js, Express, `ws` (`/api/signal` WebSocket sinyalleşme ve geçici şifreli relay)
- **Android**: Capacitor Android kabuğu (`NativeSocketPlugin` OkHttp WebSocket + `ShareIntakePlugin` sistem paylaşım köprüsü)

## Kurulum ve Çalıştırma

Gereksinimler: **Node.js 20+** ve **npm**.

```bash
npm install
npm run dev
```

Uygulama varsayılan olarak `http://localhost:3000` adresinde çalışır.

### Üretim Derlemesi

```bash
npm run build
npm start
```

### Test ve Tip Kontrolü

```bash
npm run lint
npm test -- --run
```

## Android APK Derleme

Android Studio / Android SDK ve JDK 17 kurulu ortamda (veya `.github/workflows/android-apk.yml` GitHub Actions iş akışıyla) debug APK üretilebilir:

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
VITE_REMOTE_ORIGIN=https://<yayin-adresiniz> npm run build
npx cap sync android
cd android && gradle assembleDebug
```

Çıktı konumu: `android/app/build/outputs/apk/debug/app-debug.apk`

## Proje Yapısı

```text
├── android/                  # Capacitor Android projesi (ShareIntent & NativeSocket)
├── public/                   # PWA ikonları
├── server/
│   ├── signaling.ts          # Oda yönetimi, SHA-256 token ve WebSocket relay
│   ├── signaling.test.ts     # Sinyalleşme entegrasyon testleri
│   └── transfer.test.ts      # Yardımcı fonksiyon testleri
├── shared/
│   └── transfer.ts           # Ortak protokol tipleri ve doğrulayıcılar
├── src/
│   ├── components/           # QR görüntüleme/tarama, PWA kurulum ve transfer arayüzü
│   ├── hooks/                # useTransfer, useTheme, usePWAInstall
│   ├── lib/                  # Web Crypto AES-GCM, NativeSocket, ShareIntake
│   ├── pages/Home.tsx        # Ana uygulama ekranı
│   └── sw.ts                 # Workbox ve Web Share Target Service Worker
├── capacitor.config.ts
├── server.ts                 # Express + WebSocket + Vite sunucu giriş noktası
└── vite.config.ts
```

## Lisans

MIT
