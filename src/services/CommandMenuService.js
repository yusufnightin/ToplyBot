const {
  buildClosedMenuBumote,
  buildCommandCatalogBumote,
  buildCommandMenuBumote,
  buildHelpCenterBumote
} = require('../utils/bumote');
const { sendInteractivePost, updateInteractivePost } = require('../utils/jtmlDelivery');
const { truncate } = require('../utils/text');
const {
  DEFAULT_TEMPLATE,
  DEFAULT_VIDEO_TEMPLATE
} = require('./LiveStreamService');

const SECTION_DEFINITIONS = [
  {
    id: 'general', emoji: '🧭', title: 'Genel Bakış',
    description: 'Temel komutlar, kimlik, bilgi ve istatistik',
    categories: ['Genel', 'İstatistik']
  },
  {
    id: 'moderation', emoji: '🛡️', title: 'Moderasyon',
    description: 'Uyarı, kick, ban, timeout, filtre ve denetim',
    categories: ['Moderasyon']
  },
  {
    id: 'community', emoji: '👥', title: 'Topluluk Yönetimi',
    description: 'Karşılama, kayıt, roller ve ticket',
    categories: ['Karşılama', 'Kayıt', 'Roller', 'Ticket']
  },
  {
    id: 'automation', emoji: '⚡', title: 'Otomasyon ve Tasarım',
    description: 'Özel komutlar, otomasyonlar, embed ve etkileşim',
    categories: ['Otomasyon', 'Özel Komutlar', 'Embed', 'Etkileşim', 'Sosyal Medya']
  },
  {
    id: 'progression', emoji: '⭐', title: 'Seviye ve Rozet',
    description: 'XP, rank, liderlik, rol ve Topluyo rozet ödülleri',
    categories: ['Seviye', 'Rozet']
  },
  {
    id: 'management', emoji: '⚙️', title: 'Sistem Yönetimi',
    description: 'Sunucu, kanal, rol, API, yedekleme ve bakım',
    categories: ['Yönetim']
  },
  {
    id: 'extras', emoji: '🎯', title: 'Ek Sistemler',
    description: 'Çekiliş ve anket araçları',
    categories: ['Çekiliş', 'Anket']
  }
];

function normalize(value) {
  return String(value ?? '').trim().toLocaleLowerCase('tr-TR');
}

function nextId(items) {
  return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

function commandMatches(command, query) {
  const needle = normalize(query);
  if (!needle) return true;
  const haystack = [
    command.name,
    command.description,
    command.usage,
    command.category,
    ...(command.aliases || [])
  ].join(' ').toLocaleLowerCase('tr-TR');
  return haystack.includes(needle);
}

function commandHasRequiredArguments(command) {
  return /<[^>]+>/.test(String(command.usage || ''));
}

function commandAcceptsArguments(command) {
  return /<[^>]+>|\[[^\]]+\]/.test(String(command.usage || ''));
}

function commandArgumentHint(command) {
  const usage = String(command?.usage || command?.name || '');
  return usage.replace(new RegExp(`^${String(command?.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '').trim();
}

function smartInputMeta(command) {
  const name = normalize(command?.name);
  const presets = {
    ban: ['25426', 'Kullanıcı ID yaz; süre 0 ve sebep otomatik eklenir.'],
    timeout: ['25426', 'Kullanıcı ID yaz; varsayılan süre 10m olur.'],
    kick: ['25426', 'Yalnızca kullanıcı ID yazman yeterli.'],
    uyar: ['25426', 'Yalnızca kullanıcı ID yazman yeterli.'],
    unban: ['25426', 'Yasağı kaldırılacak kullanıcı ID.'],
    untimeout: ['25426', 'Timeout kaldırılacak kullanıcı ID.'],
    temizle: ['10', 'Silinecek mesaj sayısını yaz.'],
    destekşablon: ['durum', 'kur, onar, doğrula, durum veya test yaz.'],
    yedek: ['liste', 'oluştur, liste, bilgi veya geri yaz.'],
    sistemkontrol: ['detay', 'detay yazabilir veya boş bırakabilirsin.'],
    sistemonar: ['test', 'Test mesajı için test yaz; normal onarım için boş bırak.'],
    apionbellek: ['ısıt', 'ısıt veya temizle yaz.'],
    kanaloluştur: ['destek', 'Sadece kanal adını yazarsan güvenli varsayılanlarla oluşturulur.'],
    rolekle: ['Destek', 'Sadece rol adını yazarsan varsayılan renk ve yetki kullanılır.'],
    xpver: ['25426 500', 'Kullanıcı ID ve verilecek XP miktarı.'],
    xpal: ['25426 100', 'Kullanıcı ID ve düşülecek XP miktarı.'],
    seviyeset: ['25426 10', 'Kullanıcı ID ve hedef seviye.'],
    seviyerozet: ['10 123', 'Seviye ve Topluyo rozet ID değeri.'],
    seviyerozetkur: ['10', 'Sadece seviyeyi yazarsan adı ve açıklaması otomatik oluşturulur.'],
    seviyerozetpaket: ['5,10,20,30,50,75,100', 'Oluşturulacak kilometre taşı seviyeleri.']
  };
  const preset = presets[name];
  return {
    placeholder: preset?.[0] || commandArgumentHint(command) || 'Değer, hedef veya işlem yaz…',
    description: preset?.[1] || `Tek giriş alanı • Kullanım: ${command?.usage || name}`
  };
}

function buildSmartArguments(command, rawInput) {
  const input = String(rawInput || '').trim();
  const name = normalize(command?.name);
  if (!input) return '';
  // Kullanıcı tam parametre dizisini yazdıysa dokunmadan geçir.
  if (/\s|\|/.test(input)) return input;
  if (['ban'].includes(name)) return `${input} 0 Panel üzerinden`;
  if (['timeout'].includes(name)) return `${input} 10m Panel üzerinden`;
  if (['kick', 'uyar', 'softban'].includes(name)) return `${input} Panel üzerinden`;
  if (name === 'kanaloluştur') {
    const title = input.replace(/[-_]+/g, ' ').replace(/(^|\s)\S/g, (char) => char.toLocaleUpperCase('tr-TR'));
    return `${input}|${title}|Panel üzerinden oluşturuldu|1`;
  }
  if (name === 'rolekle') return `${input}|#3b82f6|member`;
  return input;
}

function categorySection(category) {
  return SECTION_DEFINITIONS.find((section) => section.categories.includes(category)) || SECTION_DEFINITIONS[0];
}

function finiteOrder(value, fallback = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isFinite(number) && number < Number.MAX_SAFE_INTEGER ? number : fallback;
}

function sortInventory(items, kind, mode = 'order') {
  const normalized = normalize(mode || 'order');
  const list = [...(items || [])];
  if (normalized === 'name') return list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'tr'));
  if (normalized === 'id') return list.sort((a, b) => Number(a.id) - Number(b.id));
  if (kind === 'channels' && normalized === 'type') {
    return list.sort((a, b) => Number(a.type ?? 999) - Number(b.type ?? 999) || String(a.name || '').localeCompare(String(b.name || ''), 'tr'));
  }
  if (kind === 'roles' && normalized === 'power') {
    return list.sort((a, b) => Number(b.power || 0) - Number(a.power || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'tr'));
  }
  return list.sort((a, b) => finiteOrder(a.order) - finiteOrder(b.order) || String(a.name || '').localeCompare(String(b.name || ''), 'tr'));
}

class CommandMenuService {
  constructor({ store, app }) {
    this.store = store;
    this.app = app;
  }

  config() {
    return {
      enabled: true,
      openOnBarePrefix: true,
      ownerOnly: true,
      sessionMinutes: 10,
      commandsPerPage: 7,
      settingsPerPage: 8,
      showQuickRun: true,
      showTextSummary: true,
      accentColor: '#ff83c8',
      ...(this.app.config.commandMenu || {})
    };
  }

  visibleCommands(userId) {
    return this.app.router.list({ userId })
      .filter((command) => normalize(command.requiredPermission) !== 'owner')
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }

  sectionsFor(userId) {
    const commands = this.visibleCommands(userId);
    return SECTION_DEFINITIONS.map((section) => ({
      ...section,
      commandCount: commands.filter((command) => section.categories.includes(command.category)).length
    })).filter((section) => section.commandCount > 0);
  }


  async loadInventory(groupId, kind, mode = 'order', page = 0) {
    let items;
    if (kind === 'roles') {
      items = await this.app.services.roles.list(groupId);
      items = items.map((role) => ({
        id: Number(role.id), name: role.name || `Rol ${role.id}`, color: role.color || '#999999',
        order: finiteOrder(role.order, 0), power: Number(role.power || 0)
      }));
    } else {
      items = await this.app.services.channels.list(groupId, { force: true });
      items = items.map((channel) => ({
        id: Number(channel.id), name: channel.nick || channel.name || `kanal-${channel.id}`,
        title: channel.title || channel.name || '', type: channel.type ?? null,
        order: finiteOrder(channel.order, 0)
      }));
    }
    return { kind, sort: mode, page: Math.max(0, Number(page) || 0), items: sortInventory(items, kind, mode), loadedAt: new Date().toISOString() };
  }

  async prepareLiveAnnouncementChannel(groupId, reference = '') {
    const settings = await this.app.services.settings.get(groupId);
    const configured = String(
      settings?.channels?.announcements || settings?.channels?.social || ''
    ).trim();
    const requested = String(reference || '').trim() || configured;
    if (!requested) {
      throw new Error('Önce Yardım → Sunucu Ayarları bölümünden Duyuru kanalını seç.');
    }

    const resolved = await this.app.services.channels.resolve(groupId, requested);
    const visibleChannels = await this.app.services.channels.list(groupId, { force: true });
    if (!visibleChannels.some((item) => Number(item.id) === Number(resolved.id))) {
      throw new Error('Duyuru için sunucunun normal kanallarından birini seç. Örnek: #duyurular');
    }

    if (
      typeof this.app.client.getCurrentUserId === 'function' &&
      typeof this.app.client.grantChannelAccess === 'function'
    ) {
      const botUserId = await this.app.client.getCurrentUserId();
      await this.app.client.grantChannelAccess(resolved.id, botUserId, {
        read: true,
        write: true,
        control: true
      });
    }
    return String(resolved.id);
  }

  async findByPostId(postId) {
    const sessions = await this.store.read();
    return sessions.find((session) => Number(session.postId) === Number(postId)) || null;
  }

  async saveSession(session) {
    let saved;
    await this.store.update((items) => {
      const existing = items.find((entry) => Number(entry.postId) === Number(session.postId));
      const value = {
        ...session,
        id: existing?.id || session.id || nextId(items),
        updatedAt: new Date().toISOString()
      };
      if (existing) Object.assign(existing, value);
      else items.push(value);
      saved = structuredClone(value);
      return items.filter((entry) => {
        const expires = Date.parse(entry.expiresAt || '');
        return entry.active !== false || !Number.isFinite(expires) || expires > Date.now() - 86_400_000;
      });
    });
    return saved;
  }

  sessionExpiry() {
    const minutes = Math.max(1, Number(this.config().sessionMinutes) || 10);
    return new Date(Date.now() + minutes * 60_000).toISOString();
  }

  remember(session, action, label) {
    const items = Array.isArray(session.recentItems) ? session.recentItems : [];
    session.recentItems = [
      { action, label, usedAt: new Date().toISOString() },
      ...items.filter((item) => item.action !== action)
    ].slice(0, 3);
  }

  async createVisualCard({ userId, permission, commandCount, sectionCount }) {
    if (!this.app.services.cards?.createCommandMenuCard) return null;
    try {
      const card = await this.app.services.cards.createCommandMenuCard({
        userId,
        permission,
        commandCount,
        sectionCount,
        prefix: this.app.config.prefix,
        accent: this.config().accentColor
      });
      return card.url || null;
    } catch (error) {
      this.app.logger?.warn('Komut merkezi görsel kartı üretilemedi.', { message: error.message });
      return null;
    }
  }

