# Remote Mesh

Gerçek Chrome profillerini Windows ve Linux üzerinde NATS üzerinden kontrol eden
MV3 eklentisi, CLI, MCP sunucusu ve isteğe bağlı profil başlatma node servisi.
`chrome-profile-manager/extension` temel alınmıştır; kaynak projeler değiştirilmez.
`organized` kodu taşınmamıştır; kimlik ve pencere sahipliği dokümanları referanstır.

```text
AI ajan / MCP istemcisi → scripts/mcp.mjs ── NATS ── Chrome eklentisi → sekmeler / DOM / JS
                                            └──── node-agent → disk profilleri / Chrome başlatma
```

Eklenti ve node dışarı doğru bağlanır. Uzak bilgisayarda HTTP kontrol portu açılmaz.
Yerel veya bulut NATS seçimi ayarlardan yapılır; IDE Mesh ile aynı broker kullanılabilir.
IDE Mesh Hub pairing/JWT ve IDE komutları bu projeye dahil değildir.

## Gereksinimler

- Eklenti: Windows veya Linux üzerinde Chrome 120+; anlık JavaScript `script` için Chrome 135+.
- CLI / MCP / node: Node.js 22+.
- NATS sunucusunda açık WebSocket listener. `nats://…:4222` TCP adresidir; monitoring portu da WebSocket değildir.
- Yerel Docker başlatıcısı ve varsayılan entegrasyon testi için çalışan Docker.

## Yerel deneme

Windows PowerShell veya Linux terminalinde proje kökünde:

```text
npm ci
npm run build
npm run nats:local
```

Bu komut `remote-mesh-nats` adlı Docker konteynerini başlatır ve yalnızca loopback'e
`ws://127.0.0.1:18222` açar. Mevcut `4222/8222` servislerine dokunmaz.
Kapatmak için `npm run nats:stop`. Docker kullanmadan:
`nats-server -c infra/nats-local.conf` (bu örneğin WS portu `8222`).

1. Chrome'un eklentiler sayfasında geliştirici modunu aç, **Paketlenmemiş öğe yükle**
   ile bu projenin `extension` klasörünü seç. Her hedef profile ayrıca yüklenmelidir.
2. Eklenti simgesinden seçenekleri aç. NATS adresini `ws://127.0.0.1:18222` yap,
   profil etiketini gir, bağlantıyı etkinleştir ve kaydet.
3. `script` kullanacaksan Chrome 138+ üzerinde eklenti ayrıntılarında **Kullanıcı
   scriptlerine izin ver** seçeneğini de aç. Eski desteklenen sürümlerde geliştirici
   modu kullanılır. Kapalıysa normal DOM komutları çalışır, `script` hata döner.
4. Profil kimliğini seçeneklerden veya CLI'den al.

Windows:

```powershell
$env:REMOTE_MESH_URL = 'ws://127.0.0.1:18222'
npm run remote -- list
npm run remote -- run PROFILE_INST examples/probe.json
```

Linux:

```bash
export REMOTE_MESH_URL='ws://127.0.0.1:18222'
npm run remote -- list
npm run remote -- run PROFILE_INST examples/probe.json
```

`PROFILE_INST` gerçek `arInst` UUID'sidir; mail veya profil klasörü değildir.
İlk deneme `version/whoami` dışında işlem yapmaz. `examples/browser.json` örnek siteyi açar.
Yeni bir iş için yeni komut id kullan; aynı id ve aynı içerik saklanan sonucu döndürür.

## AI ajanları / MCP

Genel MCP istemci örneği `examples/mcp.json`. `args` içindeki dosya yolunu mutlak
yap: Windows'ta `D:/projects/RemoteMeshExtension/scripts/mcp.mjs`, Linux'ta kurduğun
projenin mutlak yolu. Sunucu stdio kullanır; stdout yalnızca MCP protokolüdür.
MCP uygulamasına kaydetmek kendi başına tarayıcı komutu çalıştırmaz.

