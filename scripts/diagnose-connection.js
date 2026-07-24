const dns = require('node:dns').promises;
const path = require('node:path');
const WebSocket = require('ws');
const { loadConfiguration } = require('../src/config');

const projectRoot = path.resolve(__dirname, '..');
const { config, token } = loadConfiguration(projectRoot);
const connection = config.connection || {};
const websocketUrl = connection.websocketUrl || 'wss://topluyo.com/!bot';
const origin = connection.websocketOrigin || 'https://topluyo.com';
const userAgent = connection.websocketUserAgent || `TopluyoBOTJS/1.5.0 diagnostic Node/${process.versions.node}`;
const timeoutMs = Math.max(5000, Number(connection.handshakeTimeoutMs) || 15000);

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function redact(value) {
  if (!value) return '';
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} karakter)`;
}

async function fetchWithTimeout(url, options = {}, ms = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function diagnoseDns() {
  section('Ortam');
  console.log('Node:', process.version);
  console.log('Platform:', process.platform, process.arch);
  console.log('WebSocket URL:', websocketUrl);
  console.log('Origin:', origin);
  console.log('Token:', redact(token));

  section('DNS');
  const addresses = await dns.lookup('topluyo.com', { all: true });
  console.log(addresses);
}

async function diagnoseHttps() {
  section('HTTPS / API sayfası');
  const response = await fetchWithTimeout('https://topluyo.com/!api', {
    headers: { 'User-Agent': userAgent, Accept: 'text/html' }
  });
  console.log('HTTP durum:', response.status, response.statusText);
  console.log('Server:', response.headers.get('server') || '');
  console.log('CF-Ray:', response.headers.get('cf-ray') || '');
  await response.body?.cancel?.();
}

async function diagnoseRestToken() {
  section('REST token testi (salt okunur group/list)');
  const response = await fetchWithTimeout('https://topluyo.com/!apis', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': userAgent,
      Origin: origin
    },
    body: JSON.stringify([{ api: '/!api/group/list', data: {} }])
  });
  const text = await response.text();
  console.log('HTTP durum:', response.status, response.statusText);
  console.log('Server:', response.headers.get('server') || '');
  console.log('CF-Ray:', response.headers.get('cf-ray') || '');
  console.log('Yanıt özeti:', text.slice(0, 500).replace(/\s+/g, ' '));
}

async function diagnoseWebSocket() {
  section('WebSocket handshake ve kimlik doğrulama');

  return new Promise((resolve) => {
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(result);
    };

    const ws = new WebSocket(websocketUrl, {
      followRedirects: true,
      handshakeTimeout: timeoutMs,
      origin,
      perMessageDeflate: false,
      headers: {
        'User-Agent': userAgent,
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        ...(connection.websocketHeaders || {})
      }
    });

    ws.once('unexpected-response', (_request, response) => {
      let body = '';
      response.on('data', (chunk) => {
        if (body.length < 4096) body += chunk.toString('utf8');
      });
      response.on('end', () => {
        console.log('Handshake reddedildi:', response.statusCode, response.statusMessage);
        console.log('Server:', response.headers.server || '');
        console.log('CF-Ray:', response.headers['cf-ray'] || '');
        console.log('Location:', response.headers.location || '');
        console.log('Yanıt gövdesi:', body.slice(0, 1000).replace(/\s+/g, ' '));
        finish({ ok: false, kind: 'handshake', statusCode: response.statusCode });
      });
    });

    ws.on('open', () => {
      console.log('Handshake başarılı (101 Switching Protocols). Token gönderiliyor…');
      ws.send(token);
    });

    ws.on('message', (raw) => {
      const text = raw.toString('utf8');
      console.log('Sunucu mesajı:', text.slice(0, 500));
      let value = text;
      try { value = JSON.parse(text); } catch {}

      if (value === 'CONNECTED') {
        console.log('SONUÇ: WebSocket ve token doğrulaması başarılı.');
        ws.close(1000, 'Tanılama tamamlandı');
        finish({ ok: true });
      } else if (value === 'AUTH_PROBLEM') {
        console.log('SONUÇ: Handshake başarılı fakat token geçersiz veya süresi dolmuş.');
        ws.close(1000, 'Token reddedildi');
        finish({ ok: false, kind: 'token' });
      }
    });

    ws.on('error', (error) => {
      console.log('WebSocket hata:', error.message);
    });

    ws.on('close', (code, reason) => {
      console.log('WebSocket kapandı:', code, reason.toString('utf8'));
    });

    const timer = setTimeout(() => {
      try { ws.terminate(); } catch {}
      console.log('SONUÇ: WebSocket testi zaman aşımına uğradı.');
      finish({ ok: false, kind: 'timeout' });
    }, timeoutMs + 5000);
  });
}

(async () => {
  try {
    await diagnoseDns();
    await diagnoseHttps();
    await diagnoseRestToken();
    const result = await diagnoseWebSocket();

    section('Yorum');
    if (result.ok) {
      console.log('Bağlantı tarafı sağlıklı. Botu `npm start` ile çalıştırabilirsiniz.');
      process.exitCode = 0;
    } else if (result.kind === 'handshake' && [401, 403].includes(result.statusCode)) {
      console.log('Token henüz gönderilmeden erişim reddedildi. Yanıt Cloudflare Managed Challenge içeriyorsa istemci tarafında çözülemez; Topluyo yöneticisinin /!bot yolunu challenge/bot korumasından hariç tutması gerekir. CF-Ray değerini Topluyo desteğine iletin.');
      process.exitCode = 2;
    } else if (result.kind === 'token') {
      console.log('Cihazlarım bölümünden yeni Bot Token oluşturup .token.json dosyasını güncelleyin.');
      process.exitCode = 3;
    } else {
      console.log('Ağ, güvenlik yazılımı veya Topluyo WebSocket servisi kontrol edilmelidir.');
      process.exitCode = 4;
    }
  } catch (error) {
    console.error('\nTanılama başarısız:', error.stack || error.message);
    process.exitCode = 1;
  }
})();
