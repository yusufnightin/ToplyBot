const test = require('node:test');
const assert = require('node:assert/strict');
const ChannelResolverService = require('../src/services/ChannelResolverService');
const GroupSettingsService = require('../src/services/GroupSettingsService');
const MenuSettingsService = require('../src/services/MenuSettingsService');

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

function createServices() {
  const client = {
    async listChannels(groupId) {
      assert.equal(groupId, 6875);
      return {
        data: {
          channels: [
            { channel_id: 44366, name: 'genel' },
            { id: 44367, title: 'hoş-geldin' },
            { id: 44368, name: 'yönetim-log' }
          ]
        }
      };
    }
  };
  const app = { client, logger: { warn() {} }, services: {} };
  app.services.channels = new ChannelResolverService({ client, logger: app.logger, cacheTtlMs: 60000 });
  app.services.settings = new GroupSettingsService({ store: new MemoryStore({}), config: { features: {} } });
  app.services.audit = { async write() {} };
  app.services.menuSettings = new MenuSettingsService({ app });
  return app;
}

test('#kanaladı aynı sunucudaki kanal ID değerine çevrilir', async () => {
  const app = createServices();
  const channel = await app.services.channels.resolve(6875, '#hoş-geldin');
  assert.equal(channel.id, 44367);
  assert.equal(channel.name, 'hoş-geldin');
});

test('ayar paneli #kanaladı değerini çözüp yalnızca ilgili gruba kaydeder', async () => {
  const app = createServices();
  const result = await app.services.menuSettings.set(6875, 'channels.welcome', '#hoş-geldin', 1);
  assert.equal(result.value, '44367');
  assert.equal(result.resolvedChannel.name, 'hoş-geldin');
  const settings = await app.services.settings.get(6875);
  assert.equal(settings.channels.welcome, '44367');
  assert.equal(app.services.menuSettings.format('channels.welcome', settings.channels.welcome, { groupId: 6875 }), '#hoş-geldin · 44367');
  assert.equal(app.services.menuSettings.inputValue('channels.welcome', settings.channels.welcome, { groupId: 6875 }), '#hoş-geldin');
});

test('bulunamayan kanal adı açıklayıcı hata verir', async () => {
  const app = createServices();
  await assert.rejects(
    () => app.services.channels.resolve(6875, '#olmayan-kanal'),
    /bulunamadı/
  );
});

test('Topluyo kanal nesnesindeki data alanı kanal kimliğini kaybettirmez', async () => {
  const client = {
    async listChannels() {
      return {
        success: true,
        data: {
          0: { id: 9001, nick: 'destek', title: 'Destek Merkezi', type: 1, data: '' },
          1: { channel_id: 9002, nick: 'yonetim-log', title: 'Yönetim Logları', type: 1, data: '{"locked":true}' }
        }
      };
    }
  };
  const service = new ChannelResolverService({ client, logger: { warn() {} } });
  const channel = await service.resolve(6875, '#destek');
  assert.equal(channel.id, 9001);
  assert.equal(channel.nick, 'destek');
  const log = await service.resolve(6875, '#yonetim-log');
  assert.equal(log.id, 9002);
});

test('kanal listesinde eşleşme yoksa channel/show/info fallback kullanılır', async () => {
  const client = {
    async listChannels() { return { channels: [] }; },
    async getGroup() { return { id: 6875, nick: 'ornek-sunucu' }; },
    async getChannelByNick(payload) {
      assert.equal(payload.group_nick, 'ornek-sunucu');
      assert.equal(payload.channel_nick, 'hos-geldin');
      return { channel: { id: 9010, nick: 'hos-geldin', title: 'Hoş Geldin', data: '' } };
    }
  };
  const service = new ChannelResolverService({ client, logger: { warn() {} } });
  const channel = await service.resolve(6875, '#hos-geldin');
  assert.equal(channel.id, 9010);
});
