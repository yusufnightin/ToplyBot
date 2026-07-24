const test = require('node:test');
const assert = require('node:assert/strict');
const { LiveStreamService, renderTemplate, slugFromSource } = require('../src/services/LiveStreamService');

test('yayın kaynağından kullanıcı adını çıkarır', () => {
  assert.equal(slugFromSource('https://www.twitch.tv/ornek/'), 'ornek');
  assert.equal(slugFromSource('@ornek'), 'ornek');
});

test('duyuru şablonundaki değişkenleri doldurur', () => {
  assert.equal(renderTemplate('{mention} {name}: {title} {url}', {
    mention: '@millet', name: 'Topluyo', title: 'Canlı', url: 'https://kick.com/topluyo'
  }), '@millet Topluyo: Canlı https://kick.com/topluyo');
});

test('Kick canlı yayın cevabını ortak biçime dönüştürür', async () => {
  const service = new LiveStreamService({
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { livestream: { id: 42, is_live: true, session_title: 'Yayın başlığı', viewer_count: 77 } };
      }
    })
  });
  const result = await service.check({ platform: 'kick', source: 'ornek' });
  assert.equal(result.live, true);
  assert.equal(result.streamId, '42');
  assert.equal(result.title, 'Yayın başlığı');
  assert.equal(result.url, 'https://kick.com/ornek');
});

test('Kick ClientID ve ClientSecret ile erişim anahtarını otomatik üretir', async () => {
  const calls = [];
  const responses = [
    { access_token: 'otomatik-kick-token', token_type: 'Bearer', expires_in: 3600 },
    { data: [{ broadcaster_user_id: 99, stream_title: 'Kanal başlığı' }] },
    { data: [{ id: 42, stream_title: 'Canlı yayın', viewer_count: 77, category: { name: 'Sohbet' } }] }
  ];
  const service = new LiveStreamService({
    config: { kick: { clientId: 'istemci', clientSecret: 'gizli' } },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        async json() { return responses.shift(); }
      };
    }
  });

  const result = await service.check({ platform: 'kick', source: 'ornek' });
  assert.equal(result.live, true);
  assert.equal(result.title, 'Canlı yayın');
  assert.equal(calls[0].url, 'https://id.kick.com/oauth/token');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.body.get('grant_type'), 'client_credentials');
  assert.equal(calls[0].options.body.get('client_id'), 'istemci');
  assert.equal(calls[0].options.body.get('client_secret'), 'gizli');
  assert.equal(calls[1].options.headers.authorization, 'Bearer otomatik-kick-token');
  assert.equal(calls[2].options.headers.authorization, 'Bearer otomatik-kick-token');
});

test('Kick uygulama anahtarı geçersizleşirse otomatik yeniler', async () => {
  const calls = [];
  const responses = [
    { ok: true, status: 200, data: { access_token: 'eski-token', expires_in: 3600 } },
    { ok: false, status: 401, data: {} },
    { ok: true, status: 200, data: { access_token: 'yeni-token', expires_in: 3600 } },
    { ok: true, status: 200, data: { data: [{ broadcaster_user_id: 99 }] } },
    { ok: true, status: 200, data: { data: [] } }
  ];
  const service = new LiveStreamService({
    config: { kick: { clientId: 'istemci', clientSecret: 'gizli' } },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      const response = responses.shift();
      return {
        ok: response.ok,
        status: response.status,
        async json() { return response.data; }
      };
    }
  });

  const result = await service.check({ platform: 'kick', source: 'ornek' });

  assert.equal(result.live, false);
  assert.equal(calls.filter((call) => call.url === 'https://id.kick.com/oauth/token').length, 2);
  assert.equal(calls[3].options.headers.authorization, 'Bearer yeni-token');
  assert.equal(calls[4].options.headers.authorization, 'Bearer yeni-token');
});

test('YouTube API anahtarı yoksa açıklayıcı hata verir', async () => {
  const service = new LiveStreamService();
  await assert.rejects(
    service.check({ platform: 'youtube', source: 'UC1234567890123456789012' }),
    /apiKey/
  );
});

test('YouTube son yüklenen videoyu kanal logosuyla yeni video olayına dönüştürür', async () => {
  const calls = [];
  const service = new LiveStreamService({
    config: { youtube: { apiKey: 'youtube-test-key' } },
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes('/channels?')) {
        return {
          ok: true,
          async json() {
            return {
              items: [{
                snippet: {
                  title: 'Örnek Kanal',
                  thumbnails: { high: { url: 'https://yt3.ggpht.com/ornek-logo' } }
                },
                contentDetails: { relatedPlaylists: { uploads: 'UU-ornek' } }
              }]
            };
          }
        };
      }
      if (String(url).includes('/playlistItems?')) {
        return {
          ok: true,
          async json() {
            return {
              items: [{
                snippet: {
                  title: 'Yeni video',
                  publishedAt: '2026-07-25T12:00:00Z',
                  thumbnails: { high: { url: 'https://i.ytimg.com/vi/video-1/hqdefault.jpg' } },
                  resourceId: { videoId: 'video-1' }
                },
                contentDetails: { videoId: 'video-1', videoPublishedAt: '2026-07-25T12:00:00Z' }
              }]
            };
          }
        };
      }
      return {
        ok: true,
        async json() {
          return {
            items: [{
              id: 'video-1',
              snippet: {
                title: 'Yeni video',
                publishedAt: '2026-07-25T12:00:00Z',
                liveBroadcastContent: 'none',
                thumbnails: { high: { url: 'https://i.ytimg.com/vi/video-1/hqdefault.jpg' } }
              }
            }]
          };
        }
      };
    }
  });

  const result = await service.check({
    platform: 'youtube',
    source: 'UC1234567890123456789012'
  });

  assert.equal(result.live, false);
  assert.equal(result.eventType, 'video');
  assert.equal(result.contentId, 'video-1');
  assert.equal(result.title, 'Yeni video');
  assert.equal(result.profileImage, 'https://yt3.ggpht.com/ornek-logo');
  assert.equal(result.url, 'https://www.youtube.com/watch?v=video-1');
  assert.equal(calls.length, 3);
  assert.equal(calls.some((url) => url.includes('/search?')), false);
});

test('YouTube aktif yayını video paylaşımından ayırır', async () => {
  const service = new LiveStreamService({
    config: { youtube: { apiKey: 'youtube-test-key' } },
    fetchImpl: async (url) => {
      if (String(url).includes('/channels?')) {
        return {
          ok: true,
          async json() {
            return {
              items: [{
                snippet: { title: 'Canlı Kanal', thumbnails: {} },
                contentDetails: { relatedPlaylists: { uploads: 'UU-canli' } }
              }]
            };
          }
        };
      }
      if (String(url).includes('/playlistItems?')) {
        return {
          ok: true,
          async json() {
            return {
              items: [{
                snippet: { resourceId: { videoId: 'live-1' } },
                contentDetails: { videoId: 'live-1' }
              }]
            };
          }
        };
      }
      return {
        ok: true,
        async json() {
          return {
            items: [{
              id: 'live-1',
              snippet: { title: 'Şu anda canlı', liveBroadcastContent: 'live' },
              liveStreamingDetails: {
                actualStartTime: '2026-07-25T12:00:00Z',
                concurrentViewers: '321'
              }
            }]
          };
        }
      };
    }
  });

  const result = await service.check({
    platform: 'youtube',
    source: 'UC1234567890123456789012'
  });

  assert.equal(result.live, true);
  assert.equal(result.eventType, 'live');
  assert.equal(result.contentId, 'live-1');
  assert.equal(result.viewers, 321);
});
