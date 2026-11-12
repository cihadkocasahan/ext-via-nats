# Tarayıcı komutları

```json
{
  "id": "task-unique-001",
  "dnd": true,
  "steps": [
    { "v": "fill", "tab": { "url": "https://example.com/*" }, "sel": "#name", "literal": "Example" },
    { "v": "assert", "tab": { "url": "https://example.com/*" }, "sel": "#name", "eq": "Example" }
  ]
}
```

Kesin profil `inst` NATS konusunda seçilir. Sekme hedefi `tab:{tabId:123}` veya
`tab:{url:"https://example.com/*",title:"…",index:0}`; eşleşmeler yeni sekmeden
eskiye sıralanır. CSS selector yanında kaynak content executor'ın `text=…`
görünür metin seçicileri desteklenir. Sonuç `{id,inst,ok,receipts,err,errCode,aborted}`.
DOM işlevlerinin kaynak uygulaması `extension/content.js` içinde korunmuştur.

| `v` | Alanlar / davranış |
|---|---|
| `version`, `whoami` | Paket/worker sürümü veya profil oturumu |
| `openWindow` | `url`, `run`, `state`, `focused`, `width/height/left/top`; işaret sekmeli pencere |
| `close` | `run`; yalnızca işaretli pencereler (boş run tüm işaretliler) |
| `openTab` | `url`, `windowId` veya `window:{run}`, `active`, `loadTimeout`, `settle` |
| `closeTab` | `tab`; son sekme kapanacaksa runner için boş sekme bırakır |
| `navigate` | `tab`, `url`; yüklemeyi bekler |
| `waitFor` | `tab`, `sel`, `timeout`, `grow`, `quiet` |
| `click` | `tab`, `sel` |
| `fill` | `tab`, `sel`, `literal`; secret ref kabul etmez |
| `assert` | `tab`, `sel`, `has` / `eq` / `absent` |
| `query` | `tab`, `sel`, `limit`, `text:true` ile sayfa metni dahil keşif |
| `relay` | `from:{tab,sel}`, `to:{tab,sel}`; değeri tarayıcı içinde kopyalar |
| `move` | Aynı hedefler; kaynak alanı temizler, hedefe aktarır |
| `swap` | `a:{tab,sel}`, `b:{tab,sel}`; değerleri değiştirir |
| `clear` | `tab`, `sel`; alanı temizler |
| `setStore` | `tab`, `sel`, `value` veya `remove:true`; kaynak storage selector sözlüğü |
| `inject` | `tab`, `kind`, `id`, `text`, `anchor`, `copyFrom`, `css`; buton/overlay |
| `script` | `tab`, `code`, `world:USER_SCRIPT/MAIN`; tek seferlik JavaScript, dönüş verisi aktarılmaz |
| `activate` | `tab`; sekmeyi/pencereyi öne getirir, dnd altında reddedilir |
| `hub` | `url`, `active`; kontrol sekmesi, dnd altında active kapatılır |
| `key` | `tab`, `sel`, `key`, `code`; DOM klavye olayı (native OS tuşu değildir) |
| `captcha` | `tab`, `wait:true`, `timeout`; isteğe bağlı insan çözümünü bekler |
| `sleep` | `ms`; en fazla 20 saniye |
| `reload` | Eklentiyi yeniden yükler; bağlantı kesilebilir, otomatik retry yapma |
| `put` | Kaynak yerel relayd secret slot gerektirir; doğrudan NATS sürümünde kapalı |

İzleme `follow:true`; varsayılan kapalıdır. `dnd:true` follow'u geçersiz kılar,
odak isteyen işlemleri reddeder veya uygun sekme açma ayarlarını geri plana alır.
`onError:"continue"` verilmedikçe ilk başarısız adımda durur; `close` ve `closeTab`
cleanup adımları durma/abort sonrası da işlenir. Bu özellik cleanup hedefinin
kullanıcıya ait olmadığına dair otomatik garanti değildir; doğru run/tab seç.

`inject` kaynakta keyfi JavaScript eval anlamına gelmez. Kaynak content executor
buton/overlay oluşturur ve click olayını NATS `invoke` kanalına gönderir. Dinamik
JavaScript ayrı `script` komutudur; Chrome 135+ `userScripts.execute` kullanır ve
izin kapalıyken fail closed davranır. Extension service worker içinde `eval`
veya `new Function` ile uzaktan kod yürütülmez.

## Örnek: JavaScript

```json
{
  "inst": "GERCEK-PROFIL-UUID",
  "id": "script-001",
  "tab_id": 123,
  "code": "document.querySelector('h1').style.color = 'teal';",
  "world": "USER_SCRIPT"
}
```

Bu payload MCP `remote_mesh_script` içindir. Sonuç yalnızca başarı/frame sayısıdır.
Sayfanın dönüş değeri bir token/çerez olabilir; bu yüzden otomatik export edilmez.

## Sonucu belirsiz iş

Timeout komutun çalışmadığı anlamına gelmez. Aynı komut `id` ve aynı içerikle
yeniden istekte bulun. Hâlâ çalışıyorsa `in_progress`, bitmişse saklanan sonuç,
worker çalışırken kesildiyse `interrupted` döner. İçeriği değişen aynı id için
`id_conflict`; yeni id ancak önceki işin sonucunu değerlendirdikten sonra kullan.
