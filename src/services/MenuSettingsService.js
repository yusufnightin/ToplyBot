const { getPath } = require('../utils/object');

const CATEGORIES = [
  {
    id: 'welcome', emoji: '👋', title: 'Hoş Geldin Kurulumu',
    description: 'Karşılama kanalı, mesajı, DM, kart ve ayrılma ayarları.'
  },
  {
    id: 'channels', emoji: '📡', title: 'Diğer Kanal Bağlantıları',
    description: 'Log, duyuru, ticket ve istatistik kanalları.'
  },
  {
    id: 'roles', emoji: '🎭', title: 'Rol ve Kayıt',
    description: 'Otorol, kaldırılacak roller, kendin-al rolleri ve kayıt.'
  },
  {
    id: 'moderation', emoji: '🛡️', title: 'Moderasyon',
    description: 'Spam, flood, link, caps, mention, timeout ve uyarı limitleri.'
  },
  {
    id: 'tickets', emoji: '🎫', title: 'Ticket ve Destek',
    description: 'Ticket sistemi, yetkili rolleri, kanal ve karşılama metni.'
  },
  {
    id: 'automation', emoji: '⚡', title: 'Otomasyon ve Özel Komut',
    description: 'Otomasyon ve özel komut sistemlerinin genel durumları.'
  },
  {
    id: 'leveling', emoji: '⭐', title: 'Seviye ve Rozet',
    description: 'XP kazanımı, seviye duyurusu, rank kartı ve ödül altyapısı.'
  },
  {
    id: 'maintenance', emoji: '🩺', title: 'Sistem Sağlığı ve Yedek',
    description: 'Otomatik yedek, sistem kontrolü, uyarı ve bakım ayarları.'
  }
];

function field(category, path, title, type, options = {}) {
  return { id: options.id || path, category, path, title, type, ...options };
}

const CHANNEL_HELP = 'Kanal ID veya #kanaladı yazabilirsin. Örnek: #hoş-geldin';

