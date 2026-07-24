const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function loadWithWsStub(request, parent, isMain) {
  if (request === 'ws') {
    class WebSocketStub {}
    WebSocketStub.OPEN = 1;
    WebSocketStub.CONNECTING = 0;
    return WebSocketStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};
const TopluyoClient = require('../src/core/TopluyoClient');
Module._load = originalLoad;

test('native JTML ekleme bildirimi normal message olayına aktarılmaz', (t) => {
  const logs = [];
  const client = new TopluyoClient({
    token: '1234567890-test-token',
    apiBaseUrl: 'http://127.0.0.1:1/',
    logger: { info(message, detail) { logs.push({ message, detail }); }, warn() {}, error() {} }
  });
  t.after(() => client.apiQueue.close());

  let attachmentCount = 0;
  let messageCount = 0;
  client.on('bumote_attachment', () => { attachmentCount += 1; });
  client.on('message', () => { messageCount += 1; });

  const jtml = '~{"type":"box","children":[{"type":"bumote","name":"menu_action","value":"home","text":"Ana Menü"}]}';
  client.handleIncoming(`{"action":"post/bumote","message":${jtml},"channel_id":44,"post_id":71,"user_id":25}`);

  assert.equal(attachmentCount, 1);
  assert.equal(messageCount, 0);
  assert.equal(logs.some((entry) => entry.message.includes('ekleme bildirimi')), false);
});


test('bot kullanıcı ID önbelleğe alınır ve kanal erişim API alanları doğru gönderilir', async (t) => {
  const client = new TopluyoClient({
    token: '1234567890-test-token',
    apiBaseUrl: 'http://127.0.0.1:1/',
    logger: { info() {}, warn() {}, error() {} }
  });
  t.after(() => client.apiQueue.close());
  const calls = [];
  let activePermissionCalls = 0;
  let maxConcurrentPermissionCalls = 0;
  client.api = async (api, data) => {
    calls.push({ api, data });
    if (api === '/!api/user/id') return { id: 777 };
    activePermissionCalls += 1;
    maxConcurrentPermissionCalls = Math.max(maxConcurrentPermissionCalls, activePermissionCalls);
    await new Promise((resolve) => setTimeout(resolve, 2));
    activePermissionCalls -= 1;
    return { success: true };
  };

  assert.equal(await client.getCurrentUserId(), 777);
  assert.equal(await client.getCurrentUserId(), 777);
  await client.grantChannelAccess(44367, 777, { read: true, write: true, control: true });
  assert.equal(calls.filter((item) => item.api === '/!api/user/id').length, 1);
  assert.deepEqual(calls.slice(-3), [
    { api: '/!api/channel/options/set', data: { channel_id: 44367, add_write_plus_user_id: 777 } },
    { api: '/!api/channel/options/set', data: { channel_id: 44367, add_read_plus_user_id: 777 } },
    { api: '/!api/channel/options/set', data: { channel_id: 44367, add_control_plus_user_id: 777 } }
  ]);
  assert.equal(maxConcurrentPermissionCalls, 1);
});

test('post gönderirken metin kanal kimliğini sayıya dönüştürür', async (t) => {
  const client = new TopluyoClient({
    token: '1234567890-test-token',
    apiBaseUrl: 'http://127.0.0.1:1/',
    logger: { info() {}, warn() {}, error() {} }
  });
  t.after(() => client.apiQueue.close());
  let captured;
  client.api = async (api, data, options) => {
    captured = { api, data, options };
    return { success: true };
  };

  await client.sendPost('45795', 'Duyuru');

  assert.equal(captured.api, '/!api/post/add');
  assert.equal(captured.data.channel_id, 45795);
  assert.equal(typeof captured.data.channel_id, 'number');
});

test('sunucu adına göre arama ve katılma API alanları doğru gönderilir', async (t) => {
  const client = new TopluyoClient({
    token: '1234567890-test-token',
    apiBaseUrl: 'http://127.0.0.1:1/',
    logger: { info() {}, warn() {}, error() {} }
  });
  t.after(() => client.apiQueue.close());
  const calls = [];
  client.api = async (api, data, options) => {
    calls.push({ api, data, options });
    return { success: true };
  };

  await client.getGroupByNick('ornek-sunucu');
  await client.joinGroup(4321);

  assert.deepEqual(calls[0].api, '/!api/group/get');
  assert.deepEqual(calls[0].data, { nick: 'ornek-sunucu' });
  assert.deepEqual(calls[1], {
    api: '/!api/group/join',
    data: { group_id: 4321 },
    options: { priority: 'critical', flushImmediately: true }
  });
});
