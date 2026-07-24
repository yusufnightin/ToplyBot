const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const ApiBatchQueue = require('../src/core/ApiBatchQueue');

test('API isteklerini tek batch halinde gönderir', async (t) => {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      requests.push({ authorization: request.headers.authorization, body: JSON.parse(body) });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: { 0: { ok: 1 }, 1: { ok: 2 } } }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();

  const queue = new ApiBatchQueue({
    token: 'test-token',
    baseUrl: `http://127.0.0.1:${address.port}/`,
    flushIntervalMs: 20,
    maxBatchSize: 10,
    timeoutMs: 1000
  });
  t.after(() => queue.close());

  const [first, second] = await Promise.all([
    queue.request('/!api/test/time', {}),
    queue.request('/!api/public/search', { text: 'bot' })
  ]);

  assert.deepEqual(first, { ok: 1 });
  assert.deepEqual(second, { ok: 2 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].authorization, 'Bearer test-token');
  assert.equal(requests[0].body.length, 2);
});

test('HTTP 429 alan yazma isteği Retry-After süresinden sonra kaybolmadan yeniden denenir', async (t) => {
  let httpCalls = 0;
  const server = http.createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      httpCalls += 1;
      if (httpCalls === 1) {
        response.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': '0.02'
        });
        response.end(JSON.stringify({ status: 'error', data: null, message: 'rate limit over' }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: [{ success: true, channel_id: 45803 }] }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const queue = new ApiBatchQueue({
    token: 'test-token',
    baseUrl: `http://127.0.0.1:${server.address().port}/`,
    flushIntervalMs: 1,
    timeoutMs: 1000,
    rateLimitRetryAttempts: 3,
    rateLimitBaseDelayMs: 25,
    rateLimitMaxDelayMs: 100
  });
  t.after(() => queue.close());

  const result = await queue.request('/!api/channel/add', {
    group_id: 6875,
    nick: 'yonetim-log'
  }, { flushImmediately: true });

  assert.deepEqual(result, { success: true, channel_id: 45803 });
  assert.equal(httpCalls, 2);
  assert.equal(queue.getMetrics().rateLimits, 1);
  assert.equal(queue.getMetrics().retries, 1);
});

test('HTTP 200 içindeki rate limit sonucu da yalnızca etkilenen satır için yeniden denenir', async (t) => {
  let httpCalls = 0;
  const server = http.createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      httpCalls += 1;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        data: httpCalls === 1
          ? [{ status: 'error', data: null, message: 'rate limit over' }]
          : [{ success: true, role_id: 5244 }]
      }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const queue = new ApiBatchQueue({
    token: 'test-token',
    baseUrl: `http://127.0.0.1:${server.address().port}/`,
    flushIntervalMs: 1,
    timeoutMs: 1000,
    rateLimitRetryAttempts: 3,
    rateLimitBaseDelayMs: 25,
    rateLimitMaxDelayMs: 100
  });
  t.after(() => queue.close());

  const result = await queue.request('/!api/role/add', {
    group_id: 6875,
    name: 'Destek Ekibi'
  }, { flushImmediately: true });

  assert.deepEqual(result, { success: true, role_id: 5244 });
  assert.equal(httpCalls, 2);
  assert.equal(queue.getMetrics().rateLimits, 1);
});
