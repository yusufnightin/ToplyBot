# Topluyo Professional Bot 3.7.0 — Seviye ve Rozet Paketi

> **v3.7.0:** Sunucuya özel XP/seviye sistemi, otomatik rol ve Topluyo rozet ödülleri, manuel badge yönetimi, ödül senkronizasyonu, liderlik tablosu ve JTML **Seviye & Rozet Merkezi** eklendi.

Topluyo için modüler, yönetim ve kullanıcıya özel araçlara odaklanan profesyonel bot paketidir. Komut merkezi native JTML ile oluşturulur. Bütün ayarlar, yedekler, kurulum durumu ve otomasyon verileri grup ID bazında birbirinden izole tutulur.


## 3.7 seviye ve rozet merkezi

Paneli açmak için kanala yalnızca `!` gönder ve **⭐ Seviye & Rozet Merkezi** düğmesini seç. Buradan hedef kullanıcı ID'si, XP/seviye miktarı, ödül seviyesi ve rozet ID'si girilerek bütün sistem yönetilebilir.

Başlıca özellikler:

- Mesaj başına ayarlanabilir rastgele XP, çarpan, cooldown, minimum mesaj uzunluğu ve günlük XP sınırı
- Sunucuya özel XP eğrisi, seviye kartı ve liderlik tablosu
- Seviye atlayınca otomatik rol ve resmî Topluyo badge/rozet ödülü
- Manuel XP ekleme/çıkarma, seviye belirleme ve manuel rozet verme
- Seviye-rozet eşlemesi, tek rozet oluşturma ve hazır kilometre taşı rozet paketi
- API cevabında rozet ID'si dönmezse listeleme/polling ile ID kurtarma
- Mevcut kullanıcıların eksik rol ve rozet ödüllerini toplu senkronlama
- Bütün veriler `groupId` bazında birbirinden izole

Örnek komutlar:

```text
!seviye [kullanıcıId]
!liderlik
!seviyeayar durum
!xpayar 8 12 45
!xpver 25426 500
!seviyeset 25426 10
!seviyerol 10 12345
!seviyerozet 10 67890
!seviyerozetpaket
!badgever 25426 67890
!seviyesenkron 25426
```

Ayrıntılar `LEVEL-BADGE-SYSTEM.md` ve `RELEASE-3.7.0.md` dosyalarındadır.


## 3.6.1 akıllı komut merkezi

Paneli açmak için kanala yalnızca `!` gönder. **Hızlı Çalıştır** alanına bir komut adı veya takma adı yaz: `ban`, `ping`, `destekşablon`, `sunucuozet` gibi. Parametresiz komut hemen çalışır; diğer komutlarda tek bir giriş alanı açılır.

Yaygın moderasyon işlemlerinde yalnızca kullanıcı ID'si yeterlidir:

```text
ban: 25426       -> süre 0, sebep "Panel üzerinden"
timeout: 25426   -> süre 10m, sebep "Panel üzerinden"
kick: 25426      -> sebep "Panel üzerinden"
```

Uzun komutlar yüzde ve aşama bilgisi içeren canlı JTML kartıyla izlenir. Ayrıntılar `SMART-COMMAND-CENTER.md` ve `RELEASE-3.6.1.md` dosyalarındadır.


## 3.6 resmî API yönetim merkezi

Yeni yönetim ve hız komutları:

```text
!sunucuozet
!sunucukurucu
!kanalkopyala <#kaynak/id> <yeniNick>|[başlık]
!rolkopyala <rolId/ad> <yeniAd>|[renk]
!uyerolayarla <kullanıcıId> <rolId,rolId|temizle>
!bekleyentoplu <kabul|reddet> [adet] onay
!apidurum
!apiperformans
!apionbellek <temizle|isit>
!hizlandir
```

`apiManagement` eklentisinde 42 resmî API yönetim komutu, paket genelinde 169 komut vardır. Ayrıntılı endpoint eşlemesi `API-MANAGEMENT.md`, sürüm notları `RELEASE-3.6.0.md` dosyasındadır. Performans motoru 35 ms mikro-batch, aynı okuma isteğini birleştirme, kısa süreli LRU cache, yazma sonrası otomatik invalidation ve salt-okunur çağrılarda kontrollü retry kullanır.

