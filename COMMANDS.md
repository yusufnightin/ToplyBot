# Komut Referansı

Toplam **164** ana komut vardır. Takma adlar bu sayıya dahil değildir. Kanala yalnızca `!` gönderildiğinde JTML Command Center otomatik açılır.

## Anket

- `!anket oluştur <süre|0> <soru> | seçenek | seçenek` — Çok seçenekli süreli anket oluşturur. — yetki: **moderator**
- `!oy <anketId> <seçenekNo>` — Ankette oy verir. — yetki: **member**

## Çekiliş

- `!çekiliş <oluştur süre kazanan ödül|durum id|bitir id|yeniden id>` — Çekiliş oluşturur veya durumunu gösterir. — yetki: **moderator**
- `!çekilişkatıl <id>` — Açık çekilişe katılır. — yetki: **member**

## Embed

- `!embed <oluştur|başlık|açıklama|alan|buton|butonsil|bumote|kart|önizle|gönder|bağla|liste|sil>` — Görsel kart, Bumote butonu ve tıklama eylemi olan mesajlar oluşturur. — yetki: **admin**

## Etkileşim

- `!etkileşim <liste|durum postId|aç postId|kapat postId>` — Bumote buton/form etkileşimlerini yönetir. — yetki: **admin**

## Genel

- `!ara <metin>` — Topluyo üzerinde kullanıcı veya grup arar. — yetki: **member**
- `!kimlik` — Kullanıcı, kanal, grup ve yetki kimliğini gösterir. — yetki: **member**
- `!ping` — Bot bağlantısını ve cevap süresini kontrol eder. — yetki: **member**
- `!sunucu` — Aktif grubun temel bilgilerini getirir. — yetki: **member**
- `!sunucusaat` — Topluyo sunucu saatini getirir. — yetki: **member**
- `!yardım [komut]` — JTML sekmeli görsel komut merkezini açar. — yetki: **member**

## İstatistik

- `!statskanal <kur|güncelle|sil>` — Tek ve özel canlı istatistik kanalını yönetir. — yetki: **admin**
- `!sunucuistatistik` — Grup istatistiklerini gösterir. — yetki: **member**

## Karşılama

- `!leave <aç|kapat>` — Ayrılma mesajı açar/kapatır. — yetki: **admin**
- `!leavemesaj <mesaj>` — Ayrılma mesajını değiştirir. — yetki: **admin**
- `!welcome <durum|aç|kapat>` — Karşılama sistemini yönetir. — yetki: **admin**
- `!welcomearkaplan <#renk|url>` — Welcome kart arka plan rengini veya URL’sini ayarlar. — yetki: **admin**
- `!welcomediagnostik` — Hoş geldin sisteminin olay, kanal ve bot yetkisi durumunu gösterir. — yetki: **admin**
- `!welcomedm <aç|kapat>` — DM hoş geldin mesajı açar/kapatır. — yetki: **admin**
- `!welcomedmmesaj <mesaj>` — DM hoş geldin mesajını ayarlar. — yetki: **admin**
- `!welcomeembed <aç|kapat>` — Embed biçimli welcome açar/kapatır. — yetki: **admin**
- `!welcomekanal <#kanaladı|kanalId|kapat>` — Hoş geldin kanalını #kanaladı veya ID ile ayarlar. — yetki: **admin**
- `!welcomekart <aç|kapat>` — Welcome kartı açar/kapatır. — yetki: **admin**
- `!welcomemesaj <mesaj>` — Welcome mesajını değiştirir. — yetki: **admin**
- `!welcomerenk <#hex>` — Welcome kart vurgu rengini ayarlar. — yetki: **admin**
- `!welcometamir [test]` — Hoş geldin kanalını, bot erişimini ve gönderimi otomatik onarır. — yetki: **admin**
- `!welcometest [kullanıcıId]` — Hoş geldin sistemini gerçek gönderimle test eder. — yetki: **admin**

## Kayıt

