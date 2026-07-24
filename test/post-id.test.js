const test = require('node:test');
const assert = require('node:assert/strict');
const { extractCreatedPostId } = require('../src/utils/api');

test('post ID farklı Topluyo cevap biçimlerinden çıkarılır', () => {
  assert.equal(extractCreatedPostId(700), 700);
  assert.equal(extractCreatedPostId('701'), 701);
  assert.equal(extractCreatedPostId({ post_id: 702 }), 702);
  assert.equal(extractCreatedPostId({ data: { result: { post: { id: '703' } } } }), 703);
  assert.equal(extractCreatedPostId([{ ok: true }, { response: { postId: 704 } }]), 704);
  assert.equal(extractCreatedPostId('Post ID: 705'), 705);
  assert.equal(extractCreatedPostId({ success: true }), null);
});