## 3.5 hızlı kurtarma ve tam kurulum

Önceki sürümde `kanal oluşturuldu ancak kanal ID alınamadı` hatasıyla yarıda kalan destek sunucusunu silmeden devam ettir:

```text
!destekşablon onar
!destekşablon doğrula
```

Bütün sistemi yedek alarak denetleyip eksikleri onarmak ve hoş geldin testi göndermek için:

```text
!sistemonar test
!sistemkontrol detay
```

Manuel yedek işlemleri:

```text
!yedek oluştur Kurulum öncesi
!yedek liste
!yedek bilgi <yedekId>
!yedek geri <yedekId>
```

`!destekşablon kur` artık:

- kurulumu aynı sunucuda kilitleyerek eş zamanlı çift kanal/rol oluşmasını engeller,
- kanal ve rolleri sıralı ve tekrar çalıştırılabilir biçimde hazırlar,
- API cevabında ID yoksa `channel/list`, `role/list` ve kanal bilgi sorgularıyla ID'yi kurtarır,
- her aşamayı `data/template-installations.json` içinde kaydeder,
- başlamadan önce sunucuya özel güvenlik yedeği alır,
- hoş geldin, kayıt, otorol, seviye/XP, moderasyon, ticket, log, otomasyon ve özel komutları birbirine bağlar,
- 25 kanallık gelişmiş destek düzenini ve 14 rolü hazırlar,
- SVG dosya adlarına göre Lv.1, 5, 10, 20, 30, 50, 75 ve 100 rollerini ve görsel Topluyo rozetlerini eşler,
- işlem sonunda kanal/rol/ayar erişimlerini doğrular.

Yeni bakım komutları:

```text
!sistemkontrol [detay]
!sistemonar [test]
!önbellektemizle
!bakımayar durum
!bakımayar yedek aç
!bakımayar yedeksaat 24
!bakımayar uyarı aç
!bakımayar kontrolsaat 6
```

## 3.4 hızlı kullanım (önceki özellikler)

Komut merkezini aç:

```text
!
```

Panelde **⚡ Hızlı Moderasyon** bölümünden hedef kullanıcı ID, süre ve sebep girerek uyarı, kick, ban, timeout, kaldırma ve mesaj temizleme işlemlerini uygulayabilirsin.

Kanal ve rol envanteri:

```text
!kanalliste sıra
!kanalliste ad
!rolliste sıra
!rolliste güç
!kanalsırala 15259,15791,15716
!rolsırala 301,302,303
```

Kanal ayarlarında ID yerine etiket kullan:

```text
!welcomekanal #hos-geldin
!kanalayarla logs #yonetim-log
!kanalayarla tickets #destek
```

Kişisel destek sunucusu şablonu:

```text
!destekşablon kur
!destekşablon onar
!destekşablon doğrula
!destekşablon durum
!destekşablon test
!destekşablon sıfırla TAM SIFIRLA
```

`kur` ve `onar` mevcut yapıyı korur. `sıfırla TAM SIFIRLA` ise önce yerel ayar yedeği ve uzak envanter kaydı alır; mevcut kanalları ve rolleri sırayla silip gelişmiş şablonu baştan kurar. Karşılama, Üye otorolü, seviye rolleri, SVG rozetleri, moderasyon, log ve ticket ayarları yalnızca çalıştırıldığı sunucuya bağlanır. Bot sahibi ve bot hesabı yeni Yönetici rolüne otomatik bağlanır.

Şablonu yalnızca kendi hesabına açmak için:

```json
"supportTemplate": {
  "ownerUserId": 25426,
  "levelRoleAssetDirectory": "C:\\Users\\User\\Desktop\\Yeni klasör",
  "operationDelayMs": 180
}
```

Topluyo’nun rol oluşturma API’sinde rol görseli alanı yoktur. Bu nedenle SVG adı/emoji rol adında kullanılır; dosyanın kendisi aynı seviyeye bağlı görsel Topluyo rozeti olarak eklenir.

## 3.2.5 düzeltmesi — görünüm + gerçek Bumote etkileşimi