  async open({ userId, channelId, groupId = null, initialCommand = null, initialSection = null }) {
    const config = this.config();
    if (!config.enabled) return { opened: false, reason: 'disabled' };
    if (channelId === undefined || channelId === null || channelId === '') {
      await this.app.client.sendDirectMessage(userId, `Komut merkezini bir grup kanalında ${this.app.config.prefix} yazarak açabilirsin.`);
      return { opened: false, reason: 'channel_required' };
    }

    const commands = this.visibleCommands(userId);
    const sections = this.sectionsFor(userId);
    let view = { type: 'home', page: 0, sectionId: null, commandName: null, query: '' };

    if (initialCommand) {
      const command = this.app.router.getCommand(initialCommand);
      if (command && normalize(command.requiredPermission) !== 'owner' && this.app.permissionManager.has(userId, command.requiredPermission)) {
        view = { ...view, type: 'command', commandName: command.name };
      }
    } else if (initialSection && sections.some((section) => section.id === initialSection)) {
      view = { ...view, type: 'section', sectionId: initialSection };
    }

    const permission = this.app.permissionManager.name(userId);
    const previousSessions = await this.store.read();
    const recentItems = previousSessions
      .filter((item) => Number(item.ownerUserId) === Number(userId) && Array.isArray(item.recentItems))
      .flatMap((item) => item.recentItems)
      .sort((a, b) => Date.parse(b.usedAt || 0) - Date.parse(a.usedAt || 0))
      .filter((item, index, list) => list.findIndex((entry) => entry.action === item.action) === index)
      .slice(0, 3);
    const cardUrl = await this.createVisualCard({
      userId,
      permission,
      commandCount: commands.length,
      sectionCount: sections.length
    });

    const draft = {
      id: null,
      postId: null,
      channelId,
      groupId,
      ownerUserId: Number(userId),
      ownerOnly: Boolean(config.ownerOnly),
      active: true,
      expiresAt: this.sessionExpiry(),
      createdAt: new Date().toISOString(),
      cardUrl,
      settingsSnapshot: null,
      notice: '',
      recentItems,
      view
    };

    const rendered = this.render(draft);
    const delivery = await sendInteractivePost({
      client: this.app.client,
      channelId,
      text: rendered.text,
      jtmlCode: rendered.jtml,
      attach: this.app.config.interactions?.attachBumote !== false,
      logger: this.app.logger,
      context: 'Komut merkezi JTML'
    });
    const { result, postId } = delivery;

    if (!Number.isInteger(postId)) {
      this.app.logger?.warn('Topluyo post/add cevabından post ID çıkarılamadı.', {
        channelId,
        responseType: Array.isArray(result) ? 'array' : typeof result,
        responsePreview: (() => {
          try { return truncate(JSON.stringify(result), 600); } catch { return String(result).slice(0, 600); }
        })()
      });
      await this.app.client.sendPost(
        channelId,
        `⚠️ Komut merkezi gönderildi fakat Topluyo API post ID döndürmediği için etkileşim oturumu kaydedilemedi. ${this.app.config.prefix}yardım komutunu metin görünümünde kullanabilirsin.`
      );
      return { opened: true, attached: false, postId: null };
    }

    draft.postId = postId;
    const session = await this.saveSession(draft);
    return { opened: true, attached: delivery.attached, delivery: delivery.delivery, postId, session };
  }

  async openFromContext(ctx, { commandName = null, sectionId = null } = {}) {
    return this.open({
      userId: ctx.userId,
      channelId: ctx.channelId,
      groupId: ctx.groupId,
      initialCommand: commandName,
      initialSection: sectionId
    });
  }

  render(session) {
    const commands = this.visibleCommands(session.ownerUserId);
    const sections = this.sectionsFor(session.ownerUserId);
    const view = session.view || { type: 'home', page: 0 };
    const text = this.renderText({ session, commands, sections, view });
    const jtml = this.renderJtml({ session, commands, sections, view });
    return { text, jtml };
  }

  renderText({ session, commands, sections, view }) {
    if (!this.config().showTextSummary) return '';
    const prefix = this.app.config.prefix;

    if (view.type === 'section') {
      const section = sections.find((item) => item.id === view.sectionId) || sections[0];
      const sectionCommands = commands.filter((command) => section?.categories.includes(command.category));
      const configuredPageSize = Math.max(3, Number(this.config().commandsPerPage) || 6);
      const pageSize = Math.max(3, Math.floor(configuredPageSize / 3) * 3);
      const totalPages = Math.max(1, Math.ceil(sectionCommands.length / pageSize));
      const page = Math.max(0, Math.min(Number(view.page) || 0, totalPages - 1));
      return `**${section.emoji} Yardım / ${section.title}** · Sayfa ${page + 1}/${totalPages}\n_Komutu seçerek ayrıntısını açabilirsin._`;
    }

    if (view.type === 'command') {
      const command = this.app.router.getCommand(view.commandName);
      if (!command) return this.renderText({ session, commands, sections, view: { type: 'home' } });
      return `**${categorySection(command.category).emoji} Yardım / ${prefix}${command.name}**\n${truncate(command.description, 120)} · \`${prefix}${command.usage}\``;
    }

    if (view.type === 'search') {
      const query = String(view.query || '').trim();
      const results = commands.filter((command) => commandMatches(command, query)).slice(0, 12);
      return `**🔎 Yardım / Arama** · “${query || 'tümü'}”\n_${results.length} sonuç bulundu._`;
    }

    const specialViews = {
      launcher: ['⚡', 'Hızlı Komut'],
      quickmod: ['🛡️', 'Hızlı Moderasyon'],
      inventory: ['📋', 'Sunucu Envanteri'],
      'support-template': ['🧰', 'Destek Şablonu'],
      leveling: ['⭐', 'Seviye ve Rozet'],
      livestreams: ['🔴', 'Canlı Yayın Duyuruları'],
      assistant: ['✨', 'Adım Adım Asistan']
    };
    const special = String(view.type || '').startsWith('settings')
      ? ['⚙️', 'Sunucu Ayarları']
      : specialViews[view.type];
    if (special) return `**${special[0]} Yardım / ${special[1]}**\n_Gerekli alanları doldurup işlemini seç._`;

    return `**⚡ ToplyBot Yardım / Ana Panel**\n_Komut ara veya bir kategori seç._`;
  }

