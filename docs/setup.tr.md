# Kurulum

Üç şeyin birbiriyle uyuşması gerekir: **broker adresi**, **konu öneki** ve **kimlik
doğrulama yöntemi**. Eklenti ile kontrol tarafı (MCP veya CLI) birbirinden bağımsız
iki NATS istemcisidir; üçünden biri farklıysa hiç karşılaşmazlar.

## Gereksinimler

| Parça | Gereksinim |
|---|---|
| Tarayıcı | Windows veya Linux üzerinde Chrome 120+. `script` (gerçek JavaScript) için Chrome 135+ ve *Kullanıcı scriptlerine izin ver* seçeneği gerekir. |
| Kontrol tarafı | Node.js 22+ |
| Broker | **WebSocket** listener'ı açık herhangi bir NATS sunucusu |
| Yerel broker yardımcısı | Docker (yalnızca `npm run nats:local` için) |

**Bu projeyi kullanmak için hiçbir Chrome komut satırı bayrağı gerekmez.** Eklentiyi
normal arayüzden paketlenmemiş olarak kurarsınız. `--enable-unsafe-extension-debugging`
bayrağı yalnızca `scripts/test-chrome.mjs` ve `scripts/live-session.mjs` içinde geçer;
çünkü bu test koşumları eklentiyi elle değil CDP üzerinden kurar.

## 1 · Derleme

```bash
npm ci
npm run build
```

`extension/background.js` ve `extension/protocol.js` derleme çıktısıdır. Kaynaklar
`src/` altındadır. `src/` değiştikten sonra yeniden `npm run build` çalıştırın ve
eklentiyi `chrome://extensions` sayfasında yeniden yükleyin.

## 2 · Broker başlatma

### Seçenek A — yerel Docker (en hızlısı)

```bash
npm run nats:local     # başlat
npm run nats:stop      # durdur
```

`ext-via-nats-nats` adlı konteyneri başlatır ve **yalnızca loopback'te** yayınlar:

```text
ws://127.0.0.1:18222   →   konteyner WebSocket portu 8222
```

4222/8222 üzerindeki mevcut NATS servislerine dokunmaz. Broker kimlik doğrulamasız
ve yalnızca loopback'tir: projeyi denemek için uygun, başka bir makinenin
erişebileceği bir kullanım için değil.

### Seçenek B — kendi `nats-server` binary'niz

```bash
nats-server -c infra/nats-local.conf
```

Bu config loopback'te dinler; istemci TCP portu `4222`, WebSocket portu `8222`.
Yani eklenti adresi `ws://127.0.0.1:8222` olur.

> **WebSocket portunu bilinçli seçin.** Port, `websocket { port … }` içindeki
> değerdir. Stok bir `nats-server`'da `8222` *monitoring HTTP* portudur ve
> WebSocket tamamen kapalıdır; `4222` ise *yerli istemci TCP* portudur. İkisi de
> WebSocket konuşmaz. Eklentiyi bunlardan birine yönlendirmek, hiç başarılı
> olmayan bir bağlantı üretir.

### Seçenek C — zaten çalıştırdığınız bir broker

Onun WebSocket adresini kullanın. LAN'daki başka bir cihaz için loopback yetmez:
broker'ın erişilebilir bir listener'ı, firewall kuralı, TLS ve kimlik doğrulaması
olmalıdır. `infra/nats-auth.example.conf` ile başlayın (bkz. §8).

## 3 · Eklentiyi kurma

1. `chrome://extensions` sayfasını açın.
2. Sağ üstten **Geliştirici modu**nu açın.
3. **Paketlenmemiş öğe yükle**ye tıklayıp bu projenin `extension/` klasörünü seçin.
4. Kontrol etmek istediğiniz her Chrome profili için tekrarlayın. Her profil kendi
   kimliğini ve kendi ayarlarını alır.

Manifest sabit bir public key taşır; bu yüzden eklenti kimliği Windows ve Linux'ta
aynıdır: `ncfgllpgnoapgbomonfhbmhlcffmmnba`. Key'i değiştirmeyin.

