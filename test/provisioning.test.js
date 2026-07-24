const test = require('node:test');
const assert = require('node:assert/strict');
const ProvisioningService = require('../src/services/ProvisioningService');
const ChannelResolverService = require('../src/services/ChannelResolverService');
const RoleService = require('../src/services/RoleService');

function createApp() {
  const channels = [];
  const roles = [];
  let channelId = 500;
  let roleId = 700;
  const client = {
    async listChannels() { return { success: true, data: { channels } }; },
    async createChannel(payload) {
      channelId += 1;
      channels.push({ ...payload, id: channelId });
      return { success: true, message: 'created' };
    },
    async api(path, payload) {
      if (path === '/!api/role/list') return { roles };
      throw new Error(`unexpected ${path} ${JSON.stringify(payload)}`);
    },
    async createRole(payload) {
      roleId += 1;
      roles.push({ ...payload, id: roleId });
      return `Rol oluşturuldu: role_id=${roleId}`;
    }
  };
  const app = { client, logger: { info() {}, warn() {} }, services: {} };
  app.services.channels = new ChannelResolverService({ client, logger: app.logger, cacheTtlMs: 5000 });
  app.services.roles = new RoleService({ client, logger: app.logger });
  app.services.provisioning = new ProvisioningService({ app });
  return { app, channels, roles };
}

test('ID içermeyen başarılı kanal cevabı channel/list üzerinden kurtarılır', async () => {
  const { app } = createApp();
  const result = await app.services.provisioning.ensureChannel({
    groupId: 1,
    spec: { nick: 'ekip-sohbet', title: '🛡️ Ekip Sohbeti' },
    payload: { group_id: 1, nick: 'ekip-sohbet', title: '🛡️ Ekip Sohbeti', data: '' }
  });
  assert.equal(result.id, 501);
  assert.equal(result.created, true);
  assert.equal(result.recovered, true);
});

test('metin cevabındaki rol ID değeri doğrudan çıkarılır', async () => {
  const { app } = createApp();
  const result = await app.services.provisioning.ensureRole({
    groupId: 1,
    spec: { name: 'Destek Ekibi' },
    payload: { group_id: 1, name: 'Destek Ekibi', color: '#000000' }
  });
  assert.equal(result.id, 701);
  assert.equal(result.recovered, false);
});

test('kanal listesinde görünmeyen özel kanal kayıtlı ID üzerinden doğrulanır ve yeniden oluşturulmaz', async () => {
  let createCalls = 0;
  const client = {
    async listChannels() { return { channels: [] }; },
    async getChannel(channelId) {
      return {
        channel: {
          id: Number(channelId),
          group_id: 6875,
          nick: 'yonetim-log',
          title: '📋 Sistem Logları',
          data: ''
        }
      };
    },
    async createChannel() {
      createCalls += 1;
      return { status: 'error', data: 0, message: 'same channel error' };
    },
    async api(path) {
      if (path === '/!api/role/list') return { roles: [] };
      throw new Error(`unexpected ${path}`);
    }
  };
  const app = { client, logger: { info() {}, warn() {} }, services: {} };
  app.services.channels = new ChannelResolverService({ client, logger: app.logger, cacheTtlMs: 5000 });
  app.services.roles = new RoleService({ client, logger: app.logger });
  app.services.provisioning = new ProvisioningService({ app });

  const result = await app.services.provisioning.ensureChannel({
    groupId: 6875,
    knownId: 45803,
    spec: { nick: 'yonetim-log', title: '📋 Sistem Logları' },
    payload: { group_id: 6875, nick: 'yonetim-log', title: '📋 Sistem Logları', data: '' }
  });

  assert.equal(result.id, 45803);
  assert.equal(result.created, false);
  assert.equal(result.recovered, true);
  assert.equal(result.persisted, true);
  assert.equal(createCalls, 0);
});

test('aynı gruptaki iki provisioning işlemi kilitle sıralanır', async () => {
  const { app } = createApp();
  const order = [];
  await Promise.all([
    app.services.provisioning.withGroupLock(9, async () => {
      order.push('a-start');
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('a-end');
    }),
    app.services.provisioning.withGroupLock(9, async () => {
      order.push('b-start');
      order.push('b-end');
    })
  ]);
  assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end']);
});