  renderJtml({ session, commands, sections, view }) {
    if (String(view.type || '').startsWith('settings')) {
      return this.renderSettingsJtml({ session, view });
    }
    if (view.type === 'leveling') {
      return this.renderLevelingJtml({ session, view, commands });
    }
    if (view.type === 'assistant') {
      return this.renderAssistantJtml({ session, view, commands });
    }

    const baseHeader = [
      session.notice ? { text: session.notice, ui: 'muted', color: '#fbbf24' } : null
    ].filter(Boolean);
    const navigation = [
      ...(view.type !== 'home' ? [{ value: 'home', label: '⌂ Ana Panel', style: 'secondary' }] : []),
      ...(view.type === 'home' && this.app.permissionManager.has(session.ownerUserId, 'admin')
        ? [{ value: 'settings:home', label: '⚙️ Ayarlar', style: 'secondary' }]
        : []),
      ...(view.type === 'home'
        ? [{ value: 'leveling:home', label: '⭐ Seviye & Rozet', style: 'secondary' }]
        : []),
      ...(view.type === 'home' && this.app.permissionManager.has(session.ownerUserId, 'admin') && this.app.services.liveStreams
        ? [{ value: 'livestreams:home', label: '🔴 Canlı Yayınlar', style: 'warning' }]
        : []),
      ...(view.type === 'home' && this.app.services.supportTemplate?.canInstall(session.ownerUserId)
        ? [{ value: 'template:support', label: '🧰 Destek Şablonu', style: 'warning' }]
        : []),
      { value: 'close', label: 'Kapat', style: 'danger' }
    ];
    const footerActions = [];

    if (view.type === 'progress') {
      const command = this.app.router.getCommand(view.commandName) || { name: view.commandName || 'işlem', category: 'Yönetim' };
      return buildCommandMenuBumote({
        header: [
          ...baseHeader.filter((item) => !session.notice || item.text !== session.notice),
          { text: `⏳ ${this.app.config.prefix}${command.name}`, ui: 'muted', size: 1.08 }
        ],
        progress: {
          percent: Number(view.percent) || 0,
          title: view.title || 'İşlem yürütülüyor',
          status: view.status || 'Lütfen bekle…',
          detail: view.detail || '',
          tone: view.tone || 'primary'
        },
        footerNote: 'İlerleme aynı kart üzerinde güncellenir. İşlem tamamlanınca komut ekranına otomatik dönülür.'
      });
    }

    if (view.type === 'launcher') {
      return buildCommandMenuBumote({
        header: [
          ...baseHeader,
          { text: 'Komut adını veya takma adını yaz.', ui: 'muted' }
        ],
        navigation,
        search: {
          name: 'launcher_query',
          placeholder: 'Örnek: ban, ping, yardım',
          actionValue: 'launcher:run',
          buttonLabel: 'Çalıştır',
          buttonStyle: 'success',
          maxLength: 80
        }
      });
    }

    if (view.type === 'quickmod') {
      return buildCommandMenuBumote({
        header: [
          ...baseHeader,
          { text: '⚡ Hızlı Moderasyon', ui: 'muted', size: 1.1 },
          { text: 'Kullanıcı ID, süre ve sebebi gir; ardından işlemi seç. Yetki ve güvenlik kontrolleri normal komutlarla aynıdır.', ui: 'muted' }
        ],
        navigation,
        inputs: [
          { name: 'target_user_id', label: '👤 Hedef kullanıcı ID', placeholder: 'Örnek: 25469', maxLength: 24 },
          { name: 'duration', value: '10m', label: '⏱️ Süre', description: 'Ban veya timeout için: 10m, 2h, 7d veya 0', placeholder: '10m', maxLength: 24 },
          { name: 'reason', label: '📝 Sebep', placeholder: 'İşlem sebebini yaz...', maxLength: 500 },
          { name: 'amount', value: '10', label: '🧹 Silinecek mesaj sayısı', description: 'Yalnızca Temizle işlemi kullanır (1-100).', placeholder: '10', maxLength: 3 }
        ],
        commands: [
          { value: 'quickmod:run:uyar', label: '⚠️ Uyar', style: 'warning' },
          { value: 'quickmod:run:kick', label: '👢 Kick', style: 'danger' },
          { value: 'quickmod:run:ban', label: '🔨 Ban', style: 'danger' },
          { value: 'quickmod:run:timeout', label: '🔇 Timeout', style: 'warning' },
          { value: 'quickmod:run:unban', label: '🔓 Ban Kaldır', style: 'success' },
          { value: 'quickmod:run:untimeout', label: '🔊 Timeout Kaldır', style: 'success' },
          { value: 'quickmod:run:temizle', label: '🧹 Mesaj Temizle', style: 'secondary' }
        ],
        commandColumns: 3,
        footerActions,
        footerNote: `🔐 İşlemler Sunucu #${session.groupId} kapsamında audit kaydına yazılır.`
      });
    }

    if (view.type === 'inventory') {
      const snapshot = session.inventorySnapshot || { kind: view.kind || 'channels', sort: 'order', page: 0, items: [] };
      const kind = snapshot.kind === 'roles' ? 'roles' : 'channels';
      const pageSize = 8;
      const totalPages = Math.max(1, Math.ceil(snapshot.items.length / pageSize));
      const page = Math.max(0, Math.min(Number(snapshot.page) || 0, totalPages - 1));
      const visible = snapshot.items.slice(page * pageSize, (page + 1) * pageSize);
      const inventoryNavigation = [...navigation];
      if (page > 0) inventoryNavigation.push({ value: `inventory:${kind}:${snapshot.sort}:${page - 1}`, label: '◀ Önceki', style: 'secondary' });
      if (page + 1 < totalPages) inventoryNavigation.push({ value: `inventory:${kind}:${snapshot.sort}:${page + 1}`, label: 'Sonraki ▶', style: 'secondary' });
      const sortButtons = kind === 'channels'
        ? [
            { value: 'inventory:channels:order:0', label: '↕ Sunucu Sırası', style: snapshot.sort === 'order' ? 'primary' : 'secondary' },
            { value: 'inventory:channels:name:0', label: 'A-Z', style: snapshot.sort === 'name' ? 'primary' : 'secondary' },
            { value: 'inventory:channels:id:0', label: 'ID', style: snapshot.sort === 'id' ? 'primary' : 'secondary' },
            { value: 'inventory:channels:type:0', label: 'Tip', style: snapshot.sort === 'type' ? 'primary' : 'secondary' }
          ]
        : [
            { value: 'inventory:roles:order:0', label: '↕ Sunucu Sırası', style: snapshot.sort === 'order' ? 'primary' : 'secondary' },
            { value: 'inventory:roles:name:0', label: 'A-Z', style: snapshot.sort === 'name' ? 'primary' : 'secondary' },
            { value: 'inventory:roles:id:0', label: 'ID', style: snapshot.sort === 'id' ? 'primary' : 'secondary' },
            { value: 'inventory:roles:power:0', label: 'Güç', style: snapshot.sort === 'power' ? 'primary' : 'secondary' }
          ];
      const rows = visible.map((item, index) => {
        const position = page * pageSize + index + 1;
        return kind === 'channels'
          ? { disabled: true, label: `${position}. #${item.name} • ID ${item.id} • sıra ${item.order || position} • tip ${item.type ?? '—'}${item.title && item.title !== item.name ? ` • ${item.title}` : ''}` }
          : { disabled: true, label: `${position}. ${item.name} • ID ${item.id} • sıra ${item.order || position} • ${item.color || '—'} • güç ${item.power || 0}` };
      });
      return buildCommandMenuBumote({
        header: [
          ...baseHeader,
          { text: kind === 'channels' ? '📡 Kanal Envanteri' : '🎭 Rol Envanteri', ui: 'muted', size: 1.1 },
          { text: `${snapshot.items.length} kayıt • Sayfa ${page + 1}/${totalPages} • Görünüm: ${snapshot.sort}`, ui: 'muted' }
        ],
        navigation: inventoryNavigation,
        sections: sortButtons,
        sectionColumns: 2,
        commands: [
          ...rows,
          ...(this.app.permissionManager.has(session.ownerUserId, 'admin') ? [{
            value: `inventory:apply:${kind}`,
            label: `💾 Bu görünüm sırasını sunucuya uygula`,
            style: 'warning',
            title: 'Mevcut A-Z, ID, tip/güç veya sıra görünümünü gerçek kanal/rol sırası olarak kaydeder.'
          }] : [])
        ],
        footerActions,
        footerNote: 'ID değerleri hızlı moderasyon, rol ve kanal ayarlarında doğrudan kullanılabilir.'
      });
    }

    if (view.type === 'support-template') {
      const template = this.app.services.supportTemplate;
      const allowed = template?.canInstall(session.ownerUserId);
      const channelCount = template?.constructor?.CHANNEL_SPECS?.length || 0;
      const roleCount = template?.constructor?.ROLE_SPECS?.length || 0;
      const version = template?.constructor?.TEMPLATE_VERSION || '—';
      return buildCommandMenuBumote({
        header: [
          ...baseHeader,
          { text: `🧰 DESTEK SUNUCUSU ŞABLONU • v${version}`, ui: 'muted', size: 1.12 },
          { text: `${channelCount} kanal • ${roleCount} rol • Özel ticket • Ayrı ticket/moderasyon/sistem logları`, ui: 'muted', color: '#7dd3fc' },
          { text: 'Karşılama, otorol, seviye rolleri ve SVG rozetleri, moderasyon, ticket paneli, otomasyon, bakım ve kanal erişimleri birlikte kurulur.', ui: 'muted' },
          { text: allowed ? '✅ Bu hesabın kurulum yetkisi var.' : '⛔ Bu şablon yalnızca config.json içindeki supportTemplate.ownerUserId hesabına açıktır.', ui: 'muted' }
        ],
        navigation,
        inputs: allowed ? [{
          name: 'template_confirm',
          label: '⚠️ Tam sıfırlama onayı',
          description: 'Yalnız kırmızı “Tam Sıfırla” işlemi için TAM SIFIRLA yaz. Diğer düğmeler bu alanı kullanmaz.',
          placeholder: 'TAM SIFIRLA',
          maxLength: 20
        }] : [],
        commands: allowed ? [
          {
            value: 'template:support:install',
            label: '🚀 Kur / Güncelle',
            title: 'Tüm destek altyapısını güvenli biçimde kurar veya günceller.',
            actionLabel: 'Başlat →',
            style: 'success'
          },
          {
            value: 'template:support:repair',
            label: '🔧 Eksikleri Onar',
            title: 'Eksik kanal, rol ve erişimleri mevcut yapıyı silmeden tamamlar.',
            actionLabel: 'Onar →',
            style: 'warning'
          },
          {
            value: 'template:support:verify',
            label: '✅ Sistemi Doğrula',
            title: 'Kurulumun kanal, rol ve izin bileşenlerini denetler.',
            actionLabel: 'Kontrol →',
            style: 'primary'
          },
          {
            value: 'template:support:test',
            label: '🧪 Canlı Test',
            title: 'Ticket ve log akışlarının gerçek kullanım testini çalıştırır.',
            actionLabel: 'Test Et →',
            style: 'secondary'
          },
          {
            value: 'template:support:status',
            label: '📋 Ayrıntılı Durum',
            title: 'Kurulumun güncel durumunu ve tespit edilen eksikleri gösterir.',
            actionLabel: 'Görüntüle →',
            style: 'secondary'
          },
          {
            value: 'template:support:rebuild',
            label: '🧨 Tam Sıfırla ve Yeniden Kur',
            title: 'Mevcut kanal ve rolleri sırayla siler; gelişmiş destek şablonunu ve otomatik ayarları baştan kurar.',
            actionLabel: 'Sıfırla →',
            style: 'danger'
          }
        ] : [],
        commandColumns: 3,
        footerActions,
        footerNote: `Sunucu #${session.groupId} • Kur/Güncelle ve Onar mevcut yapıyı korur. Tam Sıfırla geri alınamaz; işlem öncesi yerel ayar yedeği alınır.`
      });
    }

    if (view.type === 'livestreams') {
      return this.renderLiveStreamsJtml({ session, view });
    }

    if (view.type === 'section') {
      const section = sections.find((item) => item.id === view.sectionId) || sections[0];
      const sectionCommands = commands.filter((command) => section?.categories.includes(command.category));
      const configuredPageSize = Math.max(3, Number(this.config().commandsPerPage) || 6);
      const pageSize = Math.max(3, Math.floor(configuredPageSize / 3) * 3);
      const totalPages = Math.max(1, Math.ceil(sectionCommands.length / pageSize));
      const page = Math.max(0, Math.min(Number(view.page) || 0, totalPages - 1));
      const pageCommands = sectionCommands.slice(page * pageSize, (page + 1) * pageSize);
      if (page > 0) navigation.push({ value: `page:${page - 1}`, label: '◀ Önceki', style: 'secondary' });
      navigation.push({ value: 'page:status', label: `SAYFA ${page + 1} / ${totalPages}`, style: 'primary', disabled: true });
      if (page + 1 < totalPages) navigation.push({ value: `page:${page + 1}`, label: 'Sonraki ▶', style: 'secondary' });
      return buildCommandCatalogBumote({
        title: `${section.emoji} ${section.title}`,
        description: `${section.description} • ${sectionCommands.length} kullanılabilir komut • Sayfa ${page + 1}/${totalPages}`,
        navigation,
        searchPlaceholder: 'Bu kategoride komut ara...',
        commands: pageCommands.map((command) => ({
          icon: categorySection(command.category).emoji,
          title: `${this.app.config.prefix}${command.name}`,
          description: truncate(command.description, 74),
          usage: truncate(`${this.app.config.prefix}${command.usage}`, 82),
          actions: commandHasRequiredArguments(command)
            ? [{ value: `command:${command.name}`, label: 'Parametre →', style: 'primary' }]
            : [{ value: `command:${command.name}`, label: 'Aç →', style: 'primary' }]
        }))
      });
    }

    if (view.type === 'command') {
      const command = this.app.router.getCommand(view.commandName);
      const section = command ? categorySection(command.category) : null;
      if (section) navigation.push({ value: `section:${section.id}`, label: `↩ ${section.title}`, style: 'secondary' });
      const meta = smartInputMeta(command);
      const commandHeader = command ? [
        ...baseHeader,
        ...(view.assistant ? [
          { text: '✓ 1. İhtiyacını seç   ✓ 2. İşlemi seç   ● 3. Kontrol et ve uygula', ui: 'muted', color: '#c084fc' }
        ] : []),
        { text: `${this.app.config.prefix}${command.name}`, ui: 'muted', size: 1.15, color: '#f8fafc' },
        { text: command.description, ui: 'muted', color: '#abb1be' },
        { text: `Kullanım: ${this.app.config.prefix}${command.usage}`, ui: 'muted', color: '#c4b5fd', background: '#161d28' },
        { text: smartInputMeta(command).description, ui: 'muted' }
      ] : baseHeader;
      return buildCommandMenuBumote({
        header: commandHeader,
        navigation,
        search: command ? {
          name: 'command_args',
          placeholder: meta.placeholder,
          actionValue: `runargs:${command.name}`,
          buttonLabel: '▶ Çalıştır',
          buttonStyle: 'success',
          maxLength: 1800
        } : null
      });
    }

    if (view.type === 'search') {
      const query = String(view.query || '').trim();
      const results = commands.filter((command) => commandMatches(command, query)).slice(0, 12);
      return buildCommandMenuBumote({
        header: baseHeader,
        navigation,
        search: { value: query, placeholder: 'Komut adı veya açıklama...' },
        commands: results.map((command) => ({
          value: `command:${command.name}`,
          label: `${categorySection(command.category).emoji} ${this.app.config.prefix}${command.name}`,
          style: 'ghost',
          title: command.description,
          actionLabel: commandHasRequiredArguments(command) ? 'Parametre →' : 'Aç →'
        })),
        commandColumns: 3
      });
    }

    return buildHelpCenterBumote({
      notice: session.notice || '',
      cards: [
        {
          value: 'section:general',
          icon: '⌂',
          text: 'Genel & İstatistik',
          description: 'Bilgi, kimlik, arama ve sunucu istatistikleri.'
        },
        {
          value: 'section:moderation',
          icon: '◇',
          text: 'Moderasyon & Güvenlik',
          description: 'Uyarı, timeout, filtre, spam ve denetim.'
        },
        {
          value: 'section:community',
          icon: '👋',
          text: 'Üye & Karşılama',
          description: 'Karşılama, kayıt ve üye işlemleri.'
        },
        {
          value: 'section:community',
          icon: '♟',
          text: 'Roller & Destek',
          description: 'Rol panelleri, self rol ve ticket sistemi.'
        },
        {
          value: 'section:progression',
          icon: '★',
          text: 'Seviye & Rozet',
          description: 'XP, rank, liderlik, rol ve rozet ödülleri.'
        },
        {
          value: 'section:automation',
          icon: '⚡',
          text: 'Otomasyon & Sosyal',
          description: 'Zamanlayıcı, özel komut, yayın ve bildirimler.'
        }
      ],
      quickActions: [
        { value: 'section:management', icon: '⚙', text: 'Sistem Yönetimi' },
        { value: 'section:extras', icon: '🎯', text: 'Anket & Çekiliş' },
        { value: 'settings:home', icon: '☷', text: 'Bot Ayarları' }
      ]
    });
  }


  renderAssistantJtml({ session, view }) {
    const intent = view.intent || null;
    const choices = {
      setup: [
        ['settings:home', '⚙️ Sunucu Ayarları', 'Karşılama, kanallar, roller ve otomasyonları yapılandır.'],
        ['livestreams:home', '🔴 Canlı Yayınlar', 'Kick, Twitch veya YouTube yayın duyurusu kur.'],
        ['template:support', '🧰 Destek Sistemi', 'Ticket, log, rol ve kanal altyapısını hazırla.'],
        ['leveling:home', '⭐ Seviye & Rozet', 'XP, rank ve ödül sistemini yönet.']
      ],
      change: [
        ['settings:home', '⚙️ Sunucu Ayarı', 'Sunucuya özel kayıtlı değerleri düzenle.'],
        ['livestreams:home', '🔴 Canlı Yayınlar', 'Takip edilen yayıncıları ve duyuruları düzenle.'],
        ['section:community', '👥 Topluluk', 'Karşılama, rol veya destek özelliklerine git.'],
        ['section:automation', '⚡ Otomasyon', 'Zamanlayıcı, bildirim ve özel komutları yönet.']
      ],
      solve: [
        ['command:sistemkontrol', '🩺 Sistem Kontrolü', 'Bot servislerini ve temel bağlantıları denetle.'],
        ['command:sistemonar', '🛠 Sistem Onarımı', 'Tespit edilen altyapı eksiklerini onar.'],
        ['inventory:channels:order:0', '📡 Kanal Envanteri', 'Kanal kimliklerini, tiplerini ve sırasını incele.'],
        ['inventory:roles:order:0', '🎭 Rol Envanteri', 'Rol kimliklerini, güçlerini ve sırasını incele.']
      ],
      quick: [
        ['livestreams:home', '📣 Test Duyurusu', 'Yayın bildirimlerini hızlıca test et.'],
        ['quickmod:home', '🛡️ Hızlı Moderasyon', 'Uyar, timeout, ban veya mesaj temizleme işlemi yap.'],
        ['leveling:home', '⭐ Rank / XP', 'Profil görüntüle veya XP işlemi yap.'],
        ['command:ping', '🏓 Bağlantı Testi', 'Botun bağlantı ve cevap süresini ölç.']
      ]
    };
    const step = intent ? 2 : 1;
    return buildCommandMenuBumote({
      header: [
        ...(session.notice ? [{ text: session.notice, ui: 'muted', color: '#fbbf24' }] : []),
        { text: '✨ TOPLYBOT ASİSTAN', ui: 'muted', size: 1.16 },
        { text: step === 1 ? 'Bugün neyi halledelim?' : 'Yapmak istediğin işlemi seç.', ui: 'muted' },
        { text: `${step === 1 ? '●' : '✓'} 1. İhtiyacını seç   ${step === 2 ? '●' : '○'} 2. İşlemi seç   ○ 3. Kontrol et ve uygula`, ui: 'muted', color: '#c084fc' }
      ],
      navigation: [
        { value: 'home', label: '⌂ Ana Panel', style: 'secondary' },
        ...(intent ? [{ value: 'assistant:home', label: '← Geri', style: 'secondary' }] : []),
        { value: 'close', label: 'İptal', style: 'danger' }
      ],
      commands: intent
        ? (choices[intent] || []).map(([action, label, title]) => ({
            value: `assistant:open:${action}`,
            label,
            title,
            actionLabel: 'Aç →',
            style: 'primary'
          }))
        : [
            {
              value: 'assistant:intent:setup',
              label: '📦 Yeni Sistem Kur',
              title: 'Sunucuna yeni bir özellik veya altyapı ekle.',
              actionLabel: 'Seç →',
              style: 'primary'
            },
            {
              value: 'assistant:intent:change',
              label: '⚙️ Ayar Değiştir',
              title: 'Çalışan sistemlerin sunucuya özel ayarlarını düzenle.',
              actionLabel: 'Seç →',
              style: 'primary'
            },
            {
              value: 'assistant:intent:solve',
              label: '⚠️ Sorun Çöz',
              title: 'Sistemi denetle, eksikleri bul ve onarım seçeneklerine ulaş.',
              actionLabel: 'Seç →',
              style: 'warning'
            },
            {
              value: 'assistant:intent:quick',
              label: '⚡ Hızlı İşlem',
              title: 'Sık kullanılan yönetim araçlarına doğrudan git.',
              actionLabel: 'Seç →',
              style: 'success'
            }
          ],
      commandColumns: 2,
      footerNote: 'Asistan her ekranda yalnızca o adım için gereken seçenekleri gösterir.'
    });
  }

