# Değişiklik Günlüğü

## 3.7.0

- Sunucuya özel XP ve seviye hesaplaması için yeni `LevelingService` eklendi.
- Mesaj XP aralığı, çarpan, cooldown, minimum mesaj uzunluğu, günlük XP sınırı, XP eğrisi ve yok sayılan kanallar ayarlanabilir hâle getirildi.
- Seviye atlama bildirimleri, rank kartı ve liderlik tablosu eklendi.
- Seviye kilometre taşlarına otomatik rol ve resmî Topluyo badge/rozet ödülü bağlama eklendi.
- Manuel XP ekleme/çıkarma, seviye belirleme, manuel badge verme ve ödül senkronizasyon komutları eklendi.
- Tek rozet ve hazır kilometre taşı rozet paketi oluşturma akışı eklendi.
- Badge oluşturma API cevabında ID bulunmadığında `badge/list` üzerinden kontrollü polling ve isim eşleme ile ID kurtarma eklendi.
- JTML yardım merkezine ayrı **Seviye & Rozet Merkezi** ve bütün yönetim işlemleri için tek girişli panel eklendi.
- Seviye ve rozet ayarları genel ayar paneline eklendi; bütün kayıtlar grup ID bazında izole edildi.
- Seviye rozet paketi ve toplu ödül senkronizasyonu progress kart sistemine bağlandı.
- 81 otomatik test, 93 JavaScript sözdizimi kontrolü ve 179 komut envanteri başarıyla doğrulandı.

## 3.6.1

- `postsil` takma adı çakışmasının bot açılışını durdurması kalıcı olarak giderildi.
- Ana komut adlarının takma adlardan öncelikli olduğu, çakışan takma adların uyarıyla atlandığı dayanıklı kayıt sistemi eklendi.
- Moderasyon `sil` komutunun çakışan `postsil` takma adı `mesajsil` olarak değiştirildi.
- JTML yardım ekranı kompakt **ToplyBot Control Panel** tasarımıyla yeniden oluşturuldu.
- Tek kelimelik komut başlatıcı ve bütün komutlarda tek parametre alanı eklendi.
- Ban, kick, timeout ve benzeri sık kullanılan komutlara güvenli akıllı parametre tamamlama eklendi.
- Uzun işlemler için aynı post üzerinde yüzde, aşama, durum ve hata gösteren JTML ilerleme kartları eklendi.
- Destek şablonu ve sistem onarımına gerçek aşama bazlı progress güncellemeleri bağlandı.
- 76 otomatik test, 91 JavaScript sözdizimi kontrolü ve 169 komut envanteri başarıyla doğrulandı.

## 3.6.0

- Topluyo resmî `/!api` dokümanına göre grup, kanal, rol, üye, katılım, izin, post, rozet, ekip, takım, kullanıcı ve test uçlarını kapsayan `ApiManagementService` eklendi.
- Yönetim profilinde otomatik yüklenen `apiManagement` eklentisine 42 resmî API komutu eklendi.
- `/!apis` motoru 35 ms mikro-batch, öncelik, iki paralel batch, 40 satır sınırı ve backpressure ile yeniden yazıldı.
- Aynı salt-okunur çağrılar bekleme aşamasında birleştirilir; cevaplar TTL/LRU önbelleğe alınır.
- Kanal, rol, üye, grup, post, rozet ve ekip yazmaları ilgili önbelleği otomatik geçersiz kılar.
- Timeout, 429 ve 5xx için yalnızca salt-okunur çağrılarda jitter'lı exponential backoff eklendi.
- `JsonStore` RAM cache ve atomik disk yazımıyla hızlandırıldı.
- Kanal/rol çözümleme servislerine sunucu bazlı cache, force-refresh ve başlangıç warm-up eklendi.
- `!sunucuozet`, `!grupprofil`, `!grupana`, `!grupizin`, `!grupsosyal`, `!kanalduzenle`, `!kanalizin`, `!rolduzenle`, `!rolsablon`, `!uyeler`, `!bekleyenler`, `!yetkiguc` ve diğer resmî yönetim komutları eklendi.
- Kanal ve rol kopyalama, bütün üye rollerini atomik ayarlama ve katılım listesini kontrollü batch ile toplu işleme eklendi.
- `!apidurum`, `!apiperformans`, `!apionbellek`, `!apistres`, `!apioku` ve `!hizlandir` performans/tanılama komutları eklendi.
- `apioku` yalnızca salt-okunur endpoint izin listesinde çalışacak şekilde sınırlandı.
- Mevcut kanal/rol oluşturma komutları dayanıklı provisioning ve cache invalidation katmanına taşındı.
- 72 otomatik test, 90 JavaScript sözdizimi kontrolü ve 169 komut envanteri başarıyla doğrulandı.

