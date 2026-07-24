const { assertApiSuccess } = require('../utils/apiResult');
const { findArray, findObject, unwrapApiResult } = require('../utils/api');

const LEVEL_BADGE_PACK = Object.freeze([
  { level: 1, emoji: '🌱', title: 'İlk Adım', accent: '#22C55E', accent2: '#84CC16' },
  { level: 5, emoji: '⚡', title: 'Kıvılcım', accent: '#2EA8FF', accent2: '#6366F1' },
  { level: 10, emoji: '🔥', title: 'Alev', accent: '#F97316', accent2: '#EF4444' },
  { level: 20, emoji: '🛡️', title: 'Muhafız', accent: '#06B6D4', accent2: '#2563EB' },
  { level: 30, emoji: '💎', title: 'Elmas', accent: '#A855F7', accent2: '#EC4899' },
  { level: 50, emoji: '👑', title: 'Topluluk Tacı', accent: '#FACC15', accent2: '#F59E0B' },
  { level: 75, emoji: '🌌', title: 'Efsane', accent: '#8B5CF6', accent2: '#3B82F6' },
  { level: 100, emoji: '🏆', title: 'Toply Ustası', accent: '#FDE047', accent2: '#FB7185' }
]);

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function uniquePositiveIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0))];
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/[çÇ]/g, 'c')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[ıİ]/g, 'i')
    .replace(/[öÖ]/g, 'o')
    .replace(/[şŞ]/g, 's')
    .replace(/[üÜ]/g, 'u')
    .replace(/[^a-z0-9]+/g, '-');
}

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

class LevelingService {
  constructor({ app }) {
    this.app = app;
  }

  profileKey(groupId, userId) {
    return `${Number(groupId)}:${Number(userId)}`;
  }

  xpForLevel(level, settings = {}) {
    const normalizedLevel = Math.max(0, integer(level));
    const base = Math.max(10, Number(settings.curveBaseXp) || 100);
    const exponent = Math.max(1.2, Math.min(4, Number(settings.curveExponent) || 2));
    return Math.floor(base * (normalizedLevel ** exponent));
  }

  levelFromXp(xp, settings = {}) {
    const normalizedXp = Math.max(0, Number(xp) || 0);
    const base = Math.max(10, Number(settings.curveBaseXp) || 100);
    const exponent = Math.max(1.2, Math.min(4, Number(settings.curveExponent) || 2));
    return Math.max(0, Math.floor((normalizedXp / base) ** (1 / exponent)));
  }

  normalizeProfile(profile, groupId, userId, settings = {}) {
    const value = profile && typeof profile === 'object' ? profile : {};
    const xp = Math.max(0, integer(value.xp));
    return {
      groupId: Number(groupId),
      userId: Number(userId),
      xp,
      level: this.levelFromXp(xp, settings),
      messages: Math.max(0, integer(value.messages)),
      awardedBadgeIds: uniquePositiveIds(value.awardedBadgeIds),
      daily: value.daily && typeof value.daily === 'object'
        ? { date: String(value.daily.date || ''), xp: Math.max(0, integer(value.daily.xp)) }
        : { date: '', xp: 0 },
      lastXpAt: value.lastXpAt || null,
      updatedAt: value.updatedAt || null
    };
  }

  async settings(groupId) {
    const all = await this.app.services.settings.get(groupId);
    return all.leveling || {};
  }

  async getProfile(groupId, userId) {
    const settings = await this.settings(groupId);
    const levels = await this.app.stores.levels.read();
    return this.normalizeProfile(levels[this.profileKey(groupId, userId)], groupId, userId, settings);
  }

  async listProfiles(groupId) {
    const settings = await this.settings(groupId);
    return Object.values(await this.app.stores.levels.read())
      .filter((profile) => String(profile?.groupId) === String(groupId))
      .map((profile) => this.normalizeProfile(profile, groupId, profile.userId, settings));
  }

