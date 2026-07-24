const test = require('node:test');
const assert = require('node:assert/strict');
const BackupService = require('../src/services/BackupService');

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

test('sunucuya özel ayar ve veriler yedeklenip diğer sunucuyu etkilemeden geri yüklenir', async () => {
  const settingsByGroup = {
    '1': { channels: { welcome: '10' }, welcome: { enabled: true } },
    '2': { channels: { welcome: '20' }, welcome: { enabled: true } }
  };
  const stores = {
    backups: new MemoryStore([]),
    tickets: new MemoryStore([{ id: 1, groupId: 1, subject: 'A' }, { id: 2, groupId: 2, subject: 'B' }]),
    customCommands: new MemoryStore({ '1:test': { name: 'test' }, '2:test': { name: 'test2' } })
  };
  const app = {
    stores,
    services: {
      settings: {
        async get(groupId) { return structuredClone(settingsByGroup[String(groupId)]); },
        async replace(groupId, value) { settingsByGroup[String(groupId)] = structuredClone(value); return value; }
      },
      audit: { async write() {} },
      channels: { invalidate() {} }
    }
  };
  const service = new BackupService({ app, maxPerGroup: 5 });
  const backup = await service.create(1, { actorUserId: 99, label: 'ilk' });
  settingsByGroup['1'].channels.welcome = '999';
  stores.tickets.value = stores.tickets.value.filter((item) => item.groupId !== 1);
  stores.customCommands.value['1:test'].name = 'bozuk';

  await service.restore(1, backup.id, { actorUserId: 99, createSafetyBackup: false });
  assert.equal(settingsByGroup['1'].channels.welcome, '10');
  assert.equal(settingsByGroup['2'].channels.welcome, '20');
  assert.equal((await stores.tickets.read()).find((item) => item.groupId === 1).subject, 'A');
  assert.equal((await stores.tickets.read()).find((item) => item.groupId === 2).subject, 'B');
  assert.equal((await stores.customCommands.read())['1:test'].name, 'test');
  assert.equal((await stores.customCommands.read())['2:test'].name, 'test2');
});
