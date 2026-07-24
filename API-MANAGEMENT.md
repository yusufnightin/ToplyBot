# Resmî Topluyo API Yönetim Eşlemesi

Bu belge `src/plugins/apiManagement.js`, `src/services/ApiManagementService.js`, `src/core/TopluyoClient.js` ve `src/core/ApiBatchQueue.js` arasındaki eşlemeyi gösterir.

## Grup

| API | Bot işlemi |
|---|---|
| `group/get` | Sunucu özeti, profil mevcut değerlerini koruma |
| `group/join` | Yalnızca bot sahibinin kullanabildiği `!bosshere <sunucuLinki>` |
| `group/founder` | `!sunucukurucu` |
| `group/joinlist` | `!bekleyenler`, toplu katılım |
| `group/online` | `!cevrimici` |
| `group/set/home` | `!grupana` |
| `group/set/permissions` | `!grupizin` |
| `group/set/profile` | `!grupprofil` |
| `group/set/socials` | `!grupsosyal` |

## Kanal

| API | Bot işlemi |
|---|---|
| `channel/add` | `!kanaloluştur`, `!kanalkopyala`, destek şablonu |
| `channel/del` | `!kanalsil` |
| `channel/get` | Güncelleme öncesi tam alanları koruma |
| `channel/detail` | Artı/eksi kullanıcı izinlerini görüntüleme |
| `channel/list` | `#kanaladı` çözümleme, ID kurtarma, envanter |
| `channel/options/set` | Kullanıcı bazlı oku/yaz/kontrol yetkisi |
| `channel/set` | `!kanalduzenle` |
| `channel/show/info` | Kanal çözümleme fallback'i |
| `channel/sort` | Mevcut kanal sıralama sistemi |

## Rol ve üye

| API | Bot işlemi |
|---|---|
| `role/add`, `role/get`, `role/set`, `role/del`, `role/list`, `role/sort` | Rol oluşturma, kopyalama, şablon, düzenleme, silme ve sıralama |
| `member/get`, `member/list` | Üye bilgisi ve sayfalı üye listesi |
| `member/role/set` | Bütün rol listesini atomik değiştirme, otorol ve rol paneli |
| `member/kick` | Hızlı moderasyon ve kick komutu |
| `member/waiter/accept`, `member/waiter/reject` | Tekli ve toplu katılım yönetimi |
| `permission/power`, `permission/channel` | `!yetkiguc` |

## İçerik ve topluluk

| API | Bot işlemi |
|---|---|
| `post/add`, `post/get`, `post/list`, `post/set`, `post/del`, `post/bumote` | Mesaj, JTML, panel ve post yönetimi |
| `badge/add`, `badge/list`, `badge/give` | Rozet oluşturma/listeleme/verme |
| `crew/add`, `crew/get`, `crew/list`, `crew/set`, `crew/del`, `crew/sort` | Ekip yönetimi |
| `team/list` | Takım envanteri |
| `user/list` | En fazla 100 kullanıcı ID'sini toplu çözümleme |
| `test/time`, `test/ip` | API durum ve gecikme tanılaması |

## Batch ve cache politikası

1. Aynı event-loop zaman aralığındaki çağrılar 35 ms boyunca toplanır.
2. Öncelik sırası `critical → high → normal → low` şeklindedir.
3. Bir batch en fazla 40 satır taşır; iki batch eş zamanlı çalışabilir.
4. Aynı salt-okunur endpoint + aynı veri beklemedeyse tek Promise paylaşılır.
5. Başarılı salt-okunur cevaplar kısa süreli LRU cache'e yazılır.
6. Kanal, rol, üye, grup, post, rozet veya ekip yazması ilgili cache alanını siler.
7. Timeout, 429 ve 5xx yalnızca salt-okunur çağrılarda tekrar denenir.
8. Kuyruk sınırı aşıldığında bellek büyümesini önlemek için yeni istek reddedilir.
9. Kapanışta `drain()` bekleyen batch'leri tamamlar.

## API performans komutları

```text
!apidurum
!apiperformans
!apionbellek temizle
!apionbellek isit
!hizlandir
!apistres 40
```

`!apistres`, gerçek sunucu üzerinde yalnızca dokümandaki `test/time` salt-okunur ucunu kullanır. Normal kullanımda gereksiz yere sık çalıştırılmamalıdır.