const FIELDS = [
  field('welcome', 'channels.welcome', 'Hoş geldin kanalı', 'channel', {
    description: `Yeni üyelerin karşılanacağı kanal. ${CHANNEL_HELP}`
  }),
  field('welcome', 'welcome.enabled', 'Karşılama sistemi', 'boolean'),
  field('welcome', 'welcome.message', 'Karşılama mesajı', 'text', {
    maxLength: 1000,
    description: 'Değişkenler: {userId}, {userName}, {userNick}, {groupName}, {memberCount}'
  }),
  field('welcome', 'welcome.dmEnabled', 'Özel mesajla karşılama', 'boolean'),
  field('welcome', 'welcome.dmMessage', 'DM karşılama mesajı', 'text', {
    maxLength: 1500,
    description: 'Yeni üyeye özel mesaj olarak gönderilir.'
  }),
  field('welcome', 'welcome.embedEnabled', 'Zengin karşılama görünümü', 'boolean'),
  field('welcome', 'welcome.cardEnabled', 'Karşılama kartı', 'boolean'),
  field('welcome', 'welcome.background', 'Kart arka planı', 'text', {
    maxLength: 500,
    description: '#RRGGBB renk veya görsel URL’si.'
  }),
  field('welcome', 'welcome.accent', 'Kart vurgu rengi', 'color'),
  field('welcome', 'welcome.showAvatar', 'Kartta avatar göster', 'boolean'),
  field('welcome', 'welcome.showServerInfo', 'Sunucu bilgisini göster', 'boolean'),
  field('welcome', 'channels.leave', 'Ayrılma kanalı', 'channel', {
    description: `Ayrılan üyeler için mesaj kanalı. ${CHANNEL_HELP}`
  }),
  field('welcome', 'leave.enabled', 'Ayrılma mesajı sistemi', 'boolean'),
  field('welcome', 'leave.message', 'Ayrılma mesajı', 'text', { maxLength: 1000 }),

  field('channels', 'channels.logs', 'Log kanalı', 'channel', {
    description: `Sistem, ayar, bakım ve genel denetim kayıtlarının gönderileceği kanal. Kaydettikten sonra !logtest ile dene. ${CHANNEL_HELP}`
  }),
  field('channels', 'channels.ticketLogs', 'Ticket log kanalı', 'channel', {
    description: `Ticket açma, kapatma ve destek kayıtlarının gönderileceği kanal. ${CHANNEL_HELP}`
  }),
  field('channels', 'channels.moderationLogs', 'Moderasyon log kanalı', 'channel', {
    description: `Uyarı, timeout, ban ve moderasyon kayıtlarının gönderileceği kanal. ${CHANNEL_HELP}`
  }),
  field('channels', 'channels.announcements', 'Duyuru kanalı', 'channel', {
    description: `Bot duyurularının gönderileceği kanal. ${CHANNEL_HELP}`
  }),
  field('channels', 'channels.tickets', 'Ticket kanalı', 'channel', {
    description: `Özel kanal oluşturulmazsa ticketların gönderileceği kanal. ${CHANNEL_HELP}`
  }),
  field('channels', 'channels.statistics', 'İstatistik kanalı', 'channel', {
    description: `İstatistik raporlarının gönderileceği kanal. ${CHANNEL_HELP}`
  }),
  field('channels', 'channels.levels', 'Seviye bildirim kanalı', 'channel', {
    description: `Seviye atlama mesajlarının gönderileceği kanal. ${CHANNEL_HELP}`
  }),
  field('channels', 'channels.giveaways', 'Çekiliş kanalı', 'channel', {
    description: `Çekiliş bildirimlerinin gönderileceği kanal. ${CHANNEL_HELP}`
  }),
  field('channels', 'channels.social', 'Sosyal akış kanalı', 'channel', {
    description: `Sosyal medya akışlarının gönderileceği kanal. ${CHANNEL_HELP}`
  }),
  field('channels', 'channels.polls', 'Anket kanalı', 'channel', {
    description: `Anketlerin gönderileceği kanal. ${CHANNEL_HELP}`
  }),

  field('roles', 'autorole.enabled', 'Otorol sistemi', 'boolean'),
  field('roles', 'autorole.roleIds', 'Verilecek otoroller', 'id-list', {
    description: 'Virgülle ayrılmış rol ID’leri.'
  }),
  field('roles', 'autorole.removeRoleIds', 'Kaldırılacak başlangıç rolleri', 'id-list', {
    description: 'Yeni üye katıldığında kaldırılacak rol ID’leri.'
  }),
  field('roles', 'selfRoles', 'Kendin-al rolleri', 'id-list', {
    description: 'Kullanıcıların kendilerine verebileceği rol ID’leri.'
  }),
  field('roles', 'registration.enabled', 'Kayıt sistemi', 'boolean'),
  field('roles', 'registration.roleIds', 'Kayıt sonrası roller', 'id-list'),

  field('moderation', 'moderation.enabled', 'Otomatik moderasyon', 'boolean'),
  field('moderation', 'moderation.antiSpam', 'Spam koruması', 'boolean'),
  field('moderation', 'moderation.spamMessageCount', 'Spam mesaj limiti', 'integer', { min: 3, max: 100 }),
  field('moderation', 'moderation.spamIntervalSeconds', 'Spam zaman aralığı', 'integer', { min: 2, max: 3600, suffix: 'sn' }),
  field('moderation', 'moderation.antiFlood', 'Tekrarlı mesaj koruması', 'boolean'),
  field('moderation', 'moderation.duplicateMessageCount', 'Flood tekrar limiti', 'integer', { min: 2, max: 100 }),
  field('moderation', 'moderation.duplicateIntervalSeconds', 'Flood zaman aralığı', 'integer', { min: 5, max: 3600, suffix: 'sn' }),
  field('moderation', 'moderation.blockLinks', 'Link engeli', 'boolean'),
  field('moderation', 'moderation.allowedDomains', 'İzinli domainler', 'string-list', {
    description: 'Virgül veya yeni satırla ayrılmış domainler.'
  }),
  field('moderation', 'moderation.bannedDomains', 'Yasaklı domainler', 'string-list'),
  field('moderation', 'moderation.bannedWords', 'Yasaklı kelimeler', 'string-list'),
  field('moderation', 'moderation.capsFilter', 'Büyük harf filtresi', 'boolean'),
  field('moderation', 'moderation.capsPercent', 'Büyük harf yüzdesi', 'integer', { min: 1, max: 100, suffix: '%' }),
  field('moderation', 'moderation.capsMinLength', 'Caps minimum mesaj uzunluğu', 'integer', { min: 1, max: 500 }),
  field('moderation', 'moderation.mentionSpam', 'Mention spam koruması', 'boolean'),
  field('moderation', 'moderation.mentionLimit', 'Mention limiti', 'integer', { min: 2, max: 50 }),
  field('moderation', 'moderation.slowmodeSeconds', 'Bot slowmode süresi', 'integer', { min: 0, max: 3600, suffix: 'sn' }),
  field('moderation', 'moderation.autoKickAtWarnings', 'Otomatik kick uyarı sayısı', 'integer', { min: 0, max: 100, description: '0 devre dışı bırakır.' }),
  field('moderation', 'moderation.autoTimeoutAtWarnings', 'Otomatik timeout uyarı sayısı', 'integer', { min: 0, max: 100, description: '0 devre dışı bırakır.' }),
  field('moderation', 'moderation.autoTimeoutMinutes', 'Otomatik timeout süresi', 'integer', { min: 1, max: 10080, suffix: 'dk' }),
  field('moderation', 'moderation.muteRoleId', 'Timeout/susturma rolü', 'role-null', { description: '0 veya boş değer susturma rolünü kaldırır.' }),
  field('moderation', 'moderation.deleteViolations', 'İhlal mesajlarını sil', 'boolean'),

  field('tickets', 'tickets.enabled', 'Ticket sistemi', 'boolean'),
  field('tickets', 'tickets.staffRoleIds', 'Ticket yetkili rolleri', 'id-list'),
  field('tickets', 'tickets.channelPrefix', 'Özel ticket kanal öneki', 'slug', { maxLength: 30 }),
  field('tickets', 'tickets.createPrivateChannel', 'Ticket için özel kanal oluştur', 'boolean'),
  field('tickets', 'tickets.deleteChannelOnClose', 'Kapanınca ticket kanalını sil', 'boolean'),
  field('tickets', 'tickets.welcomeMessage', 'Ticket karşılama mesajı', 'text', { maxLength: 1500 }),

  field('automation', 'automations.enabled', 'Kelime otomasyonları', 'boolean'),
  field('automation', 'customCommands.enabled', 'Özel komut sistemi', 'boolean'),

  field('leveling', 'leveling.enabled', 'Seviye sistemi', 'boolean'),
  field('leveling', 'leveling.xpMin', 'Minimum mesaj XP', 'integer', { min: 1, max: 1000 }),
  field('leveling', 'leveling.xpMax', 'Maksimum mesaj XP', 'integer', { min: 1, max: 1000 }),
  field('leveling', 'leveling.multiplier', 'XP çarpanı', 'decimal', { min: 0.1, max: 100, suffix: 'x' }),
  field('leveling', 'leveling.cooldownSeconds', 'XP bekleme süresi', 'integer', { min: 0, max: 3600, suffix: 'sn' }),
  field('leveling', 'leveling.minMessageLength', 'Minimum mesaj uzunluğu', 'integer', { min: 0, max: 500 }),
  field('leveling', 'leveling.ignoredChannelIds', 'XP verilmeyecek kanal ID’leri', 'id-list', { description: 'Virgülle ayır. Örnek: 123, 456' }),
  field('leveling', 'leveling.dailyXpCap', 'Günlük XP tavanı', 'integer', { min: 0, max: 100000000, description: '0 sınırsız anlamına gelir.' }),
  field('leveling', 'leveling.announceLevelUp', 'Seviye atlama duyurusu', 'boolean'),
  field('leveling', 'leveling.levelUpMessage', 'Seviye atlama mesajı', 'text', { maxLength: 1000, description: 'Değişkenler: {userId}, {level}, {xp}' }),
  field('leveling', 'leveling.cardEnabled', 'SVG rank kartı', 'boolean'),
  field('leveling', 'leveling.cardAccent', 'Rank kartı rengi', 'color'),
  field('leveling', 'leveling.curveBaseXp', 'Seviye eğrisi taban XP', 'integer', { min: 10, max: 100000 }),
  field('leveling', 'leveling.curveExponent', 'Seviye eğrisi üssü', 'decimal', { min: 1.2, max: 4 }),

  field('maintenance', 'channels.system', 'Sistem durumu kanalı', 'channel', {
    description: `Sağlık uyarıları ve otomatik bakım raporları. ${CHANNEL_HELP}`
  }),
  field('maintenance', 'maintenance.autoBackupEnabled', 'Otomatik yedek', 'boolean'),
  field('maintenance', 'maintenance.autoBackupHours', 'Yedek aralığı', 'integer', { min: 1, max: 168, suffix: 'saat' }),
  field('maintenance', 'maintenance.healthAlerts', 'Sistem sağlık uyarıları', 'boolean'),
  field('maintenance', 'maintenance.healthCheckHours', 'Sağlık kontrol aralığı', 'integer', { min: 1, max: 72, suffix: 'saat' }),
  field('maintenance', 'maintenance.maxBackups', 'Saklanacak yedek sayısı', 'integer', { min: 3, max: 100 })
];

