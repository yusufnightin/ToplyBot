const test = require('node:test');
const assert = require('node:assert/strict');
const { isCloudflareManagedChallenge } = require('../src/utils/cloudflare');

test('Cloudflare Managed Challenge yanıtını tanır', () => {
  assert.equal(isCloudflareManagedChallenge({
    statusCode: 403,
    server: 'cloudflare',
    body: `<title>Just a moment...</title><script>cType: 'managed'</script>`
  }), true);
});

test('normal 403 yanıtını Managed Challenge saymaz', () => {
  assert.equal(isCloudflareManagedChallenge({
    statusCode: 403,
    server: 'nginx',
    body: 'Forbidden'
  }), false);
});
