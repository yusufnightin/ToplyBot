const path = require('node:path');
const { EventEmitter } = require('node:events');
const CommandRouter = require('../src/core/CommandRouter');
const PermissionManager = require('../src/core/PermissionManager');
const PluginManager = require('../src/core/PluginManager');
const GroupSettingsService = require('../src/services/GroupSettingsService');

class MemoryStore {
  constructor(value) { this.value = structuredClone(value); }
  async read() { return structuredClone(this.value); }
  async update(mutator) { const next = await mutator(this.value); if (next !== undefined) this.value = next; return structuredClone(this.value); }
}

const client = new EventEmitter();
for (const method of ['api', 'sendPost', 'sendDirectMessage', 'kickMember', 'deletePost', 'listPosts', 'createChannel', 'deleteChannel', 'createRole', 'deleteRole', 'listMembers', 'listOnline', 'listChannels', 'listRoles', 'getGroup', 'getUser', 'attachBumote']) client[method] = async () => ({});
const permissionManager = new PermissionManager({ ownerUserIds: [1] });
const router = new CommandRouter({ prefix: '!', permissionManager, logger: { error() {} } });
const stores = {};
for (const name of ['tickets', 'transfers', 'registrations', 'sanctions', 'audit', 'bans', 'tempRoles', 'giveaways', 'polls', 'rolePanels', 'ticketPanels', 'automations', 'webhooks', 'feeds', 'statistics', 'interactions', 'liveStreams']) stores[name] = new MemoryStore([]);
for (const name of ['levels', 'customCommands', 'embeds']) stores[name] = new MemoryStore({});
const app = {
  config: {
    prefix: '!',
    channels: {},
    features: {},
    liveStreams: {
      defaultMention: '@millet',
      defaultPollMinutes: 3
    }
  }, router, client, permissionManager,
  groupResolver: { resolve: () => 1 }, logger: { info() {}, error() {}, warn() {} }, stores,
  services: {
    settings: { async get() { return structuredClone(GroupSettingsService.DEFAULTS); }, async set() {} },
    scheduler: { register() {} }, cards: { async createWelcomeCard() { return { url: null }; }, async createRankCard() { return { url: null }; }, async createEmbedCard() { return { url: null }; } },
    roles: { async applyAutorole() {}, async removeMemberRoles() { return []; }, async addMemberRoles() { return []; }, async memberRoleIds() { return []; }, async list() { return []; }, async roleNameMap() { return new Map(); } },
    warnings: { async add() { return { id: 1 }; }, async list() { return []; }, async remove() { return 0; } }, audit: { async write() {} }, interactions: { async handle() {}, async list() { return []; }, async getByPostId() { return null; }, async setActive() {}, async register() {} }
  }
};
const plugins = ['core', 'settings', 'roles', 'welcome', 'moderation', 'registration', 'leveling', 'giveaway', 'polls', 'support', 'customCommands', 'automation', 'social', 'liveStreams', 'statistics', 'interactions', 'embeds', 'turbo', 'admin', 'apiManagement', 'system'];
new PluginManager({ app, pluginDirectory: path.join(__dirname, '..', 'src', 'plugins') }).load(plugins);
const groups = new Map();
for (const command of [...router.commands.values()].sort((a, b) => a.category.localeCompare(b.category, 'tr') || a.name.localeCompare(b.name, 'tr'))) {
  if (!groups.has(command.category)) groups.set(command.category, []);
  groups.get(command.category).push(command);
}
let output = '# Komut Referansı\n\n';
output += `Toplam **${router.commands.size}** ana komut vardır. Takma adlar bu sayıya dahil değildir. Kanala yalnızca \`!\` gönderildiğinde JTML Command Center otomatik açılır.\n\n`;
for (const [category, commands] of groups) {
  output += `## ${category}\n\n`;
  for (const command of commands) output += `- \`!${command.usage}\` — ${command.description} — yetki: **${command.requiredPermission}**\n`;
  output += '\n';
}
require('node:fs').writeFileSync(path.join(__dirname, '..', 'COMMANDS.md'), output);
console.log(`${router.commands.size} komut COMMANDS.md dosyasına yazıldı.`);