  renderLiveStreamsJtml({ session, view }) {
    const items = (session.liveStreamsSnapshot || []).filter((item) => item.active);
    const selected = items.find((item) => Number(item.id) === Number(view.selectedId)) || null;
    const mode = view.mode || (selected ? 'detail' : 'home');
    const back = selected
      ? { value: `livestreams:select:${selected.id}`, label: '← Yayın Sayfası', style: 'secondary' }
      : { value: 'livestreams:home', label: '← Yayın Listesi', style: 'secondary' };
    const common = {
      navigation: [
        { value: 'home', label: '⌂ Ana Panel', style: 'secondary' },
        ...(mode !== 'home' ? [back] : []),
        { value: 'close', label: 'Kapat', style: 'danger' }
      ],
      commandColumns: 3
    };

    if (mode === 'choose-platform') {
      return buildCommandMenuBumote({
        ...common,
        header: [
          { text: '1/2 • Yayın platformunu seç', ui: 'muted', size: 1.12 },
          { text: 'Yayıncının kullandığı platformun düğmesine dokun.', ui: 'muted' }
        ],
        commands: [
          { value: 'livestreams:platform:kick', label: '🟢 Kick', style: 'success' },
          { value: 'livestreams:platform:twitch', label: '🟣 Twitch', style: 'primary' },
          { value: 'livestreams:platform:youtube', label: '🔴 YouTube', style: 'danger' }
        ]
      });
    }

    if (mode === 'add') {
      const platform = view.platform || 'kick';
      return buildCommandMenuBumote({
        ...common,
        header: [
          { text: `2/2 • ${platform.toUpperCase()} yayıncısını ekle`, ui: 'muted', size: 1.12 },
          { text: 'Yayıncı adı ile kanal kullanıcı adını yazman yeterli. Yayıncı izni gerekmez.', ui: 'muted' }
        ],
        inputs: [
          {
            name: 'live_channel',
            label: 'Duyuru kanalı (isteğe bağlı)',
            description: 'Boş bırakırsan Sunucu Ayarları içindeki Duyuru kanalı otomatik kullanılır.',
            placeholder: 'Boş bırakabilirsin',
            maxLength: 80
          },
          { name: 'live_name', label: 'Yayıncının görünen adı', placeholder: 'Örnek: Ahmet', maxLength: 100 },
          {
            name: 'live_source',
            label: platform === 'youtube' ? 'YouTube kanal ID' : `${platform} kullanıcı adı`,
            description: platform === 'youtube' ? 'UC ile başlayan kanal ID değerini yaz.' : '@ işareti olmadan kullanıcı adını yaz.',
            placeholder: platform === 'youtube' ? 'UC...' : 'kullanıcı_adı',
            maxLength: 160
          }
        ],
        commands: [{ value: 'livestreams:add', label: '✅ Kaydet ve Takibe Başla', style: 'success' }],
        commandColumns: 1,
        footerNote: 'Varsayılan: @millet etiketi • 3 dakikada bir kontrol • hazır duyuru mesajı.'
      });
    }

    if (mode === 'edit' && selected) {
      return buildCommandMenuBumote({
        ...common,
        header: [
          { text: `✏️ ${selected.name} • Temel Ayarlar`, ui: 'muted', size: 1.12 },
          { text: 'Değiştirmek istediğin bilgileri düzenleyip Kaydet düğmesine dokun.', ui: 'muted' }
        ],
        inputs: [
          { name: 'live_channel', value: this.app.services.channels?.label(session.groupId, selected.channelId) || selected.channelId, label: 'Duyuru kanalı', description: 'Örnek: #duyurular', maxLength: 80 },
          { name: 'live_name', value: selected.name, label: 'Yayıncı adı', maxLength: 100 },
          { name: 'live_source', value: selected.source, label: 'Kullanıcı adı / YouTube kanal ID', maxLength: 160 }
        ],
        commands: [{ value: 'livestreams:save-basic', label: '💾 Kaydet', style: 'success' }],
        commandColumns: 1
      });
    }

    if (mode === 'advanced' && selected) {
      return buildCommandMenuBumote({
        ...common,
        header: [
          { text: `⚙️ ${selected.name} • Gelişmiş Ayarlar`, ui: 'muted', size: 1.12 },
          { text: 'Bu alanları değiştirmen şart değil. Hazır ayarlar çoğu sunucu için uygundur.', ui: 'muted' }
        ],
        inputs: [
          { name: 'live_mention', value: selected.mention || 'yok', label: 'Etiket', description: '@millet veya kapatmak için yok', maxLength: 80 },
          { name: 'live_interval', value: selected.pollMinutes || 3, label: 'Kaç dakikada bir kontrol edilsin?', description: '1 ile 60 arasında', maxLength: 2 },
          {
            name: 'live_template', value: String(selected.template || '').replace(/\n/g, '\\n'),
            label: 'Duyuru mesajı', description: 'Satır sonu: \\n • Değişkenler: {mention} {name} {title} {url}',
            maxLength: 1600
          },
          {
            name: 'live_video_template', value: String(selected.videoTemplate || DEFAULT_VIDEO_TEMPLATE).replace(/\n/g, '\\n'),
            label: 'YouTube yeni video mesajı', description: 'Yalnız yeni video bulunduğunda kullanılır.',
            maxLength: 1600
          },
          {
            name: 'live_logo', value: selected.logoUrl || '',
            label: 'Yayıncı logosu (isteğe bağlı)',
            description: 'Boşsa Kick veya YouTube profil görseli otomatik alınır. İstersen HTTPS görsel adresi yaz.',
            maxLength: 500
          }
        ],
        commands: [
          { value: 'livestreams:save-advanced', label: '💾 Gelişmiş Ayarları Kaydet', style: 'success' },
          { value: 'livestreams:defaults', label: '↺ Hazır Ayarlara Dön', style: 'warning' }
        ],
        commandColumns: 2
      });
    }

    if (selected) {
      const selectedState = selected.isLive
        ? '🔴 CANLI'
        : selected.lastEventType === 'video'
          ? '▶️ Video takibi aktif'
          : '⚫ Çevrimdışı';
      return buildCommandMenuBumote({
        ...common,
        header: [
          ...(session.notice ? [{ text: session.notice, ui: 'muted', color: '#fbbf24' }] : []),
          { text: `${selectedState} • ${selected.name}`, ui: 'muted', size: 1.12 },
          { text: `${selected.platform.toUpperCase()} • ${selected.source} • Duyuru kanalı: ${selected.channelId}`, ui: 'muted' },
          ...(selected.lastError ? [{ text: `Son hata: ${selected.lastError}`, ui: 'muted', color: '#fbbf24' }] : [])
        ],
        commands: [
          { value: 'livestreams:refresh', label: '↻ Durumu Yenile', style: 'success' },
          { value: 'livestreams:test', label: '🧪 Test Duyurusu Gönder', style: 'primary' },
          { value: 'livestreams:check', label: '🔎 Şimdi Kontrol Et', style: 'secondary' },
          { value: 'livestreams:edit', label: '✏️ Kanal / İsim Değiştir', style: 'secondary' },
          { value: 'livestreams:advanced', label: '⚙️ Gelişmiş Ayarlar', style: 'secondary' },
          { value: 'livestreams:delete', label: '🗑 Takibi Kapat', style: 'danger' }
        ]
      });
    }

    return buildCommandMenuBumote({
      ...common,
      header: [
        ...(session.notice ? [{ text: session.notice, ui: 'muted', color: '#fbbf24' }] : []),
        { text: '🔴 CANLI YAYINLAR', ui: 'muted', size: 1.12 },
        { text: items.length ? 'Düzenlemek istediğin yayıncıya dokun.' : 'Henüz takip edilen yayıncı yok.', ui: 'muted' }
      ],
      sections: [
        { value: 'livestreams:refresh', label: '↻ Listeyi Yenile', style: 'secondary' },
        { value: 'livestreams:new', label: '➕ Yeni Yayıncı Ekle', style: 'success' }
      ],
      sectionColumns: 2,
      commands: items.slice(0, 9).map((item) => ({
          value: `livestreams:select:${item.id}`,
          label: `${item.isLive ? '🔴' : item.lastEventType === 'video' ? '▶️' : '⚫'} ${item.name}`,
          title: `${String(item.platform || '').toUpperCase()} • ${item.source} • Kanal #${item.channelId}`,
          actionLabel: 'Yönet →',
          style: item.isLive ? 'success' : 'ghost'
        })),
      footerNote: 'Kurulum iki kısa adımdır: platformu seç, üç bilgiyi yaz.'
    });
  }

  renderLevelingJtml({ session }) {
    const snapshot = session.levelingSnapshot || {};
    const settings = snapshot.settings || {};
    const profile = snapshot.profile || { level: 0, xp: 0, messages: 0, awardedBadgeIds: [] };
    const progress = snapshot.progress || { percent: 0, gained: 0, required: 100, level: 0 };
    const isAdmin = this.app.permissionManager.has(session.ownerUserId, 'admin');
    const isOwner = this.app.permissionManager.has(session.ownerUserId, 'owner');
    const isGroupFounder = snapshot.isGroupFounder === true;
    const badgeRewardCount = Object.keys(snapshot.badgeRewards || {}).length;
    const roleRewardCount = Object.keys(snapshot.roleRewards || {}).length;
    const topText = (snapshot.top || []).slice(0, 3)
      .map((item, index) => `${index + 1}. #${item.userId} • Lv.${item.level} • ${item.xp} XP`)
      .join('  |  ') || 'Henüz sıralama verisi yok.';
    const navigation = [
      { value: 'home', label: '⌂ Ana Panel', style: 'secondary' },
      { value: 'section:progression', label: '📚 Tüm Komutlar', style: 'secondary' },
      { value: 'leveling:home', label: '↻ Yenile', style: 'primary' }
    ];
    const commands = [
      { value: 'leveling:rank', label: '⭐ Rank Göster', style: 'primary' },
      { value: 'leveling:top', label: '🏆 Liderlik Tablosu', style: 'primary' },
      { value: 'leveling:rewards', label: '🎁 Ödül Eşlemeleri', style: 'secondary' },
      { value: 'leveling:listbadges', label: '🏅 Rozetleri Listele', style: 'secondary' }
    ];
    if (isAdmin) {
      commands.push(
        { value: settings.enabled ? 'leveling:toggle:off' : 'leveling:toggle:on', label: settings.enabled ? '⛔ Sistemi Kapat' : '✅ Sistemi Aç', style: settings.enabled ? 'danger' : 'success' },
        { value: 'leveling:addxp', label: '➕ XP Ver', style: 'success' },
        { value: 'leveling:removexp', label: '➖ XP Al', style: 'warning' },
        { value: 'leveling:setlevel', label: '🎚️ Seviye Ayarla', style: 'warning' },
        { value: 'leveling:maprole', label: '🎭 Ücretsiz Seviye Rolü Bağla', style: 'success' },
        { value: 'leveling:unmaprole', label: '✂️ Seviye Rolü Bağını Sil', style: 'danger' },
        { value: 'leveling:mapbadge', label: '🔗 Rozeti Seviyeye Bağla', style: 'primary' },
        { value: 'leveling:unmapbadge', label: '✂️ Rozet Bağını Sil', style: 'danger' },
        { value: 'leveling:givebadge', label: '🎖️ Kullanıcıya Rozet Ver', style: 'success' },
        { value: 'leveling:synctarget', label: '🔄 Hedef Ödüllerini Senkronla', style: 'primary' },
        { value: 'settings:category:leveling', label: '⚙️ XP ve Kart Ayarları', style: 'secondary' }
      );
    }
    if (isOwner) {
      commands.push(
        { value: 'leveling:createbadge', label: '🏅 Seviye Rozeti Oluştur', style: 'success' },
        { value: 'leveling:syncall', label: '🔁 Tüm Ödülleri Senkronla', style: 'danger' }
      );
    }
    if (isGroupFounder) {
      commands.push(
        { value: 'leveling:createpack', label: '🎨 Simgeli Rozet Paketi', style: 'warning' }
      );
    }

    return buildCommandMenuBumote({
      header: [
        { text: '⭐ TOPLYBOT • SEVİYE & ROZET MERKEZİ', ui: 'muted', size: 1.16 },
        { text: `Sunucu #${session.groupId ?? '—'} • Sistem ${settings.enabled ? 'AÇIK' : 'KAPALI'} • ${snapshot.totalProfiles || 0} kayıtlı profil`, ui: 'muted' },
        { text: `XP ${settings.xpMin ?? settings.xpPerMessage ?? 10}-${settings.xpMax ?? settings.xpPerMessage ?? 10} • x${settings.multiplier ?? 1} • ${settings.cooldownSeconds ?? 0} sn bekleme`, ui: 'muted' },
        { text: `Ödüller: ${roleRewardCount} rol eşlemesi • ${badgeRewardCount} Topluyo rozeti eşlemesi`, ui: 'muted' },
        session.notice ? { text: session.notice, ui: 'muted' } : null
      ].filter(Boolean),
      navigation,
      progress: {
        percent: progress.percent,
        title: `Senin profilin • Seviye ${profile.level}`,
        status: `${profile.xp} XP • ${profile.messages} mesaj • ${profile.awardedBadgeIds?.length || 0} seviye rozeti`,
        detail: `Sonraki seviye: ${progress.gained}/${progress.required} XP  |  İlk 3: ${topText}`,
        tone: settings.enabled ? 'success' : 'danger'
      },
      inputs: [
        {
          name: 'level_target_user',
          value: String(session.ownerUserId),
          label: '👤 Hedef kullanıcı ID',
          description: 'Rank, XP verme/alma ve seviye ayarlama işlemlerinde kullanılır.',
          placeholder: '25426',
          maxLength: 24
        },
        {
          name: 'level_amount',
          value: '100',
          label: '🔢 XP miktarı / hedef seviye',
          description: 'XP işlemlerinde miktar; Seviye Ayarla işleminde hedef seviye.',
          placeholder: '100',
          maxLength: 12
        },
        {
          name: 'level_reward_level',
          value: '10',
          label: '🎯 Ödül seviyesi',
          description: 'Rol veya rozet ödülünün hangi seviyede verileceğini yaz.',
          placeholder: '10',
          maxLength: 8
        },
        {
          name: 'level_role_id',
          label: '🎭 Sunucu rol ID',
          description: 'Bu rol seviyeye ulaşınca ücretsiz verilir; para veya rozet gerekmez.',
          placeholder: 'Rol ID',
          maxLength: 24
        },
        {
          name: 'level_badge_id',
          label: '🏅 Topluyo rozet ID',
          description: 'Mevcut bir rozeti seviyeye bağlamak için kullanılır.',
          placeholder: 'Rozet ID',
          maxLength: 24
        }
      ],
      commands,
      commandColumns: 3,
      footerActions: [{ value: 'close', label: 'Paneli Kapat', style: 'danger' }],
      footerNote: isAdmin
        ? 'Rol ve rozet iki ayrı ödüldür. Seviye rolü tamamen ücretsiz verilir; rozet sahibi olma veya para şartı yoktur.'
        : 'Rank ve liderlik işlemlerini buradan kullanabilirsin. Yönetim düğmeleri yalnızca yetkililere görünür.'
    });
  }

