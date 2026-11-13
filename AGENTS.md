# ExtViaNats geliştirme kuralları

- Hedefler Windows ve Linux üzerinde Chrome 120+; kontrol araçları Node.js 22+.
- Eklenti Chrome API'lerini, kontrol katmanı taşınabilir Node API'lerini kullanır. PowerShell, Windows Registry, UI Automation veya sabit kullanıcı/profil yollarını ortak çalışma yoluna ekleme.
- NATS adresi yapılandırılabilir: yerelde ws, bulutta wss. TCP/monitoring portunu WebSocket portu sanma; açıkça ayarlanmış adresi kullan.
- Komut yürütücüsünün kaynağı `src/executor.js`; `extension/background.js` derlenmiş çıktıdır. Değişiklik sonrası `npm run build` çalıştır.
- Bu depo kendi kendine yeterlidir: başka bir projeye yol, marka veya bağımlılık referansı ekleme. Mimari kararları `docs/architecture.md` içinde belgele.
- Bütün komutlarda kesin `inst` gerekir; maili profil kimliği sayma. Paralel komutları aynı profilde çalıştırma.
- dnd, follow, sahiplik işaretleri, cleanup ve sırların tarayıcı içinde kalması davranışlarını koru. NATS mesajına ham DOM sırlarını veya kimlik bilgilerini koyma.
- Yetkilendirme sınırı NATS ACL'dir. Bu depoda olmayan bir pairing/JWT/Hub protokolünü varmış gibi belgeleme.
- `npm test` gerçek yerel NATS + taklit Chrome API entegrasyonunu kontrol eder. Chrome/Linux/WAN üzerinde denenmeyen şeyi doğrulanmış sayma. Canlı profil işlemlerinde hedefi ve açık kullanıcı yetkisini kontrol et.
- Kalıcı proje kararlarında kurulu mem0-memory skill'ini kullan; proje adı `ext-via-nats`. Sırları kaydetme. Mem0 yazısını geri okuyarak doğrula.
