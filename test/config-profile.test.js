const test = require('node:test');
const assert = require('node:assert/strict');
const { applyPluginProfile } = require('../src/config');

test('management profili eğlence eklentilerini otomatik çıkarır', () => {
  const config = applyPluginProfile({
    pluginProfile: 'management',
    plugins: ['core', 'moderation', 'economy', 'leveling', 'giveaway', 'polls', 'social', 'turbo', 'invites']
  });
  assert.deepEqual(config.plugins, ['core', 'settings', 'welcome', 'apiManagement', 'system', 'leveling', 'liveStreams', 'moderation']);
});

test('custom profili seçilen eklentileri korur ve kaldırılmış ekonomi/davet eklentilerini yok sayar', () => {
  const config = applyPluginProfile({
    pluginProfile: 'custom',
    plugins: ['core', 'economy', 'invites', 'giveaway']
  });
  assert.deepEqual(config.plugins, ['core', 'giveaway']);
});