- Menüdeki tekrar eden üst metin varsayılan olarak kaldırıldı; post yalnızca native JTML panelini gösterir.
- Aynı `~{JSON}` içeriği görünüm için `post.text` içine yazılır.
- Aynı içerik etkileşim kaydı için ayrıca `/!api/post/bumote` ile posta bağlanır.
- Sekme değişimlerinde post `post/set` ile güncellenir ve yeni JTML yeniden bağlanır.
- Gerçek tıklama geldiğinde `post/bumote` ve `message.form` konsolda açıkça loglanır.
- Komut ayrıntıları, yetki, kullanım ve açıklama artık üst metinde değil JTML panelinin içinde gösterilir.
- `embed gönder`, `embed bağla` ve `replyJtml()` da aynı çift teslim modelini kullanır.

> `embed.topluyo.com/mini` deposundaki istemci yalnızca mesajları görüntüler; Bumote tıklamasını API'ye gönderen bir click handler içermez. Etkileşimleri Topluyo'nun ana web/uygulama istemcisinde test edin. Mini embed bağlantıları görsel önizleme içindir.

Beklenen başarılı başlangıç logu:

```text
Komut merkezi JTML etkileşimleri posta bağlandı. {"postId":...}
```

Beklenen tıklama logu:

```text
Bumote/JTML tıklaması alındı. {"postId":...,"userId":...,"form":"{...}"}
```

## 3.2 yenilikleri — JTML Command Center

- Sohbete yalnızca `!` gönderildiğinde otomatik komut merkezi açılır.
- `!yardım`, `!help`, `!komutlar`, `!menü` ve `!menu` aynı görsel paneli açar.
- Ana Menü, Moderasyon, Karşılama/Kayıt, Roller, Seviye, Topluluk, Otomasyon, JTML/Tasarım ve Yönetim sekmeleri bulunur.
- JTML arama alanı; komut adı, açıklama, kullanım, kategori ve takma adlarda arama yapar.
- Komut ayrıntı sayfasında kullanım, yetki, kategori, takma ad ve açıklama gösterilir.
- Parametre istemeyen komutlar JTML düğmesiyle doğrudan çalıştırılabilir.
- Önceki/Sonraki sayfalama, yenileme, ana menü ve kapatma düğmeleri bulunur.
- Menü aynı post üzerinde `post/set` ile güncellenir; her tıklamada yeni mesaj oluşturmaz.
- Menü oturumları `data/command-menus.json` içinde kalıcı tutulur.
- Menü varsayılan olarak yalnızca açan kullanıcı tarafından kontrol edilebilir.
- HTTP kart sunucusu açıksa modern SVG Command Center kartı da gösterilir.

> Topluyo bot olayları, kullanıcının mesajı göndermeden önce bastığı tuşları iletmez. Bu nedenle Discord tarzı gerçek zamanlı yazım otomatik tamamlama yapılamaz. Bu sürümde en yakın desteklenen davranış uygulanır: kullanıcı kanala yalnızca `!` mesajını gönderdiğinde JTML komut paneli açılır.

Hızlı kullanım:

```text
!
!yardım
!yardım ping
!menü
```

Komut merkezi ayarları:

```json
"commandMenu": {
  "enabled": true,
  "openOnBarePrefix": true,
  "ownerOnly": true,
  "sessionMinutes": 10,
  "commandsPerPage": 7,
  "showQuickRun": true,
  "showTextSummary": false,
  "accentColor": "#ff83c8"
}
```

Ayrıntılı belge: [`JTML-COMMAND-CENTER.md`](JTML-COMMAND-CENTER.md)

## 3.1 yenilikleri

- SVG tabanlı görsel embed kartı
- Başlık, açıklama, renk, thumbnail, büyük görsel, footer ve en fazla 10 alan
- Bir embede birden fazla etkileşim butonu ekleme
- Tıklamayla komut çalıştırma
- Tıklamayla kanala yanıt gönderme
- Tıklamayla DM gönderme
- Tıklamayla rol verme, kaldırma veya rolü açıp kapatma
- Kullanıcıya bağlantı gönderme
- Buton başına yetki ve cooldown
- Kullanıcı başına tek kullanım ve toplam kullanım sınırı
- Kalıcı `interactions.json` kayıtları
- Ham Bumote/JTML koduyla otomatik üretilen formu değiştirebilme
- Mevcut 3.0.2 Cloudflare teşhis sistemi

