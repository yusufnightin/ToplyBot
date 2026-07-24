const test = require('node:test');
const assert = require('node:assert/strict');
const WelcomeService = require('../src/services/WelcomeService');

function baseSettings(overrides = {}) {
  return {
    channels: { welcome: '44367' },
    welcome: {
      enabled: true,
      message: 'Hoş geldin {userName}! #{userId} · {memberCount}',
      dmEnabled: false,
      dmMessage: '',
      embedEnabled: true,
      cardEnabled: false,
      showAvatar: true,
      showServerInfo: true,
      background: '#151922',
      accent: '#ff83c8'
    },
    ...overrides
  };
}

function createApp(settings = baseSettings()) {
  const sent = [];
  const grants = [];
  const settingWrites = [];
  const logs = [];
  const audits = [];
  const app = {
    config: { plugins: ['core', 'welcome'] },
    logger: {
      info(message, meta) { logs.push({ level: 'info', message, meta }); },
      warn(message, meta) { logs.push({ level: 'warn', message, meta }); },
      error(message, meta) { logs.push({ level: 'error', message, meta }); }
    },
    client: {
      userId: null,
      async getCurrentUserId() { this.userId = 777; return 777; },
      async grantChannelAccess(channelId, userId, options) { grants.push({ channelId, userId, options }); return { success: true }; },
      async listMembers() { return { members: [{ id: 1 }, { id: 2 }, { id: 3 }] }; },
      async getGroup() { return { group: { id: 6875, name: 'Destek', description: 'Açıklama' } }; },
      async getUser(userId) { return { user: { id: userId, name: 'Yusuf', nick: 'sporky' } }; },
      async sendPost(channelId, text) { sent.push({ channelId: Number(channelId), text }); return { success: true, post_id: 99 }; },
      async sendDirectMessage() { return { success: true }; }
    },
    services: {
      settings: {
        async get() { return structuredClone(settings); },
        async set(groupId, path, value) { settingWrites.push({ groupId, path, value }); settings.channels.welcome = String(value); return structuredClone(settings); }
      },
      channels: {
        async resolve(groupId, reference) { return { id: 44367, name: String(reference).replace(/^#/, '') }; }
      },
      cards: { async createWelcomeCard() { return { url: null }; } },
      audit: { async write(type, data, options) { audits.push({ type, data, options }); } }
    }
  };
  return { app, sent, grants, settingWrites, logs, audits };
}

test('group/join olayı hoş geldin mesajını gönderir ve bot yazma erişimini doğrular', async () => {
  const fixture = createApp();
  const service = new WelcomeService({ app: fixture.app, dedupeMs: 1000 });
  const result = await service.handleJoin({ action: 'group/join', group_id: 6875, user_id: 25426 });

  assert.equal(result.status, 'sent');
  assert.equal(result.channelId, 44367);
  assert.equal(fixture.sent.length, 1);
  assert.match(fixture.sent[0].text, /Hoş geldin Yusuf/);
  assert.match(fixture.sent[0].text, /Üye sayısı: 3/);
  assert.deepEqual(fixture.grants[0], {
    channelId: 44367,
    userId: 777,
    options: { read: true, write: true, control: false }
  });
  assert.ok(fixture.logs.some((item) => item.message === 'Topluyo group/join olayı alındı.'));
  assert.ok(fixture.logs.some((item) => item.message === 'Hoş geldin mesajı gönderildi.'));
});

test('kapalı sistem veya eksik kanal gönderim yapmadan anlaşılır durum üretir', async () => {
  const disabled = createApp(baseSettings({ channels: { welcome: '44367' }, welcome: { ...baseSettings().welcome, enabled: false } }));
  const disabledService = new WelcomeService({ app: disabled.app });
  const disabledResult = await disabledService.handleJoin({ group_id: 6875, user_id: 1 });
  assert.equal(disabledResult.reason, 'disabled');
  assert.equal(disabled.sent.length, 0);
  assert.equal(disabled.audits[0].type, 'member.join');
  assert.match(disabled.audits[0].options.text, /Karşılama mesajı: kapalı/);

  const noChannel = createApp(baseSettings({ channels: { welcome: '' } }));
  const noChannelService = new WelcomeService({ app: noChannel.app });
  const noChannelResult = await noChannelService.handleJoin({ group_id: 6875, user_id: 2 });
  assert.equal(noChannelResult.reason, 'channel_not_configured');
  assert.equal(noChannel.sent.length, 0);
  assert.equal(noChannel.audits[0].type, 'member.join');
  assert.match(noChannel.audits[0].options.text, /kanal ayarlanmamış/);
});

test('eski #kanaladı ayarı ID değerine dönüştürülüp sunucuya özel kaydedilir', async () => {
  const fixture = createApp(baseSettings({ channels: { welcome: '#hos-geldin' } }));
  const service = new WelcomeService({ app: fixture.app });
  await service.sendWelcome({ groupId: 6875, userId: 25426, source: 'test' });
  assert.deepEqual(fixture.settingWrites[0], {
    groupId: 6875,
    path: 'channels.welcome',
    value: '44367'
  });
  assert.equal(fixture.sent[0].channelId, 44367);
});

test('yardımcı API bilgileri başarısız olsa bile temel hoş geldin mesajı gönderilir', async () => {
  const fixture = createApp();
  fixture.app.client.listMembers = async () => { throw new Error('members yok'); };
  fixture.app.client.getGroup = async () => { throw new Error('group yok'); };
  fixture.app.client.getUser = async () => { throw new Error('user yok'); };
  const service = new WelcomeService({ app: fixture.app, metadataTimeoutMs: 1000 });
  const result = await service.sendWelcome({ groupId: 6875, userId: 55, source: 'test' });
  assert.equal(result.status, 'sent');
  assert.equal(fixture.sent.length, 1);
  assert.match(fixture.sent[0].text, /Kullanıcı #55/);
  assert.equal(result.metadataErrors.length, 3);
});


test('public kart URLsi yoksa bot native JTML kartını otomatik gönderir', async () => {
  const settings = baseSettings({
    welcome: { ...baseSettings().welcome, cardEnabled: true }
  });
  const fixture = createApp(settings);
  fixture.app.services.cards.createWelcomeCard = async () => ({
    url: null,
    jtml: '~{"type":"box","text":"ARAMIZA HOŞ GELDİN"}'
  });
  const service = new WelcomeService({ app: fixture.app });
  await service.sendWelcome({ groupId: 6875, userId: 25426, source: 'test' });
  assert.match(fixture.sent[0].text, /~\{"type":"box"/);
  assert.doesNotMatch(fixture.sent[0].text, /httpServer ayarını açın/);
});