## 3.5.0

- Kanal/rol oluşturma işlemleri için grup bazlı kilit, kontrollü tekrar deneme ve geri kazanım sağlayan `ProvisioningService` eklendi.
- Topluyo oluşturma cevabında kanal ID'si dönmediğinde yeni kanal listeden ve bilgi uçlarından bulunarak kurulumun devam etmesi sağlandı.
- Destek şablonu v2, tekrar çalıştırılabilir ve yarıda kaldığı aşamadan devam edebilir şekilde yeniden yazıldı.
- Kurulumdan önce otomatik güvenlik yedeği, aşama/ilerleme kaydı ve işlem sonu doğrulama eklendi.
- 6 rol ve 11 kanallı genişletilmiş destek sunucusu yapısı eklendi.
- Hoş geldin, ayrılma, kayıt, otorol, moderasyon, timeout, ticket, log, özel komut, kelime otomasyonu ve sistem kanalı tek kurulumda birbirine bağlandı.
- Sunucuya özel `BackupService` ile yedek oluşturma, listeleme, inceleme ve güvenli geri yükleme eklendi.
- `SystemHealthService` ile kanal, rol, ayar, veri dosyası, bot erişimi, hoş geldin sistemi ve şablon bütünlüğü denetimi eklendi.
- `!sistemkontrol`, `!sistemonar`, `!yedek`, `!önbellektemizle` ve `!bakımayar` komutları eklendi.
- Otomatik zamanlanmış yedekleme ve düşük sağlık puanında sistem/log kanalına uyarı gönderme eklendi.
- Komut hatalarına benzersiz hata kimliği ve bot sahibine kısa teknik hata özeti eklendi.
- API sonuç ayrıştırma ve oluşturulan varlık ID çıkarımı daha fazla cevap biçimini destekleyecek şekilde genişletildi.
- 65 otomatik test ve 86 JavaScript dosyası sözdizimi kontrolü başarıyla geçti.

## 3.4.1

- `group/join` olaylarını ayrı `WelcomeService` üzerinden güvenilir biçimde işleyen yeni karşılama akışı eklendi.
- Bot hesabının kullanıcı ID'si `/!api/user/id` ile alınır ve önbelleğe alınır.
- Hoş geldin kanalında bot için okuma/yazma erişimi `/!api/channel/options/set` ile otomatik doğrulanır.
- v3.4.0 destek şablonunun salt okunur kanallarda bot kullanıcı ID'sini `write_plus_user_ids` alanına eklememesi düzeltildi.
- Mevcut destek şablonu kanallarının erişimleri yeniden kurulum sırasında onarılır.
- `!welcometest`, `!welcometamir test` ve `!welcomediagnostik` komutları eklendi.
- Kanal, kullanıcı veya üye bilgisi API'leri geçici olarak başarısız olsa bile temel karşılama mesajı gönderilir.
- Eski `#kanaladı` biçiminde saklanan hoş geldin kanalı otomatik olarak kanal ID'sine dönüştürülür.
- Yönetim profilinde eski config listesinde eksik olsa dahi `core`, `settings` ve `welcome` eklentileri zorunlu yüklenir.
- Hoş geldin olayları için alınan, atlanan, gönderilen ve hata durumları ayrıntılı loglanır.

## 3.4.0

