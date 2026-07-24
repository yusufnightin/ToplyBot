const test = require('node:test');
const assert = require('node:assert/strict');
const CommandRouter = require('../src/core/CommandRouter');
const PermissionManager = require('../src/core/PermissionManager');
const GroupSettingsService = require('../src/services/GroupSettingsService');
const MenuSettingsService = require('../src/services/MenuSettingsService');
const CommandMenuService = require('../src/services/CommandMenuService');

class MemoryStore {
  constructor(value) { this.value = structuredClone(value); }
  async read() { return structuredClone(this.value); }
  async update(mutator) {
    const working = structuredClone(this.value);
    const next = await mutator(working);
    this.value = structuredClone(next === undefined ? working : next);
    return structuredClone(this.value);
  }
}

function createApp() {
  const sent = [];
  const updated = [];
  const attached = [];
  const permissionManager = new PermissionManager({ ownerUserIds: [1], adminUserIds: [2] });
  const router = new CommandRouter({ prefix: '!', permissionManager, logger: { error() {} } });
  router.register({
    name: 'yaz', category: 'Yönetim', description: 'Girilen metni tekrarlar.', usage: 'yaz <metin>',
    requiredPermission: 'admin',
    async execute(ctx) { await ctx.reply(`YAZ: ${ctx.args.join(' ')}`); }
  });

  const app = {
    config: {
      prefix: '!',
      commandMenu: { enabled: true, ownerOnly: true, settingsPerPage: 8, sessionMinutes: 10 },
      interactions: { attachBumote: true },
      channels: {},
      features: {}
    },
    permissionManager,
    router,
    logger: { warn() {}, error() {}, info() {} },
    client: {
      async sendPost(channelId, text) { sent.push({ channelId, text }); return { id: 800 }; },
      async updatePost(postId, text) { updated.push({ postId, text }); return {}; },
      async attachBumote(postId, code) { attached.push({ postId, code }); return {}; },
      async sendDirectMessage() { return {}; }
    },
    services: {},
    stores: {}
  };

  const settingsStore = new MemoryStore({});
  const menuStore = new MemoryStore([]);
  app.services.settings = new GroupSettingsService({ store: settingsStore, config: app.config });
  app.services.audit = { async write() {} };
  app.services.cards = { async createCommandMenuCard() { return { url: null }; } };
  app.services.menuSettings = new MenuSettingsService({ app });
  app.services.commandMenu = new CommandMenuService({ store: menuStore, app });
  return { app, sent, updated, attached };
}

test('tam ayar paneli kategori ve alanları native JTML olarak gösterir', async () => {
  const { app, updated } = createApp();
  await app.services.commandMenu.open({ userId: 1, channelId: 44, groupId: 77 });

  await app.services.commandMenu.handle({
    action: 'post/bumote', post_id: 800, user_id: 1,
    message: { submit: 'settings:home', form: {} }
  });
  assert.match(updated.at(-1).text, /Sunucu Ayarları/);
  assert.match(updated.at(-1).text, /settings:category:welcome/);
  assert.match(updated.at(-1).text, /settings:category:moderation/);

  await app.services.commandMenu.handle({
    action: 'post/bumote', post_id: 800, user_id: 1,
    message: { submit: 'settings:category:moderation', form: {} }
  });
  assert.match(updated.at(-1).text, /Moderasyon/);
  assert.match(updated.at(-1).text, /settings:field:moderation\.enabled/);
});

test('ayar panelinden sayı ve aç-kapat değerleri kaydedilir', async () => {
  const { app } = createApp();
  await app.services.commandMenu.open({ userId: 1, channelId: 44, groupId: 77 });

  await app.services.commandMenu.handle({
    action: 'post/bumote', post_id: 800, user_id: 1,
    message: { submit: 'settings:save:moderation.mentionLimit', form: { setting_value: '9' } }
  });
  let settings = await app.services.settings.get(77);
  assert.equal(settings.moderation.mentionLimit, 9);

  await app.services.commandMenu.handle({
    action: 'post/bumote', post_id: 800, user_id: 1,
    message: { submit: 'settings:set:tickets.enabled:false', form: {} }
  });
  settings = await app.services.settings.get(77);
  assert.equal(settings.tickets.enabled, false);
});

test('parametre isteyen komut menü formundan çalıştırılır', async () => {
  const { app, sent, updated } = createApp();
  await app.services.commandMenu.open({ userId: 1, channelId: 44, groupId: 77, initialCommand: 'yaz' });
  assert.match(sent[0].text, /"name":"command_args"/);
  assert.match(sent[0].text, /runargs:yaz/);
  sent.length = 0;

  await app.services.commandMenu.handle({
    action: 'post/bumote', post_id: 800, user_id: 1,
    message: { submit: 'runargs:yaz', form: { command_args: 'panelden merhaba' } }
  });
  assert.ok(sent.some((item) => item.text === 'YAZ: panelden merhaba'));
  assert.match(updated.at(-1).text, /panel üzerinden çalıştırıldı/);
});

test('ayar doğrulaması geçersiz değeri reddeder', () => {
  const { app } = createApp();
  assert.throws(() => app.services.menuSettings.parse('welcome.accent', 'pembe'), /#RRGGBB/);
  assert.throws(() => app.services.menuSettings.parse('moderation.mentionLimit', '100'), /En yüksek değer 50/);
  assert.deepEqual(app.services.menuSettings.parse('autorole.roleIds', '12, 12, 45'), [12, 45]);
});


test('ayarlar grup ID bazında birbirinden tamamen izole tutulur', async () => {
  const { app } = createApp();
  await app.services.settings.set(77, 'welcome.message', 'Sunucu 77 mesajı');
  await app.services.settings.set(88, 'welcome.message', 'Sunucu 88 mesajı');
  await app.services.settings.set(77, 'channels.welcome', '111');
  await app.services.settings.set(88, 'channels.welcome', '222');

  const first = await app.services.settings.get(77);
  const second = await app.services.settings.get(88);
  assert.equal(first.welcome.message, 'Sunucu 77 mesajı');
  assert.equal(second.welcome.message, 'Sunucu 88 mesajı');
  assert.equal(first.channels.welcome, '111');
  assert.equal(second.channels.welcome, '222');
});
