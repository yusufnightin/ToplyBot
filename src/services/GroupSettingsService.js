const { deepMerge, setPath } = require('../utils/object');

const DEFAULT_GROUP_SETTINGS = Object.freeze({
  channels: {
    welcome: '',
    leave: '',
    logs: '',
    ticketLogs: '',
    moderationLogs: '',
    announcements: '',
    levels: '',
    tickets: '',
    giveaways: '',
    social: '',
    polls: '',
    statistics: '',
    system: ''
  },
  welcome: {
    enabled: true,
    message: 'Hoş geldin, kullanıcı #{userId}! Topluluğumuz artık {memberCount} kişi.',
    dmEnabled: false,
    dmMessage: '{groupName} grubuna hoş geldin! Kuralları okumayı unutma.',
    embedEnabled: true,
    cardEnabled: true,
    background: '#071327',
    accent: '#2EA8FF',
    showAvatar: true,
    showServerInfo: true
  },
  leave: {
    enabled: true,
    message: 'Kullanıcı #{userId} gruptan ayrıldı.'
  },
  autorole: {
    enabled: false,
    roleIds: [],
    removeRoleIds: []
  },
  selfRoles: [],
  rolePanels: [],
  registration: {
    enabled: false,
    roleIds: []
  },
  moderation: {
    enabled: true,
    antiSpam: true,
    antiFlood: true,
    spamMessageCount: 5,
    spamIntervalSeconds: 7,
    duplicateMessageCount: 3,
    duplicateIntervalSeconds: 20,
    blockLinks: false,
    allowedDomains: [],
    bannedDomains: [],
    bannedWords: [],
    capsFilter: false,
    capsPercent: 80,
    capsMinLength: 12,
    mentionSpam: true,
    mentionLimit: 5,
    slowmodeSeconds: 0,
    autoKickAtWarnings: 5,
    autoTimeoutAtWarnings: 3,
    autoTimeoutMinutes: 10,
    muteRoleId: null,
    deleteViolations: false
  },
  leveling: {
    enabled: true,
    xpPerMessage: 10,
    xpMin: 8,
    xpMax: 12,
    multiplier: 1,
    cooldownSeconds: 45,
    minMessageLength: 3,
    dailyXpCap: 0,
    curveBaseXp: 100,
    curveExponent: 2,
    ignoredChannelIds: [],
    announceLevelUp: true,
    levelUpMessage: '⭐ Tebrikler kullanıcı #{userId}! Seviye {level} oldun.',
    roleRewards: {},
    badgeRewards: {},
    cardEnabled: true,
    cardAccent: '#7c5cff'
  },
  giveaways: {
    enabled: true
  },
  tickets: {
    enabled: true,
    staffRoleIds: [],
    channelPrefix: 'ticket',
    createPrivateChannel: true,
    deleteChannelOnClose: false,
    welcomeMessage: 'Destek talebin açıldı. Yetkililer en kısa sürede ilgilenecek.'
  },
  customCommands: {
    enabled: true
  },
  automations: {
    enabled: true,
    keywordReplies: [],
    scheduledMessages: []
  },
  social: {
    enabled: true,
    pollMinutes: 5
  },
  polls: {
    enabled: true
  },
  maintenance: {
    autoBackupEnabled: true,
    autoBackupHours: 24,
    healthAlerts: true,
    healthCheckHours: 6,
    maxBackups: 20
  }
});

class GroupSettingsService {
  constructor({ store, config = {} }) {
    this.store = store;
    this.config = config;
  }

  normalizeGroupId(groupId) {
    if (groupId === null || groupId === undefined || groupId === '') {
      throw new TypeError('Sunucuya özel ayar için grup ID gerekli.');
    }
    const numeric = Number(groupId);
    if (!Number.isInteger(numeric) || numeric <= 0) throw new TypeError('Geçerli bir grup ID gerekli.');
    return String(numeric);
  }

  withoutRemovedSettings(value) {
    const normalized = value && typeof value === 'object' && !Array.isArray(value)
      ? structuredClone(value)
      : {};
    delete normalized.economy;
    delete normalized.invites;
    return normalized;
  }

  configDefaults(_groupId = null) {
    const features = this.config.features || {};
    const serverDefaults = this.config.serverDefaults && typeof this.config.serverDefaults === 'object'
      ? this.config.serverDefaults
      : {};

    // Kanal ID'leri config.json'dan bütün sunuculara yayılmaz. Her kanal seçimi
    // data/group-settings.json içinde ilgili grup ID'sinin altında tutulur.
    const base = this.withoutRemovedSettings(deepMerge(DEFAULT_GROUP_SETTINGS, serverDefaults));
    return this.withoutRemovedSettings(deepMerge(base, {
      welcome: {
        message: features.welcomeMessage || base.welcome.message
      },
      leave: {
        message: features.leaveMessage || base.leave.message
      },
      autorole: {
        enabled: features.autoroleEnabled === undefined
          ? base.autorole.enabled
          : Boolean(features.autoroleEnabled),
        roleIds: Array.isArray(features.autoroleRoleIds)
          ? features.autoroleRoleIds.map(Number).filter(Number.isInteger)
          : base.autorole.roleIds
      }
    }));
  }

  legacyChannelsFor(groupId) {
    const defaultGroupId = Number(this.config.defaultGroupId);
    if (!Number.isInteger(defaultGroupId) || Number(groupId) !== defaultGroupId) return null;
    const channels = this.config.channels;
    if (!channels || typeof channels !== 'object' || Array.isArray(channels)) return null;
    const normalized = Object.fromEntries(
      Object.entries(channels)
        .filter(([, value]) => value !== null && value !== undefined && value !== '')
        .map(([key, value]) => [key, String(value)])
    );
    return Object.keys(normalized).length ? normalized : null;
  }

  async get(groupId) {
    const key = this.normalizeGroupId(groupId);
    const all = await this.store.read();
    const stored = all[key];
    if (stored) return this.withoutRemovedSettings(deepMerge(this.configDefaults(groupId), stored));

    // Eski tek-sunucu config.channels değerleri yalnızca defaultGroupId için
    // bir kez sunucuya özel depoya taşınır; diğer sunucular bu ID'leri miras almaz.
    const legacyChannels = this.legacyChannelsFor(groupId);
    if (legacyChannels) {
      const migrated = this.withoutRemovedSettings(deepMerge(this.configDefaults(groupId), { channels: legacyChannels }));
      await this.store.update((current) => {
        if (!current[key]) current[key] = migrated;
        return current;
      });
      return migrated;
    }

    return this.configDefaults(groupId);
  }

  async set(groupId, path, value) {
    const key = this.normalizeGroupId(groupId);
    let updated;
    await this.store.update((all) => {
      let current = this.withoutRemovedSettings(deepMerge(this.configDefaults(groupId), all[key] || {}));
      setPath(current, path, value);
      current = this.withoutRemovedSettings(current);
      all[key] = current;
      updated = structuredClone(current);
      return all;
    });
    return updated;
  }

  async replace(groupId, value) {
    const key = this.normalizeGroupId(groupId);
    const normalized = this.withoutRemovedSettings(value);
    await this.store.update((all) => {
      all[key] = this.withoutRemovedSettings(deepMerge(this.configDefaults(groupId), normalized));
      return all;
    });
    return this.get(groupId);
  }

  async listGroupIds() {
    const all = await this.store.read();
    return Object.keys(all)
      .filter((key) => /^\d+$/.test(key))
      .map(Number)
      .sort((a, b) => a - b);
  }
}

GroupSettingsService.DEFAULTS = DEFAULT_GROUP_SETTINGS;
module.exports = GroupSettingsService;
