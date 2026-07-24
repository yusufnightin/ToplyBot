const test = require('node:test');
const assert = require('node:assert/strict');
const SystemHealthService = require('../src/services/SystemHealthService');

test('özel log kanalları listede görünmese bile doğrudan ID doğrulamasıyla sağlıklı sayılır', async () => {
  const configuredChannels = {
    welcome: '45793',
    tickets: '45798',
    logs: '45803',
    ticketLogs: '45810',
    moderationLogs: '45811'
  };
  const existingIds = new Set(Object.values(configuredChannels).map(Number));
  const app = {
    stores: {
      audit: { async read() { return []; } }
    },
    client: {
      async getCurrentUserId() { return 777; }
    },
    services: {
      settings: {
        async get() {
          return {
            channels: configuredChannels,
            welcome: { enabled: true },
            tickets: { enabled: true },
            autorole: { enabled: false, roleIds: [] },
            moderation: { muteRoleId: null }
          };
        }
      },
      channels: {
        async list() {
          return [
            { id: 45793, nick: 'hos-geldin' },
            { id: 45798, nick: 'destek' }
          ];
        }
      },
      roles: { async list() { return []; } },
      provisioning: {
        async findChannelById(groupId, channelId) {
          return existingIds.has(Number(channelId)) ? { id: Number(channelId), groupId } : null;
        }
      },
      supportTemplate: {
        async readState() { return { status: 'completed', version: 3 }; },
        async verify() {
          return { ok: true, issues: [], channelCount: existingIds.size, roleCount: 0 };
        }
      },
      welcome: {
        async diagnostics() { return { last: null }; }
      }
    }
  };

  const health = await new SystemHealthService({ app }).inspect(6875);
  assert.equal(health.status, 'healthy');
  assert.equal(health.channelCount, existingIds.size);
  assert.deepEqual(health.checks['private-channels'].value.resolvedOutsideList.sort((a, b) => a - b), [45803, 45810, 45811]);
  assert.equal(health.issues.some((issue) => issue.code.startsWith('channel:')), false);
});