  renderSettingsJtml({ session, view }) {
    const service = this.app.services.menuSettings;
    const snapshot = session.settingsSnapshot || {};
    const categories = service?.categories?.() || [];
    const navigation = [
      { value: 'home', label: '🧭 Komutlar', style: 'secondary' },
      { value: 'settings:home', label: '⚙️ Ayarlar', style: 'primary' },
      { value: 'refresh', label: '🔄 Yenile', style: 'secondary' }
    ];
    const footerActions = [{ value: 'close', label: '✖ Paneli Kapat', style: 'danger' }];
    const header = [
      { text: '⚙️ Sunucu Ayarları', ui: 'muted', size: 1.14 },
      { text: `🏠 Sunucu #${session.groupId ?? '—'} • Tüm değişiklikler yalnızca bu sunucuya kaydedilir.`, ui: 'muted' },
      session.notice ? { text: session.notice, ui: 'muted' } : null
    ].filter(Boolean);

    if (!session.groupId) {
      return buildCommandMenuBumote({
        header: [...header, { text: 'Bu panel için sunucu/grup ID çözümlenemedi.', ui: 'muted' }],
        navigation,
        footerActions,
        footerNote: 'Paneli bir sunucu kanalında yeniden aç.'
      });
    }

    if (!service) {
      return buildCommandMenuBumote({
        header: [...header, { text: 'Ayar servisi yüklenemedi.', ui: 'muted' }],
        navigation,
        footerActions
      });
    }

    if (view.type === 'settings-category') {
      const category = service.category(view.categoryId) || categories[0];
      const fields = service.fields(category?.id);
      const pageSize = Math.max(4, Number(this.config().settingsPerPage) || 8);
      const totalPages = Math.max(1, Math.ceil(fields.length / pageSize));
      const page = Math.max(0, Math.min(Number(view.page) || 0, totalPages - 1));
      const visible = fields.slice(page * pageSize, (page + 1) * pageSize);
      const pageNavigation = [...navigation];
      if (page > 0) pageNavigation.push({ value: `settings:page:${category.id}:${page - 1}`, label: '◀ Önceki', style: 'secondary' });
      if (page + 1 < totalPages) pageNavigation.push({ value: `settings:page:${category.id}:${page + 1}`, label: 'Sonraki ▶', style: 'secondary' });
      return buildCommandMenuBumote({
        header: [
          ...header,
          { text: `${category.emoji} ${category.title}`, ui: 'muted', size: 1.08 },
          { text: `${category.description} • Sayfa ${page + 1}/${totalPages}`, ui: 'muted' }
        ],
        navigation: pageNavigation,
        commands: visible.map((field) => {
          const value = service.value(snapshot, field);
          const enabled = field.type === 'boolean' ? Boolean(value) : null;
          const icon = field.type === 'boolean' ? (enabled ? '🟢' : '🔴') : field.type === 'channel' ? '📍' : '✏️';
          return {
            value: `settings:field:${field.id}`,
            label: `${icon} ${field.title} • ${service.format(field, value, { compact: true, groupId: session.groupId })}`,
            style: field.type === 'boolean' ? (enabled ? 'success' : 'danger') : field.type === 'channel' ? 'primary' : 'ghost',
            title: field.description || field.path
          };
        }),
        commandColumns: 3,
        footerActions,
        footerNote: `${fields.length} sunucu ayarı • Bir satıra dokunarak düzenle.`
      });
    }

    if (view.type === 'settings-field') {
      const field = service.field(view.fieldId);
      if (!field) {
        return buildCommandMenuBumote({
          header: [...header, { text: 'Ayar alanı bulunamadı.', ui: 'muted' }],
          navigation,
          footerActions
        });
      }
      const category = service.category(field.category);
      const value = service.value(snapshot, field);
      navigation.push({ value: `settings:category:${field.category}`, label: `↩ ${category?.title || 'Kategori'}`, style: 'secondary' });
      const placeholder = field.type === 'channel'
        ? '#kanaladı veya kanal ID'
        : field.type === 'id-list'
          ? '123, 456, 789'
          : field.type === 'string-list'
            ? 'değer1, değer2'
            : 'Yeni değeri gir...';
      const inputs = field.type === 'boolean' ? [] : [{
        name: 'setting_value',
        value: service.inputValue(field, value, { groupId: session.groupId }),
        label: `✏️ ${field.title}`,
        description: field.description || `Ayar yolu: ${field.path}`,
        placeholder,
        maxLength: field.maxLength || 5000
      }];
      const commands = field.type === 'boolean'
        ? [
            { value: `settings:set:${field.id}:true`, label: '✅ Aç', style: value ? 'success' : 'secondary' },
            { value: `settings:set:${field.id}:false`, label: '⛔ Kapat', style: !value ? 'danger' : 'secondary' },
            { value: `settings:reset:${field.id}`, label: '↺ Varsayılana Dön', style: 'warning' }
          ]
        : [
            { value: `settings:save:${field.id}`, label: '💾 Bu Sunucuya Kaydet', style: 'success' },
            { value: `settings:reset:${field.id}`, label: '↺ Varsayılana Dön', style: 'warning' }
          ];
      return buildCommandMenuBumote({
        header: [
          ...header,
          { text: `${category?.emoji || '⚙️'} ${field.title}`, ui: 'muted', size: 1.08 },
          { text: `Mevcut: ${service.format(field, value, { groupId: session.groupId })}`, ui: 'muted' },
          field.description ? { text: field.description, ui: 'muted' } : null
        ].filter(Boolean),
        navigation,
        inputs,
        commands,
        commandColumns: field.type === 'boolean' ? 3 : 2,
        footerActions,
        footerNote: field.type === 'channel'
          ? 'Kanal ID bilmek zorunda değilsin: #hoş-geldin gibi kanal etiketini yazman yeterli.'
          : `Bu değer yalnızca Sunucu #${session.groupId} için saklanır.`
      });
    }

    const styleByCategory = {
      welcome: 'success',
      channels: 'primary',
      roles: 'primary',
      moderation: 'warning',
      tickets: 'secondary',
      automation: 'ghost'
    };

    return buildCommandMenuBumote({
      header: [
        ...header,
        { text: 'Bir bölüm seç. Kanal alanlarında #kanaladı kullanabilirsin.', ui: 'muted' }
      ],
      navigation,
      sections: categories.map((category) => ({
        value: `settings:category:${category.id}`,
        label: `${category.emoji} ${category.title} · ${category.fieldCount}`,
        style: styleByCategory[category.id] || 'primary',
        title: category.description
      })),
      sectionColumns: 3,
      footerActions,
      footerNote: `🔒 Sunucu kapsamı etkin: Sunucu #${session.groupId} ayarları diğer sunucularla paylaşılmaz.`
    });
  }

  isMenuAction(value) {
    const action = String(value ?? '').trim();
    if (!action) return false;
    if (['home', 'back', 'refresh', 'close', 'search'].includes(action)) return true;
    return /^(?:section|page|command|run|runargs|launcher|settings|quickmod|inventory|template|leveling|livestreams|assistant):[^\s]+$/u.test(action);
  }

  extractAction(event) {
    const form = event?.message?.form && typeof event.message.form === 'object'
      ? event.message.form
      : {};

    // Topluyo'nun güncel istemcisinde tıklanan Bumote düğmesinin `value`
    // alanı message.submit içinde geliyor. Aynı `name` değerini kullanan çok
    // sayıda düğme form nesnesine yazılırken son düğmenin görünen metni
    // form.menu_action alanını ezebiliyor (örn. "✖ Menüyü Kapat").
    // Resmî dokümandaki eski/alternatif biçim için form alanları da fallback.
    const candidates = [
      event?.message?.submit,
      form.menu_action,
      form.action_id,
      form.custom_id,
      form.action,
      form.value
    ];

    for (const candidate of candidates) {
      const action = String(candidate ?? '').trim();
      if (this.isMenuAction(action)) return action;
    }
    return '';
  }

  async closeSession(session, label = '🔒 Komut merkezi kapatıldı.') {
    session.active = false;
    session.closedAt = new Date().toISOString();
    await this.saveSession(session);
    await updateInteractivePost({
      client: this.app.client,
      postId: session.postId,
      text: '',
      jtmlCode: buildClosedMenuBumote(label),
      attach: this.app.config.interactions?.attachBumote !== false,
      logger: this.app.logger,
      context: 'Kapalı komut merkezi JTML'
    }).catch(() => {});
  }

  async refreshSession(session) {
    session.expiresAt = this.sessionExpiry();
    if (String(session.view?.type || '').startsWith('settings') && this.app.services.menuSettings) {
      session.settingsSnapshot = await this.app.services.menuSettings.snapshot(session.groupId);
    }
    if (session.view?.type === 'leveling' && session.groupId && this.app.services.leveling) {
      session.levelingSnapshot = await this.app.services.leveling.dashboard(session.groupId, session.ownerUserId);
    }
    if (session.view?.type === 'livestreams' && session.groupId && this.app.stores.liveStreams) {
      session.liveStreamsSnapshot = (await this.app.stores.liveStreams.read())
        .filter((item) => String(item.groupId) === String(session.groupId));
    }
    if (session.view?.type === 'inventory' && session.groupId) {
      const current = session.inventorySnapshot || {};
      session.inventorySnapshot = await this.loadInventory(
        session.groupId,
        current.kind || session.view.kind || 'channels',
        current.sort || session.view.sort || 'order',
        current.page || session.view.page || 0
      );
    }
    const saved = await this.saveSession(session);
    const rendered = this.render(saved);
    await updateInteractivePost({
      client: this.app.client,
      postId: saved.postId,
      text: rendered.text,
      jtmlCode: rendered.jtml,
      attach: this.app.config.interactions?.attachBumote !== false,
      logger: this.app.logger,
      context: 'Komut merkezi JTML'
    });
    if (saved.notice) {
      saved.notice = '';
      await this.saveSession(saved);
    }
    return saved;
  }

