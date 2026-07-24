const test = require('node:test');
const assert = require('node:assert/strict');
const PermissionManager = require('../src/core/PermissionManager');
const InteractionService = require('../src/services/InteractionService');
const { buildButtonBumote } = require('../src/utils/bumote');

class MemoryStore {
  constructor(value) { this.value = structuredClone(value); }
  async read() { return structuredClone(this.value); }
  async update(mutator) {
    const next = await mutator(this.value);
    if (next !== undefined) this.value = next;
    return structuredClone(this.value);
  }
}

function createApp() {
  const sentPosts = [];
  const sentDms = [];
  const commands = [];
  const roleSets = new Map();
  const app = {
    config: { prefix: '!' },
    permissionManager: new PermissionManager({ ownerUserIds: [1], adminUserIds: [2] }),
    logger: { error() {} },
    client: {
      async sendPost(channelId, text) { sentPosts.push({ channelId, text }); },
      async sendDirectMessage(userId, text) { sentDms.push({ userId, text }); }
    },
    router: {
      async handle(message) { commands.push(message); return true; }
    },
    services: {
      roles: {
        async memberRoleIds(groupId, userId) { return [...(roleSets.get(`${groupId}:${userId}`) || [])]; },
        async addMemberRoles(groupId, userId, ids) {
          const key = `${groupId}:${userId}`;
          roleSets.set(key, [...new Set([...(roleSets.get(key) || []), ...ids])]);
        },
        async removeMemberRoles(groupId, userId, ids) {
          const key = `${groupId}:${userId}`;
          roleSets.set(key, (roleSets.get(key) || []).filter((id) => !ids.includes(id)));
        }
      },
      audit: { async write() {} }
    }
  };
  return { app, sentPosts, sentDms, commands, roleSets };
}

test('Bumote tıklaması kayıtlı komutu çalıştırır', async () => {
  const { app, commands } = createApp();
  const store = new MemoryStore([]);
  const service = new InteractionService({ store, app });
  await service.register({
    postId: 55,
    groupId: 9,
    channelId: 10,
    actions: [{ id: 'yardim', label: 'Yardım', type: 'command', target: 'yardım', requiredPermission: 'member' }]
  });

  const handled = await service.handle({
    action: 'post/bumote',
    post_id: 55,
    user_id: 8,
    message: { form: { action_id: 'yardim' }, submit: 'Yardım' }
  });

  assert.equal(handled, true);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].message, '!yardım');
  assert.equal(commands[0].group_id, 9);
  assert.equal(commands[0].channel_id, 10);
});

test('rol toggle eylemi rolü ekler ve ikinci tıklamada kaldırır', async () => {
  const { app, roleSets } = createApp();
  const store = new MemoryStore([]);
  const service = new InteractionService({ store, app });
  await service.register({
    postId: 99,
    groupId: 5,
    channelId: 6,
    actions: [{ id: 'mavi', label: 'Mavi', type: 'role_toggle', target: '77' }]
  });
  const event = { action: 'post/bumote', post_id: 99, user_id: 12, message: { form: { action_id: 'mavi' } } };
  await service.handle(event);
  assert.deepEqual(roleSets.get('5:12'), [77]);
  service.cooldowns.clear();
  await service.handle(event);
  assert.deepEqual(roleSets.get('5:12'), []);
});

test('tek kullanımlık etkileşim kullanım sayısını bir kez artırır', async () => {
  const { app } = createApp();
  const store = new MemoryStore([]);
  const service = new InteractionService({ store, app });
  await service.register({
    postId: 7,
    groupId: 1,
    channelId: 2,
    actions: [{ id: 'al', label: 'Al', type: 'reply', target: 'Tamam {userId}', cooldownMs: 0 }],
    options: { oneUsePerUser: true }
  });
  const event = { action: 'post/bumote', post_id: 7, user_id: 4, message: { form: { action_id: 'al' } } };
  await service.handle(event);
  await service.handle(event);
  const record = await service.getByPostId(7);
  assert.equal(record.uses, 1);
  assert.deepEqual(record.usedBy, [4]);
});

test('Bumote buton kodu native JTML action_id alanı üretir', () => {
  const code = buildButtonBumote([{ id: 'rol-mavi', label: 'Mavi Rol', disabled: false }]);
  assert.match(code, /^~\{/);
  assert.match(code, /"type":"bumote"/);
  assert.match(code, /"name":"action_id"/);
  assert.match(code, /"value":"rol-mavi"/);
  assert.match(code, /"text":"Mavi Rol"/);
  assert.doesNotMatch(code, /<form|<button/i);
});

test('aynı isimli Bumote düğmelerinde submit değeri ezilmiş form alanından önce kullanılır', async () => {
  const { app, commands } = createApp();
  const store = new MemoryStore([]);
  const service = new InteractionService({ store, app });
  await service.register({
    postId: 155,
    groupId: 9,
    channelId: 10,
    actions: [
      { id: 'yardim', label: 'Yardım', type: 'command', target: 'yardım' },
      { id: 'kapat', label: 'Kapat', type: 'reply', target: 'Kapandı' }
    ]
  });

  const handled = await service.handle({
    action: 'post/bumote',
    post_id: 155,
    user_id: 8,
    message: {
      submit: 'yardim',
      form: { action_id: 'Kapat' }
    }
  });

  assert.equal(handled, true);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].message, '!yardım');
});