## Önemli platform farkı

Topluyo API'sinde Discord'daki `Embed` ve `ButtonInteraction` nesneleri yoktur. Görsel native JTML gönderinin `text` alanında tutulur ve aynı JTML `/!api/post/bumote` ile posta etkileşim olarak bağlanır; kullanıcı tıklaması WebSocket üzerinden `post/bumote` form gönderimi olarak gelir. Bu proje görsel embed deneyimini SVG kart ve biçimlendirilmiş metinle, tıklama işlemlerini Bumote form gönderimiyle sağlar.

`src/utils/bumote.js`, Topluyo MarkTop ayrıştırıcısının yerel biçimini üretir: `~{...}` kökü içinde `type: "bumote"` düğmeleri ve `type: "input"` alanları. Ham HTML formu kullanılmaz.

## Gereksinimler

- Node.js 18 veya üzeri
- Topluyo bot hesabı ve cihaz tokenı
- Bot hesabında gönderi, Bumote, rol ve DM işlemleri için gerekli yetkiler

## Kurulum

```bash
npm install
```

Windows:

```bat
copy config.example.json config.json
copy .token.json.example .token.json
```

Linux/macOS:

```bash
cp config.example.json config.json
cp .token.json.example .token.json
```

`.token.json` yalnızca JSON string içermelidir:

```json
"TOPLUYO_BOT_TOKENINIZ"
```

`config.json` içindeki kullanıcı, grup ve kanal ID'lerini düzenleyin. Eski 3.0.x yapılandırmasında `embeds` eklentisi varsa `interactions` eklentisi otomatik olarak yükleme listesine eklenir.

Başlatma:

```bash
npm start
```

Kontroller:

```bash
npm run check
npm test
npm run commands
npm run diagnose
```

## Hızlı embed örneği

```text
!embed oluştur panel | Kontrol Paneli | Aşağıdaki işlemlerden birini seçin.
!embed renk panel #ff83c8
!embed alan panel Destek | Destek talebi oluşturabilirsiniz.
!embed footer panel Topluyo Professional Bot 3.2
```

### Komut çalıştıran buton

```text
!embed buton panel Yardım | komut | yardım
```

### Yanıt gönderen buton

```text
!embed buton panel Bilgi Ver | yanıt | Merhaba #{userId}, işlemin tamamlandı.
```

Değişken biçiminde süslü parantez kullanın:

```text
{userId} {groupId} {channelId} {postId} {actionId} {actionLabel}
```

### DM gönderen buton

```text
!embed buton panel DM Gönder | dm | Merhaba {userId}, bu mesaj sana özel gönderildi.
```

### Rol aç/kapat butonu

```text
!embed buton panel Mavi Rol | roltoggle | 7788
```

### Yalnızca yöneticiye açık buton

```text
!embed buton panel Ayarları Göster | komut | ayarlar | admin | danger
```

### Bağlantı butonu

```text
!embed buton panel Web Sitesi | link | https://example.com
```

Bağlantı eylemi URL'yi kullanıcıya DM ile gönderir. Sunucu bir kullanıcının tarayıcısını zorla açamaz.

### Gönderme

```text
!embed önizle panel
!embed gönder panel KANAL_ID
```

API gönderi ID'sini döndürürse native JTML zaten post metninin içinde görünür ve etkileşim kaydı otomatik oluşturulur. ID dönmezse mevcut gönderiyi güncelleyerek kayıt oluşturmak için:

```text
!embed bağla panel POST_ID
```

## Embed düzenleme komutları

```text
!embed başlık panel Yeni Başlık
!embed açıklama panel Yeni açıklama
!embed thumbnail panel https://example.com/avatar.png
!embed görsel panel https://example.com/image.png
!embed alan panel Alan Adı | Alan değeri
!embed alantemizle panel
!embed butonlar panel
!embed butonsil panel BUTON_ID
!embed kart panel aç
!embed kart panel kapat
!embed tekkullanım panel aç
!embed maksimum panel 100
!embed sil panel
```

