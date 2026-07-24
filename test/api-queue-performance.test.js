const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const ApiBatchQueue = require('../src/core/ApiBatchQueue');

async function createServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

test('aynı salt-okunur istek kuyrukta birleştirilir ve sonra önbellekten döner', async (t) => {
  let httpCalls = 0;
  const server = await createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      httpCalls += 1;
      const rows = JSON.parse(body);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: rows.map(() => ({ id: 77, name: 'Test' })) }));
    });
  });
  t.after(() => server.close());
  const queue = new ApiBatchQueue({
    token: 'test-token', baseUrl: `http://127.0.0.1:${server.address().port}/`,
    flushIntervalMs: 10, cacheTtlMs: 1000
  });
  t.after(() => queue.close());

  const [first, second] = await Promise.all([
    queue.request('/!api/group/get', { id: 1 }),
    queue.request('/!api/group/get', { id: 1 })
  ]);
  const third = await queue.request('/!api/group/get', { id: 1 });

  assert.deepEqual(first, second);
  assert.deepEqual(second, third);
  assert.equal(httpCalls, 1);
  const metrics = queue.getMetrics();
  assert.equal(metrics.dedupeHits, 1);
  assert.equal(metrics.cacheHits, 1);
  assert.equal(metrics.networkRequests, 1);
});

test('yazma isteği ilişkili okuma önbelleğini temizler', async (t) => {
  let value = 'önce';
  let httpCalls = 0;
  const server = await createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      httpCalls += 1;
      const rows = JSON.parse(body);
      const results = rows.map((row) => {
        if (row.api === '/!api/channel/set') { value = 'sonra'; return { success: true }; }
        return { title: value };
      });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: results }));
    });
  });
  t.after(() => server.close());
  const queue = new ApiBatchQueue({ token: 'test-token', baseUrl: `http://127.0.0.1:${server.address().port}/`, flushIntervalMs: 5, cacheTtlMs: 5000 });
  t.after(() => queue.close());

  assert.equal((await queue.request('/!api/channel/get', { channel_id: 1 })).title, 'önce');
  await queue.request('/!api/channel/set', { channel_id: 1, title: 'sonra' }, { flushImmediately: true });
  assert.equal((await queue.request('/!api/channel/get', { channel_id: 1 })).title, 'sonra');
  assert.equal(httpCalls, 3);
});

test('dedupe kapalıyken aynı okumalar gerçek batch içinde ayrı satırlar olarak gönderilir', async (t) => {
  let rowCount = 0;
  const server = await createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const rows = JSON.parse(body);
      rowCount += rows.length;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data: rows.map((_, index) => ({ index })) }));
    });
  });
  t.after(() => server.close());
  const queue = new ApiBatchQueue({ token: 'test-token', baseUrl: `http://127.0.0.1:${server.address().port}/`, flushIntervalMs: 10, maxBatchSize: 40 });
  t.after(() => queue.close());

  const results = await Promise.all(Array.from({ length: 12 }, () => queue.request('/!api/test/time', {}, {
    bypassCache: true, cacheTtlMs: 0, dedupe: false
  })));
  assert.equal(results.length, 12);
  assert.equal(rowCount, 12);
  assert.equal(queue.getMetrics().networkRequests, 12);
});
