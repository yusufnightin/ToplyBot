const test = require('node:test');
const assert = require('node:assert/strict');
const CommandRouter = require('../src/core/CommandRouter');
const PermissionManager = require('../src/core/PermissionManager');
const CommandMenuService = require('../src/services/CommandMenuService');
const { buildCommandCatalogBumote, buildCommandMenuBumote, composeJtmlPost } = require('../src/utils/bumote');
const { parseNativeJtmlMarkup } = require('../src/utils/topluyoProtocol');

class MemoryStore {
  constructor(value) { this.value = structuredClone(value); }
  async read() { return structuredClone(this.value); }
  async update(mutator) {
    const next = await mutator(this.value);
    if (next !== undefined) this.value = next;
    return structuredClone(this.value);
  }
}

test('komut katalog kartları eksik son satırda uzamadan üç eşit kolon korur', () => {
  const code = buildCommandCatalogBumote({
    commands: Array.from({ length: 4 }, (_, index) => ({
      icon: '⌘',
      title: `!komut${index + 1}`,
      description: 'Kısa açıklama',
      usage: `!komut${index + 1}`,
      actions: [{ value: `command:komut${index + 1}`, label: 'Aç →' }]
    }))
  });
  const tree = JSON.parse(code.slice(1));
  const catalog = tree.children.find((node) => node.background === '#151922');
  assert.equal(catalog.children.length, 2);
  assert.equal(catalog.children[0].children.length, 3);
  assert.equal(catalog.children[1].children.length, 3);
  assert.equal(catalog.children[1].children[1].text, '');
  assert.equal(catalog.children[1].children[2].text, '');
});

test('ortak panel kartları ve gezinme satırları eksik kolonda genişlemez', () => {
  const code = buildCommandMenuBumote({
    navigation: Array.from({ length: 4 }, (_, index) => ({
      value: `nav:${index + 1}`,
      label: `Gezinme ${index + 1}`
    })),
    commands: Array.from({ length: 4 }, (_, index) => ({
      value: `action:${index + 1}`,
      label: `Kart ${index + 1}`,
      title: 'Kısa açıklama',
      actionLabel: 'Aç →'
    })),
    commandColumns: 3
  });
  const tree = JSON.parse(code.slice(1));
  const panels = tree.children.filter((node) => node.background === '#171d26');
  const navigation = panels[0];
  const cards = panels[1];

  assert.equal(navigation.children.length, 2);
  assert.equal(navigation.children[1].children.length, 3);
  assert.equal(navigation.children[1].children[1].text, '');
  assert.equal(navigation.children[1].children[2].text, '');
  assert.equal(cards.children.length, 2);
  assert.equal(cards.children[1].children.length, 3);
  assert.equal(cards.children[1].children[1].text, '');
  assert.equal(cards.children[1].children[2].text, '');
  assert.equal(cards.children[0].children[0].children[0].background, '#202633');
});

