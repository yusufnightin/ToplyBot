const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const CommandRouter = require('../src/core/CommandRouter');
const PermissionManager = require('../src/core/PermissionManager');
const PluginManager = require('../src/core/PluginManager');
const GroupSettingsService = require('../src/services/GroupSettingsService');

class MemoryStore {
  constructor(value) { this.value = structuredClone(value); }
  async read() { return structuredClone(this.value); }
  async update(mutator) {
    const next = await mutator(this.value);
    if (next !== undefined) this.value = next;
    return structuredClone(this.value);
  }
}

test('tüm profesyonel eklentiler çakışmadan yüklenir', async () => {
  const client = new EventEmitter();
  for (const method of ['api', 'sendPost', 'sendDirectMessage', 'kickMember', 'deletePost', 'listPosts', 'createChannel', 'deleteChannel', 'createRole', 'deleteRole', 'listMembers', 'listOnline', 'listChannels', 'listRoles', 'getGroup', 'getUser', 'attachBumote']) {
    client[method] = async () => ({});
  }

  const permissionManager = new PermissionManager({ ownerUserIds: [1] });
  const router = new CommandRouter({ prefix: '!', permissionManager, logger: { error() {} } });
  const settings = structuredClone(GroupSettingsService.DEFAULTS);
  settings.welcome.enabled = false;
  settings.leave.enabled = false;
  settings.autorole.enabled = false;
  settings.moderation.enabled = false;
  settings.leveling.enabled = false;

  const stores = {};
  for (const name of ['tickets', 'transfers', 'registrations', 'sanctions', 'audit', 'bans', 'tempRoles', 'giveaways', 'polls', 'rolePanels', 'ticketPanels', 'automations', 'webhooks', 'feeds', 'liveStreams', 'statistics', 'interactions', 'backups']) stores[name] = new MemoryStore([]);
  for (const name of ['levels', 'customCommands', 'embeds', 'templateInstallations', 'maintenanceState']) stores[name] = new MemoryStore({});

  const app = {
    config: { prefix: '!', channels: {}, features: {} },
    router,
    client,
    permissionManager,
    groupResolver: { resolve: () => 1 },
    logger: { info() {}, error() {}, warn() {} },
    stores,
    services: {
      settings: { async get() { return structuredClone(settings); }, async set() {} },
      scheduler: { register() {} },
      cards: { async createWelcomeCard() { return { url: null }; }, async createRankCard() { return { url: null }; }, async createEmbedCard() { return { url: null }; } },
      roles: { async applyAutorole() {}, async removeMemberRoles() { return []; }, async addMemberRoles() { return []; }, async memberRoleIds() { return []; }, async list() { return []; }, async roleNameMap() { return new Map(); } },
      warnings: { async add() { return { id: 1 }; }, async list() { return []; }, async remove() { return 0; } },
      audit: { async write() {} },
      interactions: { async handle() {}, async list() { return []; }, async getByPostId() { return null; }, async setActive() {}, async register() {} }
    }
  };

  const plugins = ['core', 'settings', 'roles', 'welcome', 'moderation', 'registration', 'leveling', 'giveaway', 'polls', 'support', 'customCommands', 'automation', 'social', 'liveStreams', 'statistics', 'interactions', 'embeds', 'turbo', 'admin', 'apiManagement', 'system'];
  const manager = new PluginManager({ app, pluginDirectory: path.join(__dirname, '..', 'src', 'plugins') });
  manager.load(plugins);

  assert.ok(router.commands.size >= 80);
  assert.equal(manager.loaded.size, plugins.length);
});
