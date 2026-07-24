# Cloudflare 403 / Managed Challenge

WebSocket yanıtında `Just a moment`, `Enable JavaScript and cookies`, `challenges.cloudflare.com` veya `cType: 'managed'` görülüyorsa Cloudflare, `/!bot` WebSocket yoluna tarayıcı challenge'ı uyguluyor demektir.

Bu challenge Node.js `ws` istemcisinde çalıştırılamaz. Token WebSocket açıldıktan sonra gönderildiği için bu hata token doğrulaması değildir.

## Topluyo yöneticisinin yapması gereken

- `/!bot` yolunu Managed Challenge / Under Attack kurallarından hariç tutmak.
- Bot Fight Mode tüm alan adına uygulanıyorsa `/!bot` için uygun bot istisnası sağlamak veya bu modu kapatmak.
- Gerekirse bot WebSocket'i challenge uygulanmayan ayrı bir alt alan adına taşımak.

## Kullanıcının ileteceği bilgiler

- Tarih ve saat
- CF-Ray
- İstemci IP ülkesi / kullanılan ağ
- `npm run diagnose` çıktısı

3.0.2, challenge tespit edildiğinde sonsuz yeniden bağlanmayı durdurur. Bağlantıyı açan gerçek çözüm sunucu tarafındaki Cloudflare kuralının düzeltilmesidir.
