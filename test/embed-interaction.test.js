const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const CommandRouter = require('../src/core/CommandRouter');
const PermissionManager = require('../src/core/PermissionManager');
const embedsPlugin = require('../src/plugins/embeds');

class MemoryStore {
  constructor(value) { this.value = structuredClone(value); }
  async read() { return structuredClone(this.value); }
  async update(mutator) {
    const next = await mutator(this.value);
    if (next !== undefined) this.value = next;
    return structuredClone(this.value);
  }
}

test('embed gönderimi native JTMLyi post metnine ekler ve etkileşimi kaydeder', async () => {
  const client = new EventEmitter();
  const sent = [];
  const attached = [];
  client.sendPost = async (channelId, text) => { sent.push({ channelId, text }); return { id: 321 }; };
  client.attachBumote = async (postId, code) => { attached.push({ postId, code }); return {}; };
  client.sendDirectMessage = async () => ({});

  const registered = [];
  const permissionManager = new PermissionManager({ ownerUserIds: [1] });
  const router = new CommandRouter({ prefix: '!', permissionManager, logger: { error() {} } });
  const app = {
    config: { prefix: '!', interactions: { autoGenerateBumote: true } },
    router,
    client,
    permissionManager,
    groupResolver: { resolve: () => 9 },
    logger: { error() {} },
    stores: { embeds: new MemoryStore({}) },
    services: {
      cards: { async createEmbedCard() { return { url: null }; } },
      interactions: { async register(value) { registered.push(value); } }
    }
  };
  embedsPlugin.setup(app);

  const run = async (message) => {
    router.cooldowns.clear();
    await router.handle({ action: 'post/add', message, user_id: 1, channel_id: 10, group_id: 9 }, app);
  };
  await run('!embed oluştur panel | Kontrol Paneli | Bir işlem seçin');
  await run('!embed buton panel Yardım | komut | yardım');
  await run('!embed gönder panel 10');

  assert.equal(registered.length, 1);
  assert.equal(registered[0].postId, 321);
  assert.equal(registered[0].actions[0].type, 'command');
  const embedPost = sent.find((item) => item.text.includes('Kontrol Paneli') && item.text.includes('~{'));
  assert.ok(embedPost);
  assert.match(embedPost.text, /"name":"action_id"/);
  assert.match(embedPost.text, /"value":"yardım"/);
  assert.equal(attached.length, 1);
  assert.equal(attached[0].postId, 321);
  assert.match(attached[0].code, /"value":"yardım"/);
});
