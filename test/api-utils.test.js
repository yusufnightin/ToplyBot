const test = require('node:test');
const assert = require('node:assert/strict');
const { unwrapApiResult, findArray } = require('../src/utils/api');

test('kendi data alanı bulunan kanal nesnesi API zarfı sanılarak parçalanmaz', () => {
  const channel = { id: 44366, nick: 'genel', title: 'Genel', data: '' };
  assert.deepEqual(unwrapApiResult(channel), channel);
});

test('API zarfındaki kanal listesi yine doğru biçimde açılır', () => {
  const response = { success: true, data: { channels: [{ id: 1, nick: 'genel', data: '' }] } };
  assert.deepEqual(findArray(response, ['channels']), [{ id: 1, nick: 'genel', data: '' }]);
});