- Kanal nesnelerindeki gerçek `data` alanının API zarfı sanılıp kanal bilgisini yok etmesi düzeltildi.
- `#kanaladı`, kanal başlığı, nick, slug, `<#ID>` ve sayısal ID çözümleme daha toleranslı hale getirildi.
- Kanal listesi boş veya farklı biçimde dönerse `/!api/channel/show/info` fallback çözümlemesi eklendi.
- Komut merkezine hedef ID, süre, sebep ve mesaj sayısı alanları olan **Hızlı Moderasyon** paneli eklendi.
- Uyarı, kick, ban, timeout, unban, untimeout ve temizle işlemleri panelden çalıştırılabilir hale getirildi.
- Kanal envanterine sıra, ad, ID ve tip görünümü; rol envanterine sıra, ad, ID ve güç görünümü eklendi.
- Kanal ve rol sıralamasını API üzerinden kaydeden panel düğmeleri ile `!kanalsırala` ve `!rolsırala` komutları eklendi.
- `!kanalliste` ayrıntılı kanal kimliği/başlık/tip bilgisi, `!rolliste` rol kimliği/renk/güç bilgisi gösterecek şekilde genişletildi.
- Yalnızca `supportTemplate.ownerUserId` hesabının kullanabildiği `!destekşablon kur` tek komutluk destek sunucusu kurulumu eklendi.
- Destek şablonu 5 rol, 7 kanal, karşılama, otorol, moderasyon, log ve ticket panelini sunucu bazında idempotent biçimde kurar.
- 53 otomatik test eklendi/geçti.

## 3.3.1

- JTML yönetim paneli koyu kartlar, iki sütunlu kategori düzeni ve daha temiz navigasyonla yenilendi.
- Panel ayarlarının tamamı grup ID bazında izole edildi; sunucular arasında ayar paylaşımı engellendi.
- Eski global `config.channels` değerleri yalnızca `defaultGroupId` için tek seferlik geçiş verisi olarak sınırlandı.
- Kanal alanlarına `#kanaladı`, `<#kanalId>` ve sayısal kanal ID desteği eklendi.
- Kanal adları aktif sunucunun `/!api/channel/list` cevabından çözülür ve gerçek ID olarak saklanır.
- Kanal `nick`, `name`, `title`, `slug` ve alternatif API alanları desteklendi.
- **Hoş Geldin Kurulumu** panelin ilk kategorisi yapıldı; hoş geldin ve ayrılma kanalları bu bölüme taşındı.
- `!welcomekanal` ve `!kanalliste` komutları eklendi; `!kanalayarla` `#kanaladı` kabul edecek şekilde güncellendi.
- 45 otomatik test ve 71 JavaScript sözdizimi kontrolü başarıyla geçti.

## 3.3.0

- Native JTML komut merkezine 7 kategorili, 58 alanlı tam grup ayar paneli eklendi.
- Kanal, mesaj, rol, moderasyon, ticket, otomasyon ve davet değerleri menüden girilebilir hale getirildi.
- Tüm parametreli komutlara JTML argüman formu ve `runargs` işlemi eklendi.
- Optional parametre (`[...]`) kabul eden komutlar da form üzerinden çalıştırılabilir hale getirildi.
- Ayar değerlerine tür doğrulaması, varsayılana döndürme ve audit kaydı eklendi.
- Ticket, özel komut ve davet sistemlerinin enabled anahtarları gerçek çalışma akışına bağlandı.
- Sürüm 3.3.0 ve WebSocket User-Agent bilgisi güncellendi.

## 3.2.6

- Native JTML düğmelerinde gerçek tıklama değerini `message.submit` üzerinden çözme eklendi.
- Aynı isimli Bumote alanlarının son düğme metniyle ezilmesi nedeniyle oluşan yanlış menü aksiyonu düzeltildi.
- Eski/alternatif `message.form` payload biçimleriyle geriye dönük uyumluluk korundu.
- Etkileşim loguna `resolvedAction` eklendi.

## 3.2.5

- Komut merkezindeki tekrar eden düz metin özet varsayılan olarak kaldırıldı.
- Komut bilgileri native JTML panelinin içine taşındı.
- JTML çift teslim modeli eklendi: `post.text` görsel render, `/!api/post/bumote` gerçek etkileşim kaydı.
- Menü açılışı, yenileme, sekme değişimi, `replyJtml()` ve embed butonları çift teslim modeline geçirildi.
- Gerçek Bumote tıklamaları için post, kullanıcı, submit ve form tanılama logu eklendi.
- `interactions.attachBumote` ve `commandMenu.showTextSummary` yapılandırmaları eklendi.
- Mini embed istemcisinin yalnızca görüntüleyici olduğu belgelendi.
- 34 otomatik test başarıyla geçti.