  progress(profile, settings = {}) {
    const level = this.levelFromXp(profile.xp, settings);
    const currentLevelXp = this.xpForLevel(level, settings);
    const nextLevelXp = this.xpForLevel(level + 1, settings);
    const gained = Math.max(0, profile.xp - currentLevelXp);
    const required = Math.max(1, nextLevelXp - currentLevelXp);
    return {
      level,
      currentLevelXp,
      nextLevelXp,
      gained,
      required,
      percent: Math.max(0, Math.min(100, Math.floor((gained / required) * 100)))
    };
  }

  messageXp(settings = {}) {
    const fallback = Math.max(1, integer(settings.xpPerMessage, 10));
    const min = Math.max(1, integer(settings.xpMin, fallback));
    const max = Math.max(min, integer(settings.xpMax, min));
    const random = min === max ? min : Math.floor(Math.random() * (max - min + 1)) + min;
    const multiplier = Math.max(0.1, Math.min(100, Number(settings.multiplier) || 1));
    return Math.max(1, Math.floor(random * multiplier));
  }

  canEarnFromMessage({ settings = {}, channelId, message = '' }) {
    if (!settings.enabled) return { allowed: false, reason: 'disabled' };
    const ignored = uniquePositiveIds(settings.ignoredChannelIds);
    if (ignored.includes(Number(channelId))) return { allowed: false, reason: 'ignored-channel' };
    const minLength = Math.max(0, integer(settings.minMessageLength, 3));
    const compact = String(message || '').replace(/\s+/g, ' ').trim();
    if (compact.length < minLength) return { allowed: false, reason: 'short-message' };
    return { allowed: true };
  }

  canCountMessage({ settings = {}, channelId, message = '' }) {
    if (!settings.enabled) return { allowed: false, reason: 'disabled' };
    const ignored = uniquePositiveIds(settings.ignoredChannelIds);
    if (ignored.includes(Number(channelId))) return { allowed: false, reason: 'ignored-channel' };
    if (!String(message || '').trim()) return { allowed: false, reason: 'empty-message' };
    return { allowed: true };
  }

  async recordMessage({ groupId, userId, channelId, message, settings = null }) {
    const normalizedSettings = settings || await this.settings(groupId);
    const eligibility = this.canCountMessage({ settings: normalizedSettings, channelId, message });
    if (!eligibility.allowed) return { counted: false, reason: eligibility.reason };
    const key = this.profileKey(groupId, userId);
    let profile;
    await this.app.stores.levels.update((levels) => {
      profile = this.normalizeProfile(levels[key], groupId, userId, normalizedSettings);
      profile.messages += 1;
      profile.updatedAt = new Date().toISOString();
      levels[key] = profile;
      return levels;
    });
    return { counted: true, profile };
  }

  async saveAwardedBadges(groupId, userId, badgeIds, settings = null) {
    const normalizedSettings = settings || await this.settings(groupId);
    const key = this.profileKey(groupId, userId);
    const awarded = uniquePositiveIds(badgeIds);
    if (!awarded.length) return this.getProfile(groupId, userId);
    let saved;
    await this.app.stores.levels.update((levels) => {
      const current = this.normalizeProfile(levels[key], groupId, userId, normalizedSettings);
      current.awardedBadgeIds = uniquePositiveIds([...current.awardedBadgeIds, ...awarded]);
      current.updatedAt = new Date().toISOString();
      levels[key] = current;
      saved = current;
      return levels;
    });
    return saved;
  }