- `!kayıt <kullanıcıId> <isim> [yaş]` — Üyeyi kaydeder ve yapılandırılmış kayıt rollerini verir. — yetki: **moderator**
- `!kayıtbilgi [kullanıcıId]` — Üyenin son aktif kayıt bilgisini gösterir. — yetki: **member**
- `!kayıtrol <göster|ayarla rolId...|kapat>` — Kayıt sırasında verilecek rolleri ayarlar. — yetki: **admin**
- `!kayıtsız <kullanıcıId>` — Üyenin kayıt rollerini alır ve kaydını pasif yapar. — yetki: **moderator**

## Moderasyon

- `!ban <kullanıcıId> [süre|0] [sebep]` — Yerel grup yasağı ekler ve üyeyi çıkarır. — yetki: **admin**
- `!capsfiltre <aç|kapat>` — Caps filtresi açar/kapatır. — yetki: **admin**
- `!floodkoruma <aç|kapat>` — Flood koruması açar/kapatır. — yetki: **admin**
- `!floodlimit <tekrar> <saniye>` — Tekrarlanan mesaj flood limitini ayarlar. — yetki: **admin**
- `!ihlalsil <aç|kapat>` — İhlal mesajı silme açar/kapatır. — yetki: **admin**
- `!izinlidomain <liste|ekle değer|sil değer>` — İzinli domainler listesini yönetir. — yetki: **admin**
- `!kick <kullanıcıId> [sebep]` — Üyeyi gruptan çıkarır. — yetki: **moderator**
- `!küfürlistesi <liste|ekle değer|sil değer>` — Küfür/yasaklı kelimeler listesini yönetir. — yetki: **admin**
- `!linkengel <aç|kapat>` — Link engeli açar/kapatır. — yetki: **admin**
- `!mentionlimit <2-50>` — Mention spam limitini ayarlar. — yetki: **admin**
- `!mentionspam <aç|kapat>` — Mention spam koruması açar/kapatır. — yetki: **admin**
- `!modkomutları` — Moderasyon komutlarını listeler. — yetki: **moderator**
- `!modlog [adet]` — Son moderasyon/audit kayıtlarını gösterir. — yetki: **moderator**
- `!otomod <durum|aç|kapat>` — Otomatik moderasyonu yapılandırır. — yetki: **admin**
- `!sil <postId>` — ID ile gönderi siler. — yetki: **moderator**
- `!slowmode <saniye|0>` — Bot tabanlı slowmode ayarlar. — yetki: **admin**
- `!softban <kullanıcıId> [sebep]` — Üyeyi çıkarır, kalıcı yasak bırakmaz. — yetki: **moderator**
- `!spamkoruma <aç|kapat>` — Spam koruması açar/kapatır. — yetki: **admin**
- `!spamlimit <mesaj> <saniye>` — Spam limitini ayarlar. — yetki: **admin**
- `!susturrol <rolId|0>` — Timeout rolünü ayarlar. — yetki: **admin**
- `!temizle <1-100> [kullanıcıId]` — Kanaldaki son mesajları siler. — yetki: **moderator**
- `!timeout <kullanıcıId> <süre|0> [sebep]` — Susturma rolüyle süreli timeout uygular. — yetki: **moderator**
- `!unban <kullanıcıId>` — Yerel grup yasağını kaldırır. — yetki: **admin**
- `!untimeout <kullanıcıId>` — Timeout rolünü kaldırır. — yetki: **moderator**
- `!uyar <kullanıcıId> <sebep>` — Bir üyeye kalıcı uyarı verir. — yetki: **moderator**
- `!uyarılar [kullanıcıId]` — Uyarı geçmişini gösterir. — yetki: **member**
- `!uyarısil <kullanıcıId> <uyarıId|tümü>` — Tek veya tüm uyarıları siler. — yetki: **moderator**
- `!yasaklıdomain <liste|ekle değer|sil değer>` — Yasaklı domainler listesini yönetir. — yetki: **admin**

## Otomasyon