  async handle(event) {
    if (event?.action !== 'post/bumote') return false;
    const session = await this.findByPostId(event.post_id);
    if (!session) return false;
    if (!session.active) return true;

    if (Date.parse(session.expiresAt || '') <= Date.now()) {
      await this.closeSession(session, '⌛ Komut merkezi oturumunun süresi doldu. Yeniden açmak için sohbete ! gönder.');
      return true;
    }

    const userId = Number(event.user_id);
    if (session.ownerOnly && userId !== Number(session.ownerUserId)) {
      await this.app.client.sendDirectMessage(
        userId,
        `Bu komut menüsü kullanıcı #${session.ownerUserId} için açılmış. Kendi menünü açmak için bir kanala yalnızca ${this.app.config.prefix} gönder.`
      ).catch(() => {});
      return true;
    }

    const action = this.extractAction(event);
    const form = event?.message?.form || {};
    if (!action) return true;

    const createProgressHook = (commandName) => async (snapshot) => {
      session.view = {
        type: 'progress',
        commandName,
        percent: snapshot.percent,
        title: snapshot.title,
        status: snapshot.status,
        detail: snapshot.detail,
        tone: snapshot.tone
      };
      await this.refreshSession(session);
    };

    if (action.startsWith('assistant:')) {
      const payload = action.slice('assistant:'.length);
      if (payload === 'home') {
        session.view = { type: 'assistant', intent: null, page: 0 };
      } else if (payload.startsWith('intent:')) {
        const intent = payload.slice('intent:'.length);
        if (['setup', 'change', 'solve', 'quick'].includes(intent)) {
          session.view = { type: 'assistant', intent, page: 0 };
        }
      } else if (payload.startsWith('open:')) {
        const target = payload.slice('open:'.length);
        this.remember(session, target, target.split(':').slice(1).join(' ') || target);
        if (target.startsWith('command:')) {
          const commandName = normalize(target.slice('command:'.length));
          const command = this.app.router.getCommand(commandName);
          if (command && normalize(command.requiredPermission) !== 'owner' && this.app.permissionManager.has(userId, command.requiredPermission)) {
            session.view = { type: 'command', commandName: command.name, assistant: true, page: 0 };
          }
        } else if (target.startsWith('section:')) {
          session.view = { type: 'section', sectionId: target.slice('section:'.length), page: 0 };
        } else if (target === 'settings:home') {
          session.view = { type: 'settings-home', page: 0 };
        } else if (target === 'livestreams:home') {
          session.view = { type: 'livestreams', mode: 'home', selectedId: null, page: 0 };
        } else if (target === 'leveling:home') {
          session.view = { type: 'leveling', page: 0 };
        } else if (target === 'quickmod:home') {
          session.view = { type: 'quickmod', page: 0 };
        } else if (target === 'template:support') {
          session.view = { type: 'support-template', page: 0 };
        } else if (target.startsWith('inventory:')) {
          const [, kindRaw, sortRaw, pageRaw] = target.split(':');
          const kind = kindRaw === 'roles' ? 'roles' : 'channels';
          session.inventorySnapshot = await this.loadInventory(session.groupId, kind, sortRaw || 'order', pageRaw || 0);
          session.view = { type: 'inventory', kind, sort: sortRaw || 'order', page: Number(pageRaw) || 0 };
        }
      }
      await this.refreshSession(session);
      return true;
    }

    if (action.startsWith('livestreams:')) {
      if (!session.groupId || !this.app.permissionManager.has(userId, 'admin') || !this.app.stores.liveStreams) {
        await this.app.client.sendDirectMessage(userId, 'Canlı yayın duyurularını yönetmek için sunucuda admin yetkisi gerekir.').catch(() => {});
        return true;
      }
      const operation = action.slice('livestreams:'.length);
      const selectedId = Number(
        operation.startsWith('select:') ? operation.slice('select:'.length) : (form.live_id || session.view?.selectedId)
      );
      const platform = normalize(form.live_platform || session.view?.platform || 'kick');
      let channelId = String(form.live_channel || '').trim();
      const name = String(form.live_name || '').trim();
      const source = String(form.live_source || '').trim();
      const mention = String(form.live_mention ?? '@millet').trim();
      const pollMinutes = Number(form.live_interval || 3);
      const template = String(form.live_template || '').replace(/\\n/g, '\n').trim();
      const videoTemplate = String(form.live_video_template || '').replace(/\\n/g, '\n').trim();
      const logoUrl = String(form.live_logo || '').trim();
      try {
        if (operation === 'home') {
          this.remember(session, 'livestreams:home', '🔴 Canlı Yayınlar');
          session.notice = null;
          session.view = { type: 'livestreams', mode: 'home', selectedId: null, page: 0 };
        } else if (operation === 'refresh') {
          session.notice = null;
          session.view = Number.isInteger(selectedId) && selectedId > 0
            ? { type: 'livestreams', mode: 'detail', selectedId, page: 0 }
            : { type: 'livestreams', mode: 'home', selectedId: null, page: 0 };
        } else if (operation === 'new') {
          session.view = { type: 'livestreams', mode: 'choose-platform', selectedId: null, page: 0 };
        } else if (operation.startsWith('platform:')) {
          const chosenPlatform = operation.slice('platform:'.length);
          if (!['kick', 'twitch', 'youtube'].includes(chosenPlatform)) throw new Error('Geçersiz platform seçildi.');
          session.view = { type: 'livestreams', mode: 'add', platform: chosenPlatform, selectedId: null, page: 0 };
        } else if (operation.startsWith('select:')) {
          const exists = (await this.app.stores.liveStreams.read())
            .some((item) => Number(item.id) === selectedId && String(item.groupId) === String(session.groupId) && item.active);
          if (!exists) throw new Error('Seçilen yayın takibi artık bulunmuyor.');
          session.notice = null;
          session.view = { type: 'livestreams', mode: 'detail', selectedId, page: 0 };
        } else if (operation === 'edit') {
          session.view = { type: 'livestreams', mode: 'edit', selectedId, page: 0 };
        } else if (operation === 'advanced') {
          session.view = { type: 'livestreams', mode: 'advanced', selectedId, page: 0 };
        } else if (operation === 'add') {
          if (!['kick', 'twitch', 'youtube'].includes(platform)) throw new Error('Platform kick, twitch veya youtube olmalı.');
          if (!name || !source) throw new Error('Yayıncı adı ve yayın kaynağı zorunludur.');
          if (!Number.isFinite(pollMinutes) || pollMinutes < 1 || pollMinutes > 60) throw new Error('Kontrol aralığı 1-60 dakika olmalı.');
          channelId = await this.prepareLiveAnnouncementChannel(session.groupId, channelId);
          let created;
          await this.app.stores.liveStreams.update((items) => {
            created = {
              id: nextId(items), groupId: session.groupId, platform, channelId, name, source,
              mention: mention.toLocaleLowerCase('tr-TR') === 'yok' ? '' : mention,
              template: template || this.app.config.liveStreams?.defaultTemplate || DEFAULT_TEMPLATE,
              videoTemplate: videoTemplate || this.app.config.liveStreams?.defaultVideoTemplate || DEFAULT_VIDEO_TEMPLATE,
              logoUrl,
              pollMinutes, active: true, isLive: false, lastLiveId: null, lastAnnouncedId: null,
              lastSeenContentId: null, lastEventType: null,
              hasSuccessfulCheck: false,
              lastCheckedAt: null, nextCheckAt: new Date().toISOString(), lastError: null,
              lastAnnouncedAt: null, announcementCount: 0, createdBy: userId, createdAt: new Date().toISOString()
            };
            items.push(created);
            return items;
          });
          session.view = { type: 'livestreams', mode: 'detail', selectedId: created.id, page: 0 };
          if (typeof this.app.services.liveStreams?.checkWatcher === 'function') {
            try {
              const result = await this.app.services.liveStreams.checkWatcher(created, { announce: false });
              session.notice = result.status.live
                ? `✅ ${created.name} doğrulandı: şu anda CANLI. Mevcut yayın için duyuru atılmadı.`
                : result.status.eventType === 'video'
                  ? `✅ ${created.name} doğrulandı. Son video başlangıç noktası olarak kaydedildi; bundan sonraki yeni videolar duyurulacak.`
                  : `✅ ${created.name} doğrulandı: şu anda çevrimdışı. Canlı olduğunda duyuru atılacak.`;
            } catch (error) {
              session.notice = `⚠️ Takip kaydedildi fakat kanal doğrulanamadı: ${truncate(error.message, 150)}`;
            }
          } else {
            session.notice = `✅ Yayın takibi #${created.id} eklendi.`;
          }
        } else if (operation === 'save-basic') {
          if (!Number.isInteger(selectedId) || selectedId < 1) throw new Error('Önce listeden bir yayın takibi seç.');
          if (!name || !source) throw new Error('Yayıncı adı ve kullanıcı adı boş olamaz.');
          channelId = await this.prepareLiveAnnouncementChannel(session.groupId, channelId);
          let changed = false;
          await this.app.stores.liveStreams.update((items) => {
            const item = items.find((entry) => Number(entry.id) === selectedId && String(entry.groupId) === String(session.groupId));
            if (item) {
              Object.assign(item, { channelId, name, source, nextCheckAt: new Date().toISOString() });
              changed = true;
            }
            return items;
          });
          if (!changed) throw new Error('Yayın takibi bulunamadı.');
          session.view = { type: 'livestreams', mode: 'detail', selectedId, page: 0 };
          session.notice = `✅ ${name} güncellendi.`;
        } else if (operation === 'save-advanced' || operation === 'defaults') {
          if (!Number.isInteger(selectedId) || selectedId < 1) throw new Error('Önce listeden bir yayın takibi seç.');
          const reset = operation === 'defaults';
          if (!reset && (!Number.isFinite(pollMinutes) || pollMinutes < 1 || pollMinutes > 60)) throw new Error('Kontrol süresi 1-60 dakika olmalı.');
          if (!reset && logoUrl && !/^https:\/\//i.test(logoUrl)) throw new Error('Logo adresi HTTPS ile başlamalı.');
          await this.app.stores.liveStreams.update((items) => {
            const item = items.find((entry) => Number(entry.id) === selectedId && String(entry.groupId) === String(session.groupId));
            if (item) Object.assign(item, reset ? {
              mention: this.app.config.liveStreams?.defaultMention || '@millet',
              pollMinutes: this.app.config.liveStreams?.defaultPollMinutes || 3,
              template: this.app.config.liveStreams?.defaultTemplate || DEFAULT_TEMPLATE,
              videoTemplate: this.app.config.liveStreams?.defaultVideoTemplate || DEFAULT_VIDEO_TEMPLATE,
              logoUrl: ''
            } : {
              mention: mention.toLocaleLowerCase('tr-TR') === 'yok' ? '' : mention,
              pollMinutes,
              template: template || item.template,
              videoTemplate: videoTemplate || item.videoTemplate || DEFAULT_VIDEO_TEMPLATE,
              logoUrl
            }, { nextCheckAt: new Date().toISOString() });
            return items;
          });
          session.view = { type: 'livestreams', mode: 'detail', selectedId, page: 0 };
          session.notice = reset ? '↺ Hazır ayarlar geri yüklendi.' : '✅ Gelişmiş ayarlar kaydedildi.';
        } else if (['check', 'test'].includes(operation)) {
          if (!Number.isInteger(selectedId) || selectedId < 1) throw new Error('Önce listeden bir yayın takibi seç.');
          const watcher = (await this.app.stores.liveStreams.read())
            .find((item) => Number(item.id) === selectedId && String(item.groupId) === String(session.groupId) && item.active);
          if (!watcher) throw new Error('Yayın takibi bulunamadı.');
          if (operation === 'test') {
            if (typeof this.app.services.liveStreams?.sendTest !== 'function') throw new Error('Test duyurusu servisi hazır değil.');
            await this.app.services.liveStreams.sendTest(watcher);
          } else {
            if (typeof this.app.services.liveStreams?.checkWatcher !== 'function') throw new Error('Yayın kontrol servisi hazır değil.');
            const result = await this.app.services.liveStreams.checkWatcher(watcher, { announce: false });
            session.notice = result.status.live
              ? `🔴 ${watcher.name} şu anda canlı: ${result.status.title || 'Başlıksız yayın'}`
              : result.status.eventType === 'video'
                ? `▶️ ${watcher.name} son video: ${result.status.title || 'Başlıksız video'}`
                : `⚫ ${watcher.name} şu anda çevrimdışı.`;
          }
          session.view = { type: 'livestreams', mode: 'detail', selectedId, page: 0 };
          if (operation === 'test') session.notice = `✅ Test duyurusu kanal ${watcher.channelId} üzerine gönderildi.`;
        } else if (['disable', 'delete'].includes(operation)) {
          let changed = false;
          await this.app.stores.liveStreams.update((items) => {
            const item = items.find((entry) => Number(entry.id) === selectedId && String(entry.groupId) === String(session.groupId));
            if (item) { item.active = false; changed = true; }
            return items;
          });
          if (!changed) throw new Error('Yayın takibi bulunamadı.');
          session.view = { type: 'livestreams', mode: 'home', selectedId: null, page: 0 };
          session.notice = `⏸ #${selectedId} yayın takibi kapatıldı.`;
        }
      } catch (error) {
        session.notice = `⚠️ ${truncate(error.message || 'Canlı yayın ayarı uygulanamadı.', 220)}`;
        session.view = {
          type: 'livestreams',
          mode: Number.isInteger(selectedId) ? 'detail' : (session.view?.mode || 'home'),
          selectedId: Number.isInteger(selectedId) ? selectedId : null,
          platform: session.view?.platform,
          page: 0
        };
      }
      await this.refreshSession(session);
      return true;
    }

    if (action.startsWith('launcher:')) {
      if (action === 'launcher:home') {
        session.view = { type: 'launcher', page: 0 };
        await this.refreshSession(session);
        return true;
      }
      const launcherReturnView = session.view?.type === 'home' ? 'home' : 'launcher';
      const query = normalize(form.launcher_query || form.query || '');
      if (!query) {
        session.notice = 'Bir komut adı yaz.';
        session.view = { type: launcherReturnView, page: 0 };
        await this.refreshSession(session);
        return true;
      }
      let command = this.app.router.getCommand(query);
      if (!command) {
        const matches = this.visibleCommands(userId).filter((item) => commandMatches(item, query));
        if (matches.length === 1) command = matches[0];
        else {
          session.notice = matches.length
            ? `“${query}” için ${matches.length} sonuç var; aşağıdaki arama ekranından seç.`
            : `“${query}” adlı komut bulunamadı.`;
          session.view = { type: 'search', query, page: 0 };
          await this.refreshSession(session);
          return true;
        }
      }
      if (!this.app.permissionManager.has(userId, command.requiredPermission)) {
        session.notice = `${command.name} için ${command.requiredPermission} yetkisi gerekiyor.`;
        session.view = { type: launcherReturnView, page: 0 };
        await this.refreshSession(session);
        return true;
      }
      if (commandAcceptsArguments(command)) {
        session.view = { type: 'command', commandName: command.name, page: 0 };
        session.notice = `${this.app.config.prefix}${command.name} seçildi; tek giriş alanını doldur.`;
        await this.refreshSession(session);
        return true;
      }
      await this.app.router.handle({
        action: 'post/add',
        message: `${this.app.config.prefix}${command.name}`,
        user_id: userId,
        channel_id: session.channelId,
        group_id: session.groupId,
        interaction: {
          post_id: session.postId,
          menu_action: action,
          progressHook: createProgressHook(command.name)
        }
      }, this.app);
      session.notice = `${this.app.config.prefix}${command.name} çalıştırıldı.`;
      session.view = { type: launcherReturnView, page: 0 };
      await this.refreshSession(session);
      return true;
    }

    if (action.startsWith('quickmod:')) {
      if (!session.groupId || !this.app.permissionManager.has(userId, 'moderator')) {
        await this.app.client.sendDirectMessage(userId, 'Hızlı moderasyon için sunucuda moderatör yetkisi gerekir.').catch(() => {});
        return true;
      }
      if (action === 'quickmod:home') {
        session.view = { type: 'quickmod', page: 0 };
        await this.refreshSession(session);
        return true;
      }
      const operation = normalize(action.slice('quickmod:run:'.length));
      const command = this.app.router.getCommand(operation);
      if (!command || !this.app.permissionManager.has(userId, command.requiredPermission)) {
        session.notice = `⛔ ${operation || 'Bu işlem'} için gerekli yetkin yok.`;
        session.view = { type: 'quickmod', page: 0 };
        await this.refreshSession(session);
        return true;
      }
      const target = String(form.target_user_id || '').trim();
      const duration = String(form.duration || '10m').trim() || '10m';
      const reason = String(form.reason || '').trim() || 'Panel üzerinden uygulandı.';
      const amount = Math.max(1, Math.min(100, Number(form.amount) || 10));
      let args = '';
      if (operation === 'temizle') args = `${amount}${target ? ` ${target}` : ''}`;
      else if (['unban', 'untimeout'].includes(operation)) args = target;
      else if (operation === 'ban') args = `${target} ${duration} ${reason}`;
      else if (operation === 'timeout') args = `${target} ${duration} ${reason}`;
      else args = `${target} ${reason}`;
      if (operation !== 'temizle' && !/^\d+$/.test(target)) {
        session.notice = '⚠️ Geçerli bir hedef kullanıcı ID gir.';
        session.view = { type: 'quickmod', page: 0 };
        await this.refreshSession(session);
        return true;
      }
      await this.app.router.handle({
        action: 'post/add', message: `${this.app.config.prefix}${operation} ${args}`.trim(),
        user_id: userId, channel_id: session.channelId, group_id: session.groupId,
        interaction: { post_id: session.postId, menu_action: action, progressHook: createProgressHook(command.name) }
      }, this.app);
      session.notice = `✅ ${this.app.config.prefix}${operation} panelden çalıştırıldı.`;
      session.view = { type: 'quickmod', page: 0 };
      await this.refreshSession(session);
      return true;
    }

    if (action.startsWith('leveling:')) {
      const service = this.app.services.leveling;
      if (!session.groupId || !service) {
        await this.app.client.sendDirectMessage(userId, 'Seviye merkezi için sunucu bağlamı veya servis bulunamadı.').catch(() => {});
        return true;
      }
      const isAdmin = this.app.permissionManager.has(userId, 'admin');
      const isOwner = this.app.permissionManager.has(userId, 'owner');
      const targetUserId = Number(form.level_target_user || userId);
      const amount = Number(form.level_amount || 0);
      const rewardLevel = Number(form.level_reward_level || 0);
      const roleId = Number(form.level_role_id || 0);
      const badgeId = Number(form.level_badge_id || 0);
      try {
        if (action === 'leveling:home') {
          session.view = { type: 'leveling', page: 0 };
        } else if (action === 'leveling:rank') {
          await this.app.router.handle({
            action: 'post/add',
            message: `${this.app.config.prefix}rank ${Number.isInteger(targetUserId) ? targetUserId : userId}`,
            user_id: userId,
            channel_id: session.channelId,
            group_id: session.groupId,
            interaction: { post_id: session.postId, menu_action: action }
          }, this.app);
          session.notice = '⭐ Rank bilgisi kanala gönderildi.';
          session.view = { type: 'leveling', page: 0 };
        } else if (action === 'leveling:top') {
          await this.app.router.handle({
            action: 'post/add', message: `${this.app.config.prefix}toprank`, user_id: userId,
            channel_id: session.channelId, group_id: session.groupId,
            interaction: { post_id: session.postId, menu_action: action }
          }, this.app);
          session.notice = '🏆 Liderlik tablosu kanala gönderildi.';
          session.view = { type: 'leveling', page: 0 };
        } else if (action === 'leveling:rewards') {
          const settings = await service.settings(session.groupId);
          const levels = [...new Set([
            ...Object.keys(settings.roleRewards || {}),
            ...Object.keys(settings.badgeRewards || {})
          ])].map(Number).filter(Number.isInteger).sort((a, b) => a - b);
          session.notice = levels.length
            ? truncate(levels.map((level) => `Lv.${level}: rol ${settings.roleRewards?.[level] || '—'}, rozet ${settings.badgeRewards?.[level] || '—'}`).join(' • '), 220)
            : 'Henüz seviye rolü veya rozeti eşlenmemiş.';
          session.view = { type: 'leveling', page: 0 };
        } else if (action === 'leveling:listbadges') {
          const badges = await this.app.services.apiManagement.listBadges(session.groupId);
          session.notice = badges.length
            ? truncate(badges.slice(0, 8).map((badge) => `#${badge.id ?? badge.badge_id ?? '?'} ${badge.name || badge.title || badge.nick || 'Rozet'}`).join(' • '), 220)
            : 'Sunucuda rozet bulunamadı.';
          session.view = { type: 'leveling', page: 0 };
        } else {
          if (!isAdmin && action !== 'leveling:createpack') throw new Error('Bu seviye işlemi için admin yetkisi gerekiyor.');
          if (action === 'leveling:toggle:on' || action === 'leveling:toggle:off') {
            const enabled = action.endsWith(':on');
            await this.app.services.settings.set(session.groupId, 'leveling.enabled', enabled);
            session.notice = `Seviye sistemi ${enabled ? 'açıldı' : 'kapatıldı'}.`;
          } else if (action === 'leveling:addxp' || action === 'leveling:removexp') {
            if (!Number.isInteger(targetUserId) || targetUserId <= 0) throw new Error('Geçerli hedef kullanıcı ID gir.');
            if (!Number.isInteger(amount) || amount <= 0) throw new Error('Pozitif XP miktarı gir.');
            const delta = action === 'leveling:addxp' ? amount : -amount;
            const result = await service.changeXp({ groupId: session.groupId, userId: targetUserId, delta, source: `menu:${userId}` });
            session.notice = `#${targetUserId}: ${delta > 0 ? '+' : ''}${delta} XP • Lv.${result.profile.level} • ${result.profile.xp} XP`;
          } else if (action === 'leveling:setlevel') {
            if (!Number.isInteger(targetUserId) || targetUserId <= 0) throw new Error('Geçerli hedef kullanıcı ID gir.');
            if (!Number.isInteger(amount) || amount < 0) throw new Error('Geçerli hedef seviye gir.');
            const result = await service.setLevel({ groupId: session.groupId, userId: targetUserId, level: amount, source: `menu:${userId}` });
            session.notice = `#${targetUserId} Seviye ${result.profile.level} olarak ayarlandı.`;
          } else if (action === 'leveling:maprole') {
            if (!Number.isInteger(rewardLevel) || rewardLevel < 1) throw new Error('Geçerli ödül seviyesi gir.');
            if (!Number.isInteger(roleId) || roleId < 1) throw new Error('Geçerli sunucu rol ID gir.');
            await service.mapRoleReward(session.groupId, rewardLevel, roleId);
            session.notice = `Seviye ${rewardLevel} → Rol #${roleId} bağlandı. Para veya rozet şartı yok.`;
          } else if (action === 'leveling:unmaprole') {
            if (!Number.isInteger(rewardLevel) || rewardLevel < 1) throw new Error('Geçerli ödül seviyesi gir.');
            await service.mapRoleReward(session.groupId, rewardLevel, null);
            session.notice = `Seviye ${rewardLevel} rol bağlantısı silindi.`;
          } else if (action === 'leveling:mapbadge') {
            if (!Number.isInteger(rewardLevel) || rewardLevel < 1) throw new Error('Geçerli ödül seviyesi gir.');
            if (!Number.isInteger(badgeId) || badgeId < 1) throw new Error('Geçerli Topluyo rozet ID gir.');
            await service.mapBadgeReward(session.groupId, rewardLevel, badgeId);
            session.notice = `Seviye ${rewardLevel} → Rozet #${badgeId} bağlandı.`;
          } else if (action === 'leveling:unmapbadge') {
            if (!Number.isInteger(rewardLevel) || rewardLevel < 1) throw new Error('Geçerli ödül seviyesi gir.');
            await service.mapBadgeReward(session.groupId, rewardLevel, null);
            session.notice = `Seviye ${rewardLevel} rozet bağlantısı silindi.`;
          } else if (action === 'leveling:givebadge') {
            if (!Number.isInteger(targetUserId) || targetUserId <= 0) throw new Error('Geçerli hedef kullanıcı ID gir.');
            if (!Number.isInteger(badgeId) || badgeId < 1) throw new Error('Geçerli Topluyo rozet ID gir.');
            await service.giveBadge({ groupId: session.groupId, userId: targetUserId, badgeId, source: `menu:${userId}` });
            session.notice = `Rozet #${badgeId}, kullanıcı #${targetUserId} hesabına verildi.`;
          } else if (action === 'leveling:synctarget') {
            if (!Number.isInteger(targetUserId) || targetUserId <= 0) throw new Error('Geçerli hedef kullanıcı ID gir.');
            const result = await service.syncUserRewards(session.groupId, targetUserId, { source: `menu:${userId}` });
            session.notice = `#${targetUserId}: ${result.rewards.roles.length} rol, ${result.rewards.badges.length} rozet senkronlandı; ${result.rewards.roleFailures.length + result.rewards.badgeFailures.length} hata.`;
          } else if (action === 'leveling:createbadge') {
            if (!isOwner) throw new Error('Topluyo rozeti oluşturmak için bot sahibi yetkisi gerekiyor.');
            if (!Number.isInteger(rewardLevel) || rewardLevel < 1) throw new Error('Geçerli ödül seviyesi gir.');
            const created = await service.createBadgeReward(session.groupId, rewardLevel);
            session.notice = `Seviye ${rewardLevel} rozeti oluşturuldu: #${created.id}`;
          } else if (action === 'leveling:createpack') {
            const command = this.app.router.getCommand('seviyerozetpaket') || { name: 'seviyerozetpaket', category: 'Rozet' };
            const progress = this.app.services.progress?.createController?.({
              channelId: session.channelId,
              command,
              userId,
              updateHook: createProgressHook(command.name)
            });
            await progress?.start?.({ percent: 3, status: 'Simgeli seviye rozeti paketi hazırlanıyor…' });
            const result = await service.createOwnerBadgePack({
              groupId: session.groupId,
              userId,
              levels: [1, 5, 10, 20, 30, 50, 75, 100],
              progress
            });
            await progress?.complete?.('Simgeli seviye rozetleri hazırlandı.', `${result.created.length} oluşturuldu • ${result.failed.length} hata`);
            session.notice = `${result.created.length} simgeli rozet oluşturuldu, ${result.skipped.length} mevcut eşleme atlandı, ${result.failed.length} hata.`;
          } else if (action === 'leveling:syncall') {
            if (!isOwner) throw new Error('Toplu ödül senkronizasyonu için bot sahibi yetkisi gerekiyor.');
            const command = this.app.router.getCommand('seviyesenkron') || { name: 'seviyesenkron', category: 'Seviye' };
            const progress = this.app.services.progress?.createController?.({
              channelId: session.channelId,
              command,
              userId,
              updateHook: createProgressHook(command.name)
            });
            await progress?.start?.({ percent: 3, status: 'Sunucu profilleri hazırlanıyor…' });
            const result = await service.syncAllRewards(session.groupId, progress);
            await progress?.complete?.('Tüm seviye ödülleri senkronlandı.', `${result.succeeded}/${result.total} başarılı`);
            session.notice = `${result.succeeded}/${result.total} profil senkronlandı; ${result.failed.length} hata.`;
          }
          session.view = { type: 'leveling', page: 0 };
        }
      } catch (error) {
        session.notice = `⚠️ ${truncate(error.message || 'Seviye işlemi başarısız.', 220)}`;
        session.view = { type: 'leveling', page: 0 };
      }
      await this.refreshSession(session);
      return true;
    }

    if (action.startsWith('inventory:')) {
      if (!session.groupId || !this.app.permissionManager.has(userId, 'admin')) {
        await this.app.client.sendDirectMessage(userId, 'Kanal ve rol envanteri için admin yetkisi gerekir.').catch(() => {});
        return true;
      }
      try {
        if (action.startsWith('inventory:apply:')) {
          const kind = action.slice('inventory:apply:'.length) === 'roles' ? 'roles' : 'channels';
          const snapshot = session.inventorySnapshot;
          if (!snapshot || snapshot.kind !== kind || snapshot.items.length < 2) throw new Error('Uygulanacak envanter görünümü bulunamadı.');
          const ids = snapshot.items.map((item) => Number(item.id)).filter(Number.isInteger);
          if (kind === 'roles') await this.app.client.sortRoles(session.groupId, ids);
          else {
            await this.app.client.sortChannels(session.groupId, ids);
            this.app.services.channels.cache?.delete(String(session.groupId));
          }
          await this.app.services.audit?.write(`${kind}.sort`, { actorUserId: userId, ids, source: 'command-menu' }, { groupId: session.groupId });
          session.notice = `✅ ${kind === 'roles' ? 'Rol' : 'Kanal'} sırası sunucuya uygulandı.`;
        } else {
          const [, kindRaw, sortRaw, pageRaw] = action.split(':');
          const kind = kindRaw === 'roles' ? 'roles' : 'channels';
          const sort = sortRaw || 'order';
          session.inventorySnapshot = await this.loadInventory(session.groupId, kind, sort, pageRaw || 0);
          session.view = { type: 'inventory', kind, sort, page: Number(pageRaw) || 0 };
        }
      } catch (error) {
        session.notice = `⚠️ ${truncate(error.message || 'Envanter işlemi başarısız.', 220)}`;
      }
      await this.refreshSession(session);
      return true;
    }

    if (action.startsWith('template:')) {
      const template = this.app.services.supportTemplate;
      if (!session.groupId || !template?.canInstall(userId)) {
        await this.app.client.sendDirectMessage(userId, 'Bu destek şablonunu yalnızca yapılandırılmış bot sahibi kullanabilir.').catch(() => {});
        return true;
      }
      session.view = { type: 'support-template', page: 0 };
      if (action === 'template:support:rebuild') {
        const confirmation = String(form.template_confirm || '').trim();
        if (confirmation.toLocaleUpperCase('tr-TR') !== 'TAM SIFIRLA') {
          session.notice = '⚠️ Tam sıfırlama için onay alanına TAM SIFIRLA yaz.';
          await this.refreshSession(session);
          return true;
        }
        await this.app.client.sendDirectMessage(
          userId,
          `🧨 Destek Sunucusu #${session.groupId} tam sıfırlanıyor. Kanallar ve roller sırayla yeniden kurulacak; işlem bitince sonucu buraya yazacağım.`
        ).catch(() => {});
        try {
          const result = await template.rebuild({
            groupId: session.groupId,
            userId,
            confirmation
          });
          const summary = [
            '✅ Destek sunucusu tam sıfırlama tamamlandı.',
            `${Object.keys(result.channels).length} kanal • ${Object.keys(result.roles).length} rol`,
            `${result.levelRewards?.created?.length || 0} SVG seviye rozeti oluşturuldu`,
            `Silinen eski yapı: ${result.rebuild?.deletedChannels || 0} kanal • ${result.rebuild?.deletedRoles || 0} rol`,
            result.verification?.ok ? 'Doğrulama: tüm sistemler hazır.' : `Doğrulama uyarısı: ${(result.verification?.issues || []).join(' • ')}`
          ].join('\n');
          await this.app.client.sendPost(result.channels.commands, summary).catch(() => {});
          await this.app.client.sendDirectMessage(userId, summary).catch(() => {});
        } catch (error) {
          await this.app.client.sendDirectMessage(
            userId,
            `⚠️ Destek sunucusu yeniden kurulamadı: ${truncate(error.message || 'Bilinmeyen hata.', 500)}`
          ).catch(() => {});
        }
        return true;
      }
      try {
        if (['template:support:install', 'template:support:repair'].includes(action)) {
          const command = this.app.router.getCommand('destekşablon') || { name: 'destekşablon', category: 'Yönetim' };
          const progress = this.app.services.progress?.createController?.({
            channelId: session.channelId,
            command,
            userId,
            updateHook: createProgressHook(command.name)
          });
          const repairing = action.endsWith(':repair');
          await progress?.start?.({
            percent: 2,
            status: repairing ? 'Destek sunucusu onarımı başlatıldı.' : 'Destek sunucusu kurulumu başlatıldı.'
          });
          const result = repairing
            ? await template.repair({ groupId: session.groupId, userId, progress })
            : await template.install({ groupId: session.groupId, userId, progress });
          await progress?.complete?.('Destek sunucusu şablonu hazır.');
          session.notice = `✅ Şablon hazır: ${Object.keys(result.channels).length} kanal, ${Object.keys(result.roles).length} rol; ticket paneli ${result.ticketPanelPostId || '—'}.`;
        } else if (action === 'template:support:verify') {
          const verification = await template.verify(session.groupId);
          session.notice = verification.ok
            ? `✅ Doğrulama başarılı: ${verification.channelCount} kanal ve ${verification.roleCount} rol hazır.`
            : `⚠️ ${verification.issues.length} sorun: ${truncate(verification.issues.join(' • '), 170)}`;
        } else if (action === 'template:support:test') {
          const verification = await template.verify(session.groupId);
          if (!verification.ok) {
            session.notice = `⚠️ Test durduruldu: ${truncate(verification.issues.join(' • '), 180)}`;
          } else {
            const welcome = await this.app.services.welcome.sendWelcome({
              groupId: session.groupId,
              userId,
              source: 'template-panel-test'
            });
            session.notice = `✅ Canlı test başarılı. Hoş geldin kartı #${welcome.channelId} kanalına gönderildi; log ve ticket bağlantıları doğrulandı.`;
          }
        } else if (action === 'template:support:status') {
          const settings = await this.app.services.settings.get(session.groupId);
          const state = await template.readState(session.groupId);
          session.notice = `📋 ${state?.status || 'kurulmamış'} • %${state?.progress || 0} • hoş geldin ${settings.channels.welcome || '—'} • destek ${settings.channels.tickets || '—'} • ticket-log ${settings.channels.ticketLogs || '—'} • mod-log ${settings.channels.moderationLogs || '—'} • sistem-log ${settings.channels.logs || '—'}`;
        }
      } catch (error) {
        session.notice = `⚠️ ${truncate(error.message || 'Şablon kurulamadı.', 220)}`;
      }
      await this.refreshSession(session);
      return true;
    }

    if (action.startsWith('settings:')) {
      if (!session.groupId) {
        await this.app.client.sendDirectMessage(userId, 'Sunucu ayarları için grup ID çözümlenemedi. Paneli bir sunucu kanalında yeniden aç.').catch(() => {});
        return true;
      }
      if (!this.app.permissionManager.has(userId, 'admin')) {
        await this.app.client.sendDirectMessage(userId, 'Sistem ayarlarını değiştirmek için admin yetkisi gerekiyor.').catch(() => {});
        return true;
      }
      const service = this.app.services.menuSettings;
      if (!service) return true;
      try {
        if (action === 'settings:home') {
          this.remember(session, 'settings:home', '⚙️ Sunucu Ayarları');
          session.view = { type: 'settings-home', page: 0, categoryId: null, fieldId: null };
        } else if (action.startsWith('settings:category:')) {
          const categoryId = action.slice('settings:category:'.length);
          if (service.category(categoryId)) session.view = { type: 'settings-category', categoryId, page: 0, fieldId: null };
        } else if (action.startsWith('settings:page:')) {
          const parts = action.slice('settings:page:'.length).split(':');
          const page = Math.max(0, Number(parts.pop()) || 0);
          const categoryId = parts.join(':');
          if (service.category(categoryId)) session.view = { type: 'settings-category', categoryId, page, fieldId: null };
        } else if (action.startsWith('settings:field:')) {
          const fieldId = action.slice('settings:field:'.length);
          const field = service.field(fieldId);
          if (field) session.view = { type: 'settings-field', fieldId, categoryId: field.category, page: 0 };
        } else if (action.startsWith('settings:set:')) {
          const payload = action.slice('settings:set:'.length);
          const splitAt = payload.lastIndexOf(':');
          const fieldId = payload.slice(0, splitAt);
          const enabled = payload.slice(splitAt + 1) === 'true';
          const result = await service.setBoolean(session.groupId, fieldId, enabled, userId);
          session.settingsSnapshot = result.settings;
          session.notice = `✅ ${result.field.title}: ${enabled ? 'Açık' : 'Kapalı'}`;
        } else if (action.startsWith('settings:save:')) {
          const fieldId = action.slice('settings:save:'.length);
          const result = await service.set(session.groupId, fieldId, form.setting_value ?? '', userId);
          session.settingsSnapshot = result.settings;
          session.notice = result.resolvedChannel
            ? `✅ ${result.field.title}: #${result.resolvedChannel.name || result.resolvedChannel.id} · ${result.resolvedChannel.id}`
            : `✅ ${result.field.title} bu sunucu için kaydedildi.`;
        } else if (action.startsWith('settings:reset:')) {
          const fieldId = action.slice('settings:reset:'.length);
          const result = await service.reset(session.groupId, fieldId, userId);
          session.settingsSnapshot = result.settings;
          session.notice = `↺ ${result.field.title} varsayılan değere döndürüldü.`;
        }
      } catch (error) {
        session.notice = `⚠️ ${truncate(error.message || 'Ayar kaydedilemedi.', 220)}`;
      }
      await this.refreshSession(session);
      return true;
    }

    if (action === 'close') {
      await this.closeSession(session);
      return true;
    }

    if (action === 'home') {
      if (session.view?.type && session.view.type !== 'home') {
        session.previousView = structuredClone(session.view);
      }
      session.view = { type: 'home', page: 0, sectionId: null, commandName: null, query: '' };
      await this.refreshSession(session);
      return true;
    }

    if (action === 'back') {
      const previousView = session.previousView;
      if (previousView?.type && previousView.type !== 'home') {
        session.view = structuredClone(previousView);
        session.previousView = null;
      } else {
        session.notice = 'Geri dönülecek başka bir ekran yok.';
      }
      await this.refreshSession(session);
      return true;
    }

    if (action === 'refresh') {
      await this.refreshSession(session);
      return true;
    }

    if (action === 'search') {
      session.view = {
        type: 'search',
        query: String(form.query || '').trim().slice(0, 48),
        page: 0,
        sectionId: null,
        commandName: null
      };
      await this.refreshSession(session);
      return true;
    }

    if (action.startsWith('section:')) {
      const sectionId = action.slice('section:'.length);
      if (this.sectionsFor(session.ownerUserId).some((section) => section.id === sectionId)) {
        session.view = { type: 'section', sectionId, page: 0, commandName: null, query: '' };
        await this.refreshSession(session);
      }
      return true;
    }

    if (action.startsWith('page:')) {
      const page = Math.max(0, Number(action.slice('page:'.length)) || 0);
      session.view = { ...session.view, type: 'section', page };
      await this.refreshSession(session);
      return true;
    }

    if (action.startsWith('command:')) {
      const commandName = normalize(action.slice('command:'.length));
      const command = this.app.router.getCommand(commandName);
      if (command && normalize(command.requiredPermission) !== 'owner' && this.app.permissionManager.has(userId, command.requiredPermission)) {
        session.view = { type: 'command', commandName: command.name, page: 0, sectionId: null, query: '' };
        await this.refreshSession(session);
      }
      return true;
    }

    if (action.startsWith('runargs:')) {
      const commandName = normalize(action.slice('runargs:'.length));
      const command = this.app.router.getCommand(commandName);
      if (!command || normalize(command.requiredPermission) === 'owner' || !this.app.permissionManager.has(userId, command.requiredPermission)) return true;
      const rawArgs = String(form.command_args || '').trim();
      const args = buildSmartArguments(command, rawArgs);
      if (commandHasRequiredArguments(command) && !args) {
        session.notice = `Parametre gerekli: ${this.app.config.prefix}${command.usage}`;
        session.view = { type: 'command', commandName: command.name, page: 0 };
        await this.refreshSession(session);
        return true;
      }
      this.remember(session, `command:${command.name}`, `${this.app.config.prefix}${command.name}`);
      await this.app.router.handle({
        action: 'post/add',
        message: `${this.app.config.prefix}${command.name}${args ? ` ${args}` : ''}`,
        user_id: userId,
        channel_id: session.channelId,
        group_id: session.groupId,
        interaction: {
          post_id: session.postId,
          menu_action: action,
          command_args: args,
          progressHook: createProgressHook(command.name)
        }
      }, this.app);
      session.notice = `${this.app.config.prefix}${command.name} panel üzerinden çalıştırıldı.`;
      session.view = { type: 'command', commandName: command.name, page: 0 };
      await this.refreshSession(session);
      return true;
    }

    if (action.startsWith('run:')) {
      const commandName = normalize(action.slice('run:'.length));
      const command = this.app.router.getCommand(commandName);
      if (!command || normalize(command.requiredPermission) === 'owner' || !this.app.permissionManager.has(userId, command.requiredPermission)) return true;
      if (commandHasRequiredArguments(command)) {
        await this.app.client.sendPost(
          session.channelId,
          `ℹ️ ${this.app.config.prefix}${command.name} komutu parametre istiyor: ${this.app.config.prefix}${command.usage}`
        );
        return true;
      }
      this.remember(session, `command:${command.name}`, `${this.app.config.prefix}${command.name}`);
      await this.app.router.handle({
        action: 'post/add',
        message: `${this.app.config.prefix}${command.name}`,
        user_id: userId,
        channel_id: session.channelId,
        group_id: session.groupId,
        interaction: { post_id: session.postId, menu_action: action, progressHook: createProgressHook(command.name) }
      }, this.app);
      return true;
    }

    return true;
  }
}

module.exports = CommandMenuService;
module.exports.SECTION_DEFINITIONS = SECTION_DEFINITIONS;
module.exports.commandHasRequiredArguments = commandHasRequiredArguments;
module.exports.commandAcceptsArguments = commandAcceptsArguments;