## 3.2.4

- Native JTML teslimi `/!api/post/bumote` ekinden çıkarılıp doğrudan `post/add.text` içine taşındı.
- Komut merkezi güncellemeleri metin ve JTML'yi birlikte `post/set.text` alanına yazar.
- Embed etkileşimleri de aynı inline JTML modeline geçirildi.
- Mevcut posta etkileşim bağlama işlemi post metnini okuyup JTML bloğunu güvenli biçimde değiştirir.
- Eski JTML bloklarını ayıklayan ve tek blokla yeniden birleştiren yardımcı eklendi.
- Yanıltıcı “JTML ekleme bildirimi” bilgi logu kaldırıldı.
- 34 otomatik test ve 66 JavaScript sözdizimi kontrolü başarıyla geçti.

## 3.2.3

- JTML üreticisi ham HTML formundan Topluyo'nun resmî `~{JSON}` MarkTop biçimine geçirildi.
- Düğmeler `type: bumote`, arama alanları `type: input` olarak oluşturuluyor.
- Menü yerleşimi `box`, `flex-x` ve `flex-y` native düğümleriyle yeniden kuruldu.
- Native JTML ekleme bildirimleri için bileşen sayımı ve WebSocket protokol tanıma eklendi.
- Eski HTML çerçeve kurtarma desteği geriye dönük uyumluluk için korundu.
- Örnek JTML dosyaları ve belgeler geçerli sözdizimine taşındı.

## 3.2.0

- Kanala yalnızca prefix (`!`) gönderildiğinde otomatik açılan JTML Command Center eklendi.
- Görsel Ana Menü ve 10 üst düzey komut sekmesi eklendi.
- JTML komut arama alanı eklendi.
- Komut ayrıntısı, kullanım, yetki, kategori ve takma ad ekranları eklendi.
- Parametresiz komutları tek tıklamayla çalıştırma eklendi.
- Önceki/Sonraki sayfalama, yenileme, geri dönme ve menüyü kapatma eklendi.
- Komut merkezi aynı gönderiyi `post/set` ile günceller; kanal mesaj kirliliği azaltıldı.
- Kullanıcıya özel, süreli ve kalıcı komut menüsü oturumları eklendi.
- `replyJtml()` komut bağlamı yardımcısı eklendi.
- `TopluyoClient.updatePost()` ve `TopluyoClient.getPost()` yardımcıları eklendi.
- SVG Command Center kartı eklendi.
- 22 otomatik test başarıyla geçti.

## 3.1.0

- Görsel SVG embed kartları eklendi.
- `post/bumote` API yardımcı metodu eklendi.
- Kalıcı Bumote etkileşim motoru eklendi.
- Komut, yanıt, DM, link ve rol eylemleri eklendi.
- Buton bazlı yetki, cooldown ve devre dışı bırakma desteği eklendi.
- Tek kullanıcı kullanımı ve maksimum kullanım sınırı eklendi.
- `!etkileşim` yönetim komutu eklendi.
- `!embed bağla` ile mevcut posta etkileşim bağlama eklendi.
- Ham Bumote/JTML kodu tanımlama desteği eklendi.
- Eski yapılandırmalarda `embeds` aktifse `interactions` otomatik yüklenir.
- Cloudflare challenge algılama yardımcı kodu test edilebilir ayrı modüle taşındı.
- 18 otomatik test ve 59 JavaScript sözdizimi kontrolü başarılı.

## 3.0.2

- Cloudflare Managed Challenge algılama ve yeniden bağlantı döngüsünü durdurma.

## 3.0.1

- WebSocket handshake tanılama ve uyumluluk headerları.

## 3.0.0

- Moderasyon, rol, seviye, ekonomi, çekiliş, ticket, otomasyon ve diğer profesyonel modüller.

## 3.2.2

- Topluyo'nun kaçışlanmamış JTML içeren bozuk `post/bumote` WebSocket çerçeveleri için toleranslı protokol ayrıştırıcısı eklendi.
- Bumote ekleme bildirimi ile gerçek form gönderimi ayrıldı.
- Tek HTML form, nested JSON ve query-string form cevapları desteklenmeye başladı.
- Varsayılan `management` eklenti profili ile eğlence modülleri eski config listelerinde bulunsa bile devre dışı bırakıldı.
