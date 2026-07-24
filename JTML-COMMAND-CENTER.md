# JTML Command Center

Topluyo Professional Bot 3.2'nin komut yardım ve keşif arayüzüdür.

## Kullanıcı deneyimi

Bir grup kanalına yalnızca şu mesaj gönderilir:

```text
!
```

Bot aynı kanalda kişisel bir **Command Center** postu oluşturur; görünen metin ve JTML/Bumote arayüzü aynı postun `text` alanında bulunur. Kullanıcı:

- Ana kategoriler arasında sekme değiştirir.
- Komutlarda ileri/geri sayfalar arasında gezer.
- Komut adı veya açıklama metniyle arama yapar.
- Komut ayrıntılarını görüntüler.
- Zorunlu parametresi bulunmayan komutları tek tıklamayla çalıştırır.
- Menüyü yeniler veya kapatır.

Aynı panel şu komutlarla da açılır:

```text
!yardım
!help
!komutlar
!menü
!menu
```

Belirli komutun ayrıntı sayfasını açmak:

```text
!yardım ping
!yardım timeout
```

## Platform sınırı

Topluyo bot WebSocket'i yalnızca gönderilmiş `post/add`, özel mesaj ve diğer sunucu olaylarını iletir. Kullanıcı mesaj kutusuna bir karakter yazdığı anda oluşan tuş/yazım olayı botlara gönderilmez.

Bu nedenle panel, kullanıcı daha mesajı göndermeden giriş kutusunun üzerinde native autocomplete olarak açılamaz. Uygulanan davranış şudur:

1. Kullanıcı yalnızca `!` mesajını gönderir.
2. Bot kişisel JTML komut panelini açar.
3. Kullanıcı bundan sonra komutları tıklayarak keşfeder.

## Native JTML sözdizimi

Topluyo arayüzü etkileşimli bileşenleri ham HTML olarak değil, `~{...}` ile başlayan MarkTop/JTML JSON düğümleri olarak işler.

```jtml
~{"type":"bumote","name":"menu_action","value":"home","text":"🏠 Ana Menü"}
```

Komut merkezi bütün düğmeleri, arama alanını ve yerleşim düğümlerini tek bir `box` kökü altında üretir.

## JTML veri akışı

```text
post/add: "!"
  ↓
post/add.text: Command Center metni + ~{JTML}
  ↓
Kullanıcı düğmeye tıklar
  ↓
WebSocket post/bumote: message.form
  ↓
CommandMenuService
  ↓
post/set.text: yeni görünüm metni + yeni ~{JTML}
```

## Ayarlar

`config.json`:

```json
{
  "commandMenu": {
    "enabled": true,
    "openOnBarePrefix": true,
    "ownerOnly": true,
    "sessionMinutes": 10,
    "commandsPerPage": 7,
    "showQuickRun": true,
    "accentColor": "#ff83c8"
  }
}
```

### Alanlar

| Alan | Açıklama |
|---|---|
| `enabled` | JTML Command Center sistemini açar/kapatır |
| `openOnBarePrefix` | Yalnızca `!` mesajında menüyü otomatik açar |
| `ownerOnly` | Menüyü yalnızca açan kullanıcının kontrol etmesini sağlar |
| `sessionMinutes` | Panelin aktif kalacağı dakika |
| `commandsPerPage` | Bir sekmede gösterilecek komut sayısı |
| `showQuickRun` | Parametresiz komutlarda Çalıştır düğmesini gösterir |
| `accentColor` | SVG Command Center kartının vurgu rengi |

## Üst düzey sekmeler

- ✨ Genel ve Yardım
- 🛡️ Moderasyon
- 👋 Karşılama ve Kayıt
- 🎭 Rol Yönetimi
- ⭐ Seviye
- 💰 Ekonomi
- 🎉 Topluluk
- ⚡ Otomasyon
- 🧩 JTML ve Tasarım
- ⚙️ Yönetim

Komutlar kayıtlı `category` alanlarına göre otomatik olarak bu sekmelere dağıtılır. Yeni bir eklenti komut kaydettiğinde ayrıca menü kodu yazılması gerekmez.

## Dosyalar

```text
src/services/CommandMenuService.js
src/utils/bumote.js
src/plugins/core.js
src/plugins/interactions.js
data/command-menus.json
bumote/command-center-example.jtml
```

## Güvenlik

- JTML tıklamaları açan kullanıcıya kilitlenebilir.
- Menü yalnızca kullanıcının yetkili olduğu komutları gösterir.
- Yetki kontrolü tıklama sırasında yeniden yapılır.
- Zorunlu parametreli komutlar yanlış değerlerle otomatik çalıştırılmaz.
- Oturum süresi dolduğunda panel kapatılır.
- `eval`, shell veya istemci tarafından verilen rastgele JavaScript çalıştırılmaz.