`maksimum 0` sınırsız kullanım anlamına gelir.

## Özel Bumote/JTML kodu

Otomatik oluşturulan form yerine kendi kodunuzu tanımlayabilirsiniz:

```text
!embed bumote panel | ~{"type":"bumote","name":"action_id","value":"yardim","text":"Yardım"}
```

Özel kodu kaldırmak ve otomatik üretime dönmek için:

```text
!embed bumotetemizle panel
```

Otomatik üretimi tüm bot için kapatmak:

```json
"interactions": {
  "autoGenerateBumote": false
}
```

## Etkileşim yönetimi

```text
!etkileşim liste
!etkileşim durum POST_ID
!etkileşim kapat POST_ID
!etkileşim aç POST_ID
```

Desteklenen eylem tipleri:

| Komut adı | İç tip | İşlev |
|---|---|---|
| `komut` | `command` | Bot komutunu kullanıcı adına çalıştırır |
| `yanıt` | `reply` | Aynı kanala mesaj gönderir |
| `dm` | `dm` | Tıklayan kullanıcıya özel mesaj gönderir |
| `rolver` | `role_add` | Rol ekler |
| `rolal` | `role_remove` | Rol kaldırır |
| `roltoggle` | `role_toggle` | Rol varsa kaldırır, yoksa ekler |
| `link` | `link` | Bağlantıyı kullanıcıya DM gönderir |

Etkileşim motoru `eval`, shell komutu veya kullanıcı tarafından belirtilen rastgele API uçlarını çalıştırmaz.

## Görsel kart sunucusu

SVG kart URL'sinin Topluyo tarafından görüntülenebilmesi için HTTP sunucusunu açın:

```json
"httpServer": {
  "enabled": true,
  "host": "127.0.0.1",
  "port": 3210,
  "publicBaseUrl": "",
  "autoTunnel": true,
  "cloudflaredPath": "tools/cloudflared.exe",
  "tunnelTimeoutMs": 30000
}
```

`autoTunnel` açıkken bot, Cloudflare Quick Tunnel üzerinden geçici bir HTTPS adresi alır ve dış erişimi doğrulamadan kart göndermez. Tünel yalnızca yerel kart sunucusuna bağlanır; `/cards/` dışındaki istekler reddedilir. Kalıcı alan adınız varsa `publicBaseUrl` alanına yazıp `autoTunnel` seçeneğini kapatabilirsiniz. Kart sunucusu veya tünel kullanılamazsa kullanıcı ve sunucu bilgilerini içeren native JTML yedeği gönderilir.

## Diğer sistemler

Moderasyon, otorol, kayıt, seviye, çekiliş, anket, ticket, özel komut, otomasyon, sosyal bildirim ve istatistik sistemleri korunmuştur. Tam liste `COMMANDS.md` dosyasındadır.

## Cloudflare 403

`Just a moment`, `Enable JavaScript and cookies` veya `cType: 'managed'` içeren WebSocket 403 hatası istemci kodundan kaynaklanmaz. Topluyo yöneticisinin `/!bot` yolunu Cloudflare Managed Challenge kuralından hariç tutması gerekir. Ayrıntılar `CLOUDFLARE-403.md` dosyasındadır.

## Güvenlik

- `.token.json` dosyasını paylaşmayın.
- Rol ve yönetim butonlarında uygun `moderator`, `admin` veya `owner` yetkisini kullanın.
- Ham Bumote kodunu yalnızca güvenilir yöneticiler eklemelidir.
- Komut eylemleri tıklayan kullanıcının mevcut bot yetkileriyle çalışır; buton bir kullanıcıya fazladan yönetici yetkisi kazandırmaz.

## v3.4.2 SVG karşılama kartı

Yeni karşılama tasarımı `assets/welcome-card-background.png` ve `assets/welcome-card-template.svg` üzerinden bot tarafından otomatik doldurulur. Yeni üyenin avatarı soldaki dairesel alana kırpılır; kullanıcı adı ve sunucu adı uzunluğa göre otomatik ölçeklenerek kartta gösterilir. Public kart sunucusu bulunmadığında bot kullanıcı ve sunucu bilgisini içeren native JTML karşılığını otomatik gönderir.
