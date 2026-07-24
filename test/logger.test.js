const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Logger = require('../src/core/Logger');

test('konsolda yalnızca açılış onayı ve hata gösterir, diğer seviyeleri dosyada saklar', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'topluyo-logger-'));
  const calls = { log: 0, warn: 0, error: 0 };
  const originals = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => { calls.log += 1; };
  console.warn = () => { calls.warn += 1; };
  console.error = () => { calls.error += 1; };
  try {
    const logger = new Logger(directory);
    logger.info('normal bilgi');
    logger.warn('uyarı');
    logger.ready('✅ ToplyBot aktif ve kullanıma hazır!');
    logger.error('gerçek hata');
  } finally {
    console.log = originals.log;
    console.warn = originals.warn;
    console.error = originals.error;
  }
  assert.deepEqual(calls, { log: 1, warn: 0, error: 1 });
  const content = fs.readFileSync(path.join(directory, `${new Date().toISOString().slice(0, 10)}.log`), 'utf8');
  assert.match(content, /normal bilgi/);
  assert.match(content, /uyarı/);
  assert.match(content, /ToplyBot aktif ve kullanıma hazır/);
  assert.match(content, /gerçek hata/);
  fs.rmSync(directory, { recursive: true, force: true });
});