| Araç | İşlev |
|---|---|
| `remote_mesh_profiles` | Bağlı eklenti/profil kimliklerini bul |
| `remote_mesh_info` | Profil pencerelerini ve çalışan komutu gör |
| `remote_mesh_command` | Mevcut DOM/sekme komutlarını çalıştır |
| `remote_mesh_script` | Kesin profil/sekmede JavaScript çalıştır; dönüş değeri aktarılmaz |
| `remote_mesh_abort` | Çalışan komutu adım sınırında durdur |
| `remote_mesh_nodes` | Windows/Linux profil node servislerini bul |
| `remote_mesh_disk_profiles` | Node makinesinde kapalı profiller dahil envanter çıkar |
| `remote_mesh_launch_profile` | Profil kimliği veya tekil maille mevcut Chrome oturumunu aç |

Ajan akışı: bağlı profilleri listele → kesin `inst` seç → `version/whoami` ile
kontrol et → adımları çalıştır. Profil kapalıysa node ve disk envanterinden seç,
önizle, `apply:true` ile aç. Sonuçtaki `sessionId` ile eklenti listesindeki
`launch.run` ve `launch.profileId` alanlarını karşılaştır. Sürecin açılmış olması
siteye girişin veya doğru profil el sıkışmasının kanıtı değildir.

## Chrome kapalıyken profil hedefleme

Eklenti Chrome kapalıyken çalışamaz. O bilgisayarda isteğe bağlı node servisini
çalıştır. Windows veya Linux örneğini `.local/node.json` olarak kopyalayıp
`chromePath`, `nodeId`, `userDataPaths` alanlarını gerçek yollarla doldur:

```text
node scripts/node-agent.mjs .local/node.json
```

Node ve MCP aynı NATS hesabına/konu alanına erişmelidir. Her makine için farklı
`nodeId` kullan. İzin verilen User Data kökleri yalnızca node'un yerel config'inde
belirlenir; uzaktan keyfi dosya yolu veya çalıştırılabilir dosya seçilemez.
Node'u masaüstü oturumunun sahibi olarak çalıştır; root/SYSTEM kullanma.
Linux'ta grafik oturumu ve Chrome'un ihtiyaç duyduğu ortam değişkenleri gerekir.

Envanter yalnızca `Local State` ve profil `Preferences` kimlik metadata'sını okur.
Parola/çerez/oturum veritabanları okunmaz. Mail çakışmalarında ilk eşleşme seçilmez;
`profileId` ile açık seçim gerekir. Bilinen çocuk profilleri başlatılmaz.
Profil kimliği gerçek User Data yolu + klasöründen türetilir; `arInst` ayrıdır.

Başlatma `--user-data-dir`, `--profile-directory`, `--new-window` ve eklentinin
işaret sekmesini kullanır. Yeni site oturumu açmak veya kullanıcı parolası girmek
yerine profilin mevcut oturumunu kullanır. `apply:false` varsayılanı önizlemedir.
Node aynı config ile tek süreç çalıştırılmalıdır; request ledger config yanında
tutulur. Aynı `request_id` process yeniden başlasa da tekrar açmaz; belirsiz
sonuç `interrupted` döner. Otomatik profil oluşturma/eklenti kurulumu yoktur.

Eklenti kimliği public manifest key ile Windows/Linux arasında sabittir:
`ncfgllpgnoapgbomonfhbmhlcffmmnba`. Key'i değiştirme. Pencere cleanup'ı yalnızca
eklenti işaret sekmesini taşıyan pencereler için `close` komutuyla yapılır;
Chrome'un ortak PID'si üzerinden process kill yapılmaz.

## Yerel ve bulut bağlantısı

Eklenti seçenekleri ve kontrol araçları aynı broker ve öneki kullanmalı:

| Ayar / ortam değişkeni | Değer |
|---|---|
| `REMOTE_MESH_URL` | `ws://HOST:WS_PORT` veya `wss://HOST:PORT` |
| `REMOTE_MESH_PREFIX` | Varsayılan `mesh.browser` |
| `REMOTE_MESH_TOKEN` | Broker token |
| `REMOTE_MESH_USER` / `REMOTE_MESH_PASS` | Broker kullanıcı/parola |
| `REMOTE_MESH_CREDS` | CLI/MCP/node için yerel `.creds` dosyasının yolu |

