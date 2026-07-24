const test = require('node:test');
const assert = require('node:assert/strict');
const ApiManagementService = require('../src/services/ApiManagementService');

test('sunucu özeti resmî API kaynaklarını paralel birleştirir', async () => {
  const app = {
    client: {
      async getGroup() { return { data: { id: 9, name: 'Destek' } }; },
      async getGroupFounder() { return { id: 1, name: 'Yusuf' }; },
      async listMembers() { return { data: [{ id: 1 }, { id: 2 }] }; },
      async listOnline() { return { data: [1] }; },
      async listJoinRequests() { return { data: [{ id: 3 }] }; },
      async listBadges() { return { data: [{ id: 4 }] }; },
      async listCrews() { return { data: [{ id: 5 }] }; },
      async listTeams() { return { data: [{ id: 6 }] }; }
    },
    services: {
      channels: { async list() { return [{ id: 10 }]; } },
      roles: { async list() { return [{ id: 20 }, { id: 21 }]; } }
    }
  };
  const service = new ApiManagementService({ app });
  const result = await service.groupSummary(9);
  assert.equal(result.channels.length, 1);
  assert.equal(result.roles.length, 2);
  assert.equal(result.members.length, 2);
  assert.equal(result.online.length, 1);
  assert.equal(result.waiters.length, 1);
  assert.equal(result.badges.length, 1);
});

test('rol şablonları beklenen güçleri üretir', () => {
  const service = new ApiManagementService({ app: {} });
  assert.equal(service.rolePreset('admin').power_group, 1);
  assert.equal(service.rolePreset('moderator').power_member, 1);
  assert.equal(service.rolePreset('member').power_post || 0, 0);
});

test('kanal kopyalama bütün resmî izin alanlarını korur ve yeni kimliği provisioning ile alır', async () => {
  let captured = null;
  const app = {
    client: {
      async getChannel() {
        return { data: { id: 10, nick: 'kaynak', title: 'Kaynak', type: 2, read_role_ids: '-1,0', write_role_ids: '7', control_role_ids: '8', write_plus_user_ids: '99' } };
      }
    },
    services: {
      channels: {
        async resolve() { return { id: 10, nick: 'kaynak', title: 'Kaynak', raw: {} }; },
        invalidate() {}
      },
      provisioning: {
        async ensureChannel(input) { captured = input; return { id: 11, created: true }; }
      }
    }
  };
  const service = new ApiManagementService({ app });
  const result = await service.cloneChannel(5, '#kaynak', { nick: 'kopya', title: 'Kopya Kanal' });
  assert.equal(result.id, 11);
  assert.equal(captured.payload.group_id, 5);
  assert.equal(captured.payload.nick, 'kopya');
  assert.equal(captured.payload.write_role_ids, '7');
  assert.equal(captured.payload.control_role_ids, '8');
  assert.equal(captured.payload.write_plus_user_ids, '99');
  assert.equal(captured.payload.channel_id, undefined);
});

test('bekleyen kullanıcılar toplu batch işleminde başarı ve API hatası ayrı raporlanır', async () => {
  const requests = [];
  const app = {
    client: {
      async listJoinRequests() { return { data: [{ id: 7 }, { id: 8 }] }; },
      async api(endpoint, data, options) {
        requests.push({ endpoint, data, options });
        return data.user_id === 8 ? { error: 'reddedildi' } : { success: true };
      }
    }
  };
  const service = new ApiManagementService({ app });
  const result = await service.bulkWaiterAction(9, 'kabul', 25);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].endpoint, '/!api/member/waiter/accept');
  assert.equal(requests[0].options.priority, 'high');
  assert.deepEqual(result.succeeded, [7]);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].userId, 8);
});
