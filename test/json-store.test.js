const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JsonStore = require('../src/core/JsonStore');

test('eş zamanlı güncellemeleri kaybetmeden sıraya alır', async (t) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'topluyo-store-'));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const store = new JsonStore(path.join(directory, 'counter.json'), { count: 0 });

  await Promise.all(Array.from({ length: 20 }, () => store.update((value) => {
    value.count += 1;
    return value;
  })));

  assert.deepEqual(await store.read(), { count: 20 });
});