Token, kullanıcı/parola veya `.creds` yöntemlerinden yalnızca birini kullan.
Eklenti seçeneklerine `.creds` dosyasının **içeriği** girilir. Eklenti kimlik
bilgileri Chrome Sync yerine yerel, yalnızca güvenilir eklenti bağlamlarının
okuyabildiği depoda tutulur; OS parola kasası şifrelemesi iddiası yoktur.

Cloud NATS WebSocket/TLS listener ve uygun hesap izinleri gerektirir. Bir bulut
servisinin TCP adresini otomatik WSS adresine çevirmeyiz. Aynı LAN'daki başka
cihaz için loopback örneği yeterli değildir; broker'ın erişilebilir listener,
firewall, TLS ve kimlik doğrulama ayarlarını yap.

Yerel örnek kimlik doğrulamasızdır. Üretimde her profilin kendi `cmd/info/abort`
konuları için ayrı kullanıcı yetkisi ver. Başlangıç ACL şablonu
`infra/nats-auth.example.conf`; gerçek profil/node kimlikleriyle düzenle ve WAN
için TLS ekle. Broker yetkisi olan controller tarayıcıyı yönetebilir; MCP tool
açıklamasındaki onay hatırlatması bir kriptografik approval gate değildir.

## Komut sözleşmesi ve sınırlar

Tam sözleşme ve kaynak eşlemesi: [docs/commands.md](docs/commands.md).
NATS konuları: [docs/architecture.md](docs/architecture.md).

- Tek profilde aynı anda tek komut; başka komut `busy`, aynı id `in_progress` döner.
- Son 100 komutun intent/sonucu yerel kayıtta kalır. Restart sonrası yarım kalan
  komut kendiliğinden tekrarlanmaz. Bu sınırlı kayıt, sonsuz exactly-once garantisi değildir.
- Abort adım sınırında uygulanır; çalışan sayfa scriptini anında kesmez. Cleanup adımları korunur.
- Ağ koparsa NATS Core offline kuyruğu sağlamaz. Süre aşımında yeni id ile kör retry
  yapma; önce aynı id ve aynı komut içeriğiyle durum/sonuç sorgula.
- Kaynak `relay/move/swap` DOM değerlerini tarayıcı içinde taşır. Arbitrary JS
  dönüş değerleri NATS'a çıkmaz. `query(text:true)` bilerek sayfa metni döndürebilir.
- Yerel relayd secret slot kullanan `put` bu doğrudan NATS sürümünde
  `local_secret_store_required` döner; secret ref'lerini buluta taşımıyoruz.
- `inject` buton/overlay ekler. Buton çağrısı `invoke` olayına dönüşür; kök projedeki
  `bindings.json` playbook servisi burada otomatik işletilmez.
- Windows UIA kurulum/rename, tüm Chrome'u kapatma ve siteye özel runner'lar taşınmadı.

## Doğrulama

```text
npm run build
npm test
```

Testler gerçek yerel NATS, taklit Chrome API'leri ve gerçek MCP stdio istemcisi
kullanır: profil izolasyonu, komut/receipt, sır taşımama, idempotency, abort,
worker restart ve profil envanteri/başlatma önizlemesi. `TEST_NATS_URL` verilirse
entegrasyon testi kendi Docker broker'ı yerine o test broker'ını kullanır;
`test.browser` namespace'i ayrılmalıdır.

Gerçek Chrome profilinde kurulum/DOM/JS/başlatma ve WAN/cloud kabulü ayrıca
yapılmalıdır; taklit Chrome testleri bunların yerini tutmaz.

Teknik referanslar: [NATS WebSocket istemcisi](https://nats-io.github.io/nats.js/core/index.html),
[Chrome WebSocket worker ömrü](https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets),
[Chrome userScripts](https://developer.chrome.com/docs/extensions/reference/api/userScripts),
[NATS authorization](https://docs.nats.io/running-a-nats-service/configuration/securing_nats/authorization).
