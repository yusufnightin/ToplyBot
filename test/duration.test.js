const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDuration, formatDuration } = require('../src/utils/duration');

test('Türkçe ve kısa süre ifadelerini çözümler', () => {
  assert.equal(parseDuration('10m'), 600000);
  assert.equal(parseDuration('2sa30dk'), 9000000);
  assert.equal(parseDuration('1g'), 86400000);
  assert.equal(parseDuration('bozuk'), null);
  assert.equal(formatDuration(9000000), '2 saat 30 dk');
});