  async giveBadge({ groupId, userId, badgeId, source = 'manual-badge', track = true }) {
    const normalizedBadgeId = Number(badgeId);
    const normalizedUserId = Number(userId);
    if (!Number.isInteger(normalizedBadgeId) || normalizedBadgeId <= 0) throw new Error('Geçerli rozet ID gerekli.');
    if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) throw new Error('Geçerli kullanıcı ID gerekli.');
    const result = await this.app.client.giveBadge(normalizedBadgeId, normalizedUserId);
    assertApiSuccess(result, `Rozet #${normalizedBadgeId} verme`);
    if (track) await this.saveAwardedBadges(groupId, normalizedUserId, [normalizedBadgeId]);
    await this.app.services.audit?.write?.('level.badge_give', {
      targetUserId: normalizedUserId,
      badgeId: normalizedBadgeId,
      source
    }, { groupId, notify: false });
    return { badgeId: normalizedBadgeId, userId: normalizedUserId, result };
  }

  async awardLevelRewards({ groupId, userId, beforeLevel, afterLevel, settings, profile }) {
    if (afterLevel <= beforeLevel) return { roles: [], badges: [], roleFailures: [], badgeFailures: [] };
    const roleRewards = settings.roleRewards && typeof settings.roleRewards === 'object' ? settings.roleRewards : {};
    const badgeRewards = settings.badgeRewards && typeof settings.badgeRewards === 'object' ? settings.badgeRewards : {};
    const roleIds = [];
    const badgeIds = [];
    for (let level = beforeLevel + 1; level <= afterLevel; level += 1) {
      const roleId = Number(roleRewards[String(level)]);
      const badgeId = Number(badgeRewards[String(level)]);
      if (Number.isInteger(roleId) && roleId > 0) roleIds.push(roleId);
      if (Number.isInteger(badgeId) && badgeId > 0 && !profile.awardedBadgeIds.includes(badgeId)) badgeIds.push(badgeId);
    }

    const roles = [];
    const roleFailures = [];
    const uniqueRoles = uniquePositiveIds(roleIds);
    if (uniqueRoles.length) {
      try {
        await this.app.services.roles.addMemberRoles(groupId, userId, uniqueRoles);
        roles.push(...uniqueRoles);
      } catch (error) {
        roleFailures.push({ roleIds: uniqueRoles, message: error.message });
        this.app.logger?.error?.('Seviye rol ödülü verilemedi.', {
          groupId: Number(groupId), userId: Number(userId), roleIds: uniqueRoles, message: error.message
        });
      }
    }

    const badges = [];
    const badgeFailures = [];
    for (const badgeId of uniquePositiveIds(badgeIds)) {
      try {
        await this.giveBadge({ groupId, userId, badgeId, source: `level:${afterLevel}`, track: false });
        badges.push(badgeId);
      } catch (error) {
        badgeFailures.push({ badgeId, message: error.message });
        this.app.logger?.error?.('Seviye rozeti verilemedi.', {
          groupId: Number(groupId), userId: Number(userId), badgeId, message: error.message
        });
      }
    }

    if (badges.length) {
      await this.saveAwardedBadges(groupId, userId, badges, settings);
      profile.awardedBadgeIds = uniquePositiveIds([...profile.awardedBadgeIds, ...badges]);
    }

    return { roles, badges, roleFailures, badgeFailures };
  }

  async changeXp({ groupId, userId, delta, source = 'manual', countMessage = false }) {
    const settings = await this.settings(groupId);
    const key = this.profileKey(groupId, userId);
    let beforeLevel = 0;
    let afterLevel = 0;
    let profile;
    const numericDelta = integer(delta);
    await this.app.stores.levels.update((levels) => {
      profile = this.normalizeProfile(levels[key], groupId, userId, settings);
      beforeLevel = profile.level;
      profile.xp = Math.max(0, profile.xp + numericDelta);
      if (countMessage && numericDelta > 0) profile.messages += 1;
      profile.level = this.levelFromXp(profile.xp, settings);
      profile.updatedAt = new Date().toISOString();
      profile.lastXpAt = profile.updatedAt;
      afterLevel = profile.level;
      levels[key] = profile;
      return levels;
    });

    const rewards = await this.awardLevelRewards({ groupId, userId, beforeLevel, afterLevel, settings, profile });
    await this.app.services.audit?.write?.('level.xp_change', {
      targetUserId: Number(userId), delta: numericDelta, source, beforeLevel, afterLevel,
      xp: profile.xp, roleRewards: rewards.roles, badgeRewards: rewards.badges
    }, { groupId, notify: false });
    return { profile, settings, beforeLevel, afterLevel, rewards };
  }

  async addMessageXp({ groupId, userId, channelId, message, countMessage = true }) {
    const settings = await this.settings(groupId);
    const eligibility = this.canEarnFromMessage({ settings, channelId, message });
    if (!eligibility.allowed) return { awarded: false, reason: eligibility.reason };
    const key = this.profileKey(groupId, userId);
    const today = new Date().toISOString().slice(0, 10);
    const gain = this.messageXp(settings);
    const dailyCap = Math.max(0, integer(settings.dailyXpCap));
    let actualGain = gain;
    let beforeLevel = 0;
    let afterLevel = 0;
    let profile;

    await this.app.stores.levels.update((levels) => {
      profile = this.normalizeProfile(levels[key], groupId, userId, settings);
      beforeLevel = profile.level;
      if (countMessage) profile.messages += 1;
      if (profile.daily.date !== today) profile.daily = { date: today, xp: 0 };
      if (dailyCap > 0) actualGain = Math.max(0, Math.min(gain, dailyCap - profile.daily.xp));
      if (actualGain <= 0) {
        profile.updatedAt = new Date().toISOString();
        levels[key] = profile;
        return levels;
      }
      profile.xp += actualGain;
      profile.daily.xp += actualGain;
      profile.level = this.levelFromXp(profile.xp, settings);
      profile.lastXpAt = new Date().toISOString();
      profile.updatedAt = profile.lastXpAt;
      afterLevel = profile.level;
      levels[key] = profile;
      return levels;
    });

    if (actualGain <= 0) return { awarded: false, reason: 'daily-cap', profile };
    const rewards = await this.awardLevelRewards({ groupId, userId, beforeLevel, afterLevel, settings, profile });
    return { awarded: true, xp: actualGain, profile, settings, beforeLevel, afterLevel, rewards };
  }

  async setLevel({ groupId, userId, level, source = 'manual-level' }) {
    const settings = await this.settings(groupId);
    const targetLevel = Math.max(0, integer(level));
    const targetXp = this.xpForLevel(targetLevel, settings);
    const current = await this.getProfile(groupId, userId);
    return this.changeXp({ groupId, userId, delta: targetXp - current.xp, source });
  }

  async mapRoleReward(groupId, level, roleId) {
    const settings = await this.settings(groupId);
    const rewards = { ...(settings.roleRewards || {}) };
    const key = String(Math.max(1, integer(level, 1)));
    if (roleId === null) delete rewards[key];
    else rewards[key] = Number(roleId);
    await this.app.services.settings.set(groupId, 'leveling.roleRewards', rewards);
    return rewards;
  }

  async mapBadgeReward(groupId, level, badgeId) {
    const settings = await this.settings(groupId);
    const rewards = { ...(settings.badgeRewards || {}) };
    const key = String(Math.max(1, integer(level, 1)));
    if (badgeId === null) delete rewards[key];
    else rewards[key] = Number(badgeId);
    await this.app.services.settings.set(groupId, 'leveling.badgeRewards', rewards);
    return rewards;
  }

  badgeTier(level) {
    const numeric = Math.max(1, integer(level, 1));
    if (numeric >= 100) return '5/5';
    if (numeric >= 50) return '4/5';
    if (numeric >= 25) return '3/5';
    if (numeric >= 10) return '2/5';
    return '1/5';
  }

  badgePackItem(level) {
    const numericLevel = Math.max(1, integer(level, 1));
    return LEVEL_BADGE_PACK.find((item) => item.level === numericLevel) || {
      level: numericLevel,
      emoji: '⭐',
      title: `Seviye ${numericLevel}`,
      accent: '#7C5CFF',
      accent2: '#2EA8FF'
    };
  }

  nextBadgeReward(settings = {}, currentLevel = 0) {
    const rewards = settings.badgeRewards && typeof settings.badgeRewards === 'object'
      ? settings.badgeRewards
      : {};
    const nextLevel = Object.entries(rewards)
      .map(([level, badgeId]) => ({ level: Number(level), badgeId: Number(badgeId) }))
      .filter((item) => Number.isInteger(item.level)
        && item.level > Number(currentLevel)
        && Number.isInteger(item.badgeId)
        && item.badgeId > 0)
      .sort((a, b) => a.level - b.level)[0];
    if (!nextLevel) return null;
    return { ...nextLevel, ...this.badgePackItem(nextLevel.level) };
  }

  async groupFounderId(groupId) {
    const raw = await this.app.client.getGroupFounder(Number(groupId));
    const unwrapped = unwrapApiResult(raw);
    const founder = findObject(raw, ['founder', 'user', 'member', 'info']);
    const id = Number(
      founder?.id
      ?? founder?.user_id
      ?? founder?.userId
      ?? founder?.member_id
      ?? founder?.founder_id
      ?? founder?.founderId
      ?? unwrapped
    );
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  async isGroupFounder(groupId, userId) {
    const founderId = await this.groupFounderId(groupId);
    return founderId !== null && founderId === Number(userId);
  }

  async createOwnerBadgePack({ groupId, userId, levels = LEVEL_BADGE_PACK.map((item) => item.level), progress = null }) {
    if (!await this.isGroupFounder(groupId, userId)) {
      throw new Error('Simgeli rozet paketini yalnızca bu sunucunun sahibi oluşturabilir.');
    }
    return this.createMilestoneBadges(groupId, levels, progress);
  }

  badgeId(item) {
    const id = Number(item?.id ?? item?.badge_id ?? item?.badgeId);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  async recoverBadgeId(groupId, payload, { attempts = 6, delayMs = 350 } = {}) {
    const targetNick = normalizeName(payload.nick || payload.name);
    const targetName = normalizeName(payload.name);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await sleep(delayMs * attempt);
      try {
        const raw = await this.app.client.api('/!api/badge/list', { group_id: Number(groupId) }, {
          bypassCache: true,
          cacheTtlMs: 0,
          dedupe: false,
          priority: 'high'
        });
        const badges = findArray(raw, ['badges', 'list', 'items']);
        const match = badges.find((item) => {
          const nick = normalizeName(item?.nick || item?.slug);
          const name = normalizeName(item?.name || item?.title);
          return (targetNick && nick === targetNick) || (targetName && name === targetName);
        });
        const id = this.badgeId(match);
        if (id) return id;
      } catch (error) {
        this.app.logger?.warn?.('Yeni rozet ID değeri listeden kurtarılamadı.', {
          groupId: Number(groupId), attempt: attempt + 1, message: error.message
        });
      }
    }
    return null;
  }

  async createBadgeReward(groupId, level, options = {}) {
    const numericLevel = Math.max(1, integer(level, 1));
    const packItem = this.badgePackItem(numericLevel);
    let image = String(options.image || '').trim();
    if (!image && this.app.services.cards?.createLevelBadgeIcon) {
      try {
        const icon = await this.app.services.cards.createLevelBadgeIcon({
          level: numericLevel,
          title: packItem.title,
          emoji: packItem.emoji,
          accent: packItem.accent,
          accent2: packItem.accent2
        });
        image = icon.url || '';
      } catch (error) {
        this.app.logger?.warn?.('Seviye rozeti görseli üretilemedi; simgeli ad ile devam ediliyor.', {
          groupId: Number(groupId), level: numericLevel, message: error.message
        });
      }
    }
    const created = await this.app.services.apiManagement.createBadge(groupId, {
      name: options.name || `${packItem.emoji} ${packItem.title}`,
      nick: options.nick || `toply-seviye-${numericLevel}-${normalizeName(packItem.title)}`,
      description: options.description || `ToplyBot simgeli rozet paketi • Sunucuda ${numericLevel}. seviyeye ulaşan üyelere otomatik verilir.`,
      image,
      level: options.tier || this.badgeTier(numericLevel)
    });
    let badgeId = Number(created.id);
    if (!Number.isInteger(badgeId) || badgeId <= 0) {
      badgeId = await this.recoverBadgeId(groupId, created.payload);
    }
    if (!Number.isInteger(badgeId) || badgeId <= 0) {
      throw new Error('Rozet oluşturuldu ancak rozet ID bulunamadı. !rozetler ile ID’yi bulup !seviyerozet komutuyla eşleştir.');
    }
    await this.mapBadgeReward(groupId, numericLevel, badgeId);
    const originalId = Number(created.id);
    return { ...created, id: badgeId, recovered: !Number.isInteger(originalId) || originalId <= 0 };
  }

  async createMilestoneBadges(groupId, levels = LEVEL_BADGE_PACK.map((item) => item.level), progress = null) {
    const normalized = [...new Set(levels.map(Number).filter((level) => Number.isInteger(level) && level > 0))].sort((a, b) => a - b);
    if (!normalized.length) throw new Error('En az bir geçerli seviye girilmelidir.');
    const settings = await this.settings(groupId);
    const existing = { ...(settings.badgeRewards || {}) };
    const created = [];
    const skipped = [];
    const failed = [];
    for (let index = 0; index < normalized.length; index += 1) {
      const level = normalized[index];
      if (Number.isInteger(Number(existing[String(level)]))) {
        skipped.push(level);
      } else {
        await progress?.update?.(Math.round(((index + 0.15) / normalized.length) * 90), `Seviye ${level} rozeti hazırlanıyor…`, `${index + 1}/${normalized.length}`);
        try {
          const badge = await this.createBadgeReward(groupId, level);
          existing[String(level)] = Number(badge.id);
          created.push({ level, badgeId: Number(badge.id), recovered: badge.recovered });
        } catch (error) {
          failed.push({ level, message: error.message });
        }
      }
    }
    await progress?.update?.(95, 'Rozet ödül haritası doğrulanıyor…');
    return {
      created,
      skipped,
      failed,
      rewards: await this.settings(groupId).then((value) => value.badgeRewards || {})
    };
  }

  async syncUserRewards(groupId, userId, { source = 'reward-sync' } = {}) {
    const settings = await this.settings(groupId);
    const profile = await this.getProfile(groupId, userId);
    const rewards = await this.awardLevelRewards({
      groupId,
      userId,
      beforeLevel: 0,
      afterLevel: profile.level,
      settings,
      profile
    });
    await this.app.services.audit?.write?.('level.reward_sync', {
      targetUserId: Number(userId),
      level: profile.level,
      source,
      roles: rewards.roles,
      badges: rewards.badges,
      roleFailures: rewards.roleFailures,
      badgeFailures: rewards.badgeFailures
    }, { groupId, notify: false });
    return { profile, rewards };
  }

  async syncAllRewards(groupId, progress = null) {
    const profiles = await this.listProfiles(groupId);
    const results = [];
    for (let index = 0; index < profiles.length; index += 1) {
      const profile = profiles[index];
      await progress?.update?.(
        Math.max(5, Math.round(((index + 0.3) / Math.max(1, profiles.length)) * 95)),
        `#${profile.userId} ödülleri kontrol ediliyor…`,
        `${index + 1}/${profiles.length}`
      );
      try {
        results.push({ userId: profile.userId, ok: true, ...(await this.syncUserRewards(groupId, profile.userId, { source: 'bulk-sync' })) });
      } catch (error) {
        results.push({ userId: profile.userId, ok: false, error: error.message });
      }
    }
    return {
      total: profiles.length,
      succeeded: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok),
      results
    };
  }

  async dashboard(groupId, userId) {
    const [settings, profile, profiles, badges, isGroupFounder] = await Promise.all([
      this.settings(groupId),
      this.getProfile(groupId, userId),
      this.listProfiles(groupId),
      this.app.services.apiManagement?.listBadges?.(groupId).catch(() => []) || [],
      this.isGroupFounder(groupId, userId).catch(() => false)
    ]);
    const top = profiles.sort((a, b) => b.xp - a.xp || b.messages - a.messages).slice(0, 5);
    return {
      settings,
      profile,
      progress: this.progress(profile, settings),
      totalProfiles: profiles.length,
      totalXp: profiles.reduce((sum, item) => sum + item.xp, 0),
      top,
      badges,
      isGroupFounder,
      badgeRewards: settings.badgeRewards || {},
      roleRewards: settings.roleRewards || {}
    };
  }
}

module.exports = LevelingService;
module.exports.uniquePositiveIds = uniquePositiveIds;
module.exports.LEVEL_BADGE_PACK = LEVEL_BADGE_PACK;