- `!kanaloluştur <nick> | <başlık> | [açıklama] | [tip]` — Yeni kanalı resmî channel/add API’siyle oluşturur ve ID dönmezse listeden kurtarır. — yetki: **admin**
- `!kanalsil <#kanal/id> onay` — Kanalı ID veya #kanaladıyla siler; onay gerekir. — yetki: **owner**
- `!kelimecevap <liste|ekle tetik | cevap|sil id>` — Anahtar kelime cevaplarını yönetir. — yetki: **admin**
- `!webhook <liste|ekle url eventler|sil id>` — Dış webhook bildirimlerini yönetir. — yetki: **owner**
- `!zamanlayıcı <sonra süre kanalId | mesaj|tekrar süre kanalId | mesaj|günlük SS:DD kanalId | mesaj|liste|sil id>` — Tek seferlik, tekrarlayan veya günlük mesaj planlar. — yetki: **admin**

## Özel Komutlar

- `!komutizin <ad> <member|moderator|admin|owner>` — Özel komut yetkisini ayarlar. — yetki: **admin**
- `!komutoluştur <ad> <text|embed|dm|role_add|role_remove> <içerik|rolId>` — Metin/embed/DM/rol özel komutu oluşturur. — yetki: **admin**
- `!komutsil <ad>` — Özel komutu siler. — yetki: **admin**
- `!özelkomutlar` — Özel komutları listeler. — yetki: **member**

## Roller

- `!geçicirol <kullanıcıId> <rolId> <süre>` — Üyeye süreli rol verir. — yetki: **moderator**
- `!kendinerol <rolId>` — İzin verilen rolü alır veya bırakır. — yetki: **member**
- `!otorol <durum|aç rolId...|kapat|kaldır rolId...>` — Yeni katılanlara otomatik rol verir. — yetki: **admin**
- `!rolal <kullanıcıId> <rolId...>` — Üyeden rol alır. — yetki: **moderator**
- `!rolekle <isim> | <#renk> | [member/content/support/moderator/admin]` — Rolü resmî role/add API’siyle oluşturur; hazır yetki şablonu destekler. — yetki: **admin**
- `!roller` — Gruptaki rolleri listeler. — yetki: **member**
- `!rolpanel oluştur <başlık> | <rolId,rolId>` — Komut/Bumote uyumlu rol paneli oluşturur. — yetki: **admin**
- `!rolsil <rolId> onay` — Rolü siler; onay gerekir. — yetki: **admin**
- `!rolver <kullanıcıId> <rolId...>` — Üyeye rol verir. — yetki: **moderator**
- `!selfrol <liste|ekle rolId|sil rolId>` — Kendin-al rollerini yönetir. — yetki: **admin**
- `!üyerolleri [kullanıcıId]` — Üyenin rollerini gösterir. — yetki: **member**

## Rozet

- `!levelrozetver <rozetId> <kullanıcıId>` — Bir Topluyo rozetini kullanıcıya verir ve seviye profiline kaydeder. — yetki: **admin**
- `!rozetler` — Sunucudaki rozetleri listeler. — yetki: **admin**
- `!rozetolustur <ad>|<nick>|<açıklama>|[görsel]|[seviye]` — Sunucuya yeni rozet ekler. — yetki: **owner**
- `!rozetver <rozetId> <kullanıcıId>` — Bir kullanıcıya rozet verir. — yetki: **admin**
- `!seviyerozet <seviye> <rozetId|sil>` — Bir seviyeye mevcut Topluyo rozetini bağlar. — yetki: **admin**
- `!seviyerozetkur <seviye> [ad|nick|açıklama|görsel|kademe]` — Yeni Topluyo rozeti oluşturur ve seviyeye otomatik bağlar. — yetki: **owner**
- `!seviyerozetler` — Seviyelere bağlı rol ve rozet ödüllerini listeler. — yetki: **member**
- `!seviyerozetpaket [1,5,10,20,30,50,75,100]` — Sunucu sahibine özel simgeli seviye rozet paketini oluşturur. — yetki: **member**

