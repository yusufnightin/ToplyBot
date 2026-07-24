const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPanel,
  collect,
  panelPostIdFromList,
  parseOnlinePresence,
  recoverPanelPostId
} = require('../src/plugins/statistics');

test('canlı istatistik paneli dört metriği iki dengeli ikili satırda gösterir', () => {
  const panel = buildPanel({
    groupName: 'Test Sunucusu',
    members: 120,
    online: 48,
    voice: 8,
    activityPercent: 40,
    updatedAt: new Date('2026-07-25T10:00:00.000Z')
  });
  const tree = JSON.parse(panel.jtmlCode.slice(1));
  const metricRows = tree.children.filter((node) => node.type === 'flex-x' && node.ui === 'flex-x');

  assert.equal(metricRows.length, 2);
  assert.equal(metricRows[0].children.length, 2);
  assert.equal(metricRows[1].children.length, 2);
  assert.equal(metricRows[0].children.every((cell) => cell.ui === 'space'), true);
  assert.match(panel.jtmlCode, /ToplyBot ♥ Topluyo/);
});

test('istatistik paneli post ID değerini kanal listesinden kurtarır', async () => {
  const response = {
    posts: [
      { id: 40, text: 'normal gönderi' },
      { post_id: '41', text: '## 📊 Test — CANLI SUNUCU İSTATİSTİKLERİ' }
    ]
  };
  assert.equal(panelPostIdFromList(response), 41);

  const calls = [];
  const client = {
    async api(path, payload, options) {
      calls.push({ path, payload, options });
      return response;
    }
  };
  assert.equal(await recoverPanelPostId(client, 45875, { attempts: 1 }), 41);
  assert.equal(calls[0].path, '/!api/post/list');
  assert.equal(calls[0].payload.channel_id, 45875);
  assert.equal(calls[0].options.cacheTtlMs, 0);
});

test('Topluyo çevrimiçi ve ses bilgisini kullanıcı-kanal cevabından ayırır', () => {
  const result = parseOnlinePresence({
    status: 'success',
    data: '25426-46422,25469,25426-46422'
  });

  assert.deepEqual(result.onlineUserIds, [25426, 25469]);
  assert.deepEqual(result.voiceUserIds, [25426]);
  assert.equal(result.online, 2);
  assert.equal(result.voice, 1);
});

test('canlı istatistikler yalnızca gerekli dört değeri toplar', async () => {
  const app = {
    client: {
      async listMembers() {
        return { data: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] };
      },
      async listOnline() {
        return { data: '1-800,2' };
      },
      async getGroup() {
        return { data: { name: 'Test Sunucusu' } };
      }
    }
  };

  const result = await collect(app, 6875);
  assert.equal(result.groupName, 'Test Sunucusu');
  assert.equal(result.members, 4);
  assert.equal(result.online, 2);
  assert.equal(result.voice, 1);
  assert.equal(result.activityPercent, 50);
  assert.deepEqual(Object.keys(result).sort(), [
    'activityPercent', 'groupName', 'members', 'online', 'updatedAt', 'voice'
  ]);
});

test('istatistik panelinde fazladan ölçü gösterilmez', () => {
  const panel = buildPanel({
    groupName: 'Test Sunucusu',
    members: 4,
    online: 2,
    voice: 1,
    activityPercent: 50,
    updatedAt: new Date('2026-07-25T10:00:00.000Z')
  });

  for (const label of ['Toplam Üye', 'Çevrimiçi', 'Sesteki Kişi', 'Aktiflik Oranı']) {
    assert.match(`${panel.text}\n${panel.jtmlCode}`, new RegExp(label));
  }
  assert.doesNotMatch(
    `${panel.text}\n${panel.jtmlCode}`,
    /Gerçek Üye|🤖 \*\*Bot:|📁 \*\*Kanal:|🎭 \*\*Rol:|"text":"🤖 Bot"|"text":"📁 Kanal"|"text":"🎭 Rol"/
  );
});
