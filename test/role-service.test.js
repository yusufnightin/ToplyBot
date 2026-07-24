const test = require('node:test');
const assert = require('node:assert/strict');
const RoleService = require('../src/services/RoleService');

test('rol eklerken mevcut rolleri korur ve tekrarları kaldırır', async () => {
  const calls = [];
  const client = {
    async api(endpoint, data) {
      calls.push({ endpoint, data });
      if (endpoint === '/!api/member/get') return { data: { member: { role_ids: '1,2' } } };
      if (endpoint === '/!api/member/role/set') return { ok: true };
      throw new Error(`Beklenmeyen endpoint: ${endpoint}`);
    }
  };
  const roles = new RoleService({ client });
  const result = await roles.addMemberRoles(10, 20, [2, 3]);

  assert.deepEqual(result, [1, 2, 3]);
  assert.deepEqual(calls.at(-1), {
    endpoint: '/!api/member/role/set',
    data: { group_id: 10, user_id: 20, role_ids: '1,2,3' }
  });
});

test('otorol kapalıysa API çağrısı yapmaz', async () => {
  let callCount = 0;
  const roles = new RoleService({ client: { async api() { callCount += 1; } } });
  const result = await roles.applyAutorole(1, 2, { autorole: { enabled: false, roleIds: [9] } });
  assert.deepEqual(result, []);
  assert.equal(callCount, 0);
});