## Seviye

- `!istatistik [kullanıcıId]` — Kullanıcının mesaj, XP, günlük XP ve rozet istatistiklerini gösterir. — yetki: **member**
- `!leveldurum` — Sunucunun seviye ve rozet ayarlarını özetler. — yetki: **admin**
- `!levelreset <kullanıcıId|tümü>` — Kullanıcı veya tüm grubun seviye verisini sıfırlar. — yetki: **admin**
- `!toprank [sayfa]` — Sunucunun XP liderlik tablosunu 336×178 SVG görseliyle gösterir. (`!leveltop` da çalışır.) — yetki: **member**
- `!rank [kullanıcıId]` — Seviye, XP, ilerleme ve kazanılan rozetleri gösterir. — yetki: **member**
- `!rankkart <aç|kapat>` — SVG rank kartını açar veya kapatır. — yetki: **admin**
- `!seviyeayar <aç|kapat>` — Seviye sistemini açar veya kapatır. — yetki: **admin**
- `!seviyerol <seviye> <rolId|sil>` — Bir seviyeye para ve rozet şartı olmayan otomatik rol ödülü bağlar. — yetki: **admin**
- `!seviyesenkron <kullanıcıId|tümü>` — Mevcut seviyeye göre eksik rol ve rozet ödüllerini yeniden uygular. — yetki: **admin**
- `!seviyeset <kullanıcıId> <seviye>` — Kullanıcıyı doğrudan belirli seviyeye getirir. — yetki: **admin**
- `!xpal <kullanıcıId> <miktar>` — Kullanıcıdan XP düşer. — yetki: **admin**
- `!xpayar <minXP> [maxXP] <saniye>` — Mesaj XP aralığını ve cooldown süresini ayarlar. — yetki: **admin**
- `!xpçarpan <0.1-100>` — Sunucunun XP çarpanını ayarlar. — yetki: **admin**
- `!xpver <kullanıcıId> <miktar>` — Kullanıcıya XP ekler ve seviye ödüllerini uygular. — yetki: **admin**

## Sosyal Medya

- `!sosyal <liste|ekle tür kanalId isim | url|sil id|kontrol id>` — YouTube ve RSS tabanlı sosyal bildirimleri yönetir. — yetki: **admin**
- `!yayın <liste|ekle|ayarla|kontrol|test|sil>` — Kick, Twitch ve YouTube canlı yayın duyurularını yönetir. — yetki: **admin**

## Ticket

- `!ticket <aç konu|kapat id|liste|bilgi id>` — Ticket açar, kapatır ve yönetir. — yetki: **member**
- `!ticketayar <özelkanal|kanalsil> <aç|kapat>` — Ticket kanal davranışını ayarlar. — yetki: **admin**
- `!ticketpanel <başlık>` — Buton/Bumote uyumlu ticket paneli oluşturur. — yetki: **admin**
- `!ticketyetkili <rolId,rolId|temizle>` — Ticket yetkili rollerini ayarlar. — yetki: **admin**

## Yönetim