## 4 · Ayar sayfasını doldurma

Eklentinin seçeneklerini açın (araç çubuğu simgesi → seçenekler, veya
`chrome-extension://<id>/options.html`). Sayfa iki dillidir — sağ üstten
**English / Türkçe** geçişi yapılır.

Önce bir ön seçim yapın:

- **Yerel veya kendi sunucunuz** — alan boşsa `ws://127.0.0.1:8222` doldurur ve
  yerel broker komutlarını gösterir.
- **NATS Cloud** — `wss://connect.ngs.global:443` doldurur ve hesap adımlarını
  gösterir. Bu genel uç nokta WebSocket üzerinden gerçek bir NATS el sıkışmasına
  yanıt verir; kimlik doğrulamasını yine sizin `.creds` dosyanız yapar. Hesap
  paneliniz farklı bir WebSocket adresi gösteriyorsa onu kullanın (bkz. §6).

Sonra şunları girin:

| Alan | Değer |
|---|---|
| Etiket | Bu profil için insan okunur bir ad, örn. `is-laptop`. Keşif listesinde görünür. |
| NATS adresi | `ws://HOST:WS_PORT` veya `wss://HOST:PORT` |
| Konu öneki | Varsayılan `extvianats.browser`. Kontrol tarafıyla aynı olmalı. |
| Kimlik doğrulama | Tam olarak biri: token, kullanıcı + parola, veya `.creds` **içeriği** |
| Etkinleştir | Açın, sonra **Kaydet** |

Durum satırı canlı bağlantı durumunu bildirir ve bu profilin `inst` değerini
gösterir. **O `inst` değerini kopyalayın** — profile özel bir UUID'dir ve geçerli
tek komut hedefidir. Mail adresi kimlik değildir; profil klasörü adı da değildir.

Kimlik bilgileri o profilin yerel eklenti deposunda tutulur ve yalnızca güvenilir
eklenti bağlamları okuyabilir. Chrome Sync'e gönderilmez ve hiçbir NATS mesajında
yer almaz. Bu depo bir işletim sistemi parola kasası değildir.

## 5 · Gerçek JavaScript'i etkinleştirme (isteğe bağlı)

`script`, kullanıcı tarafından yazılmış JavaScript'i `chrome.userScripts` üzerinden
çalıştırır. Chrome bunu bir seçeneğin arkasına koyar:

1. `chrome://extensions` → bu eklenti → **Ayrıntılar**.
2. **Kullanıcı scriptlerine izin ver** seçeneğini açın.

Bu bir arayüz seçeneğidir, komut satırı bayrağı değil. Kapalıyken bütün DOM
verbleri çalışır, `script` izin hatası döner. Açmak eklentiyi yeniden başlatır;
bu yüzden komut göndermeden önce ayar sayfasının yeniden *bağlı* bildirmesini
bekleyin.

## 6 · NATS Cloud

İki referans sayfa:

