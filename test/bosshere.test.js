const test = require('node:test');
const assert = require('node:assert/strict');
const CommandRouter = require('../src/core/CommandRouter');
const PermissionManager = require('../src/core/PermissionManager');
const adminPlugin = require('../src/plugins/admin');

function createApp() {
  const calls = [];
  const permissionManager = new PermissionManager({ ownerUserIds: [25426] });
  const router = new CommandRouter({
    prefix: '!',
    permissionManager,
    logger: { error() {}, warn() {} }
  });
  const client = {
    async getGroup(id) {
      calls.push({ method: 'getGroup', id });
      return { data: { id, name: 'Sayısal Sunucu' } };
    },
    async getGroupByNick(nick) {
      calls.push({ method: 'getGroupByNick', nick });
      return { data: { id: 4321, nick, name: 'Örnek Sunucu' } };
    },
    async joinGroup(groupId) {
      calls.push({ method: 'joinGroup', groupId });
      return { success: true };
    },
    async sendPost(channelId, message) {
      calls.push({ method: 'sendPost', channelId, message });
      return { success: true };
    },
    async sendDirectMessage(userId, message) {
      calls.push({ method: 'sendDirectMessage', userId, message });
      return { success: true };
    }
  };
  const app = {
    config: { prefix: '!' },
    permissionManager,
    router,
    client,
    services: {},
    stores: {},
    logger: { error() {}, warn() {} }
  };
  adminPlugin.setup(app);
  return { app, calls };
}

test('bosshere Topluyo bağlantısını çözüp botu sunucuya gönderir', async () => {
  const { app, calls } = createApp();

  await app.router.handle({
    action: 'post/add',
    message: '!bosshere https://topluyo.com/ornek-sunucu/null',
    user_id: 25426,
    channel_id: 77,
    group_id: 1
  }, app);

  assert.deepEqual(calls.find((call) => call.method === 'getGroupByNick'), {
    method: 'getGroupByNick',
    nick: 'ornek-sunucu'
  });
  assert.deepEqual(calls.find((call) => call.method === 'joinGroup'), {
    method: 'joinGroup',
    groupId: 4321
  });
  assert.match(calls.find((call) => call.method === 'sendPost').message, /ToplyBot.*Örnek Sunucu/);
});

test('bosshere bot sahibi olmayan kullanıcıları engeller', async () => {
  const { app, calls } = createApp();

  await app.router.handle({
    action: 'post/add',
    message: '!bosshere https://topluyo.com/ornek-sunucu/null',
    user_id: 999,
    channel_id: 77,
    group_id: 1
  }, app);

  assert.equal(calls.some((call) => call.method === 'joinGroup'), false);
  assert.match(calls.find((call) => call.method === 'sendPost').message, /owner yetkisi/);
});

test('bosshere yabancı site bağlantısını kabul etmez', () => {
  assert.throws(
    () => adminPlugin.parseGroupReference('https://example.com/ornek-sunucu'),
    /Yalnızca topluyo\.com/
  );
});
