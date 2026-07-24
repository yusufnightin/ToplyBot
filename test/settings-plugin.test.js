const test = require('node:test');
const assert = require('node:assert/strict');
const settingsPlugin = require('../src/plugins/settings');

test('logtest gerçek teslimat sonucunu kullanıcıya anlaşılır biçimde gösterir', async () => {
  const commands = new Map();
  const app = {
    router: {
      register(command) {
        commands.set(command.name, command);
      }
    }
  };
  settingsPlugin.setup(app);

  const replies = [];
  await commands.get('logtest').execute({
    userId: 7,
    groupId: 6875,
    channelId: 44,
    services: {
      audit: {
        async write() {
          return {
            delivery: { status: 'sent', channelId: 100, repaired: true }
          };
        }
      }
    },
    reply: async (text) => { replies.push(text); }
  });

  assert.match(replies[0], /Log sistemi çalışıyor/);
  assert.match(replies[0], /kanal #100/);
  assert.match(replies[0], /kanal izni otomatik onarıldı/);
});
