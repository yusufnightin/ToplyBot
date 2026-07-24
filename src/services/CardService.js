const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { sanitizeXml } = require('../utils/templates');

function normalizeHexColor(value, fallback = '#2EA8FF') {
  const color = String(value || '').trim();
  if (!/^#[0-9a-f]{6}$/i.test(color)) return fallback;
  // Eski pembe varsayılanı yeni kart tasarımının mavi neon rengine yükselt.
  return color.toLowerCase() === '#ff83c8' ? fallback : color.toUpperCase();
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function isTrustedAvatarUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'topluyo.com'
      || host.endsWith('.topluyo.com')
      || host === 'kick.com'
      || host.endsWith('.kick.com')
      || host === 'ytimg.com'
      || host.endsWith('.ytimg.com')
      || host === 'ggpht.com'
      || host.endsWith('.ggpht.com')
      || host === 'googleusercontent.com'
      || host.endsWith('.googleusercontent.com')
      || host === 'githubusercontent.com'
      || host.endsWith('.githubusercontent.com')
      || host === 'discordapp.com'
      || host.endsWith('.discordapp.com');
  } catch {
    return false;
  }
}

function isTrustedLiveTargetUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'kick.com'
      || host.endsWith('.kick.com')
      || host === 'youtube.com'
      || host.endsWith('.youtube.com')
      || host === 'youtu.be';
  } catch {
    return false;
  }
}

function liveRedirectTarget(target, acceptHeader = '') {
  if (!/\btext\/html\b/i.test(String(acceptHeader || ''))) return null;
  return isTrustedLiveTargetUrl(target) ? target : null;
}

function fitFontSize(value, { preferred, minimum, maxWidth, averageGlyph = 0.58 }) {
  const length = Math.max(1, Array.from(String(value || '')).length);
  return Math.max(minimum, Math.min(preferred, Math.floor(maxWidth / (length * averageGlyph))));
}

function tunnelUrlFromOutput(value) {
  const match = String(value || '').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i);
  return match ? match[0] : null;
}

class CardService {
  constructor({ projectRoot, config = {}, logger }) {
    this.logger = logger;
    this.directory = path.join(projectRoot, 'generated', 'cards');
    this.welcomeTemplatePath = path.join(projectRoot, 'assets', 'welcome-card-template.svg');
    this.welcomeBackgroundPath = path.join(projectRoot, 'assets', 'welcome-card-background.png');
    this.welcomeTemplate = fs.readFileSync(this.welcomeTemplatePath, 'utf8');
    this.welcomeBackgroundDataUri = `data:image/png;base64,${fs.readFileSync(this.welcomeBackgroundPath).toString('base64')}`;
    this.httpConfig = {
      enabled: Boolean(config.httpServer?.enabled),
      host: config.httpServer?.host || '127.0.0.1',
      port: Number(config.httpServer?.port) || 3210,
      publicBaseUrl: String(config.httpServer?.publicBaseUrl || '').replace(/\/$/, ''),
      autoTunnel: Boolean(config.httpServer?.autoTunnel),
      tunnelTimeoutMs: Math.max(5000, Number(config.httpServer?.tunnelTimeoutMs) || 30000),
      cloudflaredPath: path.resolve(
        projectRoot,
        String(config.httpServer?.cloudflaredPath || 'tools/cloudflared.exe')
      )
    };
    this.server = null;
    this.tunnelProcess = null;
    this.readyPromise = null;
    this.closing = false;
    this.avatarCache = new Map();
    this.cardTargets = new Map();
    fs.mkdirSync(this.directory, { recursive: true });
  }