function createApp() {
  const sent = [];
  const updated = [];
  const attached = [];
  const dms = [];
  const permissionManager = new PermissionManager({ ownerUserIds: [1], moderatorUserIds: [2] });
  const router = new CommandRouter({ prefix: '!', permissionManager, logger: { error() {} } });
  router.register({
    name: 'ping', category: 'Genel', description: 'Bot gecikmesini gösterir.', usage: 'ping',
    async execute(ctx) { await ctx.reply('Pong!'); }
  });
  router.register({
    name: 'uyar', category: 'Moderasyon', description: 'Kullanıcıyı uyarır.', usage: 'uyar <kullanıcı> <sebep>',
    requiredPermission: 'moderator', async execute(ctx) { await ctx.reply(`Uyar çalıştı: ${ctx.args.join(' ')}`); }
  });
  router.register({
    name: 'ban', category: 'Moderasyon', description: 'Kullanıcıyı yasaklar.', usage: 'ban <kullanıcı>',
    requiredPermission: 'moderator', async execute(ctx) { await ctx.reply(`Ban çalıştı: ${ctx.args.join(' ')}`); }
  });

  const app = {
    config: {
      prefix: '!',
      commandMenu: {
        enabled: true,
        openOnBarePrefix: true,
        ownerOnly: true,
        sessionMinutes: 10,
        commandsPerPage: 5,
        showQuickRun: true
      }
    },
    permissionManager,
    router,
    logger: { warn() {}, error() {} },
    stores: { liveStreams: new MemoryStore([]) },
    client: {
      async sendPost(channelId, text) { sent.push({ channelId, text }); return { id: 700 }; },
      async updatePost(postId, text) { updated.push({ postId, text }); return {}; },
      async attachBumote(postId, code) { attached.push({ postId, code }); return {}; },
      async sendDirectMessage(userId, text) { dms.push({ userId, text }); return {}; },
      async sortChannels() { return {}; },
      async sortRoles() { return {}; }
    },
    services: {
      cards: { async createCommandMenuCard() { return { url: null }; } },
      channels: {
        cache: new Map(),
        async resolve(_groupId, reference) {
          const id = Number(String(reference).replace(/^#/, '')) || 44;
          return { id, name: 'genel', nick: 'genel' };
        },
        label(_groupId, channelId) { return Number(channelId) === 44 ? '#genel' : ''; },
        async list() {
          return [
            { id: 44, name: 'genel', nick: 'genel', title: 'Genel', type: 1, order: 2 },
            { id: 45, name: 'destek', nick: 'destek', title: 'Destek', type: 1, order: 1 }
          ];
        }
      },
      roles: {
        async list() {
          return [
            { id: 8, name: 'Üye', color: '#999999', order: 2, power: 0 },
            { id: 9, name: 'Yönetici', color: '#ff0000', order: 1, power: 8 }
          ];
        }
      },
      audit: { async write() {} },
      settings: { async get() { return { channels: {}, tickets: { enabled: false } }; } },
      supportTemplate: {
        canInstall(userId) { return Number(userId) === 1; },
        async install() { return { channels: { support: 45 }, roles: { admin: 9 }, ticketPanelPostId: 701 }; }
      },
      apiManagement: {
        async listBadges() { return [{ id: 501, name: 'Seviye 5' }, { id: 510, name: 'Seviye 10' }]; }
      },
      liveStreams: {},
      leveling: {
        async dashboard(groupId, userId) {
          return {
            settings: { enabled: true, xpMin: 8, xpMax: 12, multiplier: 1, cooldownSeconds: 45, roleRewards: {}, badgeRewards: {} },
            profile: { groupId, userId, level: 3, xp: 950, messages: 42, awardedBadgeIds: [501] },
            progress: { percent: 50, gained: 150, required: 300 },
            totalProfiles: 4,
            totalXp: 3200,
            top: [{ userId: 1, level: 3, xp: 950 }],
            badges: [{ id: 501, name: 'Seviye 5' }],
            isGroupFounder: true,
            roleRewards: {},
            badgeRewards: {}
          };
        },
        async settings() { return { roleRewards: {}, badgeRewards: {} }; },
        async changeXp({ userId, delta }) { return { profile: { userId, level: 4, xp: 1200 }, rewards: { badges: [] } }; },
        async setLevel({ userId, level }) { return { profile: { userId, level, xp: level * 100 } }; },
        async mapRoleReward(groupId, level, roleId) { app._lastRoleMap = { groupId, level, roleId }; return {}; },
        async mapBadgeReward() { return {}; },
        async giveBadge({ userId, badgeId }) { app._lastBadgeGive = { userId, badgeId }; return {}; },
        async syncUserRewards(groupId, userId) { return { rewards: { roles: [9], badges: [501], roleFailures: [], badgeFailures: [] } }; },
        async createBadgeReward(groupId, level) { return { id: 700 + level, payload: { name: `Seviye ${level}` } }; },
        async createOwnerBadgePack() { return { created: [{ level: 5, badgeId: 705 }], skipped: [], failed: [] }; },
        async syncAllRewards() { return { total: 4, succeeded: 4, failed: [] }; }
      }
    }
  };
  const store = new MemoryStore([]);
  app.services.commandMenu = new CommandMenuService({ store, app });
  return { app, store, sent, updated, attached, dms };
}

test('JTML komut merkezi ana sekmeleri ve arama alanını üretir', () => {
  const code = buildCommandMenuBumote({
    navigation: [{ value: 'home', label: 'Ana Menü' }],
    search: { placeholder: 'Komut ara' },
    sections: [{ value: 'section:moderation', label: 'Moderasyon' }]
  });
  assert.match(code, /^~\{/);
  assert.doesNotMatch(code, /<form|<button/i);
  const parsed = parseNativeJtmlMarkup(code);
  assert.equal(parsed.blockCount, 1);
  assert.equal(parsed.bumoteCount, 3);
  assert.equal(parsed.inputCount, 1);
  assert.match(code, /"name":"menu_action"/);
  assert.match(code, /"value":"section:moderation"/);
  assert.match(code, /"name":"query"/);
  assert.match(code, /"type":"bumote"/);
});

test('görünen metin ve JTML tek post.text değerinde birleştirilir', () => {
  const first = composeJtmlPost('Kontrol paneli', '~{"type":"bumote","name":"action_id","value":"ok","text":"Tamam"}');
  assert.match(first, /^Kontrol paneli\n\n~\{/);
  const replaced = composeJtmlPost(first, '~{"type":"bumote","name":"action_id","value":"new","text":"Yeni"}');
  assert.equal((replaced.match(/~\{/g) || []).length, 1);
  assert.match(replaced, /"value":"new"/);
  assert.doesNotMatch(replaced, /"value":"ok"/);
});

test('komut merkezi JTMLyi post metninde gösterir, posta bağlar ve sekme tıklaması aynı postu günceller', async () => {
  const { app, sent, updated, attached } = createApp();
  const result = await app.services.commandMenu.open({ userId: 1, channelId: 10, groupId: 9 });

  assert.equal(result.postId, 700);
  assert.equal(result.attached, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /^\*\*⚡ ToplyBot Yardım \/ Ana Panel\*\*/);
  assert.match(sent[0].text, /\n\n~\{/);
  assert.doesNotMatch(sent[0].text, /╭|TOPLUYO COMMAND CENTER/);
  assert.match(sent[0].text, /section:moderation/);
  assert.match(sent[0].text, /"name":"launcher_query"/);
  assert.doesNotMatch(sent[0].text, /inventory:channels|inventory:roles|quickmod:home/);
  assert.match(sent[0].text, /section:management/);
  assert.equal(attached.length, 1);
  assert.equal(attached[0].postId, 700);
  assert.match(attached[0].code, /^~\{/);
  assert.ok(sent[0].text.endsWith(attached[0].code));

  const handled = await app.services.commandMenu.handle({
    action: 'post/bumote',
    post_id: 700,
    user_id: 1,
    message: { form: { menu_action: 'section:moderation' }, submit: 'Moderasyon' }
  });

  assert.equal(handled, true);
  assert.equal(updated.length, 1);
  assert.match(updated[0].text, /^\*\*🛡️ Yardım \/ Moderasyon\*\*/);
  assert.match(updated[0].text, /\n\n~\{/);
  assert.match(updated[0].text, /command:uyar/);
  assert.equal(attached.length, 2);
  assert.equal(attached[1].postId, 700);
  assert.match(attached[1].code, /^~\{/);
  assert.ok(updated[0].text.endsWith(attached[1].code));
});

test('başka kullanıcıya ait özel menü tıklanamaz ve kullanıcı bilgilendirilir', async () => {
  const { app, updated, dms } = createApp();
  await app.services.commandMenu.open({ userId: 1, channelId: 10, groupId: 9 });

  const handled = await app.services.commandMenu.handle({
    action: 'post/bumote',
    post_id: 700,
    user_id: 2,
    message: { form: { menu_action: 'home' } }
  });

  assert.equal(handled, true);
  assert.equal(updated.length, 0);
  assert.equal(dms.length, 1);
  assert.match(dms[0].text, /Kendi menünü/);
});

test('parametresiz komut JTML düğmesinden çalıştırılabilir', async () => {
  const { app, sent } = createApp();
  await app.services.commandMenu.open({ userId: 1, channelId: 10, groupId: 9, initialCommand: 'ping' });
  sent.length = 0;

  await app.services.commandMenu.handle({
    action: 'post/bumote',
    post_id: 700,
    user_id: 1,
    message: { form: { menu_action: 'run:ping' } }
  });

  assert.ok(sent.some((item) => item.text === 'Pong!'));
});

test('güncel Topluyo payloadında gerçek tıklama message.submit üzerinden çözülür', async () => {
  const { app, updated } = createApp();
  await app.services.commandMenu.open({ userId: 1, channelId: 10, groupId: 9 });

  const handled = await app.services.commandMenu.handle({
    action: 'post/bumote',
    post_id: 700,
    user_id: 1,
    message: {
      submit: 'section:general',
      form: { menu_action: '✖ Menüyü Kapat', query: '' }
    }
  });

  assert.equal(handled, true);
  assert.equal(updated.length, 1);
  assert.match(updated[0].text, /Genel Bakış/);
  assert.match(updated[0].text, /command:ping/);
});

test('dokümante edilen eski payload biçiminde form.menu_action fallback çalışır', () => {
  const { app } = createApp();
  const action = app.services.commandMenu.extractAction({
    action: 'post/bumote',
    message: {
      submit: '🛡️ Moderasyon',
      form: { menu_action: 'section:moderation' }
    }
  });
  assert.equal(action, 'section:moderation');
});


test('hızlı moderasyon paneli form değerleriyle gerçek komutu çalıştırır', async () => {
  const { app, sent, updated } = createApp();
  await app.services.commandMenu.open({ userId: 1, channelId: 10, groupId: 9 });
  sent.length = 0;

  await app.services.commandMenu.handle({
    action: 'post/bumote', post_id: 700, user_id: 1,
    message: {
      submit: 'quickmod:run:uyar',
      form: { target_user_id: '25469', duration: '10m', reason: 'Spam yaptı', amount: '10' }
    }
  });

  assert.ok(sent.some((item) => item.text === 'Uyar çalıştı: 25469 Spam yaptı'));
  assert.ok(updated.some((item) => /Hızlı Moderasyon/.test(item.text)));
});

test('kanal ve rol envanteri JTML panelinde ID ve sıra bilgilerini gösterir', async () => {
  const { app, updated } = createApp();
  await app.services.commandMenu.open({ userId: 1, channelId: 10, groupId: 9 });

  await app.services.commandMenu.handle({
    action: 'post/bumote', post_id: 700, user_id: 1,
    message: { submit: 'inventory:channels:order:0', form: {} }
  });
  assert.match(updated.at(-1).text, /Kanal Envanteri/);
  assert.match(updated.at(-1).text, /#destek/);
  assert.match(updated.at(-1).text, /ID 45/);

  await app.services.commandMenu.handle({
    action: 'post/bumote', post_id: 700, user_id: 1,
    message: { submit: 'inventory:roles:power:0', form: {} }
  });
  assert.match(updated.at(-1).text, /Rol Envanteri/);
  assert.match(updated.at(-1).text, /Yönetici/);
  assert.match(updated.at(-1).text, /güç 8/);
});

test('destek sunucusu şablonu yalnızca belirlenen bot sahibi için panelde çalışır', async () => {
  const { app, updated } = createApp();
  await app.services.commandMenu.open({ userId: 1, channelId: 10, groupId: 9 });
  await app.services.commandMenu.handle({
    action: 'post/bumote', post_id: 700, user_id: 1,
    message: { submit: 'template:support:install', form: {} }
  });
  assert.match(updated.at(-1).text, /DESTEK SUNUCUSU ŞABLONU/);
  assert.match(updated.at(-1).text, /template:support:repair/);
  assert.match(updated.at(-1).text, /template:support:verify/);
  assert.match(updated.at(-1).text, /template:support:test/);
  assert.match(updated.at(-1).text, /Şablon hazır/);
});


test('tek kelimelik başlatıcı komutu seçer ve akıllı tek giriş varsayımlarını uygular', async () => {
  const { app, sent, updated } = createApp();
  await app.services.commandMenu.open({ userId: 1, channelId: 10, groupId: 9 });
  sent.length = 0;

  await app.services.commandMenu.handle({
    action: 'post/bumote', post_id: 700, user_id: 1,
    message: { submit: 'launcher:run', form: { launcher_query: 'ban' } }
  });
  assert.match(updated.at(-1).text, /!ban/);
  assert.match(updated.at(-1).text, /"name":"command_args"/);
  assert.match(updated.at(-1).text, /"value":"runargs:ban"/);

  await app.services.commandMenu.handle({
    action: 'post/bumote', post_id: 700, user_id: 1,
    message: { submit: 'runargs:ban', form: { command_args: '25469' } }
  });
  assert.ok(sent.some((item) => /Ban çalıştı: 25469 0 Panel üzerinden/.test(item.text)));
});

test('JTML ilerleme kartı yüzde ve aşama çubuğu üretir', () => {
  const code = buildCommandMenuBumote({
    progress: { percent: 50, title: 'Kurulum', status: 'Kanallar hazırlanıyor' }
  });
  assert.match(code, /%50/);
  assert.match(code, /Kurulum/);
  assert.match(code, /Kanallar hazırlanıyor/);
  assert.match(code, /█/);
});


test('seviye ve rozet merkezi yardım menüsünden açılır ve yönetim işlemlerini çalıştırır', async () => {
  const { app, updated } = createApp();
  await app.services.commandMenu.open({ userId: 1, channelId: 10, groupId: 9 });

  await app.services.commandMenu.handle({
    action: 'post/bumote', post_id: 700, user_id: 1,
    message: { submit: 'leveling:home', form: {} }
  });
  assert.match(updated.at(-1).text, /SEVİYE & ROZET MERKEZİ/);
  assert.match(updated.at(-1).text, /leveling:addxp/);
  assert.match(updated.at(-1).text, /leveling:maprole/);
  assert.match(updated.at(-1).text, /leveling:givebadge/);
  assert.match(updated.at(-1).text, /leveling:createpack/);
  assert.match(updated.at(-1).text, /level_target_user/);
  assert.match(updated.at(-1).text, /level_role_id/);

  await app.services.commandMenu.handle({
    action: 'post/bumote', post_id: 700, user_id: 1,
    message: {
      submit: 'leveling:maprole',
      form: { level_reward_level: '5', level_role_id: '9' }
    }
  });
  assert.deepEqual(app._lastRoleMap, { groupId: 9, level: 5, roleId: 9 });
  assert.match(updated.at(-1).text, /Para veya rozet şartı yok/);

  await app.services.commandMenu.handle({
    action: 'post/bumote', post_id: 700, user_id: 1,
    message: {
      submit: 'leveling:givebadge',
      form: { level_target_user: '55', level_badge_id: '501', level_amount: '100', level_reward_level: '5' }
    }
  });
  assert.deepEqual(app._lastBadgeGive, { userId: 55, badgeId: 501 });
  assert.match(updated.at(-1).text, /Rozet #501/);
});

test('canlı yayın takipleri yardım panelinden eklenip düzenlenir', async () => {
  const { app, updated } = createApp();
  await app.services.commandMenu.open({ userId: 1, channelId: 10, groupId: 9 });
  await app.services.commandMenu.handle({
    action: 'post/bumote', post_id: 700, user_id: 1,
    message: { submit: 'livestreams:home', form: {} }
  });
  assert.match(updated.at(-1).text, /livestreams:new/);
  await app.services.commandMenu.handle({
    action: 'post/bumote', post_id: 700, user_id: 1,
    message: { submit: 'livestreams:new', form: {} }
  });
  assert.match(updated.at(-1).text, /livestreams:platform:kick/);
  await app.services.commandMenu.handle({
    action: 'post/bumote', post_id: 700, user_id: 1,
    message: { submit: 'livestreams:platform:kick', form: {} }
  });
  assert.match(updated.at(-1).text, /live_channel/);
  assert.match(updated.at(-1).text, /livestreams:add/);

  await app.services.commandMenu.handle({
    action: 'post/bumote', post_id: 700, user_id: 1,
    message: {
      submit: 'livestreams:add',
      form: {
        live_channel: '44', live_name: 'Örnek Yayıncı', live_source: 'ornek'
      }
    }
  });
  const records = await app.stores.liveStreams.read();
  assert.equal(records.length, 1);
  assert.equal(records[0].platform, 'kick');
  assert.equal(records[0].pollMinutes, 3);
  assert.match(records[0].template, /\{mention\}/);
  assert.match(updated.at(-1).text, /livestreams:edit/);
});

test('canlı yayın kurulumu boş bırakılan duyuru kanalını ayarlardan otomatik seçer', async () => {
  const { app } = createApp();
  const grants = [];
  app.services.settings.get = async () => ({
    channels: { announcements: '44' },
    tickets: { enabled: false }
  });
  app.client.getCurrentUserId = async () => 999;
  app.client.grantChannelAccess = async (channelId, userId, options) => {
    grants.push({ channelId, userId, options });
    return { success: true };
  };

  const channelId = await app.services.commandMenu.prepareLiveAnnouncementChannel(9, '');

  assert.equal(channelId, '44');
  assert.deepEqual(grants, [{
    channelId: 44,
    userId: 999,
    options: { read: true, write: true, control: true }
  }]);
});

test('yardım ana paneli seçenek 1 tasarımını çalışan native JTML olarak gösterir', async () => {
  const { app, sent } = createApp();
  await app.services.commandMenu.open({ userId: 1, channelId: 10, groupId: 9 });
  const text = sent[0].text;
  assert.match(text, /ToplyBot Yardım Merkezi/);
  assert.match(text, /SEÇENEK 1 — SADE ANA PANEL/);
  assert.match(text, /Bot Durumu: Çevrimiçi/);
  assert.match(text, /Ne yapmak istiyorsun\?/);
  assert.match(text, /Genel & İstatistik/);
  assert.match(text, /Moderasyon & Güvenlik/);
  assert.match(text, /Üye & Karşılama/);
  assert.match(text, /Roller & Destek/);
  assert.match(text, /Seviye & Rozet/);
  assert.match(text, /Otomasyon & Sosyal/);
  assert.match(text, /Hızlı İşlemler/);
  assert.match(text, /Sistem Yönetimi/);
  assert.match(text, /Anket & Çekiliş/);
  assert.match(text, /Bot Ayarları/);
  assert.match(text, /"value":"home"/);
  assert.match(text, /"value":"back"/);
  assert.match(text, /"value":"close"/);
  assert.match(text, /ToplyBot ♥ Topluyo/);
  assert.match(text, /Destek Sunucusu Yakında/);
  assert.doesNotMatch(text, /assistant:home|SON KULLANDIKLARIN/);
});

test('yardım ana panelindeki geri düğmesi önceki ekranı açar', async () => {
  const { app, updated } = createApp();
  await app.services.commandMenu.open({ userId: 1, channelId: 10, groupId: 9 });

  await app.services.commandMenu.handle({
    action: 'post/bumote',
    post_id: 700,
    user_id: 1,
    message: { submit: 'section:moderation', form: {} }
  });
  await app.services.commandMenu.handle({
    action: 'post/bumote',
    post_id: 700,
    user_id: 1,
    message: { submit: 'home', form: {} }
  });
  await app.services.commandMenu.handle({
    action: 'post/bumote',
    post_id: 700,
    user_id: 1,
    message: { submit: 'back', form: {} }
  });

  assert.match(updated.at(-1).text, /Yardım \/ Moderasyon/);
  assert.match(updated.at(-1).text, /command:uyar/);
});
