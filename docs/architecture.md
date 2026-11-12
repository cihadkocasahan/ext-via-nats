# Mimari ve kimlikler

## Katmanlar

`src/executor.js` kaynak eklentinin tarayıcı komutlarını taşır. `src/background.js`
HTTP poll yerine doğrudan NATS request/reply, kayıt, heartbeat, abort ve receipt
akışını sağlar. Beş saniyelik heartbeat ve NATS ping worker'ın canlı bağlantısını
korur; alarm bağlantı kesildiğinde tekrar denemek içindir. NATS istemcisi reconnect
sonrası abonelikleri yeniden kurar ve profil tekrar register gönderir.

`scripts/client.mjs` MCP/CLI'nin ortak kontrol istemcisidir. MCP, CLI ve doğrudan
NATS isteği aynı komut sözleşmesini kullanır. NATS Core kullanılır; kalıcı offline
kuyruğu, durable hub veya tek kullanımlık pairing servisi bulunmaz.

`scripts/node-agent.mjs` hedef masaüstünde çalıştırılan isteğe bağlı OS katmanıdır.
Sabitlenmiş Chrome executable ve izin verilmiş User Data kökleri dışında uzaktan
path almaz. Windows/Linux ortak `spawn(...,{shell:false})` kullanır. Chrome zaten
çalışıyorsa başlangıç süreci çıkıp isteği mevcut Chrome'a devredebilir. Bu yüzden
PID'yi pencere sahipliği saymaz veya process sonlandırmaz.

## Ayrı kimlikler

| Kimlik | Anlam |
|---|---|
| `nodeId` | Config'deki masaüstü makinesinin kimliği |
| `profileId` | Gerçek User Data kökü + profil klasörünün hash'i |
| `inst` / `arInst` | Eklentinin o profil için yerel depodaki UUID'si |
| `sessionId` / `launch.run` | Node'un tek başlatma isteğinin kimliği |
| komut `id` | Eklenti adım dizisinin idempotency kimliği |
| `windowId` / `tabId` | Chrome oturumuna ait tarayıcı içi hedefler |

Mail benzersiz profil kimliği değildir. Aynı mail birden fazla profile aitse
explicit `profileId` gerekir. Klonlanmış profil eklenti deposunu da klonlayabilir;
aynı `arInst`'i taşıyan profil kopyalarını aynı NATS hesabında çalıştırma.
İşaret sekmesi insan tarafından taşınabilir/kapatılabilir; bu sürümün sahiplik
kanıtı sekmenin o anki konumudur, native HWND/PID doğrulaması değildir.

## Konular

Varsayılan önek `mesh.browser`; payload'lar JSON'dur. Komut/info/abort gerçek NATS
`request()` ile gönderilir, sonuç `msg.reply` inbox'una döner. JSON içinde keyfi
`reply_to` desteklenmez.

| Konu | Yön / payload |
|---|---|
| `mesh.browser.discover` | Controller request → bütün eklentiler, her biri sessionInfo döner |
| `mesh.browser.cmd.<inst>` | Controller → `{id,steps,dnd?,follow?,onError?}` |
| `mesh.browser.info.<inst>` | Controller → `{}`, sessionInfo döner |
| `mesh.browser.abort.<inst>` | Controller → `{id}`, eşleşen çalışan komutu işaretler |
| `mesh.browser.register.<inst>` | Eklenti → profil/pencere/launch metadata |
| `mesh.browser.heartbeat.<inst>` | Eklenti → `{inst,label,running,timestamp}` |
| `mesh.browser.stream.<inst>` | Eklenti → started/step/done metadata |
| `mesh.browser.invoke.<inst>` | Enjekte edilen butondan `{id,inst,tabId}` olayı |
| `mesh.browser.node.discover` | Controller → bütün node servisleri |
| `mesh.browser.node.profiles.<nodeId>` | Controller → izinli disk profil envanteri |
| `mesh.browser.node.launch.<nodeId>` | Controller → `{profileId?,email?,requestId,url?,apply?}` |

`discover` çok yanıt alır; CLI belirlenen zaman penceresinde toplar. Online profil
listesi NATS Core'da geçmiş register mesajına bağlı değildir.

## Depolama ve yetki

Eklenti config/kimlik/son 100 komut ledger'ı yerel storage'da, geçici bağlantı
durumu session storage'dadır. Yerel storage erişimi `TRUSTED_CONTEXTS` ile
sınırlandırılır. Ledger'da komut içeriğinin SHA-256 hash'i ve receipt saklanır;
ham komut kodu veya taşınan DOM sırları saklanmaz. `query` receipt metni ve profil
metadata'sı kişisel bilgi içerebilir. Node ledger config yanında tutulur; tek
config için aynı anda yalnızca bir node servisi çalıştırılır.

NATS kimlik doğrulama token/user-password/creds ile yapılır. Yetki broker subject
ACL'idir; profile göre daraltılmalıdır. Dinamik script kodu sayfada kod yürütme
yetkisidir ve yalnızca yetkili kullanıcı/ajanlara açılmalıdır. Eklentinin
`userScripts` izni broker yetkisinden ayrıdır. Tarayıcı Web Store yayımlama ve
uzaktan script politikaları ayrıca değerlendirilmelidir; burada unpacked yükleme
hedeflenir.

## Kaynak doküman eşlemesi

- `chrome-profile-manager/relayd/README.md`: komut sözlüğü, dnd/follow, receipts.
- `chrome-profile-manager/docs/ide-mesh-uzaktan-erisim-modeli.md`: outbound NATS modeli.
- `chrome-profile-manager/docs/remote-control-platform-kararlar.md`: MCP yüzeyi, idempotency, profil sınırı.
- `chrome-profile-manager/organized/docs/architecture/execution-mode-policy.md`: background isteğini foreground'a düşürmeme ilkesi.
- `chrome-profile-manager/organized/docs/architecture/tracked-chrome-window-ownership.md`: PID/pencere ayrımı ve profile/session kimlikleri.

Buradaki node başlatma foreground masaüstü işlemidir. Background garantisi vermez;
tarayıcı içi `dnd` bundan ayrı bir komut ayarıdır. Windows UIA bağımlılığı alınmadı.