  start() {
    if (!this.httpConfig.enabled) return Promise.resolve(null);
    if (this.readyPromise) return this.readyPromise;
    this.server = http.createServer(async (request, response) => {
      try {
        const url = new URL(request.url, 'http://localhost');
        if (url.pathname === '/cards/.health') {
          response.writeHead(200, {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store'
          }).end('ok');
          return;
        }
        if (!url.pathname.startsWith('/cards/')) {
          response.writeHead(404).end('Not found');
          return;
        }
        const fileName = path.basename(url.pathname);
        const redirectTarget = liveRedirectTarget(
          this.cardTargets.get(fileName),
          request.headers.accept
        );
        if (redirectTarget) {
          response.writeHead(302, {
            location: redirectTarget,
            'cache-control': 'no-store'
          }).end();
          return;
        }
        const filePath = path.join(this.directory, fileName);
        const content = await fs.promises.readFile(filePath);
        response.writeHead(200, {
          'content-type': 'image/svg+xml; charset=utf-8',
          'cache-control': 'public, max-age=86400'
        });
        response.end(content);
      } catch {
        response.writeHead(404).end('Not found');
      }
    });
    this.readyPromise = new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.httpConfig.port, this.httpConfig.host, () => {
        this.server.off('error', reject);
        this.logger?.info('Kart HTTP sunucusu açıldı.', {
          host: this.httpConfig.host,
          port: this.httpConfig.port,
          autoTunnel: this.httpConfig.autoTunnel
        });
        resolve();
      });
    }).then(async () => {
      if (this.httpConfig.publicBaseUrl) return this.httpConfig.publicBaseUrl;
      if (!this.httpConfig.autoTunnel) return null;
      try {
        return await this.startQuickTunnel();
      } catch (error) {
        this.logger?.error('Kart HTTPS tüneli açılamadı; JTML yedek görünümü kullanılacak.', {
          message: error.message
        });
        return null;
      }
    });
    this.server.unref?.();
    return this.readyPromise;
  }

  startQuickTunnel() {
    if (this.httpConfig.publicBaseUrl) return Promise.resolve(this.httpConfig.publicBaseUrl);
    if (this.tunnelProcess) {
      return Promise.reject(new Error('Cloudflare tüneli başlatıldı ancak HTTPS adresi henüz alınamadı.'));
    }
    if (!fs.existsSync(this.httpConfig.cloudflaredPath)) {
      return Promise.reject(new Error(`cloudflared bulunamadı: ${this.httpConfig.cloudflaredPath}`));
    }

    return new Promise((resolve, reject) => {
      const localUrl = `http://${this.httpConfig.host}:${this.httpConfig.port}`;
      const child = spawn(this.httpConfig.cloudflaredPath, [
        'tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', localUrl
      ], {
        cwd: path.dirname(this.httpConfig.cloudflaredPath),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      this.tunnelProcess = child;
      let settled = false;
      let verifying = false;
      let output = '';
      const finish = (error, publicBaseUrl = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(publicBaseUrl);
      };
      const inspect = (chunk) => {
        if (settled) return;
        output = `${output}${String(chunk || '')}`.slice(-12000);
        const publicBaseUrl = tunnelUrlFromOutput(output);
        if (!publicBaseUrl || verifying) return;
        verifying = true;
        this.verifyQuickTunnel(publicBaseUrl)
          .then(() => {
            this.httpConfig.publicBaseUrl = publicBaseUrl.replace(/\/$/, '');
            this.logger?.info('Kart HTTPS tüneli hazır ve dış erişim doğrulandı.', {
              publicBaseUrl: this.httpConfig.publicBaseUrl
            });
            finish(null, this.httpConfig.publicBaseUrl);
          })
          .catch((error) => finish(error));
      };
      child.stdout.on('data', inspect);
      child.stderr.on('data', inspect);
      child.once('error', (error) => finish(error));
      child.once('exit', (code) => {
        this.tunnelProcess = null;
        if (!this.closing) {
          this.logger?.warn('Kart HTTPS tüneli kapandı.', { code });
        }
        finish(new Error(`cloudflared HTTPS adresi alınamadan kapandı (kod ${code}).`));
      });
      const timer = setTimeout(() => {
        child.kill();
        const diagnostic = output
          .replace(/\x1b\[[0-9;]*m/g, '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(-3)
          .join(' | ');
        finish(new Error(`Cloudflare tüneli ${this.httpConfig.tunnelTimeoutMs} ms içinde hazır olmadı.${diagnostic ? ` Son çıktı: ${diagnostic}` : ''}`));
      }, this.httpConfig.tunnelTimeoutMs);
      timer.unref?.();
    });
  }

  async verifyQuickTunnel(publicBaseUrl) {
    const deadline = Date.now() + this.httpConfig.tunnelTimeoutMs - 1000;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${publicBaseUrl.replace(/\/$/, '')}/cards/.health`, {
          headers: { Accept: 'text/plain' },
          signal: AbortSignal.timeout(5000)
        });
        if (response.ok && (await response.text()).trim() === 'ok') return true;
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    throw new Error(`Cloudflare HTTPS sağlık kontrolü başarısız: ${lastError?.message || 'zaman aşımı'}`);
  }

  async close() {
    this.closing = true;
    if (this.tunnelProcess) {
      this.tunnelProcess.kill();
      this.tunnelProcess = null;
    }
    if (this.server) {
      await new Promise((resolve) => this.server.close(() => resolve()));
      this.server = null;
    }
    this.readyPromise = null;
  }

  urlFor(fileName, { targetUrl = '' } = {}) {
    if (!this.httpConfig.enabled || !this.httpConfig.publicBaseUrl) return null;
    const cardUrl = `${this.httpConfig.publicBaseUrl}/cards/${encodeURIComponent(fileName)}`;
    if (isTrustedLiveTargetUrl(targetUrl)) {
      this.cardTargets.set(fileName, String(targetUrl).trim());
      while (this.cardTargets.size > 1000) {
        this.cardTargets.delete(this.cardTargets.keys().next().value);
      }
    }
    return cardUrl;
  }

  async fetchAvatarDataUri(avatarUrl) {
    const source = String(avatarUrl || '').trim();
    if (!isTrustedAvatarUrl(source)) return '';
    const cached = this.avatarCache.get(source);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    let value = '';
    try {
      const response = await fetch(source, {
        redirect: 'follow',
        headers: {
          Accept: 'image/png,image/jpeg,image/webp,image/gif;q=0.8',
          'User-Agent': 'ToplyBot-WelcomeCard/3.7.0'
        },
        signal: AbortSignal.timeout(7000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!isTrustedAvatarUrl(response.url || source)) throw new Error('Güvenilmeyen avatar yönlendirmesi');
      const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
      if (!allowedTypes.has(contentType)) throw new Error(`Desteklenmeyen avatar türü: ${contentType || 'bilinmiyor'}`);
      const declaredLength = Number(response.headers.get('content-length')) || 0;
      if (declaredLength > 5 * 1024 * 1024) throw new Error('Avatar dosyası 5 MB sınırını aşıyor');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('Avatar dosyası boş veya çok büyük');
      value = `data:${contentType};base64,${bytes.toString('base64')}`;
    } catch (error) {
      this.logger?.warn('Profil fotoğrafı karta gömülemedi; varsayılan silüet kullanılacak.', {
        message: error.message
      });
    }

    this.avatarCache.set(source, {
      value,
      expiresAt: Date.now() + (value ? 30 * 60_000 : 5 * 60_000)
    });
    while (this.avatarCache.size > 200) {
      this.avatarCache.delete(this.avatarCache.keys().next().value);
    }
    return value;
  }

  createLiveAnnouncementFallbackJtml({
    platform = 'kick',
    eventType = 'live',
    name = 'Yayıncı',
    title = '',
    avatarUrl = '',
    viewers = 0
  } = {}) {
    const normalizedPlatform = String(platform || '').toLowerCase();
    const isYouTube = normalizedPlatform === 'youtube';
    const accent = isYouTube ? '#FF0033' : '#53FC18';
    const platformLabel = isYouTube ? '▶ YouTube' : 'KICK';
    const statusLabel = eventType === 'video' ? 'YENİ VİDEO' : 'ŞİMDİ YAYINDA';
    const avatarNode = isHttpUrl(avatarUrl)
      ? { type: 'icon', src: String(avatarUrl), ui: 'size-8' }
      : { type: 'box', text: '👤', size: 2, background: '#161D28' };
    return `~${JSON.stringify({
      type: 'box',
      ui: 'flex-x',
      gap: 0.8,
      background: '#0A0D13',
      children: [
        avatarNode,
        {
          type: 'box',
          ui: 'flex-y',
          gap: 0.22,
          children: [
            { type: 'box', text: platformLabel, color: accent, size: 1.15 },
            { type: 'box', text: statusLabel, color: '#FFFFFF', size: 1.35 },
            { type: 'box', text: String(name || 'Yayıncı').slice(0, 60), color: accent, size: 1.08 },
            { type: 'muted', text: String(title || '').slice(0, 120) },
            ...(Number(viewers) > 0
              ? [{ type: 'muted', text: `👁 ${Number(viewers).toLocaleString('tr-TR')} izleyici` }]
              : [])
          ]
        }
      ]
    })}`;
  }

  async createLiveAnnouncementCard({
    platform = 'kick',
    eventType = 'live',
    name = 'Yayıncı',
    title = '',
    category = '',
    viewers = 0,
    avatarUrl = '',
    thumbnailUrl = '',
    targetUrl = ''
  } = {}) {
    if (this.httpConfig.enabled && !this.httpConfig.publicBaseUrl) {
      await (this.readyPromise || this.start());
    }

    const normalizedPlatform = String(platform || '').trim().toLowerCase();
    const isYouTube = normalizedPlatform === 'youtube';
    const accent = isYouTube ? '#FF0033' : '#53FC18';
    const accentSoft = isYouTube ? '#8B1028' : '#215F1C';
    const safeName = String(name || 'Yayıncı').trim().slice(0, 36);
    const safeTitle = String(title || (
      eventType === 'video' ? 'Yeni video yayınlandı!' : 'Canlı yayın başladı!'
    )).replace(/\s+/g, ' ').trim().slice(0, 76);
    const safeCategory = String(category || '').replace(/\s+/g, ' ').trim().slice(0, 42);
    const statusLabel = eventType === 'video' ? 'YENİ VİDEO' : 'CANLI';
    const words = safeTitle.split(' ').filter(Boolean).flatMap((word) => {
      if (Array.from(word).length <= 28) return [word];
      const characters = Array.from(word);
      return [characters.slice(0, 28).join(''), characters.slice(28, 56).join('')];
    });
    const titleLines = [];
    let currentLine = '';
    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (Array.from(candidate).length > 28 && currentLine) {
        titleLines.push(currentLine);
        currentLine = word;
        if (titleLines.length === 2) break;
      } else {
        currentLine = candidate;
      }
    }
    if (currentLine && titleLines.length < 2) titleLines.push(currentLine);
    if (titleLines.length === 2 && words.join(' ').length > titleLines.join(' ').length) {
      titleLines[1] = `${Array.from(titleLines[1]).slice(0, 25).join('').trimEnd()}…`;
    }

    const fileName = `live-${isYouTube ? 'youtube' : 'kick'}-${eventType}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.png`;
    const embeddedAvatar = await this.fetchAvatarDataUri(avatarUrl);
    const embeddedThumbnail = thumbnailUrl
      ? await this.fetchAvatarDataUri(thumbnailUrl)
      : '';
    const initial = Array.from(safeName)[0]?.toLocaleUpperCase('tr-TR') || 'Y';
    const avatarSvg = embeddedAvatar
      ? `<image href="${sanitizeXml(embeddedAvatar)}" x="17" y="70" width="58" height="58" preserveAspectRatio="xMidYMid slice" clip-path="url(#liveAvatarClip)"/>`
      : `<circle cx="46" cy="99" r="29" fill="${sanitizeXml(accentSoft)}"/>
<path d="M24 113c7-11 14-17 22-17s15 6 22 17v15H24Z" fill="#FFFFFF" fill-opacity=".08"/>
<text x="46" y="109" text-anchor="middle" font-family="Arial, sans-serif" font-size="27" font-weight="900" fill="#FFFFFF">${sanitizeXml(initial)}</text>`;
    const thumbnailSvg = embeddedThumbnail
      ? `<image href="${sanitizeXml(embeddedThumbnail)}" x="162" y="0" width="174" height="178" preserveAspectRatio="xMidYMid slice" clip-path="url(#liveBannerClip)"/>`
      : `<g opacity=".2">
  <path d="M238-18 352 38 284 196 170 140Z" fill="${sanitizeXml(accent)}"/>
  <path d="M296-12 366 23 300 184 230 149Z" fill="#FFFFFF" fill-opacity=".15"/>
  <circle cx="292" cy="94" r="55" fill="none" stroke="${sanitizeXml(accent)}" stroke-width="17" stroke-opacity=".26"/>
</g>`;
    const titleSvg = titleLines.slice(0, 2).map((line, index) => (
      `<text x="84" y="${101 + index * 15}" font-family="Arial, sans-serif" font-size="12.5" font-weight="800" fill="#F7F8FC">${sanitizeXml(line)}</text>`
    )).join('\n');
    const categoryLabel = (safeCategory || (
      eventType === 'video' ? 'Yeni içerik' : 'Canlı yayın'
    )).slice(0, 12);
    const viewerLabel = Number(viewers) > 0
      ? `${Number(viewers).toLocaleString('tr-TR')} izleyici`
      : (eventType === 'video' ? 'Şimdi yayında' : 'Yayına katıl');
    const platformLogo = isYouTube
      ? `<g transform="translate(12 10)" filter="url(#liveLogoShadow)">
  <rect width="32" height="21" rx="6" fill="#FF0033"/>
  <path d="M13 5.5 23 10.5 13 15.5Z" fill="#FFFFFF"/>
  <text x="39" y="16" font-family="Arial, sans-serif" font-size="14" font-weight="800" fill="#FFFFFF">YouTube</text>
</g>`
      : `<g transform="translate(12 10)" filter="url(#liveLogoShadow)">
  <rect width="63" height="22" rx="2.5" fill="#53FC18"/>
  <text x="31.5" y="16.5" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="14.5" font-weight="900" letter-spacing=".6" fill="#071006">KICK</text>
</g>`;
    const statusWidth = eventType === 'video' ? 86 : 62;
    const statusX = 336 - statusWidth - 11;
    const ctaLabel = eventType === 'video' ? 'İZLE' : 'KATIL';

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="336" height="178" viewBox="0 0 336 178">
<defs>
  <linearGradient id="liveBackground" x1="4" y1="7" x2="330" y2="172" gradientUnits="userSpaceOnUse">
    <stop stop-color="#05070B"/>
    <stop offset=".55" stop-color="#0C1018"/>
    <stop offset="1" stop-color="${sanitizeXml(accentSoft)}"/>
  </linearGradient>
  <linearGradient id="liveThumbShade" x1="112" y1="89" x2="336" y2="89" gradientUnits="userSpaceOnUse">
    <stop stop-color="#070A10"/>
    <stop offset=".28" stop-color="#070A10" stop-opacity=".94"/>
    <stop offset=".72" stop-color="#070A10" stop-opacity=".45"/>
    <stop offset="1" stop-color="#070A10" stop-opacity=".18"/>
  </linearGradient>
  <radialGradient id="liveGlow" cx="0" cy="0" r="1" gradientTransform="translate(288 14) rotate(126) scale(145 190)">
    <stop stop-color="${sanitizeXml(accent)}" stop-opacity=".32"/>
    <stop offset="1" stop-color="${sanitizeXml(accent)}" stop-opacity="0"/>
  </radialGradient>
  <pattern id="liveGrid" width="12" height="12" patternUnits="userSpaceOnUse">
    <path d="M12 0H0V12" fill="none" stroke="#FFFFFF" stroke-opacity=".035"/>
  </pattern>
  <clipPath id="liveAvatarClip"><circle cx="46" cy="99" r="29"/></clipPath>
  <clipPath id="liveBannerClip"><rect width="336" height="178" rx="12"/></clipPath>
  <filter id="liveShadow" x="-30%" y="-30%" width="160%" height="160%">
    <feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#000000" flood-opacity=".65"/>
  </filter>
  <filter id="liveLogoShadow" x="-20%" y="-40%" width="160%" height="190%">
    <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity=".6"/>
  </filter>
</defs>
<rect width="336" height="178" rx="12" fill="url(#liveBackground)"/>
${thumbnailSvg}
<rect width="336" height="178" rx="12" fill="url(#liveThumbShade)"/>
<rect width="336" height="178" rx="12" fill="url(#liveGlow)"/>
<rect width="336" height="178" rx="12" fill="url(#liveGrid)"/>
<path d="M0 155 116 135 220 178H0Z" fill="${sanitizeXml(accent)}" fill-opacity=".08"/>
<rect x="1" y="1" width="334" height="176" rx="11" fill="none" stroke="${sanitizeXml(accent)}" stroke-width="2"/>
<rect x="0" y="0" width="4" height="178" rx="2" fill="${sanitizeXml(accent)}"/>
${platformLogo}
<rect x="${statusX}" y="10" width="${statusWidth}" height="22" rx="11" fill="#070A10" fill-opacity=".82" stroke="${sanitizeXml(accent)}" stroke-width="1"/>
<circle cx="${statusX + 11}" cy="21" r="3.5" fill="${sanitizeXml(accent)}"/>
<circle cx="${statusX + 11}" cy="21" r="6" fill="none" stroke="${sanitizeXml(accent)}" stroke-opacity=".35"/>
<text x="${statusX + 20}" y="24.5" font-family="Arial, sans-serif" font-size="8" font-weight="900" letter-spacing=".45" fill="#FFFFFF">${sanitizeXml(statusLabel)}</text>
<circle cx="46" cy="99" r="33" fill="#080B12" stroke="#FFFFFF" stroke-opacity=".12" stroke-width="4" filter="url(#liveShadow)"/>
<circle cx="46" cy="99" r="32" fill="none" stroke="${sanitizeXml(accent)}" stroke-width="2"/>
${avatarSvg}
<text x="84" y="58" font-family="Arial, sans-serif" font-size="7.5" font-weight="800" letter-spacing=".9" fill="${sanitizeXml(accent)}">${isYouTube ? 'YOUTUBE KANALI' : 'KICK YAYINCISI'}</text>
<text x="84" y="78" font-family="Arial, sans-serif" font-size="${fitFontSize(safeName, { preferred: 16, minimum: 10, maxWidth: 235, averageGlyph: 0.57 })}" font-weight="900" fill="#FFFFFF">${sanitizeXml(safeName)}</text>
${titleSvg}
<g transform="translate(84 137)">
  <rect width="${Math.min(90, 22 + categoryLabel.length * 5)}" height="22" rx="11" fill="#FFFFFF" fill-opacity=".08" stroke="#FFFFFF" stroke-opacity=".1"/>
  <text x="10" y="14.5" font-family="Arial, sans-serif" font-size="7.8" font-weight="700" fill="#D7DCE6">${sanitizeXml(categoryLabel)}</text>
</g>
<g transform="translate(181 137)">
  <rect width="77" height="22" rx="11" fill="#FFFFFF" fill-opacity=".08" stroke="#FFFFFF" stroke-opacity=".1"/>
  <circle cx="10" cy="11" r="2.5" fill="${sanitizeXml(accent)}"/>
  <text x="17" y="14.5" font-family="Arial, sans-serif" font-size="7.5" font-weight="700" fill="#D7DCE6">${sanitizeXml(viewerLabel)}</text>
</g>
<g transform="translate(266 136)" filter="url(#liveLogoShadow)">
  <rect width="59" height="24" rx="6" fill="${sanitizeXml(accent)}"/>
  <text x="27" y="16" text-anchor="middle" font-family="Arial, sans-serif" font-size="8" font-weight="900" letter-spacing=".35" fill="${isYouTube ? '#FFFFFF' : '#071006'}">${sanitizeXml(ctaLabel)}</text>
  <path d="M47 8 52 12 47 16" fill="none" stroke="${isYouTube ? '#FFFFFF' : '#071006'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</g>
</svg>`;
    const filePath = path.join(this.directory, fileName);
    await fs.promises.writeFile(filePath, svg, 'utf8');
    return {
      fileName,
      path: filePath,
      url: this.urlFor(fileName, { targetUrl }),
      jtml: this.createLiveAnnouncementFallbackJtml({
        platform: normalizedPlatform,
        eventType,
        name: safeName,
        title: safeTitle,
        avatarUrl,
        viewers
      })
    };
  }

  createWelcomeFallbackJtml({
    avatarUrl = '',
    accent = '#2EA8FF',
    userName = 'kullanıcı',
    groupName = 'Topluyo'
  } = {}) {
    const safeAccent = normalizeHexColor(accent);
    const displayName = `@${String(userName || 'kullanıcı').trim().replace(/^@+/, '').slice(0, 40)}`;
    const safeGroupName = String(groupName || 'Topluyo').trim().slice(0, 60);
    const avatarNode = isHttpUrl(avatarUrl)
      ? { type: 'icon', src: String(avatarUrl), ui: 'size-8' }
      : { type: 'box', text: '👤', size: 2, background: '#161D28' };
    return `~${JSON.stringify({
      type: 'box', ui: 'flex-x', gap: 1, background: '#0F1118',
      children: [
        avatarNode,
        {
          type: 'box', ui: 'flex-y', gap: 0.35,
          children: [
            { type: 'box', text: 'ARAMIZA', color: '#FFFFFF', size: 1.55 },
            { type: 'box', text: 'HOŞ GELDİN', color: '#FF83C8', size: 1.9 },
            { type: 'box', text: displayName, color: '#A78BFA', size: 1.25 },
            { type: 'muted', text: 'Topluluğumuza katıldığın için mutluyuz' },
            { type: 'box', text: `👑 ${safeGroupName}`, color: safeAccent, size: 1.05 }
          ]
        }
      ]
    })}`;
  }

  async createWelcomeCard({
    avatarUrl,
    userName = 'kullanıcı',
    groupName = 'Topluyo',
    background = '#071327',
    accent = '#2EA8FF'
  }) {
    if (this.httpConfig.enabled && !this.httpConfig.publicBaseUrl) {
      await (this.readyPromise || this.start());
    }
    const safeAccent = normalizeHexColor(accent);
    const displayName = `@${String(userName || 'kullanıcı').trim().replace(/^@+/, '').slice(0, 40)}`;
    const safeGroupName = String(groupName || 'Topluyo').trim().slice(0, 60);
    const usernameSize = fitFontSize(displayName, {
      preferred: 54, minimum: 27, maxWidth: 316, averageGlyph: 0.59
    });
    const serverNameSize = fitFontSize(safeGroupName, {
      preferred: 38, minimum: 21, maxWidth: 326, averageGlyph: 0.58
    });
    const fileName = `welcome-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.png`;
    const embeddedAvatar = await this.fetchAvatarDataUri(avatarUrl);
    const avatar = embeddedAvatar
      ? `<g filter="url(#avatarShadow)">
  <circle cx="435" cy="438" r="226" fill="#07101F"/>
  <image href="${sanitizeXml(embeddedAvatar)}" x="215" y="218" width="440" height="440" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)"/>
  <circle cx="435" cy="438" r="222" fill="none" stroke="url(#avatarStroke)" stroke-width="6"/>
</g>`
      : '';
    const templateImage = `<image href="${this.welcomeBackgroundDataUri}" x="0" y="0" width="1680" height="941" preserveAspectRatio="xMidYMid meet"/>`;
    const username = `<text x="1025" y="558" text-anchor="middle" font-family="Arial, 'DejaVu Sans', sans-serif"
  font-size="${usernameSize}" font-weight="800" fill="url(#usernameGradient)" filter="url(#textShadow)">${sanitizeXml(displayName)}</text>`;
    const serverName = `<text x="954" y="817" text-anchor="middle" font-family="Arial, 'DejaVu Sans', sans-serif"
  font-size="${serverNameSize}" font-weight="800" fill="#D7DEEB" filter="url(#textShadow)">${sanitizeXml(safeGroupName)}</text>`;
    const svg = this.welcomeTemplate
      .replace('<!-- RUNTIME_TEMPLATE_IMAGE -->', templateImage)
      .replace('<!-- RUNTIME_AVATAR -->', avatar)
      .replace('<!-- RUNTIME_USERNAME -->', username)
      .replace('<!-- RUNTIME_SERVER_NAME -->', serverName)
      .replaceAll('#2EA8FF', safeAccent);
    const filePath = path.join(this.directory, fileName);
    await fs.promises.writeFile(filePath, svg, 'utf8');
    return {
      fileName,
      path: filePath,
      url: this.urlFor(fileName),
      jtml: this.createWelcomeFallbackJtml({
        avatarUrl, accent: safeAccent, userName, groupName
      })
    };
  }

  async createEmbedCard({ title, description = '', fields = [], footer = '', color = '#ff83c8', thumbnail = '' }) {
    const fileName = `embed-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.svg`;
    const wrap = (value, limit = 72, maxLines = 5) => {
      const words = String(value || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
      const lines = [];
      let current = '';
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length > limit && current) {
          lines.push(current);
          current = word;
          if (lines.length >= maxLines) break;
        } else current = candidate;
      }
      if (current && lines.length < maxLines) lines.push(current);
      return lines;
    };
    const descLines = wrap(description, 88, 5);
    const safeFields = (fields || []).slice(0, 5).map((field) => ({
      name: String(field.name || '').slice(0, 70),
      value: wrap(field.value, 82, 2)
    }));
    const height = Math.max(330, 235 + descLines.length * 28 + safeFields.reduce((sum, field) => sum + 42 + field.value.length * 23, 0));
    let y = 132;
    const descriptionSvg = descLines.map((line) => {
      const element = `<text x="58" y="${y}" font-family="Arial, sans-serif" font-size="21" fill="#d5d8e1">${sanitizeXml(line)}</text>`;
      y += 28;
      return element;
    }).join('\n');
    const fieldsSvg = safeFields.map((field) => {
      y += 18;
      const name = `<text x="58" y="${y}" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#ffffff">${sanitizeXml(field.name)}</text>`;
      const values = field.value.map((line) => {
        y += 24;
        return `<text x="76" y="${y}" font-family="Arial, sans-serif" font-size="18" fill="#c5cad6">${sanitizeXml(line)}</text>`;
      }).join('\n');
      return `${name}\n${values}`;
    }).join('\n');
    const thumbnailSvg = thumbnail
      ? `<image href="${sanitizeXml(thumbnail)}" x="780" y="48" width="112" height="112" preserveAspectRatio="xMidYMid slice"/>`
      : '';
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="940" height="${height}" viewBox="0 0 940 ${height}">
<rect width="940" height="${height}" rx="26" fill="#151922"/>
<rect x="24" y="24" width="892" height="${height - 48}" rx="20" fill="#20242e" stroke="${sanitizeXml(color)}" stroke-width="3"/>
<rect x="24" y="24" width="10" height="${height - 48}" rx="5" fill="${sanitizeXml(color)}"/>
<text x="58" y="84" font-family="Arial, sans-serif" font-size="31" font-weight="700" fill="#ffffff">${sanitizeXml(String(title || 'Embed').slice(0, 70))}</text>
${thumbnailSvg}
${descriptionSvg}
${fieldsSvg}
<text x="58" y="${height - 52}" font-family="Arial, sans-serif" font-size="16" fill="#9299a8">${sanitizeXml(String(footer || '').slice(0, 110))}</text>
</svg>`;
    await fs.promises.writeFile(path.join(this.directory, fileName), svg, 'utf8');
    return { fileName, path: path.join(this.directory, fileName), url: this.urlFor(fileName) };
  }

  async createCommandMenuCard({ userId, permission, commandCount, sectionCount, prefix = '!', accent = '#ff83c8' }) {
    const fileName = `command-center-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.svg`;
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="420" viewBox="0 0 1120 420">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#111827"/>
    <stop offset="0.55" stop-color="#21152a"/>
    <stop offset="1" stop-color="#10131b"/>
  </linearGradient>
  <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${sanitizeXml(accent)}"/>
    <stop offset="1" stop-color="#7c5cff"/>
  </linearGradient>
  <filter id="shadow"><feDropShadow dx="0" dy="12" stdDeviation="18" flood-opacity=".38"/></filter>
</defs>
<rect width="1120" height="420" rx="34" fill="url(#bg)"/>
<circle cx="1010" cy="58" r="190" fill="${sanitizeXml(accent)}" opacity=".08"/>
<circle cx="105" cy="390" r="220" fill="#7c5cff" opacity=".07"/>
<rect x="36" y="34" width="1048" height="352" rx="28" fill="#171b25" opacity=".92" stroke="${sanitizeXml(accent)}" stroke-width="2" filter="url(#shadow)"/>
<rect x="36" y="34" width="12" height="352" rx="6" fill="url(#accent)"/>
<text x="82" y="112" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="${sanitizeXml(accent)}">TOPLUYO PROFESSIONAL BOT</text>
<text x="82" y="174" font-family="Arial, sans-serif" font-size="48" font-weight="800" fill="#ffffff">COMMAND CENTER</text>
<text x="82" y="220" font-family="Arial, sans-serif" font-size="22" fill="#b9c0d0">JTML sekmeleriyle komutları keşfet, incele ve tek tıkla çalıştır.</text>
<rect x="82" y="270" width="250" height="72" rx="18" fill="#222838" stroke="#333b50"/>
<text x="104" y="299" font-family="Arial, sans-serif" font-size="15" fill="#8992a6">KULLANICI</text>
<text x="104" y="329" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#ffffff">#${sanitizeXml(userId)}</text>
<rect x="352" y="270" width="210" height="72" rx="18" fill="#222838" stroke="#333b50"/>
<text x="374" y="299" font-family="Arial, sans-serif" font-size="15" fill="#8992a6">YETKİ</text>
<text x="374" y="329" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#ffffff">${sanitizeXml(permission)}</text>
<rect x="582" y="270" width="210" height="72" rx="18" fill="#222838" stroke="#333b50"/>
<text x="604" y="299" font-family="Arial, sans-serif" font-size="15" fill="#8992a6">KOMUT</text>
<text x="604" y="329" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#ffffff">${sanitizeXml(commandCount)}</text>
<rect x="812" y="270" width="230" height="72" rx="18" fill="#222838" stroke="#333b50"/>
<text x="834" y="299" font-family="Arial, sans-serif" font-size="15" fill="#8992a6">HIZLI AÇILIŞ</text>
<text x="834" y="329" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#ffffff">${sanitizeXml(prefix)} · ${sanitizeXml(sectionCount)} sekme</text>
</svg>`;
    await fs.promises.writeFile(path.join(this.directory, fileName), svg, 'utf8');
    return { fileName, path: path.join(this.directory, fileName), url: this.urlFor(fileName) };
  }

  async createLevelBadgeIcon({
    level,
    title = 'Seviye Rozeti',
    emoji = '⭐',
    accent = '#7C5CFF',
    accent2 = '#2EA8FF'
  }) {
    if (this.httpConfig.enabled && !this.httpConfig.publicBaseUrl) {
      await (this.readyPromise || this.start());
    }
    const primary = normalizeHexColor(accent, '#7C5CFF');
    const secondary = normalizeHexColor(accent2, '#2EA8FF');
    const numericLevel = Math.max(1, Math.trunc(Number(level) || 1));
    const fileName = `level-badge-${numericLevel}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.svg`;
    const safeTitle = String(title || 'Seviye Rozeti').trim().slice(0, 24);
    const titleSize = fitFontSize(safeTitle, {
      preferred: 30,
      minimum: 19,
      maxWidth: 330,
      averageGlyph: 0.62
    });
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs>
  <linearGradient id="badgeGradient" x1="58" y1="40" x2="454" y2="472" gradientUnits="userSpaceOnUse">
    <stop stop-color="${sanitizeXml(primary)}"/>
    <stop offset="1" stop-color="${sanitizeXml(secondary)}"/>
  </linearGradient>
  <radialGradient id="badgeGlow" cx="0" cy="0" r="1" gradientTransform="translate(256 218) rotate(90) scale(218)">
    <stop stop-color="${sanitizeXml(primary)}" stop-opacity=".34"/>
    <stop offset="1" stop-color="#070B16" stop-opacity="0"/>
  </radialGradient>
  <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation="11" result="blur"/>
    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>
<rect width="512" height="512" rx="112" fill="#070B16"/>
<rect x="22" y="22" width="468" height="468" rx="96" fill="url(#badgeGlow)" stroke="url(#badgeGradient)" stroke-width="10"/>
<path d="M256 62 291 93 337 86 353 130 397 147 389 194 420 229 389 264 397 311 353 328 337 372 291 365 256 396 221 365 175 372 159 328 115 311 123 264 92 229 123 194 115 147 159 130 175 86 221 93Z" fill="#0D1425" stroke="url(#badgeGradient)" stroke-width="8" filter="url(#glow)"/>
<circle cx="256" cy="229" r="116" fill="none" stroke="#FFFFFF" stroke-opacity=".09" stroke-width="3"/>
<text x="256" y="218" text-anchor="middle" dominant-baseline="middle" font-family="Segoe UI Emoji, Apple Color Emoji, sans-serif" font-size="104">${sanitizeXml(emoji)}</text>
<rect x="170" y="297" width="172" height="58" rx="29" fill="url(#badgeGradient)"/>
<text x="256" y="327" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="27" font-weight="800" fill="#070B16">LV. ${sanitizeXml(numericLevel)}</text>
<text x="256" y="440" text-anchor="middle" font-family="Arial, sans-serif" font-size="${titleSize}" font-weight="800" fill="#F8FAFC">${sanitizeXml(safeTitle)}</text>
</svg>`;
    const filePath = path.join(this.directory, fileName);
    await fs.promises.writeFile(filePath, svg, 'utf8');
    return { fileName, path: filePath, url: this.urlFor(fileName) };
  }

  async publishLevelBadgeAssets(sourceDirectory, expectedLevels = []) {
    if (this.httpConfig.enabled && !this.httpConfig.publicBaseUrl) {
      await (this.readyPromise || this.start());
    }
    const directory = path.resolve(String(sourceDirectory || '').trim());
    const stat = await fs.promises.stat(directory).catch(() => null);
    if (!stat?.isDirectory()) {
      throw new Error(`Seviye SVG klasörü bulunamadı: ${directory}`);
    }
    const required = [...new Set(expectedLevels.map(Number).filter((level) => Number.isInteger(level) && level > 0))];
    const candidates = (await fs.promises.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^level-badge-\d+-.+\.svg$/i.test(entry.name))
      .map((entry) => {
        const level = Number(entry.name.match(/^level-badge-(\d+)-/i)?.[1]);
        return { level, name: entry.name, path: path.join(directory, entry.name) };
      })
      .filter((entry) => Number.isInteger(entry.level) && (!required.length || required.includes(entry.level)))
      .sort((a, b) => a.level - b.level || b.name.localeCompare(a.name, 'tr'));
    const selected = new Map();
    for (const candidate of candidates) if (!selected.has(candidate.level)) selected.set(candidate.level, candidate);
    const missing = required.filter((level) => !selected.has(level));
    if (missing.length) throw new Error(`Seviye SVG dosyaları eksik: ${missing.join(', ')}`);

    const published = {};
    for (const [level, candidate] of selected) {
      const svg = await fs.promises.readFile(candidate.path, 'utf8');
      if (!/^<\?xml[\s\S]*<svg\b/i.test(svg) || /<(?:script|foreignObject)\b/i.test(svg)) {
        throw new Error(`Güvenli olmayan veya geçersiz SVG: ${candidate.name}`);
      }
      const textValues = [...svg.matchAll(/<text\b[^>]*>([^<]+)<\/text>/gi)]
        .map((match) => String(match[1] || '').trim())
        .filter(Boolean);
      const colors = [...new Set(
        [...svg.matchAll(/stop-color="(#[0-9a-f]{6})"/gi)].map((match) => match[1].toUpperCase())
      )].filter((color) => color !== '#070B16');
      const emoji = textValues.find((value) => !/^LV\./i.test(value) && Array.from(value).length <= 4) || '⭐';
      const title = textValues.findLast((value) => !/^LV\./i.test(value) && value !== emoji) || `Seviye ${level}`;
      const hash = crypto.createHash('sha256').update(svg).digest('hex').slice(0, 12);
      const fileName = `template-level-${level}-${hash}.svg`;
      const filePath = path.join(this.directory, fileName);
      await fs.promises.writeFile(filePath, svg, 'utf8');
      published[String(level)] = {
        level,
        sourceName: candidate.name,
        sourcePath: candidate.path,
        fileName,
        path: filePath,
        url: this.urlFor(fileName),
        emoji,
        title,
        accent: colors[0] || '#7C5CFF',
        accent2: colors[1] || '#2EA8FF'
      };
    }
    return published;
  }

  createRankFallbackJtml({
    userName,
    level,
    xp,
    currentLevelXp,
    nextLevelXp,
    messages,
    earnedBadges = 0,
    nextBadge = null,
    accent = '#7C5CFF'
  }) {
    const range = Math.max(1, Number(nextLevelXp) - Number(currentLevelXp));
    const gained = Math.max(0, Number(xp) - Number(currentLevelXp));
    const percent = Math.max(0, Math.min(100, Math.round((gained / range) * 100)));
    const filled = Math.round(percent / 10);
    const nextLevel = Math.max(1, Number(level) + 1);
    const remaining = Math.max(0, Number(nextLevelXp) - Number(xp));
    const badgeText = nextBadge
      ? `${nextBadge.emoji || '🏅'} ${nextBadge.title || 'Seviye Rozeti'} • Lv.${nextBadge.level}`
      : '🎖️ Sıradaki seviye rozeti henüz bağlı değil';
    return `~${JSON.stringify({
      type: 'box',
      ui: 'flex-y',
      gap: 0.45,
      background: '#0F1118',
      children: [
        { type: 'box', text: `⭐ ${String(userName || 'Kullanıcı').slice(0, 45)}`, color: '#FFFFFF', size: 1.35 },
        { type: 'muted', text: `Seviye ${level} • ${xp} XP • ${messages} mesaj • ${earnedBadges} rozet` },
        { type: 'box', text: `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}  %${percent}`, color: normalizeHexColor(accent) },
        { type: 'box', text: `Sonraki seviye: Lv.${nextLevel} • ${remaining} XP kaldı`, color: '#E2E8F0' },
        { type: 'box', text: badgeText, color: nextBadge?.accent || '#FACC15', background: '#161D28' }
      ]
    })}`;
  }

  createTopRankFallbackJtml({
    groupName = 'Topluyo',
    ranking = [],
    page = 1,
    totalProfiles = ranking.length,
    totalPages = 1
  }) {
    const rows = ranking.slice(0, 5).map((item) => ({
      type: 'box',
      ui: 'flex-x',
      gap: 0.45,
      background: Number(item.rank) <= 3 ? '#171E2D' : '#111827',
      children: [
        { type: 'box', text: `${item.rank}.`, color: Number(item.rank) === 1 ? '#FACC15' : '#E2E8F0', size: 1.1 },
        { type: 'box', text: String(item.userName || `Kullanıcı #${item.userId}`).slice(0, 28), color: '#FFFFFF' },
        { type: 'muted', text: `Lv.${item.level} • ${item.xp} XP` }
      ]
    }));
    return `~${JSON.stringify({
      type: 'box',
      ui: 'flex-y',
      gap: 0.4,
      background: '#080D19',
      children: [
        { type: 'box', text: `🏆 TOPRANK • ${String(groupName || 'Topluyo').slice(0, 40)}`, color: '#FFFFFF', size: 1.3 },
        { type: 'muted', text: `XP liderlik tablosu • Sayfa ${page}/${totalPages}` },
        ...rows,
        { type: 'muted', text: `${totalProfiles} kayıtlı profil • ToplyBot` }
      ]
    })}`;
  }

  async createTopRankCard({
    groupName = 'Topluyo',
    ranking = [],
    page = 1,
    totalProfiles = ranking.length,
    totalPages = 1,
    accent = '#7C5CFF'
  }) {
    if (this.httpConfig.enabled && !this.httpConfig.publicBaseUrl) {
      await (this.readyPromise || this.start());
    }
    const fileName = `toprank-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.png`;
    const safeAccent = normalizeHexColor(accent, '#7C5CFF');
    const safeGroupName = String(groupName || 'Topluyo').trim().slice(0, 42);
    const rows = ranking.slice(0, 5).map((item, index) => {
      const rank = Math.max(1, Math.trunc(Number(item.rank) || index + 1));
      const y = 38 + (index * 25);
      const name = String(item.userName || `Kullanıcı #${item.userId}`).trim().slice(0, 34);
      const nameSize = fitFontSize(name, {
        preferred: 8.5,
        minimum: 6.2,
        maxWidth: 150,
        averageGlyph: 0.58
      });
      const rankColor = rank === 1
        ? '#FACC15'
        : rank === 2
          ? '#CBD5E1'
          : rank === 3
            ? '#FB923C'
            : '#64748B';
      const rowFill = rank <= 3 ? '#121B2E' : '#0E1626';
      return `
<rect x="8" y="${y}" width="320" height="22" rx="6" fill="${rowFill}" stroke="${rankColor}" stroke-opacity="${rank <= 3 ? '.55' : '.16'}"/>
<circle cx="21" cy="${y + 11}" r="7.5" fill="${rankColor}" fill-opacity="${rank <= 3 ? '.2' : '.12'}" stroke="${rankColor}" stroke-width=".8"/>
<text x="21" y="${y + 14}" text-anchor="middle" font-family="Arial, sans-serif" font-size="7" font-weight="900" fill="${rankColor}">${sanitizeXml(rank)}</text>
<text x="34" y="${y + 10}" font-family="Arial, sans-serif" font-size="${nameSize}" font-weight="800" fill="#F8FAFC">${sanitizeXml(name)}</text>
<text x="34" y="${y + 18}" font-family="Arial, sans-serif" font-size="5.3" fill="#77849C">#${sanitizeXml(item.userId)} • ${sanitizeXml(item.messages || 0)} mesaj • ${sanitizeXml(item.badges || 0)} rozet</text>
<rect x="226" y="${y + 4}" width="38" height="14" rx="7" fill="${sanitizeXml(safeAccent)}" fill-opacity=".13"/>
<text x="245" y="${y + 13.5}" text-anchor="middle" font-family="Arial, sans-serif" font-size="6.4" font-weight="800" fill="${sanitizeXml(safeAccent)}">LV.${sanitizeXml(item.level)}</text>
<text x="318" y="${y + 13.5}" text-anchor="end" font-family="Arial, sans-serif" font-size="7" font-weight="800" fill="#E2E8F0">${sanitizeXml(item.xp)} XP</text>`;
    }).join('');
    const groupNameSize = fitFontSize(safeGroupName, {
      preferred: 6.5,
      minimum: 5,
      maxWidth: 126,
      averageGlyph: 0.58
    });
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="336" height="178" viewBox="0 0 336 178">
<defs>
  <linearGradient id="toprankAccent" x1="8" y1="8" x2="328" y2="170" gradientUnits="userSpaceOnUse">
    <stop stop-color="${sanitizeXml(safeAccent)}"/>
    <stop offset="1" stop-color="#2EA8FF"/>
  </linearGradient>
  <radialGradient id="toprankGlow" cx="0" cy="0" r="1" gradientTransform="translate(40 22) rotate(25) scale(180 100)">
    <stop stop-color="${sanitizeXml(safeAccent)}" stop-opacity=".3"/>
    <stop offset="1" stop-color="#080D19" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="336" height="178" rx="14" fill="#080D19"/>
<rect x="1.5" y="1.5" width="333" height="175" rx="12.5" fill="url(#toprankGlow)" stroke="url(#toprankAccent)" stroke-width="1.5"/>
<path d="M9 32H327" stroke="#FFFFFF" stroke-opacity=".1"/>
<text x="12" y="17" font-family="Arial, sans-serif" font-size="12" font-weight="900" fill="#F8FAFC">TOPRANK</text>
<text x="12" y="27" font-family="Arial, sans-serif" font-size="5.8" font-weight="700" letter-spacing=".7" fill="#8D98AE">XP LİDERLİK TABLOSU</text>
<text x="324" y="16" text-anchor="end" font-family="Arial, sans-serif" font-size="${groupNameSize}" font-weight="800" fill="#E2E8F0">${sanitizeXml(safeGroupName)}</text>
<text x="324" y="26" text-anchor="end" font-family="Arial, sans-serif" font-size="5.5" fill="#8D98AE">SAYFA ${sanitizeXml(page)}/${sanitizeXml(totalPages)}</text>
${rows}
<text x="12" y="171" font-family="Arial, sans-serif" font-size="5.5" font-weight="700" fill="#77849C">${sanitizeXml(totalProfiles)} KAYITLI PROFİL</text>
<text x="324" y="171" text-anchor="end" font-family="Arial, sans-serif" font-size="5.5" font-weight="700" fill="#77849C">TOPLYBOT</text>
</svg>`;
    const filePath = path.join(this.directory, fileName);
    await fs.promises.writeFile(filePath, svg, 'utf8');
    return {
      fileName,
      path: filePath,
      url: this.urlFor(fileName),
      jtml: this.createTopRankFallbackJtml({
        groupName: safeGroupName,
        ranking,
        page,
        totalProfiles,
        totalPages
      })
    };
  }

  async createRankCard({
    userId,
    userName,
    level,
    xp,
    currentLevelXp,
    nextLevelXp,
    messages,
    earnedBadges = 0,
    nextBadge = null,
    accent = '#7c5cff'
  }) {
    if (this.httpConfig.enabled && !this.httpConfig.publicBaseUrl) {
      await (this.readyPromise || this.start());
    }
    // Topluyo görsel algılayıcısı URL uzantısını dikkate alıyor. İçerik SVG
    // kalırken çalışan hoş geldin kartıyla aynı biçimde .png URL kullanılır.
    const fileName = `rank-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.png`;
    const safeAccent = normalizeHexColor(accent, '#7C5CFF');
    const range = Math.max(1, nextLevelXp - currentLevelXp);
    const progress = Math.max(0, Math.min(1, (xp - currentLevelXp) / range));
    const barWidth = Math.round(145 * progress);
    const percent = Math.round(progress * 100);
    const nextLevel = Math.max(1, Number(level) + 1);
    const remainingXp = Math.max(0, Number(nextLevelXp) - Number(xp));
    const safeUserName = String(userName || `Kullanıcı #${userId}`).trim().slice(0, 50);
    const userNameSize = fitFontSize(safeUserName, {
      preferred: 14,
      minimum: 10,
      maxWidth: 210,
      averageGlyph: 0.58
    });
    const badgeEmoji = nextBadge?.emoji || '🎖️';
    const badgeTitle = String(nextBadge?.title || 'Bağlı rozet yok').trim().slice(0, 24);
    const badgeLevel = Number.isInteger(Number(nextBadge?.level)) ? `LV. ${Number(nextBadge.level)}` : '—';
    const badgeAccent = normalizeHexColor(nextBadge?.accent, '#FACC15');
    const badgeTitleSize = fitFontSize(badgeTitle, {
      preferred: 10,
      minimum: 7,
      maxWidth: 72,
      averageGlyph: 0.62
    });
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="336" height="178" viewBox="0 0 336 178">
<defs>
  <linearGradient id="rankAccent" x1="8" y1="8" x2="328" y2="170" gradientUnits="userSpaceOnUse">
    <stop stop-color="${sanitizeXml(safeAccent)}"/>
    <stop offset="1" stop-color="#2EA8FF"/>
  </linearGradient>
  <radialGradient id="rankGlow" cx="0" cy="0" r="1" gradientTransform="translate(48 89) rotate(35) scale(125 155)">
    <stop stop-color="${sanitizeXml(safeAccent)}" stop-opacity=".3"/>
    <stop offset="1" stop-color="#080D19" stop-opacity="0"/>
  </radialGradient>
  <filter id="rankShadow" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur stdDeviation="3" result="blur"/>
    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>
<rect width="336" height="178" rx="14" fill="#080D19"/>
<rect x="1.5" y="1.5" width="333" height="175" rx="12.5" fill="url(#rankGlow)" stroke="url(#rankAccent)" stroke-width="1.5"/>
<path d="M10 31H326" stroke="#FFFFFF" stroke-opacity=".1"/>
<text x="12" y="21" font-family="Arial, sans-serif" font-size="${userNameSize}" font-weight="800" fill="#F8FAFC">${sanitizeXml(safeUserName)}</text>
<text x="324" y="19" text-anchor="end" font-family="Arial, sans-serif" font-size="7" font-weight="700" letter-spacing="1" fill="#8D98AE">TOPLYBOT RANK</text>

<circle cx="43" cy="91" r="34" fill="#0D1528" stroke="url(#rankAccent)" stroke-width="3.5" filter="url(#rankShadow)"/>
<circle cx="43" cy="91" r="27" fill="#0A1020" stroke="#FFFFFF" stroke-opacity=".08"/>
<text x="43" y="84" text-anchor="middle" font-family="Arial, sans-serif" font-size="7" font-weight="700" letter-spacing=".8" fill="#93A0B8">SEVİYE</text>
<text x="43" y="106" text-anchor="middle" font-family="Arial, sans-serif" font-size="27" font-weight="900" fill="#FFFFFF">${sanitizeXml(level)}</text>

<text x="83" y="52" font-family="Arial, sans-serif" font-size="7" font-weight="700" letter-spacing=".8" fill="#8692AA">SONRAKİ SEVİYE</text>
<text x="83" y="69" font-family="Arial, sans-serif" font-size="12" font-weight="800" fill="#F8FAFC">Lv.${sanitizeXml(level)} → Lv.${sanitizeXml(nextLevel)}</text>
<text x="228" y="69" text-anchor="end" font-family="Arial, sans-serif" font-size="9" font-weight="800" fill="${sanitizeXml(safeAccent)}">%${sanitizeXml(percent)}</text>
<rect x="83" y="77" width="145" height="7" rx="3.5" fill="#252D40"/>
<rect x="83" y="77" width="${barWidth}" height="7" rx="3.5" fill="url(#rankAccent)"/>
<text x="83" y="98" font-family="Arial, sans-serif" font-size="8" fill="#B5BED0">${sanitizeXml(xp)} / ${sanitizeXml(nextLevelXp)} XP</text>
<text x="228" y="98" text-anchor="end" font-family="Arial, sans-serif" font-size="8" font-weight="700" fill="#E2E8F0">${sanitizeXml(remainingXp)} XP kaldı</text>

<rect x="83" y="108" width="68" height="39" rx="7" fill="#111A2D" stroke="#FFFFFF" stroke-opacity=".08"/>
<text x="91" y="120" font-family="Arial, sans-serif" font-size="5.8" font-weight="700" letter-spacing=".5" fill="#7F8BA3">MESAJ</text>
<text x="91" y="141" font-family="Arial, sans-serif" font-size="16" font-weight="900" fill="#F8FAFC">${sanitizeXml(messages)}</text>

<rect x="156" y="108" width="72" height="39" rx="7" fill="#111A2D" stroke="#FFFFFF" stroke-opacity=".08"/>
<text x="164" y="120" font-family="Arial, sans-serif" font-size="5.8" font-weight="700" letter-spacing=".5" fill="#7F8BA3">ROZET</text>
<text x="164" y="141" font-family="Arial, sans-serif" font-size="16" font-weight="900" fill="#F8FAFC">${sanitizeXml(earnedBadges)}</text>

<rect x="238" y="43" width="86" height="104" rx="10" fill="#111A2D" stroke="${sanitizeXml(badgeAccent)}" stroke-opacity=".72"/>
<text x="281" y="56" text-anchor="middle" font-family="Arial, sans-serif" font-size="6.2" font-weight="700" letter-spacing=".5" fill="#8E9AB1">SIRADAKİ ROZET</text>
<circle cx="281" cy="82" r="19" fill="#0A1020" stroke="${sanitizeXml(badgeAccent)}" stroke-width="2"/>
<text x="281" y="85" text-anchor="middle" dominant-baseline="middle" font-family="Segoe UI Emoji, Apple Color Emoji, sans-serif" font-size="22">${sanitizeXml(badgeEmoji)}</text>
<text x="281" y="117" text-anchor="middle" font-family="Arial, sans-serif" font-size="${badgeTitleSize}" font-weight="800" fill="#F8FAFC">${sanitizeXml(badgeTitle)}</text>
<rect x="258" y="125" width="46" height="14" rx="7" fill="${sanitizeXml(badgeAccent)}" fill-opacity=".18"/>
<text x="281" y="135" text-anchor="middle" font-family="Arial, sans-serif" font-size="7" font-weight="800" fill="${sanitizeXml(badgeAccent)}">${sanitizeXml(badgeLevel)}</text>
</svg>`;
    const filePath = path.join(this.directory, fileName);
    await fs.promises.writeFile(filePath, svg, 'utf8');
    return {
      fileName,
      path: filePath,
      url: this.urlFor(fileName),
      jtml: this.createRankFallbackJtml({
        userName: safeUserName,
        level,
        xp,
        currentLevelXp,
        nextLevelXp,
        messages,
        earnedBadges,
        nextBadge,
        accent: safeAccent
      })
    };
  }
}

module.exports = CardService;
module.exports.tunnelUrlFromOutput = tunnelUrlFromOutput;
module.exports.isTrustedAvatarUrl = isTrustedAvatarUrl;
module.exports.isTrustedLiveTargetUrl = isTrustedLiveTargetUrl;
module.exports.liveRedirectTarget = liveRedirectTarget;
