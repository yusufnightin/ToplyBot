const test = require('node:test');
const assert = require('node:assert/strict');
const SupportTemplateService = require('../src/services/SupportTemplateService');
const ProvisioningService = require('../src/services/ProvisioningService');
const ChannelResolverService = require('../src/services/ChannelResolverService');
const RoleService = require('../src/services/RoleService');

class MemoryStore {
  constructor(value) { this.value = structuredClone(value); }
  async read() { return structuredClone(this.value); }
  async write(value) { this.value = structuredClone(value); return structuredClone(value); }
  async update(mutator) {
    const working = structuredClone(this.value);
    const next = await mutator(working);
    this.value = structuredClone(next === undefined ? working : next);
    return structuredClone(this.value);
  }
}

test('kişisel destek şablonu ID dönmeyen kanal cevabını listeden kurtarıp tüm sistemi kurar', async () => {
  let roleId = 100;
  let channelId = 200;
  let postId = 900;
  let badgeId = 400;
  const roleRows = [];
  const channelRows = [];
  const badgeRows = [];
  const memberRoles = new Map();
  let hidePrivateChannels = false;
  const sorted = { roles: [], channels: [] };
  const accessGrants = [];
  let settings = {
    channels: {}, welcome: {}, leave: {}, autorole: {}, registration: {}, moderation: {}, tickets: {}, customCommands: {}, automations: {}, maintenance: {}
  };
  const client = {
    async getCurrentUserId() { return 777; },
    async grantChannelAccess(id, userId, options) { accessGrants.push({ channelId: id, userId, options }); return { success: true }; },
    async api(path, data) {
      if (path === '/!api/role/list') return { roles: roleRows };
      if (path === '/!api/member/get') {
        const userId = Number(data?.user_id);
        return { member: { role_ids: memberRoles.get(userId) || [] } };
      }
      if (path === '/!api/member/role/set') {
        const userId = Number(data?.user_id);
        memberRoles.set(userId, String(data?.role_ids || '').split(',').map(Number).filter(Number.isInteger));
        return { success: true };
      }
      throw new Error(`Beklenmeyen API: ${path}`);
    },
    async listChannels() {
      return {
        channels: hidePrivateChannels
          ? channelRows.filter((row) => (
              SupportTemplateService.CHANNEL_SPECS.find((spec) => spec.nick === row.nick)?.access !== 'staff'
            ))
          : channelRows
      };
    },
    async getChannel(id) {
      const channel = channelRows.find((row) => Number(row.id) === Number(id));
      return channel
        ? { channel }
        : { status: 'error', data: 0, message: 'channel not found' };
    },
    async createRole(payload) {
      roleId += 1;
      roleRows.push({ id: roleId, name: payload.name, color: payload.color, order: roleRows.length + 1, ...payload });
      return { success: true, role_id: roleId };
    },
    async createChannel(payload) {
      channelId += 1;
      channelRows.push({ ...payload, id: channelId, order: channelRows.length + 1 });
      // Kullanıcının yaşadığı gerçek durum: ekip-sohbet oluşturuluyor ama cevapta ID yok.
      if (payload.nick === 'ekip-sohbet') return { success: true, message: 'channel created' };
      return { success: true, channel_id: channelId };
    },
    async deleteRole(id) {
      const index = roleRows.findIndex((row) => Number(row.id) === Number(id));
      if (index < 0) return { status: 'error', data: 0, message: 'role not found' };
      roleRows.splice(index, 1);
      return { success: true };
    },
    async deleteChannel(id) {
      const index = channelRows.findIndex((row) => Number(row.id) === Number(id));
      if (index < 0) return { status: 'error', data: 0, message: 'channel not found' };
      channelRows.splice(index, 1);
      return { success: true };
    },
    async sortRoles(groupId, ids) { sorted.roles = ids; },
    async sortChannels(groupId, ids) { sorted.channels = ids; },
    async setMemberRoles(groupId, userId, ids) { memberRoles.set(Number(userId), [...ids]); return { success: true }; },
    async sendPost() { postId += 1; return { id: postId }; },
    async attachBumote() { return {}; },
    async updatePost() { return {}; }
  };
  const app = {
    projectRoot: process.cwd(),
    config: {
      prefix: '!',
      ownerUserIds: [25426],
      supportTemplate: { ownerUserId: 25426, operationDelayMs: 0 },
      interactions: { attachBumote: true }
    },
    permissionManager: { has(userId, permission) { return Number(userId) === 25426 && permission === 'owner'; } },
    client,
    logger: { warn() {}, info() {}, error() {} },
    stores: {
      ticketPanels: new MemoryStore([]),
      rolePanels: new MemoryStore([]),
      tickets: new MemoryStore([]),
      statistics: new MemoryStore([]),
      commandMenus: new MemoryStore([]),
      liveStreams: new MemoryStore([]),
      feeds: new MemoryStore([]),
      giveaways: new MemoryStore([]),
      polls: new MemoryStore([]),
      customCommands: new MemoryStore({}),
      templateInstallations: new MemoryStore({})
    },
    services: {}
  };
  app.services.roles = new RoleService({ client, logger: app.logger });
  app.services.channels = new ChannelResolverService({ client, logger: app.logger, cacheTtlMs: 5000 });
  app.services.settings = {
    async get() { return structuredClone(settings); },
    async set(groupId, path, value) {
      const parts = path.split('.'); let target = settings;
      while (parts.length > 1) { const key = parts.shift(); target[key] ||= {}; target = target[key]; }
      target[parts[0]] = structuredClone(value); return structuredClone(settings);
    },
    async replace(groupId, value) { settings = structuredClone(value); return structuredClone(settings); }
  };
  app.services.audit = { async write() {} };
  app.services.backups = { async create() { return { id: 'backup-1', createdAt: new Date().toISOString() }; } };
  app.services.welcome = { async repair() { return { channelId: Number(settings.channels.welcome), botUserId: 777 }; } };
  app.services.cards = {
    async publishLevelBadgeAssets() {
      return Object.fromEntries(SupportTemplateService.LEVEL_ROLE_SPECS.map((spec) => [String(spec.level), {
        level: spec.level,
        sourceName: `level-badge-${spec.level}-${spec.title}.svg`,
        url: `https://bot.example.com/cards/level-badge-${spec.level}.svg`,
        title: spec.title,
        emoji: spec.emoji,
        accent: spec.color
      }]));
    }
  };
  app.services.apiManagement = { async listBadges() { return structuredClone(badgeRows); } };
  app.services.leveling = {
    async settings() { return structuredClone(settings.leveling || {}); },
    async mapRoleReward(groupId, level, id) {
      settings.leveling ||= {};
      settings.leveling.roleRewards ||= {};
      settings.leveling.roleRewards[String(level)] = Number(id);
    },
    async mapBadgeReward(groupId, level, id) {
      settings.leveling ||= {};
      settings.leveling.badgeRewards ||= {};
      settings.leveling.badgeRewards[String(level)] = Number(id);
    },
    async createBadgeReward(groupId, level, badge) {
      badgeId += 1;
      const created = { id: badgeId, ...badge };
      badgeRows.push(created);
      await this.mapBadgeReward(groupId, level, badgeId);
      return created;
    },
    async syncAllRewards() { return { total: 0, succeeded: 0, failed: [], results: [] }; }
  };
  app.services.provisioning = new ProvisioningService({ app });
  app.services.supportTemplate = new SupportTemplateService({ app });

  const result = await app.services.supportTemplate.install({ groupId: 6875, userId: 25426 });
  assert.equal(Object.keys(result.roles).length, SupportTemplateService.ROLE_SPECS.length);
  assert.equal(Object.keys(result.channels).length, SupportTemplateService.CHANNEL_SPECS.length);
  assert.equal(sorted.roles.length, SupportTemplateService.ROLE_SPECS.length);
  assert.equal(sorted.channels.length, SupportTemplateService.CHANNEL_SPECS.length);
  assert.equal(settings.welcome.enabled, true);
  assert.equal(settings.tickets.enabled, true);
  assert.equal(settings.channels.welcome, String(result.channels.welcome));
  assert.equal(settings.channels.tickets, String(result.channels.support));
  assert.equal(settings.channels.system, String(result.channels.status));
  assert.ok(Number.isInteger(result.ticketPanelPostId));
  assert.equal(result.botUserId, 777);
  assert.equal(accessGrants.length, 0);
  assert.ok(channelRows.every((row) => String(row.write_plus_user_ids).split(',').includes('777')));
  assert.ok(channelRows.every((row) => String(row.read_plus_user_ids).split(',').includes('25426')));
  assert.ok(result.recoveredChannels.includes('ekip-sohbet'));
  assert.equal(result.verification.ok, true);
  assert.equal(settings.channels.ticketLogs, String(result.channels.ticketLogs));
  assert.equal(settings.channels.moderationLogs, String(result.channels.moderationLogs));
  assert.equal(settings.autorole.enabled, true);
  assert.deepEqual(settings.autorole.roleIds, [result.roles.member]);
  assert.equal(memberRoles.get(25426).includes(result.roles.admin), true);
  assert.equal(memberRoles.get(777).includes(result.roles.admin), true);
  assert.equal(result.levelRewards.created.length, SupportTemplateService.LEVEL_ROLE_SPECS.length);
  for (const spec of SupportTemplateService.LEVEL_ROLE_SPECS) {
    assert.equal(settings.leveling.roleRewards[String(spec.level)], result.roles[spec.key]);
    assert.ok(Number.isInteger(settings.leveling.badgeRewards[String(spec.level)]));
  }

  const state = await app.services.supportTemplate.readState(6875);
  assert.equal(state.status, 'completed');
  assert.equal(state.progress, 100);
  assert.equal(state.backupId, 'backup-1');

  hidePrivateChannels = true;
  app.services.channels.invalidate(6875);
  const hiddenVerification = await app.services.supportTemplate.verify(6875);
  assert.equal(hiddenVerification.ok, true);
  assert.ok(hiddenVerification.directlyResolvedChannels.includes(result.channels.logs));

  const channelCountBeforeRepair = channelRows.length;
  const repaired = await app.services.supportTemplate.repair({ groupId: 6875, userId: 25426 });
  assert.equal(repaired.verification.ok, true);
  assert.equal(channelRows.length, channelCountBeforeRepair);

  hidePrivateChannels = false;
  roleRows.push({ id: ++roleId, name: 'Eski Rol', color: '#000000', order: 999 });
  channelRows.push({ id: ++channelId, nick: 'eski-kanal', title: 'Eski Kanal', order: 999 });
  const oldRoleIds = roleRows.map((row) => Number(row.id));
  const oldChannelIds = channelRows.map((row) => Number(row.id));
  await assert.rejects(
    () => app.services.supportTemplate.rebuild({ groupId: 6875, userId: 25426, confirmation: 'yanlış' }),
    /TAM SIFIRLA/
  );
  assert.ok(oldRoleIds.every((id) => roleRows.some((row) => Number(row.id) === id)));
  assert.ok(oldChannelIds.every((id) => channelRows.some((row) => Number(row.id) === id)));

  const rebuilt = await app.services.supportTemplate.rebuild({
    groupId: 6875,
    userId: 25426,
    confirmation: 'TAM SIFIRLA'
  });
  assert.equal(rebuilt.rebuild.failedChannels.length, 0);
  assert.equal(rebuilt.rebuild.failedRoles.length, 0);
  assert.equal(rebuilt.rebuild.deletedChannels, oldChannelIds.length);
  assert.equal(rebuilt.rebuild.deletedRoles, oldRoleIds.length);
  assert.equal(oldChannelIds.some((id) => channelRows.some((row) => Number(row.id) === id)), false);
  assert.equal(oldRoleIds.some((id) => roleRows.some((row) => Number(row.id) === id)), false);
  assert.equal(rebuilt.levelRewards.created.length, SupportTemplateService.LEVEL_ROLE_SPECS.length);
  assert.equal(rebuilt.verification.ok, true);

  await assert.rejects(
    () => app.services.supportTemplate.install({ groupId: 6875, userId: 999 }),
    /yalnızca/
  );
});
