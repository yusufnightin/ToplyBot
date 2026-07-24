const test = require('node:test');
const assert = require('node:assert/strict');
const CommandRouter = require('../src/core/CommandRouter');
const PermissionManager = require('../src/core/PermissionManager');

function createApp(sent, overrides = {}) {
  return {
    config: { prefix: '!' },
    logger: { error() {} },
    stores: {},
    groupResolver: { resolve: () => overrides.groupId ?? 55 },
    permissionManager: overrides.permissionManager || new PermissionManager(),
    services: {},
    client: {
      async sendPost(channelId, text) {
        sent.push({ type: 'post', channelId, text });
      },
      async sendDirectMessage(userId, text) {
        sent.push({ type: 'dm', userId, text });
      }
    }
  };
}

test('kanal komutunu çalıştırır ve cevap verir', async () => {
  const sent = [];
  const permissionManager = new PermissionManager();
  const router = new CommandRouter({ prefix: '!', permissionManager, logger: { error() {} } });
  router.register({
    name: 'ping',
    cooldownMs: 0,
    async execute(ctx) {
      await ctx.reply('pong');
    }
  });

  const handled = await router.handle({
    action: 'post/add',
    message: '!ping',
    channel_id: '55',
    user_id: 10
  }, createApp(sent, { permissionManager }));

  assert.equal(handled, true);
  assert.deepEqual(sent, [{ type: 'post', channelId: '55', text: 'pong' }]);
});

test('yönetici komutunu normal kullanıcıya kapatır', async () => {
  const sent = [];
  const permissionManager = new PermissionManager({ adminUserIds: [99] });
  const router = new CommandRouter({ prefix: '!', permissionManager, logger: { error() {} } });
  router.register({
    name: 'gizli',
    requiredPermission: 'admin',
    cooldownMs: 0,
    async execute() {
      throw new Error('Çalışmamalı');
    }
  });

  await router.handle({
    action: 'message/send',
    message: '!gizli',
    user_id: 10
  }, createApp(sent, { permissionManager }));

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /admin yetkisi gerekiyor/i);
});

test('moderatör komutunu moderatöre açar', async () => {
  const sent = [];
  const permissionManager = new PermissionManager({ moderatorUserIds: [44] });
  const router = new CommandRouter({ prefix: '!', permissionManager, logger: { error() {} } });
  router.register({
    name: 'uyar',
    requiredPermission: 'moderator',
    guildOnly: true,
    cooldownMs: 0,
    async execute(ctx) {
      await ctx.reply(`yetki:${ctx.permission};grup:${ctx.groupId}`);
    }
  });

  await router.handle({
    action: 'post/add',
    message: '!uyar',
    channel_id: '55',
    user_id: 44
  }, createApp(sent, { permissionManager, groupId: 777 }));

  assert.equal(sent[0].text, 'yetki:moderator;grup:777');
});


test('replyJtml JTMLyi hem post metninde gönderir hem post/bumote ile bağlar', async () => {
  const sent = [];
  const permissionManager = new PermissionManager();
  const router = new CommandRouter({ prefix: '!', permissionManager, logger: { error() {} } });
  router.register({
    name: 'panel',
    cooldownMs: 0,
    async execute(ctx) {
      await ctx.replyJtml('Panel', '~{"type":"bumote","name":"action_id","value":"ok","text":"Tamam"}');
    }
  });

  const app = createApp(sent, { permissionManager });
  const attached = [];
  app.client.attachBumote = async (postId, code) => { attached.push({ postId, code }); return {}; };
  app.client.sendPost = async (channelId, text) => {
    sent.push({ type: 'post', channelId, text });
    return { id: 99 };
  };

  await router.handle({
    action: 'post/add',
    message: '!panel',
    channel_id: '55',
    user_id: 10
  }, app);

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /^Panel\n\n~\{/);
  assert.match(sent[0].text, /"value":"ok"/);
  assert.deepEqual(attached, [{ postId: 99, code: '~{"type":"bumote","name":"action_id","value":"ok","text":"Tamam"}' }]);
});


test('ana komut adı önceki takma adın yerini alır ve bot açılışını durdurmaz', () => {
  const warnings = [];
  const router = new CommandRouter({
    prefix: '!',
    permissionManager: new PermissionManager(),
    logger: { error() {}, warn(message, data) { warnings.push({ message, data }); } }
  });
  router.register({ name: 'sil', aliases: ['postsil'], async execute() {} });
  router.register({ name: 'postsil', async execute() {} });
  assert.equal(router.getCommand('postsil').name, 'postsil');
  assert.equal(router.getCommand('sil').name, 'sil');
  assert.equal(router.getCommand('sil').aliases.includes('postsil'), false);
  assert.ok(warnings.length >= 1);
});

test('başka ana komutla çakışan takma ad atlanır', () => {
  const router = new CommandRouter({
    prefix: '!',
    permissionManager: new PermissionManager(),
    logger: { error() {}, warn() {} }
  });
  router.register({ name: 'postsil', async execute() {} });
  const command = router.register({ name: 'sil', aliases: ['postsil', 'mesajsil'], async execute() {} });
  assert.deepEqual(command.aliases, ['mesajsil']);
  assert.equal(router.getCommand('postsil').name, 'postsil');
  assert.equal(router.getCommand('mesajsil').name, 'sil');
});
