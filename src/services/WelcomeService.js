const { findArray, findObject } = require('../utils/api');
const { assertApiSuccess } = require('../utils/apiResult');
const { renderTemplate } = require('../utils/templates');
const { truncate } = require('../utils/text');

function publicUser(result, userId) {
  const value = findObject(result, ['user', 'profile']) || {};
  return {
    id: Number(value.id ?? value.user_id ?? userId),
    name: value.name || value.nick || `Kullanıcı #${userId}`,
    nick: value.nick || '',
    image: value.image || value.avatar || ''
  };
}

function publicGroup(result, groupId) {
  const value = findObject(result, ['group']) || {};
  return {
    id: Number(value.id ?? value.group_id ?? groupId),
    name: value.name || value.title || value.nick || `Grup #${groupId}`,
    nick: value.nick || '',
    description: value.description || ''
  };
}

function promiseTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} ${timeoutMs} ms içinde tamamlanmadı.`)), timeoutMs);
      timer.unref?.();
    })
  ]).finally(() => clearTimeout(timer));
}

class WelcomeService {
  constructor({ app, metadataTimeoutMs = 4500, dedupeMs = 5000, accessCacheMs = 10 * 60 * 1000 }) {
    this.app = app;
    this.metadataTimeoutMs = Math.max(1000, Number(metadataTimeoutMs) || 4500);
    this.dedupeMs = Math.max(1000, Number(dedupeMs) || 5000);
    this.accessCacheMs = Math.max(30000, Number(accessCacheMs) || 600000);
    this.recentEvents = new Map();
    this.accessCache = new Map();
    this.lastByGroup = new Map();
  }

  normalizeEvent(event = {}) {
    const groupId = Number(event.group_id ?? event.groupId);
    const userId = Number(event.user_id ?? event.userId);
    if (!Number.isInteger(groupId) || groupId <= 0) throw new Error('group/join olayında geçerli group_id bulunamadı.');
    if (!Number.isInteger(userId) || userId <= 0) throw new Error('group/join olayında geçerli user_id bulunamadı.');
    return { groupId, userId };
  }

  remember(groupId, state) {
    this.lastByGroup.set(String(groupId), { at: new Date().toISOString(), ...state });
  }

  isDuplicate(groupId, userId) {
    const key = `${groupId}:${userId}`;
    const now = Date.now();
    const previous = this.recentEvents.get(key) || 0;
    this.recentEvents.set(key, now);
    for (const [eventKey, timestamp] of this.recentEvents) {
      if (now - timestamp > this.dedupeMs * 3) this.recentEvents.delete(eventKey);
    }
    return now - previous < this.dedupeMs;
  }

  async resolveChannel(groupId, configuredValue, { persist = true } = {}) {
    const raw = String(configuredValue ?? '').trim();
    if (!raw) throw new Error('Hoş geldin kanalı ayarlanmamış.');
    if (/^\d+$/.test(raw)) return { id: Number(raw), migrated: false };
    const channel = await this.app.services.channels.resolve(groupId, raw);
    if (persist) await this.app.services.settings.set(groupId, 'channels.welcome', String(channel.id));
    return { ...channel, migrated: true };
  }

  async ensureBotAccess(channelId, { force = false } = {}) {
    const botUserId = await this.app.client.getCurrentUserId({ force: false });
    const cacheKey = `${channelId}:${botUserId}`;
    const cachedUntil = this.accessCache.get(cacheKey) || 0;
    if (!force && cachedUntil > Date.now()) return { botUserId, repaired: false, cached: true };

    const result = await this.app.client.grantChannelAccess(channelId, botUserId, {
      read: true,
      write: true,
      control: false
    });
    this.accessCache.set(cacheKey, Date.now() + this.accessCacheMs);
    return { botUserId, repaired: true, cached: false, result };
  }

  async collectMetadata(groupId, userId) {
    const jobs = [
      promiseTimeout(this.app.client.listMembers(groupId), this.metadataTimeoutMs, 'Üye listesi'),
      promiseTimeout(this.app.client.getGroup(groupId), this.metadataTimeoutMs, 'Grup bilgisi'),
      promiseTimeout(this.app.client.getUser(userId), this.metadataTimeoutMs, 'Kullanıcı bilgisi')
    ];
    const [membersResult, groupResult, userResult] = await Promise.allSettled(jobs);
    const members = membersResult.status === 'fulfilled' ? findArray(membersResult.value, ['members', 'list']) : [];
    const group = groupResult.status === 'fulfilled' ? publicGroup(groupResult.value, groupId) : publicGroup({}, groupId);
    const user = userResult.status === 'fulfilled' ? publicUser(userResult.value, userId) : publicUser({}, userId);
    return {
      members,
      group,
      user,
      metadataErrors: [membersResult, groupResult, userResult]
        .filter((item) => item.status === 'rejected')
        .map((item) => item.reason?.message || String(item.reason))
    };
  }

  async composeMessage(settings, groupId, userId) {
    const { members, group, user, metadataErrors } = await this.collectMetadata(groupId, userId);
    const variables = {
      userId,
      userName: user.name,
      userNick: user.nick,
      groupId,
      groupName: group.name,
      groupNick: group.nick,
      memberCount: members.length || '?'
    };
    const lines = [renderTemplate(settings.welcome.message, variables)];

    if (settings.welcome.embedEnabled && settings.welcome.showServerInfo) {
      lines.push(`🏠 ${group.name}`);
      lines.push(`👥 Üye sayısı: ${variables.memberCount}`);
      if (group.description) lines.push(`📝 ${truncate(group.description, 250)}`);
    }

    if (settings.welcome.cardEnabled) {
      try {
        const card = await this.app.services.cards.createWelcomeCard({
          userId,
          userName: user.nick || user.name,
          avatarUrl: settings.welcome.showAvatar ? user.image : '',
          groupName: group.name,
          memberCount: variables.memberCount,
          background: settings.welcome.background,
          accent: settings.welcome.accent
        });
        // Topluyo görsel algılayıcısı URL uzantısına baktığı için kart URL'sini
        // tek başına gönderiyoruz. Public URL yoksa aynı tasarımın native JTML
        // karşılığı kullanılır; kullanıcı ek ayar yapmak zorunda kalmaz.
        if (card.url) lines.push(card.url);
        else if (card.jtml) lines.push(card.jtml);
      } catch (error) {
        this.app.logger?.warn('Hoş geldin kartı üretilemedi; metin mesajı gönderilmeye devam ediliyor.', {
          groupId, userId, message: error.message
        });
      }
    }

    return { text: truncate(lines.join('\n'), 1800), variables, user, metadataErrors };
  }

  async sendWelcome({ groupId, userId, settings = null, source = 'event', repairAccess = true }) {
    const current = settings || await this.app.services.settings.get(groupId);
    if (!current.welcome?.enabled) throw new Error('Karşılama sistemi kapalı.');
    const channel = await this.resolveChannel(groupId, current.channels?.welcome);

    let access = null;
    if (repairAccess) {
      try {
        access = await this.ensureBotAccess(channel.id);
      } catch (error) {
        this.app.logger?.warn('Hoş geldin kanalında bot yazma erişimi otomatik doğrulanamadı; gönderim yine de denenecek.', {
          groupId, channelId: channel.id, message: error.message
        });
      }
    }

    const built = await this.composeMessage(current, groupId, userId);
    const postResult = await this.app.client.sendPost(channel.id, built.text);
    assertApiSuccess(postResult, 'Hoş geldin mesajı gönderimi');

    if (current.welcome.dmEnabled && current.welcome.dmMessage) {
      try {
        const dmResult = await this.app.client.sendDirectMessage(
          userId,
          truncate(renderTemplate(current.welcome.dmMessage, built.variables), 1800)
        );
        assertApiSuccess(dmResult, 'Hoş geldin DM gönderimi');
      } catch (error) {
        this.app.logger?.warn('Hoş geldin DM mesajı gönderilemedi.', { groupId, userId, message: error.message });
      }
    }

    await this.app.services.audit.write('member.join', {
      targetUserId: userId,
      memberCount: built.variables.memberCount,
      source
    }, {
      groupId,
      text: `Üye katıldı: #${userId}\nToplam üye: ${built.variables.memberCount}`
    });

    const state = {
      status: 'sent', source, userId, channelId: channel.id,
      botUserId: access?.botUserId || this.app.client.userId || null,
      metadataErrors: built.metadataErrors
    };
    this.remember(groupId, state);
    this.app.logger?.info('Hoş geldin mesajı gönderildi.', state);
    return state;
  }

  async handleJoin(event) {
    const { groupId, userId } = this.normalizeEvent(event);
    this.app.logger?.info('Topluyo group/join olayı alındı.', { groupId, userId });

    if (this.isDuplicate(groupId, userId)) {
      const state = { status: 'skipped', reason: 'duplicate', userId };
      this.remember(groupId, state);
      this.app.logger?.info('Yinelenen group/join olayı atlandı.', { groupId, userId });
      return state;
    }

    const settings = await this.app.services.settings.get(groupId);
    if (!settings.welcome?.enabled) {
      await this.app.services.audit.write('member.join', {
        targetUserId: userId,
        source: 'group/join',
        welcomeStatus: 'disabled'
      }, {
        groupId,
        text: `Üye katıldı: #${userId}\nKarşılama mesajı: kapalı`
      });
      const state = { status: 'skipped', reason: 'disabled', userId };
      this.remember(groupId, state);
      this.app.logger?.info('Hoş geldin mesajı atlandı: sistem kapalı.', { groupId, userId });
      return state;
    }
    if (!String(settings.channels?.welcome || '').trim()) {
      await this.app.services.audit.write('member.join', {
        targetUserId: userId,
        source: 'group/join',
        welcomeStatus: 'channel_not_configured'
      }, {
        groupId,
        text: `Üye katıldı: #${userId}\nKarşılama mesajı: kanal ayarlanmamış`
      });
      const state = { status: 'skipped', reason: 'channel_not_configured', userId };
      this.remember(groupId, state);
      this.app.logger?.warn('Hoş geldin mesajı atlandı: kanal ayarlanmamış.', { groupId, userId });
      return state;
    }

    try {
      return await this.sendWelcome({ groupId, userId, settings, source: 'group/join' });
    } catch (error) {
      await this.app.services.audit.write('member.join', {
        targetUserId: userId,
        source: 'group/join',
        welcomeStatus: 'error',
        welcomeError: error.message
      }, {
        groupId,
        text: `Üye katıldı: #${userId}\nKarşılama mesajı gönderilemedi: ${error.message}`
      });
      const state = { status: 'error', reason: error.message, userId };
      this.remember(groupId, state);
      this.app.logger?.error('Karşılama olayı işlenemedi.', { groupId, userId, message: error.message, stack: error.stack });
      throw error;
    }
  }

  async repair(groupId, { enable = true, sendTest = false, testUserId = null } = {}) {
    if (enable) await this.app.services.settings.set(groupId, 'welcome.enabled', true);
    const settings = await this.app.services.settings.get(groupId);
    const channel = await this.resolveChannel(groupId, settings.channels?.welcome);
    const access = await this.ensureBotAccess(channel.id, { force: true });
    let test = null;
    if (sendTest) {
      const userId = Number(testUserId) || access.botUserId;
      test = await this.sendWelcome({ groupId, userId, settings: await this.app.services.settings.get(groupId), source: 'repair-test', repairAccess: false });
    }
    return { groupId: Number(groupId), channelId: channel.id, botUserId: access.botUserId, test };
  }

  async diagnostics(groupId) {
    const settings = await this.app.services.settings.get(groupId);
    let channel = null;
    let channelError = null;
    try { channel = await this.resolveChannel(groupId, settings.channels?.welcome, { persist: false }); }
    catch (error) { channelError = error.message; }
    let botUserId = this.app.client.userId || null;
    let botIdError = null;
    try { botUserId = await this.app.client.getCurrentUserId(); }
    catch (error) { botIdError = error.message; }
    return {
      groupId: Number(groupId),
      enabled: Boolean(settings.welcome?.enabled),
      configuredChannel: settings.channels?.welcome || '',
      channelId: channel?.id || null,
      channelError,
      botUserId,
      botIdError,
      pluginLoaded: this.app.config.plugins.includes('welcome'),
      last: this.lastByGroup.get(String(groupId)) || null
    };
  }
}

module.exports = WelcomeService;
