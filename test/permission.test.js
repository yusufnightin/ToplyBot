const test = require('node:test');
const assert = require('node:assert/strict');
const PermissionManager = require('../src/core/PermissionManager');

test('yetki hiyerarşisini doğru uygular', () => {
  const permissions = new PermissionManager({
    ownerUserIds: [1],
    adminUserIds: [2],
    moderatorUserIds: [3]
  });

  assert.equal(permissions.name(1), 'owner');
  assert.equal(permissions.has(1, 'admin'), true);
  assert.equal(permissions.has(2, 'owner'), false);
  assert.equal(permissions.has(2, 'moderator'), true);
  assert.equal(permissions.has(3, 'admin'), false);
  assert.equal(permissions.has(4, 'member'), true);
});
