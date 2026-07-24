const path = require('node:path');
const { loadConfiguration } = require('../src/config');
const TopluyoClient = require('../src/core/TopluyoClient');
const { LiveStreamService } = require('../src/services/LiveStreamService');
const { assertApiSuccess } = require('../src/utils/apiResult');

const projectRoot = path.resolve(__dirname, '..');
const { config, token } = loadConfiguration(projectRoot);
const channelId = Number(process.argv[2]);
const includeMention = process.argv.includes('--mention');
const useLiveMessage = process.argv.includes('--live');

if (!Number.isInteger(channelId) || channelId <= 0) {
  throw new Error('Kullanım: node scripts/diagnose-live-announcement.js <kanalId> [--mention]');
}

const client = new TopluyoClient({
  token,
  logger: { info() {}, warn() {}, error() {} },
  websocketUserAgent: config.connection.websocketUserAgent,
  api: config.api
});

(async () => {
  try {
    const botUserIdPromise = client.getCurrentUserId();
    await client.apiQueue.flush();
    const botUserId = await botUserIdPromise;
    const access = await client.grantChannelAccess(channelId, botUserId, {
      read: true,
      write: true,
      control: includeMention
    });
    let text;
    if (useLiveMessage) {
      const service = new LiveStreamService({ config: config.liveStreams });
      const watcher = {
        platform: 'kick',
        source: 'bardesmesanges',
        name: 'TEstediyok',
        mention: includeMention ? '@millet' : '',
        template: config.liveStreams.defaultTemplate
      };
      const status = await service.check(watcher);
      text = service.message(watcher, status);
    } else {
      text = [
        ...(includeMention ? ['@millet'] : []),
        '🧪 Canlı yayın duyuru sistemi etiket testi',
        '👉 https://kick.com/bardesmesanges'
      ].join('\n');
    }
    const result = await client.sendPost(channelId, text);
    assertApiSuccess(result, 'Canlı yayın duyuru testi');
    process.stdout.write(`${JSON.stringify({
      success: true,
      channelId,
      includeMention,
      useLiveMessage,
      access: access.operations.map((item) => ({
        permission: item.permission,
        status: item.status
      })),
      result
    })}\n`);
  } finally {
    await client.apiQueue.close({ drain: true });
  }
})().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
