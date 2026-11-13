# Doğrulama kaydı — 13 Kasım 2026

Aşağıdakilerin tamamı bu depo üzerinde ölçüldü. Burada listelenmeyen hiçbir şey
doğrulanmış **sayılmaz**.

## Ölçülen

| Ortam / işlem | Sonuç |
|---|---|
| Windows host, Node v24.22.1: `npm run build` | Başarılı — `extension/background.js` ve `extension/protocol.js` `src/` üzerinden yeniden üretildi |
| Windows host: `npm test` | **2 / 2 başarılı**, 0 hata (~5,4 s) |
| Gerçek NATS 2.11.9 broker'ına karşı WebSocket entegrasyon testi | Başarılı — yalıtılmış profiller, makbuzlar, idempotency, abort, worker restart, MCP |
| Protokol testi: yerel/bulut uç nokta ve konu sınırları | Başarılı |
| Gerçek MCP istemcisiyle stdio üzerinden MCP (`initialize`, `tools/list`, `tools/call`) | **7 araç** sunuldu; komut yürütme başarılı |
| Verb kataloğu tutarlılığı (`src/verbs.js`) | **41 verb**, 6 grup, 36 sabit hata kodu |
| `nats-server -t -c infra/nats-auth.example.conf` (NATS 2.11.9 konteyneri) | Yapılandırma geçerli |
| Windows'ta canlı Chrome kabulü, tek kullanımlık yalıtılmış profil | **9 / 9 kontrol başarılı** |
| Bulut WebSocket uç noktası `wss://connect.ngs.global:443` | Kimlik doğrulamasız gerçek NATS INFO el sıkışması: sunucu 2.15.3, `auth_required: true`, `tls_required: true`, `jetstream: true` |

Entegrasyon testi, sandbox'lanmış worker içinde Chrome API'lerini taklit eder:
tarayıcı binary'si başlatılmaz ve gerçek bir kullanıcı profili açılmaz. Buna karşılık
iki ayrı worker/profil arasındaki NATS yönlendirmesini, yinelenen komut id'sinin
yeniden yürütülmediğini, aynı id altında değişen yükün `id_conflict` döndürdüğünü,
adım sınırında abort'u, worker restart sonrası sonuç kalıcılığını ve ne bir DOM
sırrının ne de bir `script` dönüş değerinin NATS makbuzuna ulaşmadığını doğrular.

### Canlı Chrome kabul kontrolleri (Windows)

`npm run test:chrome` ile, gitignore'lanmış scratch dizini altında oluşturulan tek
kullanımlık bir profile karşı çalıştırılır — günlük kullanılan bir tarayıcı profiline
asla değil.

1. `options-ui-and-nats-connection` — ayar sayfası çizilir, kaydeder ve *bağlı* durumuna ulaşır
2. `profile-discovery` — profil kesin `inst` değeriyle keşfedilebilir
3. `mcp-version-and-whoami` — MCP araçları `version` / `whoami` sürer
4. `real-dom-fill-assert-click` — gerçek sayfa, gerçek fill, assert ve click
5. `browser-only-value-relay` — değer tarayıcı tarafında taşınır; makbuz değeri değil uzunluğu bildirir
6. `injected-button` — `inject` gerçek sayfaya çalışan bir öğe ekler
7. `real-javascript-user-script` — *Kullanıcı scriptlerine izin ver* açıkken `script`, `chrome.userScripts` üzerinden yürür
8. `owned-window-marker` — çalışmaya ait pencere işaretlenir
9. `owned-window-cleanup-preserves-fixture` — cleanup yalnızca sahip olunan pencereleri kapatır, fixture'ı bozmaz

NATS Core'da offline kuyruk olmadığı için koşum, daha fazla komut göndermeden önce
**aralıklı üç ardışık `info` yanıtı** bekler (0 ms, 2012 ms, 4028 ms'de gözlendi). Tek
bir yanıt, ölmek üzere olan bir worker'dan gelebilir ve o aralıkta yayınlanan komut
kuyruğa girmez, kaybolur.

### Bilinmesi gereken iki koşum bulgusu

- **Bu projeyi kullanmak için hiçbir Chrome komut satırı bayrağı gerekmez.**
  `--enable-unsafe-extension-debugging` bayrağı yalnızca test koşumlarında vardır;
  onlar eklentiyi elle değil CDP üzerinden kurar. Normal kullanım
  `chrome://extensions` üzerinden **Paketlenmemiş öğe yükle**dir.
- **CDP ile kurulmuş eklentide `reload` zararlıdır.** Bu kurulum profilde kalıcı
  değildir; `chrome.runtime.reload()` eklentiyi devre dışı bırakır ve kendi sayfaları
  `net::ERR_BLOCKED_BY_CLIENT` ile başarısız olur. *Kullanıcı scriptlerine izin ver*
  seçeneğini açmak eklentiyi zaten yeniden başlatır; bu yüzden koşum `reload`
  çağırmaz.

## Doğrulanmayan

1. **Linux Chrome canlı kabulü.** Kontrol katmanı taşınabilir Node'dur ve test
   takımı platformdan bağımsızdır; ancak burada kayıtlı bir Linux tarayıcı koşumu yok.
2. **Kimlik doğrulamalı bulut oturumu.** Bulut uç noktası yalnızca *kimlik
   doğrulamasız* yoklandı. Gerçek bir hesap, `.creds` dosyası veya bulut komut
   gidiş-dönüşü denenmedi.
3. **Canlı kimlik doğrulamalı broker'a karşı konu ACL negatif testleri.** Örnek
   yapılandırma sözdizimi doğrulamasını geçer; yetki sınırlarına saldırılmadı.
4. **İki ayrı ağ arasında NAT / WAN geçişi** ve uzun süreli bağlantı kaybından
   kurtarma.
5. **Günlük kullanılan bir tarayıcı profili.** Bütün canlı koşumlar tek kullanımlık
   profiller kullandı.

## Bu sürümde kapsam dışı

İşletim sistemi düzeyinde tarayıcı başlatma, profilden mail envanteri, harici
secret-slot servisleri, kalıcı sayfa script kayıtları ve playbook binding'leri bu
deponun parçası değildir. Pairing, JWT veya hub protokolü yoktur: **yetkilendirme
NATS konu ACL'leriyle uygulanır**, başka hiçbir şeyle değil.