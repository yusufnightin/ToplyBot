const test = require('node:test');
const assert = require('node:assert/strict');
const levelingPlugin = require('../src/plugins/leveling');

test('normal mesaj ve komut mesajı sayılır, XP bekleme süresi ve çift olay koruması uygulanır', async () => {
  let messageHandler;
  const counted = [];
  const xpAwards = [];
  const settings = {
    enabled: true,
    ignoredChannelIds: [],
    minMessageLength: 1,
    cooldownSeconds: 60
  };
  const app = {
    config: { prefix: '!' },
    client: {
      userId: 999,
      on(event, handler) {
        if (event === 'message') messageHandler = handler;
      }
    },
    groupResolver: { resolve: (event) => Number(event.group_id) },
    logger: { error() {} },
    router: { register() {} },
    services: {
      leveling: {
        async settings() { return settings; },
        canEarnFromMessage() { return { allowed: true }; },
        async recordMessage(payload) {
          counted.push(payload);
          return { counted: true };
        },
        async addMessageXp(payload) {
          xpAwards.push(payload);
          return { awarded: false, reason: 'test' };
        }
      }
    }
  };

  levelingPlugin.setup(app);
  assert.equal(typeof messageHandler, 'function');

  const base = {
    action: 'post/add',
    group_id: 7,
    channel_id: 44,
    user_id: 11,
    message: '!rank'
  };
  await messageHandler({ ...base, post_id: 101 });
  await messageHandler({ ...base, post_id: 102, message: 'İkinci mesaj' });
  await messageHandler({ ...base, action: 'post/mention', post_id: 102, message: 'İkinci mesaj' });

  assert.equal(counted.length, 2);
  assert.equal(xpAwards.length, 1);
  assert.equal(xpAwards[0].countMessage, false);
});

test('rank kartı açıkken dış metinler yerine yalnız görsel kart URLsi gönderilir', async () => {
  const commands = new Map();
  const replies = [];
  let cardOptions;
  const leveling = {
    async getProfile() {
      return { level: 1, xp: 300, messages: 18, awardedBadgeIds: [801] };
    },
    async settings() {
      return {
        cardEnabled: true,
        cardAccent: '#7C5CFF',
        badgeRewards: { 5: 805 }
      };
    },
    progress() {
      return {
        percent: 66,
        gained: 200,
        required: 300,
        currentLevelXp: 100,
        nextLevelXp: 400
      };
    },
    nextBadgeReward() {
      return { level: 5, badgeId: 805, emoji: '⚡', title: 'Kıvılcım', accent: '#2EA8FF' };
    }
  };
  const app = {
    config: { prefix: '!' },
    client: {
      userId: 999,
      on() {},
      async getUser() { return { data: { user: { id: 11, name: 'Sporky' } } }; }
    },
    groupResolver: { resolve: () => 7 },
    logger: { warn() {}, error() {} },
    router: { register(command) { commands.set(command.name, command); } },
    services: {
      leveling,
      cards: {
        async createRankCard(options) {
          cardOptions = options;
          return { url: 'https://cards.example/cards/rank-test.png', jtml: '~{}' };
        }
      }
    }
  };

  levelingPlugin.setup(app);
  await commands.get('rank').execute({
    args: [],
    userId: 11,
    groupId: 7,
    client: app.client,
    services: app.services,
    reply: async (text) => { replies.push(text); }
  });

  assert.deepEqual(replies, ['https://cards.example/cards/rank-test.png']);
  assert.equal(cardOptions.earnedBadges, 1);
  assert.equal(cardOptions.nextBadge.emoji, '⚡');
});

test('toprank komutu sıralamayı beş kişilik SVG karta dönüştürür', async () => {
  const commands = new Map();
  const replies = [];
  let cardOptions;
  const profiles = [
    { userId: 12, level: 3, xp: 800, messages: 30, awardedBadgeIds: [] },
    { userId: 11, level: 5, xp: 1500, messages: 50, awardedBadgeIds: [801] }
  ];
  const app = {
    config: { prefix: '!' },
    client: {
      userId: 999,
      on() {},
      async getUser(userId) { return { data: { user: { id: userId, name: userId === 11 ? 'Sporky' : 'Ece' } } }; },
      async getGroup() { return { data: { group: { id: 7, name: 'Test Sunucusu' } } }; }
    },
    groupResolver: { resolve: () => 7 },
    logger: { warn() {}, error() {} },
    router: { register(command) { commands.set(command.name, command); } },
    services: {
      leveling: {
        async listProfiles() { return profiles; },
        async settings() { return { cardAccent: '#7C5CFF' }; }
      },
      cards: {
        async createTopRankCard(options) {
          cardOptions = options;
          return { url: 'https://cards.example/cards/toprank-test.png', jtml: '~{}' };
        }
      }
    }
  };

  levelingPlugin.setup(app);
  await commands.get('toprank').execute({
    args: [],
    userId: 11,
    groupId: 7,
    client: app.client,
    services: app.services,
    reply: async (text) => { replies.push(text); }
  });

  assert.deepEqual(replies, ['https://cards.example/cards/toprank-test.png']);
  assert.equal(cardOptions.groupName, 'Test Sunucusu');
  assert.equal(cardOptions.totalProfiles, 2);
  assert.deepEqual(cardOptions.ranking.map((item) => item.userName), ['Sporky', 'Ece']);
  assert.deepEqual(cardOptions.ranking.map((item) => item.rank), [1, 2]);
});
