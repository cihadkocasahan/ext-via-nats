# Doğrulama kaydı — 13 Kasım 2026

| Ortam / işlem | Sonuç |
|---|---|
| Windows host, Node 24.22.1: `npm run build` | Başarılı |
| Windows: `npm test` | 3/3 başarılı |
| Linux Alpine konteyneri, Node 24.22.3: `npm ci`, build, test | 3/3 başarılı |
| NATS 2.11.9 yerel WebSocket request/reply | Gerçek broker ile başarılı |
| MCP SDK stdio initialize/tools/list/tools/call | Gerçek MCP istemcisi ile 8 araç; komut başarılı |
| Node servisi üzerinden disk envanteri ve launch preview | Geçici profil metadata fixture'ları ile başarılı |
| ACL örneği `nats-server -t` config kontrolü | Başarılı |

Entegrasyon testinin Chrome API'leri taklittir; tarayıcı binary'si veya gerçek
kullanıcı profili açılmaz. İki ayrı worker/profilin NATS yönlendirmesi, yinelenen
komutun yeniden yürütülmemesi, farklı içerikli id çakışması, abort, worker
restart sonrası sonuç kaydı, DOM sırrının ve script dönüş değerinin NATS sonucuna
girmemesi doğrulanmıştır. Linux testi aynı kaynak ve lock dosyasından konteyner
içinde kurulum/derleme yapar; host node_modules kullanılmaz.

Yerel deneme için `remote-mesh-nats` konteyneri ve
`ws://127.0.0.1:18222` listener'ı hazır bırakılmıştır; stop komutu README'dedir.

## Canlı kabulte kalanlar

1. Windows ve Linux Chrome'da eklentiyi yükleme, ayar ekranı ve gerçek DOM komutları.
2. Kullanıcı script izni açık/kapalıyken gerçek `script` yürütme.
3. Kullanıcının seçtiği gerçek User Data ve profileDirectory ile Chrome başlatma;
   launch marker → sessionId/profileId/inst eşleşmesi ve yalnızca kendi penceresi cleanup.
4. TLS/WSS cloud broker, gerçek kullanıcı/.creds ve subject ACL negatif testleri.
5. İki farklı ağ arasında NAT/WAN ve bağlantı kaybı kabulü.

Yerel relayd secret slot servisi, kalıcı sayfa script kayıtları, `bindings.json`
playbook işletimi ve IDE Mesh pairing/Hub entegrasyonu bu sürümde uygulanmadı.
