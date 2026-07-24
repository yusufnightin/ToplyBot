const test = require('node:test');
const assert = require('node:assert/strict');
const LevelingService = require('../src/services/LevelingService');

class MemoryStore {
  constructor(value) { this.value = structuredClone(value); }
  async read() { return structuredClone(this.value); }
  async update(mutator) {
    const next = await mutator(this.value);
    if (next !== undefined) this.value = next;
    return structuredClone(this.value);
  }
}

function createFixture(overrides = {}) {
  const settings = {
    enabled: true,
    xpPerMessage: 50,
    xpMin: 50,
    xpMax: 50,
    multiplier: 1,
    cooldownSeconds: 0,
    minMessageLength: 1,
    dailyXpCap: 0,
    curveBaseXp: 100,
    curveExponent: 2,
    ignoredChannelIds: [],
    roleRewards: { 1: 901 },
    badgeRewards: { 1: 801 },
    ...overrides.settings
  };
  const roleCalls = [];
  const badgeCalls = [];
  const audit = [];
  const apiCalls = [];
  const iconCalls = [];
  const app = {
    stores: { levels: new MemoryStore(overrides.levels || {}) },
    logger: { error() {}, warn() {} },
    client: {
      async giveBadge(badgeId, userId) { badgeCalls.push({ badgeId, userId }); return { success: true }; },
      async getGroupFounder() {
        const founderId = Number(overrides.founderId ?? 11);
        return { data: { founder: { id: founderId, name: 'Kurucu' } } };
      },
      async api(path, data, options) {
        apiCalls.push({ path, data, options });
        return overrides.badgeListResult || [];
      }
    },
    services: {
      settings: {
        async get() { return { leveling: structuredClone(settings) }; },
        async set(groupId, path, value) {
          const key = path.replace(/^leveling\./, '');
          settings[key] = structuredClone(value);
          return { leveling: structuredClone(settings) };
        }
      },
      roles: {
        async addMemberRoles(groupId, userId, roleIds) { roleCalls.push({ groupId, userId, roleIds }); return roleIds; }
      },
      audit: { async write(action, payload) { audit.push({ action, payload }); } },
      cards: {
        async createLevelBadgeIcon(options) {
          iconCalls.push(options);
          return { url: `https://cards.example/level-${options.level}.svg` };
        }
      },
      apiManagement: {
        async createBadge(groupId, payload) {
          if (overrides.createBadge) return overrides.createBadge(groupId, payload);
          return { id: 802, payload, result: { success: true, badge_id: 802 } };
        },
        async listBadges() { return []; }
      }
    }
  };
  app.services.leveling = new LevelingService({ app });
  return { app, service: app.services.leveling, settings, roleCalls, badgeCalls, audit, apiCalls, iconCalls };
}

test('mesaj XPsi seviye atlatır ve bağlı rol ile Topluyo rozetini otomatik verir', async () => {
  const { service, roleCalls, badgeCalls } = createFixture();
  const first = await service.addMessageXp({ groupId: 7, userId: 11, channelId: 44, message: 'ilk mesaj' });
  const second = await service.addMessageXp({ groupId: 7, userId: 11, channelId: 44, message: 'ikinci mesaj' });

  assert.equal(first.afterLevel, 0);
  assert.equal(second.afterLevel, 1);
  assert.deepEqual(second.rewards.roles, [901]);
  assert.deepEqual(second.rewards.badges, [801]);
  assert.deepEqual(roleCalls, [{ groupId: 7, userId: 11, roleIds: [901] }]);
  assert.deepEqual(badgeCalls, [{ badgeId: 801, userId: 11 }]);

  const profile = await service.getProfile(7, 11);
  assert.equal(profile.xp, 100);
  assert.equal(profile.level, 1);
  assert.deepEqual(profile.awardedBadgeIds, [801]);
});

test('günlük XP tavanı son kazancı kırpar ve tavan dolunca XP vermez', async () => {
  const { service } = createFixture({ settings: { xpMin: 20, xpMax: 20, dailyXpCap: 30, roleRewards: {}, badgeRewards: {} } });
  const a = await service.addMessageXp({ groupId: 7, userId: 12, channelId: 44, message: 'bir' });
  const b = await service.addMessageXp({ groupId: 7, userId: 12, channelId: 44, message: 'iki' });
  const c = await service.addMessageXp({ groupId: 7, userId: 12, channelId: 44, message: 'üç' });
  assert.equal(a.xp, 20);
  assert.equal(b.xp, 10);
  assert.equal(c.awarded, false);
  assert.equal(c.reason, 'daily-cap');
  const profile = await service.getProfile(7, 12);
  assert.equal(profile.xp, 30);
  assert.equal(profile.messages, 3);
});

