const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const CardService = require('../src/services/CardService');
const {
  isTrustedAvatarUrl,
  isTrustedLiveTargetUrl,
  liveRedirectTarget,
  tunnelUrlFromOutput
} = require('../src/services/CardService');

function fixture(config = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toplybot-card-'));
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.copyFileSync(
    path.resolve(__dirname, '..', 'assets', 'welcome-card-template.svg'),
    path.join(root, 'assets', 'welcome-card-template.svg')
  );
  fs.copyFileSync(
    path.resolve(__dirname, '..', 'assets', 'welcome-card-background.png'),
    path.join(root, 'assets', 'welcome-card-background.png')
  );
  const service = new CardService({ projectRoot: root, config, logger: null });
  return { root, service };
}

test('yeni welcome kartı kaynak tasarıma avatar, kullanıcı ve sunucu adını yerleştirir', async (t) => {
  const { root, service } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  service.fetchAvatarDataUri = async () => 'data:image/png;base64,dGVzdA==';

  const card = await service.createWelcomeCard({
    userId: 25426,
    userName: 'Yusuf',
    groupName: 'Özel Destek',
    avatarUrl: 'https://cdn.example.com/avatar.png',
    accent: '#2EA8FF'
  });
  const svg = fs.readFileSync(card.path, 'utf8');

  assert.match(card.fileName, /\.png$/);
  assert.match(svg, /^<\?xml/);
  assert.match(svg, /<svg/);
  assert.match(svg, /data:image\/png;base64,/);
  assert.match(svg, /data:image\/png;base64,dGVzdA==/);
  assert.match(svg, />@Yusuf<\/text>/);
  assert.match(svg, />Özel Destek<\/text>/);
  assert.doesNotMatch(svg, /RUNTIME_(?:TEMPLATE_IMAGE|AVATAR|USERNAME|SERVER_NAME)/);
  assert.equal(card.url, null);
  assert.match(card.jtml, /^~\{/);
  assert.match(card.jtml, /ARAMIZA/);
  assert.match(card.jtml, /@Yusuf/);
  assert.match(card.jtml, /Özel Destek/);
});

test('publicBaseUrl verildiğinde Topluyo tarafından görsel algılanacak png uzantılı URL üretir', async (t) => {
  const { root, service } = fixture({
    httpServer: { enabled: true, publicBaseUrl: 'https://bot.example.com/' }
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const card = await service.createWelcomeCard({ avatarUrl: '' });
  assert.match(card.url, /^https:\/\/bot\.example\.com\/cards\/welcome-.+\.png$/);
});

test('seviye rozeti için renkli ve simgeli kare SVG üretir', async (t) => {
  const { root, service } = fixture({
    httpServer: { enabled: true, publicBaseUrl: 'https://bot.example.com/' }
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const badge = await service.createLevelBadgeIcon({
    level: 50,
    title: 'Topluluk Tacı',
    emoji: '👑',
    accent: '#FACC15',
    accent2: '#F59E0B'
  });
  const svg = fs.readFileSync(badge.path, 'utf8');

  assert.match(badge.url, /^https:\/\/bot\.example\.com\/cards\/level-badge-50-.+\.svg$/);
  assert.match(svg, /👑/);
  assert.match(svg, /LV\. 50/);
  assert.match(svg, /Topluluk Tacı/);
  assert.match(svg, /#FACC15/);
});

test('dosya adına göre seviye SVG paketini güvenli kart adreslerinde yayınlar', async (t) => {
  const { root, service } = fixture({
    httpServer: { enabled: true, publicBaseUrl: 'https://bot.example.com/' }
  });
  const source = path.join(root, 'level-assets');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'level-badge-5-kivilcim.svg'), `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g">
<stop stop-color="#2EA8FF"/><stop offset="1" stop-color="#6366F1"/></linearGradient></defs>
<text>⚡</text><text>LV. 5</text><text>Kıvılcım</text></svg>`, 'utf8');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = await service.publishLevelBadgeAssets(source, [5]);
  assert.equal(result['5'].emoji, '⚡');
  assert.equal(result['5'].title, 'Kıvılcım');
  assert.equal(result['5'].accent, '#2EA8FF');
  assert.match(result['5'].url, /^https:\/\/bot\.example\.com\/cards\/template-level-5-.+\.svg$/);
  assert.equal(fs.existsSync(result['5'].path), true);
  await assert.rejects(() => service.publishLevelBadgeAssets(source, [10]), /eksik: 10/);
});

test('rank kartı sonraki seviye ve sıradaki rozet simgesini tek görselde gösterir', async (t) => {
  const { root, service } = fixture({
    httpServer: { enabled: true, publicBaseUrl: 'https://bot.example.com/' }
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const card = await service.createRankCard({
    userId: 11,
    userName: 'Sporky',
    level: 1,
    xp: 300,
    currentLevelXp: 100,
    nextLevelXp: 400,
    messages: 18,
    earnedBadges: 1,
    nextBadge: { level: 5, emoji: '⚡', title: 'Kıvılcım', accent: '#2EA8FF' }
  });
  const svg = fs.readFileSync(card.path, 'utf8');

  assert.match(card.url, /^https:\/\/bot\.example\.com\/cards\/rank-.+\.png$/);
  assert.match(svg, /width="336" height="178" viewBox="0 0 336 178"/);
  assert.doesNotMatch(svg, /width="1100" height="430"/);
  assert.match(svg, /SONRAKİ SEVİYE/);
  assert.match(svg, /Lv\.1 → Lv\.2/);
  assert.match(svg, /100 XP kaldı/);
  assert.match(svg, /SIRADAKİ ROZET/);
  assert.match(svg, /⚡/);
  assert.match(svg, /Kıvılcım/);
  assert.match(card.jtml, /^~\{/);
});

test('toprank kartı ilk beş kullanıcıyı Topluyo sınırına uygun SVG görselinde gösterir', async (t) => {
  const { root, service } = fixture({
    httpServer: { enabled: true, publicBaseUrl: 'https://bot.example.com/' }
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const card = await service.createTopRankCard({
    groupName: 'Özel Destek',
    page: 1,
    totalPages: 2,
    totalProfiles: 8,
    ranking: [
      { rank: 1, userId: 11, userName: 'Sporky', level: 15, xp: 8250, messages: 640, badges: 4 },
      { rank: 2, userId: 12, userName: 'Ece', level: 12, xp: 6100, messages: 510, badges: 3 },
      { rank: 3, userId: 13, userName: 'Mert', level: 10, xp: 4800, messages: 390, badges: 2 },
      { rank: 4, userId: 14, userName: 'Deniz', level: 8, xp: 3300, messages: 280, badges: 1 },
      { rank: 5, userId: 15, userName: 'Ada', level: 7, xp: 2700, messages: 240, badges: 1 }
    ]
  });
  const svg = fs.readFileSync(card.path, 'utf8');

  assert.match(card.url, /^https:\/\/bot\.example\.com\/cards\/toprank-.+\.png$/);
  assert.match(svg, /width="336" height="178" viewBox="0 0 336 178"/);
  assert.match(svg, />TOPRANK<\/text>/);
  assert.match(svg, />Sporky<\/text>/);
  assert.match(svg, />Ada<\/text>/);
  assert.match(svg, /SAYFA 1\/2/);
  assert.match(svg, /8 KAYITLI PROFİL/);
  assert.match(card.jtml, /^~\{/);
});

test('Kick ve YouTube duyuruları platform logolu, yayıncı görselli banner üretir', async (t) => {
  const { root, service } = fixture({
    httpServer: { enabled: true, publicBaseUrl: 'https://bot.example.com/' }
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  service.fetchAvatarDataUri = async () => 'data:image/png;base64,dGVzdA==';

  const kick = await service.createLiveAnnouncementCard({
    platform: 'kick',
    eventType: 'live',
    name: 'Örnek Yayıncı',
    title: 'Akşam sohbeti başladı',
    category: 'Just Chatting',
    viewers: 123,
    avatarUrl: 'https://files.kick.com/avatar.png',
    targetUrl: 'https://kick.com/ornek'
  });
  const youtube = await service.createLiveAnnouncementCard({
    platform: 'youtube',
    eventType: 'video',
    name: 'Örnek Kanal',
    title: 'Yeni videomuz yayında',
    avatarUrl: 'https://yt3.ggpht.com/avatar',
    targetUrl: 'https://www.youtube.com/watch?v=video-1'
  });
  const kickSvg = fs.readFileSync(kick.path, 'utf8');
  const youtubeSvg = fs.readFileSync(youtube.path, 'utf8');

  assert.match(kick.url, /\/cards\/live-kick-live-.+\.png$/);
  assert.equal(service.cardTargets.get(kick.fileName), 'https://kick.com/ornek');
  assert.match(kickSvg, /width="336" height="178" viewBox="0 0 336 178"/);
  assert.doesNotMatch(kickSvg, /width="600" height="240"/);
  assert.match(kickSvg, /KICK YAYINCISI/);
  assert.match(kickSvg, />CANLI<\/text>/);
  assert.match(kickSvg, /Örnek Yayıncı/);
  assert.match(kickSvg, /data:image\/png;base64,dGVzdA==/);
  assert.match(youtube.url, /\/cards\/live-youtube-video-.+\.png$/);
  assert.equal(
    service.cardTargets.get(youtube.fileName),
    'https://www.youtube.com/watch?v=video-1'
  );
  assert.match(youtubeSvg, />YouTube<\/text>/);
  assert.match(youtubeSvg, /YENİ VİDEO/);
  assert.match(youtubeSvg, /Örnek Kanal/);
  assert.match(kick.jtml, /^~\{/);
  assert.match(youtube.jtml, /^~\{/);
});

test('Cloudflare Quick Tunnel çıktısından HTTPS kart adresini çıkarır', () => {
  const output = 'INF +https://quiet-river-1234.trycloudflare.com |';
  assert.equal(tunnelUrlFromOutput(output), 'https://quiet-river-1234.trycloudflare.com');
  assert.equal(tunnelUrlFromOutput('henüz adres yok'), null);
});

test('yalnızca güvenilir HTTPS profil görseli kaynaklarını karta kabul eder', () => {
  assert.equal(isTrustedAvatarUrl('https://lh3.googleusercontent.com/a/avatar=s96-c'), true);
  assert.equal(isTrustedAvatarUrl('https://cdn.topluyo.com/user/avatar.png'), true);
  assert.equal(isTrustedAvatarUrl('https://files.kick.com/images/user/avatar.png'), true);
  assert.equal(isTrustedAvatarUrl('https://yt3.ggpht.com/channel-avatar'), true);
  assert.equal(isTrustedAvatarUrl('https://i.ytimg.com/vi/video/maxresdefault.jpg'), true);
  assert.equal(isTrustedAvatarUrl('http://127.0.0.1/private.png'), false);
  assert.equal(isTrustedAvatarUrl('https://example.invalid/avatar.png'), false);
});

test('banner tıklaması yalnız güvenilir yayın ve video adreslerine yönlenir', () => {
  const kickTarget = 'https://kick.com/ornek';
  const youtubeTarget = 'https://www.youtube.com/watch?v=video-1';
  const unsafeTarget = 'https://example.invalid/phishing';

  assert.equal(isTrustedLiveTargetUrl(kickTarget), true);
  assert.equal(isTrustedLiveTargetUrl(youtubeTarget), true);
  assert.equal(isTrustedLiveTargetUrl('http://kick.com/ornek'), false);
  assert.equal(liveRedirectTarget(kickTarget, 'text/html,application/xhtml+xml'), kickTarget);
  assert.equal(liveRedirectTarget(youtubeTarget, 'text/html'), youtubeTarget);
  assert.equal(liveRedirectTarget(kickTarget, 'image/avif,image/webp,*/*'), null);
  assert.equal(liveRedirectTarget(unsafeTarget, 'text/html'), null);
});
