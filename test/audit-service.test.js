const test = require('node:test');
const assert = require('node:assert/strict');
const AuditService = require('../src/services/AuditService');

class MemoryStore {
  constructor(value = []) { this.value = structuredClone(value); }
  async update(mutator) {
    const next = await mutator(this.value);
    if (next !== undefined) this.value = next;
    return structuredClone(this.value);
  }
}

test('ticket, moderasyon ve sistem denetimleri kendi log kanallarına yönlendirilir', async () => {
  const sent = [];
  const service = new AuditService({
    store: new MemoryStore(),
    settings: {
      async get() {
        return {
          channels: {
            logs: '100',
            ticketLogs: '101',
            moderationLogs: '102',
            system: '103'
          }
        };
      }
    },
    client: {
      async sendPost(channelId, text) {
        sent.push({ channelId: String(channelId), text });
        return { success: true };
      }
    },
    logger: { info() {}, error() {} }
  });

  const ticket = await service.write('ticket.open', { targetUserId: 1 }, { groupId: 6875 });
  await service.write('moderation.ban', { targetUserId: 2 }, { groupId: 6875 });
  await service.write('role.add', { targetUserId: 2, roleIds: [55] }, { groupId: 6875 });
  await service.write('system.repair', { actorUserId: 3 }, { groupId: 6875 });
  await service.write('level.up', { targetUserId: 4 }, { groupId: 6875 });

  assert.deepEqual(sent.map((item) => item.channelId), ['101', '102', '102', '100', '100']);
  assert.deepEqual(ticket.delivery, { status: 'sent', channelId: 101, repaired: false });
  assert.match(sent[0].text, /Ticket açıldı/);
  assert.match(sent[0].text, /Hedef: #1/);
});

test('API hata cevabı başarı sanılmaz ve kanal izni onarıldıktan sonra log yeniden gönderilir', async () => {
  const sent = [];
  const grants = [];
  const service = new AuditService({
    store: new MemoryStore(),
    settings: { async get() { return { channels: { logs: '100' } }; } },
    client: {
      async sendPost(channelId, text) {
        sent.push({ channelId, text });
        return sent.length === 1
          ? { status: 'error', message: 'permission denied' }
          : { status: 'success' };
      },
      async getCurrentUserId() { return 999; },
      async grantChannelAccess(channelId, userId, options) {
        grants.push({ channelId, userId, options });
        return { status: 'success' };
      }
    },
    logger: { info() {}, error() {} }
  });

  const entry = await service.write('system.log_test', { actorUserId: 7 }, { groupId: 6875 });

  assert.equal(sent.length, 2);
  assert.deepEqual(grants, [{
    channelId: 100,
    userId: 999,
    options: { read: true, write: true, control: false }
  }]);
  assert.deepEqual(entry.delivery, { status: 'sent', channelId: 100, repaired: true });
});

test('özel log kanalı çalışmazsa genel log kanalı yedek olarak kullanılır', async () => {
  const sent = [];
  const service = new AuditService({
    store: new MemoryStore(),
    settings: {
      async get() {
        return { channels: { logs: '100', ticketLogs: '101' } };
      }
    },
    client: {
      async sendPost(channelId) {
        sent.push(channelId);
        return Number(channelId) === 101
          ? { status: 'error', message: 'permission denied' }
          : { status: 'success' };
      },
      async getCurrentUserId() { throw new Error('bot id alınamadı'); },
      async grantChannelAccess() {}
    },
    logger: { info() {}, error() {} }
  });

  const entry = await service.write('ticket.open', { targetUserId: 8 }, { groupId: 6875 });

  assert.deepEqual(sent, [101, 100]);
  assert.deepEqual(entry.delivery, { status: 'sent', channelId: 100, repaired: false });
});

test('log kanalı ayarlanmamışsa test edilebilir durum döndürür', async () => {
  const service = new AuditService({
    store: new MemoryStore(),
    settings: { async get() { return { channels: {} }; } },
    client: { async sendPost() { throw new Error('çağrılmamalı'); } },
    logger: { info() {}, error() {} }
  });

  const entry = await service.write('system.log_test', {}, { groupId: 6875 });
  assert.deepEqual(entry.delivery, { status: 'unconfigured', channelId: null });
});