test('rozet oluşturma cevabında ID yoksa rozet listesinden nick ile ID kurtarılır', async () => {
  const fixture = createFixture({
    createBadge: async (groupId, payload) => ({ id: null, payload, result: { success: true } }),
    badgeListResult: { data: { badges: [{ badge_id: 944, nick: 'toply-seviye-10-alev', name: '🔥 Alev' }] } },
    settings: { roleRewards: {}, badgeRewards: {} }
  });
  const created = await fixture.service.createBadgeReward(7, 10);
  assert.equal(created.id, 944);
  assert.equal(created.recovered, true);
  assert.equal(fixture.settings.badgeRewards['10'], 944);
  assert.equal(fixture.apiCalls[0].path, '/!api/badge/list');
  assert.equal(fixture.apiCalls[0].options.bypassCache, true);
});

test('ödül senkronizasyonu mevcut seviyedeki eksik rozeti sonradan verir', async () => {
  const fixture = createFixture({
    levels: {
      '7:15': { groupId: 7, userId: 15, xp: 2500, level: 5, messages: 40, awardedBadgeIds: [801] }
    },
    settings: {
      roleRewards: { 1: 901, 5: 905 },
      badgeRewards: { 1: 801, 5: 805 }
    }
  });
  const result = await fixture.service.syncUserRewards(7, 15);
  assert.deepEqual(result.rewards.badges, [805]);
  assert.deepEqual(fixture.badgeCalls, [{ badgeId: 805, userId: 15 }]);
  assert.deepEqual((await fixture.service.getProfile(7, 15)).awardedBadgeIds, [801, 805]);
});

test('mesaj sayacı XP bekleme mantığından bağımsız artırılabilir ve XP kaydı ikinci kez saymaz', async () => {
  const fixture = createFixture({ settings: { roleRewards: {}, badgeRewards: {} } });
  const counted = await fixture.service.recordMessage({
    groupId: 7,
    userId: 11,
    channelId: 44,
    message: 'gerçek bir mesaj'
  });
  assert.equal(counted.counted, true);

  await fixture.service.addMessageXp({
    groupId: 7,
    userId: 11,
    channelId: 44,
    message: 'gerçek bir mesaj',
    countMessage: false
  });
  const profile = await fixture.service.getProfile(7, 11);
  assert.equal(profile.messages, 1);
  assert.equal(profile.xp, 50);
});

test('simgeli rozet paketini yalnız sunucu kurucusu oluşturabilir', async () => {
  let nextBadgeId = 900;
  const fixture = createFixture({
    founderId: 11,
    settings: { roleRewards: {}, badgeRewards: {} },
    createBadge: async (groupId, payload) => {
      nextBadgeId += 1;
      return { id: nextBadgeId, payload, result: { success: true, badge_id: nextBadgeId } };
    }
  });

  await assert.rejects(
    fixture.service.createOwnerBadgePack({ groupId: 7, userId: 99, levels: [1] }),
    /yalnızca bu sunucunun sahibi/
  );

  const result = await fixture.service.createOwnerBadgePack({
    groupId: 7,
    userId: 11,
    levels: [1, 10, 50]
  });
  assert.equal(result.created.length, 3);
  assert.deepEqual(result.created.map((item) => item.level), [1, 10, 50]);
  assert.deepEqual(fixture.iconCalls.map((item) => item.emoji), ['🌱', '🔥', '👑']);
  assert.equal(fixture.settings.badgeRewards['50'], 903);
});

test('rank kartı için mevcut seviyenin üzerindeki en yakın rozet ödülünü seçer', () => {
  const fixture = createFixture();
  const reward = fixture.service.nextBadgeReward({
    badgeRewards: { 1: 801, 5: 805, 10: 810 }
  }, 1);

  assert.deepEqual(reward, {
    level: 5,
    badgeId: 805,
    emoji: '⚡',
    title: 'Kıvılcım',
    accent: '#2EA8FF',
    accent2: '#6366F1'
  });
});