- [Quick start](https://docs.synadia.com/cloud/user-guides/quick-start) — hesap
  oluşturma, kullanıcı oluşturma, `.creds` dosyasını indirme.
- [HTTP Gateway](https://docs.synadia.com/cloud/http-gateway) — **burada kullanılmaz.**

Adımlar:

1. Giriş yapın ve bir **Account** oluşturun.
2. O hesapta bir **User** oluşturun.
3. Kullanıcının **Get Connected** panelini açın ve `.creds` dosyasını indirin.
4. NATS adresi alanı `wss://connect.ngs.global:443` ile önceden doludur. Hesabınızın
   **Get Connected** paneli farklı bir WebSocket adresi gösteriyorsa önceden
   doldurulan değeri onunla değiştirin.
5. `.creds` dosyasının **içeriğini** eklentinin kimlik bilgisi alanına yapıştırın.
   CLI ve MCP sunucusu ise dosya **yolu** alır (`EXT_VIA_NATS_CREDS`).

İki dürüst uyarı:

- Quick-start sayfasında `tls://connect.ngs.global` görünür. Bu, **yerli NATS
  istemcisinin** adresidir ve tarayıcı onu açamaz. Bu eklenti NATS'ı **WebSocket
  üzerinden** konuşur; bu yüzden bulut ön seçimi aynı host'un TLS portundaki
  `wss://connect.ngs.global:443` adresini doldurur. Bu adres kimlik doğrulaması
  olmadan yapılan bir NATS INFO el sıkışmasıyla denendi ve gerçekten WebSocket
  üzerinden yanıt veriyor; tahmin değil. Kimlik doğrulama yine sizde: geçerli bir
  `.creds` olmadan broker bağlantıyı reddeder. TCP (4222) ve monitoring (8222)
  portları da WebSocket konuşmaz.
- HTTP Gateway, `Authorization: Bearer` token'lı bir REST/HTTPS arayüzüdür. NATS'ın
  WebSocket üzerinden request/reply protokolünden farklıdır ve bu projenin parçası
  değildir.

Bulut kullanımı, WebSocket/TLS listener ve `docs/architecture.md` içindeki konulara
izin veren hesap yetkileri gerektirir. Bir sağlayıcının TCP adresi burada otomatik
olarak WSS adresine çevrilmez.

## 7 · Kontrol tarafı yapılandırması

### MCP

`examples/mcp.json` iki hazır sunucu girdisi içerir (yerel ve bulut). İhtiyacınız
olanı MCP istemcinizin yapılandırmasına kopyalayın ve `args` yolunu **mutlak** yapın:

```json
{
  "mcpServers": {
    "ext-via-nats": {
      "command": "node",
      "args": ["/mutlak/yol/ext-via-nats/scripts/mcp.mjs"],
      "env": {
        "EXT_VIA_NATS_URL": "ws://127.0.0.1:18222",
        "EXT_VIA_NATS_PREFIX": "extvianats.browser"
      }
    }
  }
}
```

Sunucu **stdio** üzerinden MCP konuşur; stdout yalnızca protokol trafiği taşır.
Kaydetmek kendi başına hiçbir tarayıcı komutu çalıştırmaz.

| Araç | İşlev |
|---|---|
| `ext_via_nats_verbs` | Verb kataloğu: her `v`, alanları, grubu, hangi verblerin sayfa verisi döndürdüğü ve sabit hata kodları. Adım kurmadan önce çağırın. |
| `ext_via_nats_profiles` | Bağlı profilleri ve kesin `inst` kimliklerini keşfet. |
| `ext_via_nats_info` | Bir profilin pencereleri, sahip olduğu pencereler, run etiketleri, çalışan komut. |
| `ext_via_nats_command` | Bir kesin profilde adım dizisi çalıştır. |
| `ext_via_nats_script` | Bir kesin profil ve sekmede JavaScript çalıştır. Dönüş değerleri tarayıcıdan çıkmaz. |
| `ext_via_nats_screenshot` | Bir sekmenin görünen alanını yakala; NATS yüküne sığması için eklentide küçültülür. |
| `ext_via_nats_abort` | Çalışan komutu sonraki adım sınırında durdur; cleanup adımları yine çalışır. |

### Ortam değişkenleri

| Değişken | Anlamı |
|---|---|
| `EXT_VIA_NATS_URL` | `ws://HOST:WS_PORT` veya `wss://HOST:PORT` |
| `EXT_VIA_NATS_PREFIX` | Konu öneki, varsayılan `extvianats.browser` |
| `EXT_VIA_NATS_TOKEN` | Broker token'ı |
| `EXT_VIA_NATS_USER` / `EXT_VIA_NATS_PASS` | Broker kullanıcısı ve parolası |
| `EXT_VIA_NATS_CREDS` | Yerel `.creds` dosyasının yolu (yalnızca CLI/MCP) |

Tam olarak bir kimlik doğrulama yöntemi kullanın. Eklenti `.creds` **içeriği** alır;
kontrol tarafı **yol** alır.

### CLI

```bash
export EXT_VIA_NATS_URL='ws://127.0.0.1:18222'
npm run remote -- list
npm run remote -- run PROFILE_INST examples/probe.json
```

Windows PowerShell'de `$env:EXT_VIA_NATS_URL = 'ws://127.0.0.1:18222'` kullanın.
`PROFILE_INST`, ayar sayfasındaki gerçek UUID'dir. `examples/probe.json` yalnızca
`version`/`whoami` çalıştırır; `examples/browser.json` bir sayfa açar.

### Ajan akışı

Profilleri listele → kesin `inst` seç → `version`/`whoami` ile doğrula → adımları
çalıştır. **Yeni iş için yeni komut id** kullan. Aynı id'yi aynı içerikle tekrar
kullanmak, yeniden yürütmek yerine saklanan sonucu döndürür.

## 8 · Broker'ı sıkılaştırma

Yerel örnekte kimlik doğrulama yoktur. Broker'a başka bir şey erişebildiğinde
`infra/nats-auth.example.conf` ile başlayın:

1. `profile-uuid` yerine her eklentinin gerçek `inst` değerini yazın.
2. Parolaları `nats-server`'a ortam değişkeni olarak verin
   (`EXT_VIA_NATS_CONTROLLER_PASSWORD`, `EXT_VIA_NATS_BROWSER_PASSWORD`).
3. TLS ekleyin. Şablon yalnızca loopback için `no_tls: true` ile gelir.
4. Doğrulayın: `nats-server -t -c sizin.conf`.

Şablon, kontrol tarafına `cmd/abort/info/discover` üzerinde yayınlama yetkisi;
her tarayıcı profiline ise yalnızca kendi konuları üzerinde yetki verir. **Gerçek
güvenlik sınırı broker yetkisidir**: bir profilin `cmd` konusuna yayın yapabilen
kontrol kimliği o tarayıcıyı sürebilir. MCP araç açıklamasındaki onay hatırlatması
ajan için bir rehberdir, kriptografik bir kapı değil.

## Sorun giderme

| Belirti | Neden ve çözüm |
|---|---|
| `no responders` | O konuda abone olan eklenti yok. Profilin açık, eklentinin etkin olduğunu ve her iki tarafta adres **ve önek**in aynı olduğunu kontrol edin. NATS Core'da offline kuyruk yoktur: kimse dinlemezken gönderilen komut kuyruğa girmez, kaybolur. |
| Durum hiç *bağlı* olmuyor | Genelde yanlış port (WebSocket yerine TCP 4222 veya monitoring 8222), `wss://` üzerinde eksik TLS, veya reddedilen kimlik bilgisi. |
| `busy` / `in_progress` | Profil başına aynı anda tek komut. `in_progress`, aynı id'nin hâlâ çalıştığı anlamına gelir. |
| `id_conflict` | Id farklı içerikle zaten kullanılmış. Yeni id kullanın. |
| `interrupted` | Bu id ile önceki çalışmanın sonucu belirsiz. Bilerek yeniden yürütülmez; karar vermeden önce durumu sorgulayın. |
| `script` izin hatası | *Kullanıcı scriptlerine izin ver* kapalı, veya Chrome 135'ten eski. |
| `screenshot_too_large` | Yakalanan görüntü, küçültmeden sonra bile işçi içi bütçeyi aştı. Daha küçük bir alan yakalayın. |
| `reload` sonrası eklenti kayboldu | `reload` eklentiyi diskten yeniden okur. Bir test koşumunun CDP ile kurduğu eklenti profilde kalıcı değildir; normal kullanım için **Paketlenmemiş öğe yükle** ile kurun. |

Zaman aşımından sonra yeni id ile kör retry yapmayın. Saklanan sonucu okumak için
**aynı id ve aynı içeriği** tekrar gönderin, veya önce `ext_via_nats_info` çağırın.