function normalizeString(value) {
  return String(value ?? '').trim();
}

function parseList(raw, { numeric = false } = {}) {
  const parts = String(raw ?? '')
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (numeric) {
    const values = [...new Set(parts.map(Number).filter((value) => Number.isInteger(value) && value > 0))];
    if (parts.length && !values.length) throw new Error('En az bir geçerli pozitif ID girilmelidir.');
    return values;
  }
  return [...new Set(parts)];
}

class MenuSettingsService {
  constructor({ app }) {
    this.app = app;
  }

  categories() {
    return CATEGORIES.map((category) => ({
      ...category,
      fieldCount: FIELDS.filter((item) => item.category === category.id).length
    }));
  }

  category(categoryId) {
    return this.categories().find((item) => item.id === String(categoryId)) || null;
  }

  fields(categoryId) {
    return FIELDS.filter((item) => item.category === String(categoryId));
  }

  field(fieldId) {
    return FIELDS.find((item) => item.id === String(fieldId)) || null;
  }

  value(settings, fieldOrId) {
    const selected = typeof fieldOrId === 'string' ? this.field(fieldOrId) : fieldOrId;
    if (!selected) return undefined;
    return getPath(settings, selected.path);
  }

  format(fieldOrId, value, { compact = false, groupId = null } = {}) {
    const selected = typeof fieldOrId === 'string' ? this.field(fieldOrId) : fieldOrId;
    if (!selected) return '—';
    if (selected.type === 'boolean') return value ? 'Açık' : 'Kapalı';
    if (selected.type === 'channel') {
      if (value === null || value === undefined || value === '') return 'Ayarsız';
      return this.app.services.channels?.describe?.(groupId, value) || `Kanal #${value}`;
    }
    if (Array.isArray(value)) {
      if (!value.length) return 'Boş';
      const text = value.join(', ');
      return compact && text.length > 38 ? `${text.slice(0, 35)}…` : text;
    }
    if (value === null || value === undefined || value === '') return 'Ayarsız';
    const text = String(value);
    const suffix = selected.suffix ? ` ${selected.suffix}` : '';
    if (compact && text.length > 40) return `${text.slice(0, 37)}…`;
    return `${text}${suffix}`;
  }