- `!logtest` — Log kanalını ve botun yazma iznini gerçek gönderimle kontrol eder. — yetki: **admin**
- `!apidurum` — Topluyo sunucu saati, uzak IP ve batch motoru gecikmesini birlikte ölçer. — yetki: **owner**
- `!apioku </!api/yol> [JSON]` — Yalnızca dokümanda salt-okunur olarak tanımlanan bir API ucunu güvenli biçimde sorgular. — yetki: **owner**
- `!apionbellek <temizle|isit>` — API, kanal ve rol önbelleklerini temizler veya yeniden ısıtır. — yetki: **owner**
- `!apiperformans` — Batch, cache, dedupe, retry, kuyruk ve JSON depolama performansını gösterir. — yetki: **admin**
- `!apistres [1-100]` — Resmî test/time ucunu /!apis üzerinden batch ederek kontrollü hız testi yapar. — yetki: **owner**
- `!ayarlar` — Bu sunucuya özel bot ayarlarını özetler. — yetki: **admin**
- `!bakımayar <durum|yedek aç/kapat|yedeksaat sayı|uyarı aç/kapat|kontrolsaat sayı>` — Otomatik yedek ve sağlık kontrolü ayarlarını yönetir. — yetki: **owner**
- `!bekleyenler` — Sunucuya katılım bekleyen kullanıcıları listeler. — yetki: **admin**
- `!bekleyentoplu <kabul|reddet> [adet] onay` — Katılım bekleyen kullanıcıları /!apis batch motoruyla toplu kabul eder veya reddeder. — yetki: **owner**
- `!bosshere <sunucuLinki>` — ToplyBot’u verilen Topluyo sunucusuna katılmaya gönderir. — yetki: **owner**
- `!cevrimici` — Sunucudaki çevrimiçi kullanıcı ID’lerini listeler. — yetki: **admin**
- `!destekşablon <kur|onar|doğrula|durum|test|sıfırla TAM SIFIRLA>` — Bot sahibine özel destek şablonunu kurar/onarır; açık onaylı sıfırlama mevcut kanal ve rolleri silerek baştan kurar. — yetki: **owner**
- `!duyuru <mesaj>` — Yapılandırılmış duyuru kanalına mesaj gönderir. — yetki: **admin**
- `!ekipbilgi <ekipId>` — Bir ekibin ayrıntılarını crew/get ile getirir. — yetki: **admin**
- `!ekipduzenle <ekipId>|<ad>|<renk>|[görsel]` — Bir ekibin adını, rengini ve görselini değiştirir. — yetki: **owner**
- `!ekipler` — Sunucudaki crew/ekipleri listeler. — yetki: **admin**
- `!ekipolustur <ad>|[renk]|[görsel]` — Sunucuya crew/add ile ekip ekler. — yetki: **owner**
- `!ekipsil <ekipId> onay` — Ekibi siler; onay gerekir. — yetki: **owner**
- `!ekipsirala <id,id,id>` — Ekip sırasını crew/sort ile değiştirir. — yetki: **owner**
- `!grupana <içerik>` — Sunucunun ana sayfa içeriğini group/set/home ile değiştirir. — yetki: **owner**
- `!grupizin <keşfet> <herkesÜye> <filtre> <reklam>` — Keşfet, herkesi üye yapma, kötüye kullanım filtresi ve reklam izinlerini değiştirir. — yetki: **owner**
- `!grupprofil <ad>|<açıklama>|[görselURL]` — Grup adını, açıklamasını ve görselini resmî group/set/profile API’siyle günceller. — yetki: **owner**
- `!grupsosyal <instagram|x|youtube|tiktok|kick|twitch|github|steam|linkedin|website> <değer|sil>` — Sunucu sosyal medya bağlantısını günceller. — yetki: **owner**
- `!hizlandir` — Sunucu kanal, rol, üye, grup ve ayar verilerini paralel batch ile önceden yükler. — yetki: **admin**
- `!kanalayarla <tür> <#kanaladı|kanalId|kapat>` — Bot özelliklerinin kanalını ID veya #kanaladı ile ayarlar. — yetki: **admin**
- `!kanalduzenle <#kanal/id> <alan> <değer>` — Kanalın nick, başlık, açıklama, tip veya izin listesi alanını channel/set ile değiştirir. — yetki: **owner**
- `!kanalizin <#kanal/id> <kullanıcıId> <oku|yaz|kontrol> <ver|al>` — Bir kullanıcıya kanal okuma, yazma veya kontrol artı izni verir/alır. — yetki: **owner**
- `!kanaldetay <#kanal/id>` — Kanal bilgisi ve artı/eksi kullanıcı izinlerini channel/get + channel/detail ile getirir. — yetki: **admin**
- `!kanalkopyala <#kaynak/id> <yeniNick>|[yeniBaşlık]` — Bir kanalın tipi ve bütün rol/kullanıcı izinlerini yeni kanala kopyalar. — yetki: **owner**
- `!kanalliste [sıra|ad|id|tip]` — Kanal sırası, etiketi, ID, başlık ve tip bilgilerini listeler. — yetki: **admin**
- `!kanalsırala <kanalId,kanalId,...>` — Kanal sırasını verilen ID dizisine göre uygular. — yetki: **admin**
- `!kullanicilar <id,id,id>` — En fazla 100 kullanıcı ID’sini user/list ile tek çağrıda çözümler. — yetki: **admin**
- `!mesaj <kullanıcıId> <mesaj>` — Bir kullanıcıya özel mesaj gönderir. — yetki: **admin**
- `!önbellektemizle` — Kanal çözümleyici önbelleğini temizleyip sunucu verilerini yeniden yükler. — yetki: **admin**
- `!postbilgi <postId>` — Bir postun ayrıntılarını post/get ile getirir. — yetki: **admin**
- `!postduzenle <postId> <metin>` — Post metnini post/set ile değiştirir. — yetki: **admin**
- `!postlar <#kanal/id> [adet]` — Kanalın son postlarını post/list ile getirir. — yetki: **admin**
- `!postsil <postId> onay` — Postu siler; onay gerekir. — yetki: **admin**
- `!prefixbilgi` — Aktif komut prefixini gösterir. — yetki: **member**
- `!rolduzenle <rolId/ad> <name|color|power_*> <değer>` — Rol adı, rengi veya tek bir power_* yetkisini değiştirir. — yetki: **owner**
- `!rolkopyala <rolId/ad> <yeniAd>|[renk]` — Bir rolün rengini ve bütün power_* yetkilerini yeni role kopyalar. — yetki: **owner**
- `!rolliste [sıra|ad|id|güç]` — Rol sırası, adı, ID, renk ve güç bilgilerini listeler. — yetki: **admin**
- `!rolsablon <rolId/ad> <şablon>` — Bir role hazır member/content/support/moderator/admin yetki paketi uygular. — yetki: **owner**
- `!rolsırala <rolId,rolId,...>` — Rol sırasını verilen ID dizisine göre uygular. — yetki: **admin**
- `!sistemkontrol [detay]` — Sunucu ayarlarını, kanal/rol bağlantılarını, veri dosyalarını ve şablonu denetler. — yetki: **admin**
- `!sistemonar [test]` — Yedek alıp destek şablonu, kanallar, roller, erişimler ve hoş geldin sistemini onarır. — yetki: **owner**
- `!sunucukurucu` — Sunucunun kurucu hesabını group/founder üzerinden gösterir. — yetki: **admin**
- `!sunucuozet` — Resmî API uçlarından sunucu, üye, kanal, rol, bekleyen, rozet ve ekip özetini tek batch ile getirir. — yetki: **admin**
- `!takimlar` — Sunucudaki team kayıtlarını listeler. — yetki: **admin**
- `!uyebilgi <kullanıcıId|@nick>` — Üyeyi ID veya kullanıcı adıyla member/get üzerinden sorgular. — yetki: **admin**
- `!uyekabul <kullanıcıId>` — Katılım bekleyen kullanıcıyı kabul eder. — yetki: **admin**
- `!uyeler [sayfa]` — Sunucu üyelerini sayfalı olarak listeler. — yetki: **admin**
- `!uyereddet <kullanıcıId>` — Katılım bekleyen kullanıcıyı reddeder. — yetki: **admin**
- `!uyerolayarla <kullanıcıId> <rolId,rolId|temizle>` — Üyenin bütün rollerini tek işlemde verilen rol ID listesiyle değiştirir. — yetki: **admin**
- `!yedek <oluştur [etiket]|liste|bilgi id|geri id>` — Sunucuya özel bot verilerini yedekler, listeler ve geri yükler. — yetki: **admin**
- `!yetkiguc <kullanıcıId> [#kanal/id]` — Kullanıcının grup ve isteğe bağlı kanal gücünü sorgular. — yetki: **admin**
