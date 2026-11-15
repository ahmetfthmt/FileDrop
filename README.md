
File Drop; hesap açmadan, kalıcı dosya depolamadan ve dosyaları varsayılan olarak bir üçüncü taraf servise yüklemeden çalışmak üzere tasarlanmıştır. Uygun ağlarda dosyalar WebRTC DataChannel üzerinden doğrudan iki cihaz arasında aktarılır. Doğrudan WebRTC bağlantısı kurulamazsa, uygulama uçtan uca şifrelenmiş geçici relay aktarımına geri döner.

Özellikler
• Oda oluşturma ve odaya katılma
• 6 karakterli oda kodu
• QR kodu oluşturma, paylaşma ve kamera ile tarama
• Telefon, tablet ve bilgisayar uyumlu mobil öncelikli arayüz
• PWA olarak kurulabilme
• Android için Capacitor kabuğu
• Android WebView bağlantı sorunları için native OkHttp WebSocket eklentisi
• WebRTC DataChannel ile doğrudan cihazdan cihaza aktarım
• WebRTC bağlantısı kurulamazsa AES-GCM ile şifrelenmiş geçici relay aktarımı
• Dosya kuyruğu oluşturma, sırayı değiştirme ve dosya çıkarma
• Klasör seçme ve göreli klasör yolunu koruma
• Görsel dosya önizlemeleri
• Aktarım ilerlemesi, hız ve tahmini kalan süre göstergesi
• Aktarımı iptal etme ve uygun durumda kaldığı yerden sürdürme
• Iki yönlü dosya aktarımı
• Açık/koyu/sistem teması
• Erişilebilir odak durumları ve klavye ile temel kullanım
• Oda süresi, katılım denemesi ve aktif oda sayısı için sunucu sınırları
Nasıl çalışır?
1. Oda oluşturma
Oda sahibi cihazı /api/signal WebSocket uç noktasına bağlanır ve create mesajı gönderir.
Sunucu rastgele bir oda kodu ve uzun bir oturum token’ı oluşturur. Token sunucuda
yalnızca SHA-256 özeti olarak tutulur.
Oda bilgisi QR koduna ve paylaşılabilir bağlantıya dönüştürülür. Oda varsayılan olarak 10
dakika aktiftir; aktivite olduğunda süresi yenilenir.
2. Odaya katılma
Ikinci cihaz QR kodunu okur veya oda kodunu elle girer. QR bağlantısında oturum token’ı
varsa eşleşme doğrudan yapılabilir. Sadece oda kodu kullanılıyorsa, ikinci cihazın isteği oda
sahibine pair-request olarak iletilir ve oda sahibi eşleşmeyi onaylar.
3. WebRTC bağlantısı
Eşleşme sonrasında cihazlar WebRTC teklif, cevap ve ICE adaylarını WebSocket sinyalleşme
sunucusu üzerinden değiştirir. Dosya içeriği sinyalleşme sunucusundan geçmez; uygun
ağlarda dosya WebRTC DataChannel üzerinden cihazlar arasında gider.
4. Şifreli relay geri dönüşü
Bazı NAT, güvenlik duvarı veya operatör ağlarında doğrudan WebRTC bağlantısı
kurulamayabilir. Bu durumda host cihazı rastgele bir AES-GCM anahtarı üretir ve anahtarı
WebRTC sinyalleşme kanalında karşı cihaza iletir. Relay paketleri sunucu üzerinden geçse
bile içerikleri AES-GCM ile şifrelenir.
Relay modu dosyanın sunucuda kalıcı olarak saklandığı anlamına gelmez. Sunucu yalnızca
şifreli geçici paketleri iki WebSocket bağlantısı arasında iletir.
Teknoloji yığını
Istemci
• React 19
• TypeScript
• Vite
• Tailwind CSS 4
• Radix UI tabanlı bileşenler• WebRTC DataChannel
• Capacitor Android
• qrcode ile QR üretimi
• jsqr ile QR tarama
Sunucu
• Node.js
• Express
• TypeScript
• ws WebSocket sunucusu
• tRPC altyapısı şablondan gelir; dosya transferinin temel oda/sinyalleşme akışı
doğrudan WebSocket mesajlarıyla çalışır.
Android
• Capacitor Android
• OkHttp WebSocket
• NativeSocket Capacitor eklentisi
• HTTPS/WSS bağlantısı
• Kamera ve internet izinleri
Proje yapısı
Plain Text
.
├── android/
│ └── app/src/main/java/space/manus/filedrop/debug/
│ ├── MainActivity.java
│ └── NativeSocketPlugin.java
├── client/
│ ├── src/
│ │ ├── hooks/useTransfer.ts # Oda, WebRTC ve dosya transfer mantığı
│ │ ├── lib/nativeSocket.ts # Android native WebSocket köprüsü
│ │ ├── lib/runtime.ts # Sunucu ve WSS URL seçimi
│ │ └── pages/Home.tsx # Ana kullanıcı arayüzü
│ └── public/
├── docs/
│ └── device-network-test-plan.md # Gerçek cihaz/ağ test planı├── server/
│ ├── signaling.ts │ ├── signaling.test.ts
│ ├── transfer.test.ts
│ └── _core/index.ts ├── shared/
│ └── transfer.ts ├── capacitor.config.ts
├── package.json
└── README.md
# Oda ve WebSocket sinyalleşmesi
# Express sunucusu ve upgrade bağlantısı
# Ortak transfer yardımcıları ve kuralla
Gereksinimler
• Node.js 20 veya üzeri
• pnpm
• Android derlemesi için Android SDK ve JDK
• Gerçek cihazlar arası kullanımda HTTPS yayın adresi
• Android uygulamasında sinyalleşme için WSS erişimi
Kurulum
Bash
git clone <depo-adresi>
cd file-drop
pnpm install
Geliştirme sunucusunu başlatmak için:
Bash
pnpm dev
Üretim build’i için:
Bash
pnpm run build
NODE_ENV=production pnpm start
Istemci, sinyalleşme adresini şu kuralla belirler:1. VITE_REMOTE_ORIGIN varsa onu kullanır.
2. Yoksa mevcut sayfanın origin’ini kullanır.
3. https: adresini wss: adresine, http: adresini ws: adresine çevirir.
4. WebSocket yolu her zaman /api/signal olur.
Örnek:
Bash
VITE_REMOTE_ORIGIN=https://example.com pnpm run build
Bu durumda sinyalleşme adresi:
Plain Text
wss://example.com/api/signal
Android debug APK
Android kaynakları Capacitor ile senkronize etmek ve debug APK üretmek için:
Bash
export VITE_REMOTE_ORIGIN=https://example.com
pnpm run android:debug
APK şu konumda oluşur:
Plain Text
android/app/build/outputs/apk/debug/app-debug.apk
VITE_REMOTE_ORIGIN verilmeden Android debug build’i çalıştırılmaz. Bu, APK’nın
yanlışlıkla yalnızca yerel bilgisayar adresine bağlanmasını önlemek içindir.
Mevcut doğrulanmış debug APK:
• Dosya: file-drop-debug-native-websocket.apk
• Boyut: yaklaşık 8,3 MB
• SHA-256: 1bb4e59afc672f4ce0f35819957676692b02a2079b7ddfd29d9ead210e3fb388
• Paket kimliği: space.manus.filedrop.debug
• Imza: debug imzası; mağaza dağıtımı için production/release signing gerekir.