  inputValue(fieldOrId, value, { groupId = null } = {}) {
    const selected = typeof fieldOrId === 'string' ? this.field(fieldOrId) : fieldOrId;
    if (!selected) return '';
    if (selected.type === 'channel' && value) {
      return this.app.services.channels?.label?.(groupId, value) || String(value);
    }
    if (Array.isArray(value)) return value.join(', ');
    if (value === null || value === undefined) return '';
    return String(value);
  }

  parse(fieldOrId, raw) {
    const selected = typeof fieldOrId === 'string' ? this.field(fieldOrId) : fieldOrId;
    if (!selected) throw new Error('Ayar alanı bulunamadı.');
    const value = normalizeString(raw);

    if (selected.type === 'text') return String(raw ?? '').trim().slice(0, selected.maxLength || 1800);
    if (selected.type === 'channel') {
      if (!value || ['0', 'kapat', 'sil', 'boş', 'bos'].includes(value.toLocaleLowerCase('tr-TR'))) return '';
      if (/^\d+$/.test(value) || /^<#\d+>$/.test(value) || /^#[^#\s].*$/.test(value)) return value;
      throw new Error('Kanal için ID veya #kanaladı kullan. Örnek: #hoş-geldin');
    }
    if (selected.type === 'role-null') {
      if (!value || value === '0') return null;
      const id = Number(value);
      if (!Number.isInteger(id) || id <= 0) throw new Error('Geçerli bir rol ID girilmelidir.');
      return id;
    }
    if (selected.type === 'id-list') return parseList(raw, { numeric: true });
    if (selected.type === 'string-list') return parseList(raw);
    if (selected.type === 'color') {
      if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Renk #RRGGBB biçiminde olmalıdır.');
      return value.toLowerCase();
    }
    if (selected.type === 'slug') {
      const slug = value.toLocaleLowerCase('tr-TR').replace(/[^a-z0-9çğıöşü_-]+/gi, '-').replace(/^-+|-+$/g, '');
      if (!slug) throw new Error('Geçerli bir önek girilmelidir.');
      return slug.slice(0, selected.maxLength || 60);
    }
    if (selected.type === 'decimal') {
      if (!/^-?(?:\d+|\d*\.\d+)$/.test(value)) throw new Error('Geçerli bir sayı girilmelidir.');
      const number = Number(value);
      if (!Number.isFinite(number)) throw new Error('Sayı desteklenen aralığın dışında.');
      if (selected.min !== undefined && number < selected.min) throw new Error(`En düşük değer ${selected.min}.`);
      if (selected.max !== undefined && number > selected.max) throw new Error(`En yüksek değer ${selected.max}.`);
      return number;
    }
    if (selected.type === 'integer') {
      if (!/^-?\d+$/.test(value)) throw new Error('Tam sayı girilmelidir.');
      const number = Number(value);
      if (!Number.isSafeInteger(number)) throw new Error('Sayı desteklenen aralığın dışında.');
      if (selected.min !== undefined && number < selected.min) throw new Error(`En düşük değer ${selected.min}.`);
      if (selected.max !== undefined && number > selected.max) throw new Error(`En yüksek değer ${selected.max}.`);
      return number;
    }
    if (selected.type === 'boolean') {
      const normalized = value.toLocaleLowerCase('tr-TR');
      if (['1', 'true', 'aç', 'ac', 'açık', 'acik'].includes(normalized)) return true;
      if (['0', 'false', 'kapat', 'kapalı', 'kapali'].includes(normalized)) return false;
      throw new Error('Değer açık veya kapalı olmalıdır.');
    }
    return value.slice(0, selected.maxLength || 1000);
  }

  async snapshot(groupId) {
    await this.app.services.channels?.prime?.(groupId);
    return this.app.services.settings.get(groupId);
  }

  async set(groupId, fieldId, rawValue, actorUserId) {
    const selected = this.field(fieldId);
    if (!selected) throw new Error('Ayar alanı bulunamadı.');
    let value = this.parse(selected, rawValue);
    let resolvedChannel = null;

    if (selected.type === 'channel' && value) {
      resolvedChannel = await this.app.services.channels.resolve(groupId, value);
      value = String(resolvedChannel.id);
    }

    const settings = await this.app.services.settings.set(groupId, selected.path, value);
    await this.app.services.audit?.write?.('settings.menu_update', {
      actorUserId,
      key: selected.path,
      value,
      channelName: resolvedChannel?.name || undefined
    }, { groupId, notify: false });
    return { field: selected, value, settings, resolvedChannel };
  }

  async setBoolean(groupId, fieldId, value, actorUserId) {
    const selected = this.field(fieldId);
    if (!selected || selected.type !== 'boolean') throw new Error('Bu alan aç/kapat türünde değil.');
    const settings = await this.app.services.settings.set(groupId, selected.path, Boolean(value));
    await this.app.services.audit?.write?.('settings.menu_toggle', {
      actorUserId,
      key: selected.path,
      value: Boolean(value)
    }, { groupId, notify: false });
    return { field: selected, value: Boolean(value), settings };
  }

  async reset(groupId, fieldId, actorUserId) {
    const selected = this.field(fieldId);
    if (!selected) throw new Error('Ayar alanı bulunamadı.');
    const defaults = this.app.services.settings.configDefaults(groupId);
    const value = structuredClone(getPath(defaults, selected.path));
    const settings = await this.app.services.settings.set(groupId, selected.path, value);
    await this.app.services.audit?.write?.('settings.menu_reset', {
      actorUserId,
      key: selected.path,
      value
    }, { groupId, notify: false });
    return { field: selected, value, settings };
  }
}

MenuSettingsService.CATEGORIES = CATEGORIES;
MenuSettingsService.FIELDS = FIELDS;
module.exports = MenuSettingsService;
