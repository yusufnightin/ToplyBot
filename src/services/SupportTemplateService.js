const path = require('node:path');
const { deepMerge } = require('../utils/object');
const { buildCommandMenuBumote } = require('../utils/bumote');
const { sendInteractivePost, updateInteractivePost } = require('../utils/jtmlDelivery');
const ChannelResolverService = require('./ChannelResolverService');
const RoleService = require('./RoleService');
const { safePreview } = require('../utils/preview');
const { sleep } = require('../utils/retry');
const { assertApiSuccess } = require('../utils/apiResult');

const TEMPLATE_VERSION = 4;

const LEVEL_ROLE_SPECS = Object.freeze([
  { key: 'level1', level: 1, emoji: '🌱', title: 'İlk Adım', name: '🌱 İlk Adım • Seviye 1', color: '#22C55E', powers: {} },
  { key: 'level5', level: 5, emoji: '⚡', title: 'Kıvılcım', name: '⚡ Kıvılcım • Seviye 5', color: '#2EA8FF', powers: {} },
  { key: 'level10', level: 10, emoji: '🔥', title: 'Alev', name: '🔥 Alev • Seviye 10', color: '#F97316', powers: {} },
  { key: 'level20', level: 20, emoji: '🛡️', title: 'Muhafız', name: '🛡️ Muhafız • Seviye 20', color: '#06B6D4', powers: {} },
  { key: 'level30', level: 30, emoji: '💎', title: 'Elmas', name: '💎 Elmas • Seviye 30', color: '#A855F7', powers: {} },
  { key: 'level50', level: 50, emoji: '👑', title: 'Topluluk Tacı', name: '👑 Topluluk Tacı • Seviye 50', color: '#FACC15', powers: {} },
  { key: 'level75', level: 75, emoji: '🌌', title: 'Efsane', name: '🌌 Efsane • Seviye 75', color: '#8B5CF6', powers: {} },
  { key: 'level100', level: 100, emoji: '🏆', title: 'Toply Ustası', name: '🏆 Toply Ustası • Seviye 100', color: '#FDE047', powers: {} }
]);

const ROLE_SPECS = Object.freeze([
  { key: 'admin', name: 'Yönetici', color: '#EF4444', powers: { power_group: 1, power_role: 1, power_channel: 1, power_post: 1, power_member: 1, power_room: 1, power_team: 1, power_mention: 1 } },
  { key: 'moderator', name: 'Moderatör', color: '#F59E0B', powers: { power_post: 1, power_member: 1, power_channel: 1, power_mention: 1 } },
  { key: 'support', name: 'Destek Ekibi', color: '#3B82F6', powers: { power_post: 1, power_member: 1, power_mention: 1 } },
  { key: 'verified', name: 'Doğrulanmış', color: '#22C55E', powers: { power_post: 1, power_mention: 1 } },
  ...[...LEVEL_ROLE_SPECS].reverse(),
  { key: 'member', name: 'Üye', color: '#94A3B8', powers: {} },
  { key: 'muted', name: 'Susturulmuş', color: '#64748B', powers: {} }
]);

const CHANNEL_SPECS = Object.freeze([
  { key: 'welcome', nick: 'hos-geldin', title: '👋 Hoş Geldin', description: 'Yeni üyelerin karşılandığı kanal.', access: 'readonly-public' },
  { key: 'guide', nick: 'baslangic-rehberi', title: '🧭 Başlangıç Rehberi', description: 'Yeni üyeler için sunucu ve destek kullanım rehberi.', access: 'readonly-public' },
  { key: 'rules', nick: 'kurallar', title: '📜 Kurallar', description: 'Topluluk kuralları ve kullanım şartları.', access: 'readonly-public' },
  { key: 'announcements', nick: 'duyurular', title: '📢 Duyurular', description: 'Resmî sunucu duyuruları.', access: 'readonly-public' },
  { key: 'updates', nick: 'guncellemeler', title: '🛠️ Güncellemeler', description: 'Bot, ürün ve hizmet güncelleme notları.', access: 'readonly-public' },
  { key: 'status', nick: 'sistem-durumu', title: '🟢 Sistem Durumu', description: 'Bot ve destek sistemi durum bildirimleri.', access: 'readonly-public' },
  { key: 'faq', nick: 'sikca-sorulanlar', title: '📚 Sıkça Sorulanlar', description: 'Yaygın sorular ve hızlı çözümler.', access: 'readonly-public' },
  { key: 'roleGuide', nick: 'rol-rehberi', title: '🎭 Rol Rehberi', description: 'Otorol, seviye rolleri ve rol seçim açıklamaları.', access: 'readonly-public' },
  { key: 'leveling', nick: 'seviye-rank', title: '⭐ Seviye ve Rank', description: 'Rank kartı, toprank ve seviye atlama bildirimleri.', access: 'public' },
  { key: 'general', nick: 'genel-sohbet', title: '💬 Genel Sohbet', description: 'Topluluk sohbeti ve genel paylaşımlar.', access: 'public' },
  { key: 'introductions', nick: 'tanisma', title: '👋 Tanışma', description: 'Yeni üyelerin kendini tanıtabileceği kanal.', access: 'public' },
  { key: 'media', nick: 'medya-paylasim', title: '🖼️ Medya Paylaşım', description: 'Görsel, video ve topluluk içerikleri.', access: 'public' },
  { key: 'giveaways', nick: 'cekilisler', title: '🎉 Çekilişler', description: 'Çekiliş duyuruları ve katılım işlemleri.', access: 'public' },
  { key: 'support', nick: 'destek', title: '🎫 Destek Merkezi', description: 'Ticket ve kullanıcı destek talepleri.', access: 'public' },
  { key: 'bugs', nick: 'hata-bildirimi', title: '🐞 Hata Bildirimi', description: 'Hata raporları ve teknik sorunlar.', access: 'public' },
  { key: 'suggestions', nick: 'oneriler', title: '💡 Öneriler', description: 'Kullanıcı önerileri ve geri bildirimler.', access: 'public' },
  { key: 'applications', nick: 'yetkili-basvuru', title: '📝 Yetkili Başvuru', description: 'Destek ve moderasyon ekibi başvuruları.', access: 'public' },
  { key: 'commands', nick: 'bot-komut', title: '🤖 Bot Komutları', description: 'Bot komutlarının ve yönetim panelinin kullanıldığı kanal.', access: 'public' },
  { key: 'staffAnnouncements', nick: 'ekip-duyuru', title: '📣 Ekip Duyuruları', description: 'Destek ekibine özel operasyon duyuruları.', access: 'staff' },
  { key: 'staff', nick: 'ekip-sohbet', title: '🛡️ Ekip Sohbeti', description: 'Destek ekibi ve yönetim için özel kanal.', access: 'staff' },
  { key: 'staffCommands', nick: 'ekip-komut', title: '⚙️ Ekip Komutları', description: 'Yönetim ve destek komutlarının güvenli kullanım kanalı.', access: 'staff' },
  { key: 'ticketLogs', nick: 'ticket-log', title: '🎫 Ticket Logları', description: 'Ticket açma, kapatma ve destek işlem kayıtları.', access: 'staff' },
  { key: 'moderationLogs', nick: 'moderasyon-log', title: '🛡️ Moderasyon Logları', description: 'Uyarı, timeout, ban ve koruma sistemi kayıtları.', access: 'staff' },
  { key: 'logs', nick: 'yonetim-log', title: '📋 Sistem Logları', description: 'Ayar, bakım, şablon ve genel denetim kayıtları.', access: 'staff' }
]);

function rolePayload(groupId, spec) {
  return {
    group_id: Number(groupId),
    name: spec.name,
    color: spec.color,
    power_group: 0,
    power_role: 0,
    power_channel: 0,
    power_post: 0,
    power_member: 0,
    power_room: 0,
    power_team: 0,
    power_mention: 0,
    ...(spec.powers || {})
  };
}

function idCsv(...values) {
  return [...new Set(values.flat().map(Number).filter((id) => Number.isInteger(id) && id > 0))].join(',');
}

function channelPayload(groupId, spec, roles, ownerUserId, botUserId = null) {
  const staffRoleIds = [roles.support, roles.moderator, roles.admin].filter(Number.isInteger);
  const staffCsv = staffRoleIds.join(',');
  const isStaff = spec.access === 'staff';
  const readOnly = spec.access === 'readonly-public';
  const privilegedUsers = idCsv(ownerUserId, botUserId);
  return {
    group_id: Number(groupId),
    nick: spec.nick,
    title: spec.title,
    description: spec.description,
    type: 1,
    data: '',
    read_role_ids: isStaff ? staffCsv : '-1,0',
    write_role_ids: isStaff || readOnly ? staffCsv : '0',
    control_role_ids: staffCsv,
    read_plus_user_ids: privilegedUsers,
    read_minus_user_ids: '',
    write_plus_user_ids: privilegedUsers,
    write_minus_user_ids: '',
    control_plus_user_ids: privilegedUsers,
    control_minus_user_ids: ''
  };
}

function nextPanelId(items) {
  return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

function ticketPanelJtml(prefix) {
  return buildCommandMenuBumote({
    header: [
      { text: '🎫 Destek Merkezi', ui: 'muted', size: 1.15 },
      { text: 'Sorununu kısa ve anlaşılır biçimde yaz; sana özel bir destek talebi açılsın.', ui: 'muted' }
    ],
    inputs: [{
      name: 'subject',
      label: '📝 Destek konusu',
      description: 'Hesap, teknik sorun, ödeme veya diğer destek konuları.',
      placeholder: 'Örnek: Bot komutları çalışmıyor...',
      maxLength: 800
    }],
    commands: [{ value: 'ticket:create', label: '🎫 Destek Talebi Aç', style: 'success' }],
    footerNote: `Metin alternatifi: ${prefix}ticket aç <sorun>`
  });
}

function stateBase(groupId, userId) {
  return {
    groupId: Number(groupId),
    version: TEMPLATE_VERSION,
    status: 'pending',
    stage: 'pending',
    progress: 0,
    installedBy: Number(userId),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    lastError: null,
    roles: {},
    channels: {},
    createdRoles: [],
    createdChannels: [],
    warnings: [],
    verification: null,
    backupId: null,
    ticketPanelPostId: null
  };
}

class SupportTemplateService {
  constructor({ app }) {
    this.app = app;
  }

  designatedOwnerId() {
    const configured = Number(this.app.config.supportTemplate?.ownerUserId);
    if (Number.isInteger(configured) && configured > 0) return configured;
    return Number(this.app.config.ownerUserIds?.[0]) || null;
  }

  canInstall(userId) {
    const designated = this.designatedOwnerId();
    return this.app.permissionManager.has(userId, 'owner')
      && (!designated || Number(userId) === designated);
  }

  async readState(groupId) {
    const all = await this.app.stores.templateInstallations.read();
    return all[String(groupId)] || null;
  }

  async writeState(groupId, patch) {
    let next;
    await this.app.stores.templateInstallations.update((all) => {
      const current = all[String(groupId)] || stateBase(groupId, patch.installedBy || this.designatedOwnerId());
      next = deepMerge(current, { ...patch, updatedAt: new Date().toISOString() });
      all[String(groupId)] = next;
      return all;
    });
    return next;
  }

  async replaceState(groupId, value) {
    const next = {
      ...stateBase(groupId, value.installedBy || this.designatedOwnerId()),
      ...structuredClone(value),
      updatedAt: new Date().toISOString()
    };
    await this.app.stores.templateInstallations.update((all) => {
      all[String(groupId)] = next;
      return all;
    });
    return next;
  }

  levelAssetDirectory() {
    const configured = String(this.app.config.supportTemplate?.levelRoleAssetDirectory || '').trim();
    return configured ? path.resolve(configured) : path.join(this.app.projectRoot, 'assets', 'level-roles');
  }

  operationDelayMs() {
    const configured = Number(this.app.config.supportTemplate?.operationDelayMs);
    return Number.isFinite(configured) && configured >= 0 ? configured : 180;
  }

  levelRoleRewards(roles) {
    return Object.fromEntries(
      LEVEL_ROLE_SPECS
        .map((spec) => [String(spec.level), Number(roles[spec.key])])
        .filter(([, roleId]) => Number.isInteger(roleId) && roleId > 0)
    );
  }

  async ensureLevelRewards(groupId, roles, progress = null, { forceBadges = false } = {}) {
    const levels = LEVEL_ROLE_SPECS.map((spec) => spec.level);
    const assets = await this.app.services.cards.publishLevelBadgeAssets(
      this.levelAssetDirectory(),
      levels
    );
    const badges = await this.app.services.apiManagement.listBadges(groupId).catch(() => []);
    const settings = await this.app.services.leveling.settings(groupId);
    const badgeRewards = { ...(settings.badgeRewards || {}) };
    const created = [];
    const reused = [];
    const failed = [];

    for (let index = 0; index < LEVEL_ROLE_SPECS.length; index += 1) {
      const spec = LEVEL_ROLE_SPECS[index];
      const asset = assets[String(spec.level)];
      const roleId = Number(roles[spec.key]);
      if (Number.isInteger(roleId) && roleId > 0) {
        await this.app.services.leveling.mapRoleReward(groupId, spec.level, roleId);
      }
      const configuredBadgeId = forceBadges ? null : Number(badgeRewards[String(spec.level)]);
      if (Number.isInteger(configuredBadgeId) && configuredBadgeId > 0) {
        reused.push({ level: spec.level, badgeId: configuredBadgeId, source: 'settings' });
        continue;
      }
      const targetNick = ChannelResolverService.normalizeChannelName(`toply-seviye-${spec.level}-${asset.title}`);
      const existing = forceBadges ? null : badges.find((badge) => (
        ChannelResolverService.normalizeChannelName(badge.nick || badge.slug || '') === targetNick
        || String(badge.name || badge.title || '').trim() === `${asset.emoji} ${asset.title}`
      ));
      const existingId = Number(existing?.id ?? existing?.badge_id ?? existing?.badgeId);
      if (Number.isInteger(existingId) && existingId > 0) {
        await this.app.services.leveling.mapBadgeReward(groupId, spec.level, existingId);
        badgeRewards[String(spec.level)] = existingId;
        reused.push({ level: spec.level, badgeId: existingId, source: 'badge-list' });
        continue;
      }
      try {
        if (!asset.url) throw new Error('SVG için dışarıdan erişilebilir HTTPS kart adresi oluşturulamadı.');
        const badge = await this.app.services.leveling.createBadgeReward(groupId, spec.level, {
          name: `${asset.emoji} ${asset.title}`,
          nick: targetNick,
          description: `Seviye ${spec.level} rolünün SVG logolu görsel ödülü • ${asset.sourceName}`,
          image: asset.url
        });
        badgeRewards[String(spec.level)] = Number(badge.id);
        created.push({
          level: spec.level,
          badgeId: Number(badge.id),
          roleId,
          image: asset.url,
          sourceName: asset.sourceName
        });
      } catch (error) {
        failed.push({ level: spec.level, roleId, sourceName: asset?.sourceName, message: error.message });
      }
      const percent = 63 + Math.round(((index + 1) / LEVEL_ROLE_SPECS.length) * 7);
      await progress?.update?.(percent, `Seviye rolleri ve SVG rozetleri bağlanıyor (${index + 1}/${LEVEL_ROLE_SPECS.length})`, `Lv.${spec.level} • ${asset.emoji} ${asset.title}`);
    }

    return {
      roleRewards: this.levelRoleRewards(roles),
      badgeRewards: (await this.app.services.leveling.settings(groupId)).badgeRewards || {},
      assets,
      created,
      reused,
      failed
    };
  }

  async remoteInventory(groupId) {
    const [listedRoles, listedChannels, state] = await Promise.all([
      this.app.services.roles.list(groupId, { force: true }),
      this.app.services.channels.list(groupId, { force: true }),
      this.readState(groupId)
    ]);
    const roles = [...listedRoles];
    const channels = [...listedChannels];
    const knownRoleIds = new Set(roles.map((role) => Number(role.id)));
    const knownChannelIds = new Set(channels.map((channel) => Number(channel.id)));

    for (const roleId of Object.values(state?.roles || {}).map(Number)) {
      if (!Number.isInteger(roleId) || roleId <= 0 || knownRoleIds.has(roleId)) continue;
      const role = await this.app.services.provisioning.findRoleById(groupId, roleId);
      if (role) {
        roles.push(role);
        knownRoleIds.add(roleId);
      }
    }
    for (const channelId of Object.values(state?.channels || {}).map(Number)) {
      if (!Number.isInteger(channelId) || channelId <= 0 || knownChannelIds.has(channelId)) continue;
      const channel = await this.app.services.provisioning.findChannelById(groupId, channelId);
      if (channel) {
        channels.push(channel);
        knownChannelIds.add(channelId);
      }
    }

    return {
      capturedAt: new Date().toISOString(),
      roles: roles.map((role) => ({
        id: Number(role.id),
        name: role.name,
        color: role.color,
        order: role.order,
        raw: role.raw || role
      })).filter((role) => Number.isInteger(role.id) && role.id > 0),
      channels: channels.map((channel) => ({
        id: Number(channel.id),
        nick: channel.nick || channel.name,
        title: channel.title || channel.name,
        order: channel.order,
        raw: channel.raw || channel
      })).filter((channel) => Number.isInteger(channel.id) && channel.id > 0)
    };
  }

  async clearRuntimeReferences(groupId) {
    const belongsToGroup = (item) => String(item?.groupId ?? item?.group_id) === String(groupId);
    for (const storeName of ['ticketPanels', 'rolePanels']) {
      const store = this.app.stores[storeName];
      if (!store) continue;
      await store.update((items) => items.map((item) => (
        belongsToGroup(item)
          ? { ...item, active: false, disabledAt: new Date().toISOString(), disabledReason: 'support-template-rebuild' }
          : item
      )));
    }
    if (this.app.stores.tickets) {
      await this.app.stores.tickets.update((items) => items.map((item) => (
        belongsToGroup(item) && item.status === 'open'
          ? { ...item, status: 'closed', closedAt: new Date().toISOString(), closedBy: 0, closeReason: 'support-template-rebuild' }
          : item
      )));
    }
    for (const storeName of ['statistics', 'commandMenus']) {
      const store = this.app.stores[storeName];
      if (!store) continue;
      await store.update((items) => items.filter((item) => !belongsToGroup(item)));
    }
  }

  async deleteExistingStructure(groupId, inventory, progress = null) {
    const deletedChannels = [];
    const deletedRoles = [];
    const failedChannels = [];
    const failedRoles = [];
    for (let index = 0; index < inventory.channels.length; index += 1) {
      const channel = inventory.channels[index];
      try {
        const result = await this.app.client.deleteChannel(channel.id);
        assertApiSuccess(result, `Kanal #${channel.id} silme`);
        deletedChannels.push(channel);
      } catch (error) {
        failedChannels.push({ ...channel, message: error.message });
      }
      await progress?.update?.(
        8 + Math.round(((index + 1) / Math.max(1, inventory.channels.length)) * 12),
        `Eski kanallar kaldırılıyor (${index + 1}/${inventory.channels.length})`,
        `#${channel.nick || channel.id}`
      );
      await sleep(this.operationDelayMs());
    }
    this.app.services.channels.invalidate(groupId);

    for (let index = 0; index < inventory.roles.length; index += 1) {
      const role = inventory.roles[index];
      try {
        const result = await this.app.client.deleteRole(role.id);
        assertApiSuccess(result, `Rol #${role.id} silme`);
        deletedRoles.push(role);
      } catch (error) {
        failedRoles.push({ ...role, message: error.message });
      }
      await progress?.update?.(
        20 + Math.round(((index + 1) / Math.max(1, inventory.roles.length)) * 8),
        `Eski roller kaldırılıyor (${index + 1}/${inventory.roles.length})`,
        `${role.name || role.id}`
      );
      await sleep(this.operationDelayMs());
    }
    this.app.services.roles.invalidate(groupId);
    return { deletedChannels, deletedRoles, failedChannels, failedRoles };
  }

  async ensurePrivilegedAssignments(groupId, roles, ownerUserId, botUserId) {
    const adminRoleId = Number(roles.admin);
    if (!Number.isInteger(adminRoleId) || adminRoleId <= 0) {
      throw new Error('Yönetici rolü oluşturulamadığı için sahip erişimi güvenceye alınamadı.');
    }
    const visibleRoles = await this.app.services.roles.list(groupId, { force: true }).catch(() => []);
    const validRoleIds = new Set(visibleRoles.map((role) => Number(role.id)).filter(Number.isInteger));
    validRoleIds.add(adminRoleId);
    const assigned = [];
    const failed = [];
    for (const userId of [...new Set([Number(ownerUserId), Number(botUserId)].filter(Number.isInteger))]) {
      try {
        const current = await this.app.services.roles.memberRoleIds(groupId, userId).catch(() => []);
        const next = [...new Set([
          ...current.map(Number).filter((roleId) => validRoleIds.has(roleId)),
          adminRoleId
        ])];
        const response = typeof this.app.client.setMemberRoles === 'function'
          ? await this.app.client.setMemberRoles(groupId, userId, next)
          : await this.app.client.api('/!api/member/role/set', {
            group_id: groupId,
            user_id: userId,
            role_ids: next.join(',')
          });
        assertApiSuccess(response, `Kullanıcı #${userId} yönetici rolü`);
        assigned.push({ userId, roleIds: next });
      } catch (error) {
        failed.push({ userId, message: error.message });
      }
    }
    if (!assigned.some((item) => Number(item.userId) === Number(ownerUserId))) {
      throw new Error(`Sunucu sahibine Yönetici rolü verilemedi: ${failed.find((item) => Number(item.userId) === Number(ownerUserId))?.message || 'bilinmeyen hata'}`);
    }
    return { assigned, failed };
  }

  async createBootstrapRole(groupId, ownerUserId, botUserId) {
    const spec = {
      key: 'bootstrapAdmin',
      name: `Kurulum Yöneticisi • ${Date.now().toString(36).slice(-6)}`,
      color: '#DC2626',
      powers: { power_group: 1, power_role: 1, power_channel: 1, power_post: 1, power_member: 1, power_room: 1, power_team: 1, power_mention: 1 }
    };
    const created = await this.app.services.provisioning.ensureRole({
      groupId,
      spec,
      payload: rolePayload(groupId, spec),
      skipInitialLookup: true
    });
    const assignments = await this.ensurePrivilegedAssignments(
      groupId,
      { admin: Number(created.id) },
      ownerUserId,
      botUserId
    );
    if (!assignments.assigned.some((item) => Number(item.userId) === Number(botUserId))) {
      await this.app.client.deleteRole(Number(created.id)).catch(() => {});
      throw new Error('Bot hesabına geçici kurulum yöneticisi rolü verilemedi; hiçbir kanal veya rol silinmedi.');
    }
    return { id: Number(created.id), name: spec.name, assignments };
  }

  async removeBootstrapRole(groupId, bootstrapRole, roles, ownerUserId, botUserId) {
    if (!Number.isInteger(Number(bootstrapRole?.id))) return { removed: false, reason: 'not-created' };
    const response = await this.app.client.deleteRole(Number(bootstrapRole.id));
    assertApiSuccess(response, 'Geçici kurulum yöneticisi rolünü silme');
    this.app.services.roles.invalidate(groupId);
    const assignments = await this.ensurePrivilegedAssignments(groupId, roles, ownerUserId, botUserId);
    return { removed: true, roleId: Number(bootstrapRole.id), assignments };
  }

  async remapChannelBoundSystems(groupId, channels) {
    const mapping = {
      liveStreams: channels.announcements,
      feeds: channels.media || channels.announcements,
      giveaways: channels.giveaways,
      polls: channels.suggestions
    };
    for (const [storeName, channelId] of Object.entries(mapping)) {
      const store = this.app.stores[storeName];
      if (!store || !channelId) continue;
      await store.update((items) => items.map((item) => (
        String(item?.groupId ?? item?.group_id) === String(groupId)
          ? { ...item, channelId: String(channelId) }
          : item
      )));
    }
  }

  async ensureRoles(groupId, state = null, progress = null) {
    const listedRoles = await this.app.services.roles.list(groupId, { force: true }).catch(() => []);
    const results = {};
    const created = [];
    const recovered = [];
    for (let index = 0; index < ROLE_SPECS.length; index += 1) {
      const spec = ROLE_SPECS[index];
      const existingEntity = listedRoles.find(
        (role) => role.normalizedName === RoleService.normalizeRoleName(spec.name)
      ) || null;
      const result = await this.app.services.provisioning.ensureRole({
        groupId,
        spec,
        payload: rolePayload(groupId, spec),
        knownId: state?.roles?.[spec.key],
        existingEntity,
        skipInitialLookup: true
      });
      results[spec.key] = result.id;
      if (result.created) created.push({ ...spec, id: result.id });
      if (result.recovered) recovered.push({ ...spec, id: result.id });
      const percent = 5 + Math.round(((index + 1) / ROLE_SPECS.length) * 20);
      await this.writeState(groupId, {
        stage: 'roles', progress: percent, roles: results,
        createdRoles: created.map((item) => item.name)
      });
      await progress?.update?.(percent, `Roller hazırlanıyor (${index + 1}/${ROLE_SPECS.length})`, `${spec.name} • ID ${result.id}`);
    }

    const ordered = ROLE_SPECS.map((spec) => results[spec.key]).filter(Number.isInteger);
    if (ordered.length) {
      await this.app.client.sortRoles(groupId, ordered).catch((error) => {
        this.app.logger?.warn('Destek şablonunda rol sırası uygulanamadı.', { groupId, message: error.message });
      });
    }
    return { ids: results, created, recovered };
  }

  async ensureChannels(groupId, roles, ownerUserId, botUserId, progress = null) {
    const state = await this.readState(groupId);
    const listedChannels = await this.app.services.channels.list(groupId, { force: true }).catch(() => []);
    const results = {};
    const created = [];
    const recovered = [];
    const accessHints = {};
    for (let index = 0; index < CHANNEL_SPECS.length; index += 1) {
      const spec = CHANNEL_SPECS[index];
      const payload = channelPayload(groupId, spec, roles, ownerUserId, botUserId);
      const targets = [spec.nick, spec.title].map(ChannelResolverService.normalizeChannelName);
      const existingEntity = listedChannels.find((channel) => (
        targets.some((target) => (channel.aliases || []).includes(target))
      )) || null;
      const result = await this.app.services.provisioning.ensureChannel({
        groupId,
        spec,
        payload,
        knownId: state?.channels?.[spec.key],
        existingEntity,
        skipInitialLookup: true
      });
      results[spec.key] = result.id;
      accessHints[result.id] = result.entity?.raw || result.entity || payload;
      if (result.created) created.push({ ...spec, id: result.id });
      if (result.recovered) recovered.push({ ...spec, id: result.id });
      const percent = 27 + Math.round(((index + 1) / CHANNEL_SPECS.length) * 28);
      await this.writeState(groupId, {
        stage: 'channels', progress: percent, channels: results,
        createdChannels: created.map((item) => item.nick)
      });
      await progress?.update?.(percent, `Kanallar hazırlanıyor (${index + 1}/${CHANNEL_SPECS.length})`, `#${spec.nick} • ID ${result.id}`);
    }

    const ordered = CHANNEL_SPECS.map((spec) => results[spec.key]).filter(Number.isInteger);
    if (ordered.length) {
      await this.app.client.sortChannels(groupId, ordered).catch((error) => {
        this.app.logger?.warn('Destek şablonunda kanal sırası uygulanamadı.', { groupId, message: error.message });
      });
    }
    this.app.services.channels.invalidate(groupId);
    await this.app.services.channels.prime(groupId);
    const access = await this.repairChannelAccess(groupId, results, [ownerUserId, botUserId], accessHints);
    return { ids: results, created, recovered, access };
  }

  async repairChannelAccess(groupId, channels, userIds, accessHints = {}) {
    if (typeof this.app.client.grantChannelAccess !== 'function') return { repaired: 0, failed: [] };
    const ids = [...new Set(Object.values(channels).map(Number).filter(Number.isInteger))];
    const users = [...new Set(userIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    const failed = [];
    let repaired = 0;
    // API yükünü kontrol altında tutmak için sıralı ilerle.
    for (const channelId of ids) {
      let raw = accessHints[channelId] || {};
      const permissionKeys = [
        'read_plus_user_ids', 'readPlusUserIds',
        'write_plus_user_ids', 'writePlusUserIds',
        'control_plus_user_ids', 'controlPlusUserIds'
      ];
      if (!permissionKeys.some((key) => Object.prototype.hasOwnProperty.call(raw, key))) {
        const current = await this.app.services.provisioning.findChannelById(groupId, channelId);
        raw = current?.raw || {};
      }
      for (const userId of users) {
        const contains = (value) => String(value ?? '')
          .split(/[,\s]+/)
          .map(Number)
          .includes(userId);
        const readMissing = !contains(raw.read_plus_user_ids ?? raw.readPlusUserIds);
        const writeMissing = !contains(raw.write_plus_user_ids ?? raw.writePlusUserIds);
        const controlMissing = !contains(raw.control_plus_user_ids ?? raw.controlPlusUserIds);
        if (!readMissing && !writeMissing && !controlMissing) continue;
        try {
          await this.app.client.grantChannelAccess(channelId, userId, {
            read: readMissing,
            write: writeMissing,
            control: controlMissing
          });
          repaired += 1;
        } catch (error) {
          failed.push({ channelId, userId, message: error.message });
        }
        await sleep(180);
      }
    }
    if (failed.length) this.app.logger?.warn('Destek şablonunda bazı kanal erişimleri otomatik onarılamadı.', { failed });
    return { repaired, failed };
  }

  async configureSettings(groupId, roles, channels) {
    const current = await this.app.services.settings.get(groupId);
    const configured = deepMerge(current, {
      channels: {
        welcome: String(channels.welcome || ''),
        leave: String(channels.logs || channels.welcome || ''),
        logs: String(channels.logs || ''),
        announcements: String(channels.announcements || ''),
        tickets: String(channels.support || ''),
        ticketLogs: String(channels.ticketLogs || channels.logs || ''),
        moderationLogs: String(channels.moderationLogs || channels.logs || ''),
        statistics: String(channels.status || channels.logs || ''),
        system: String(channels.status || channels.logs || ''),
        levels: String(channels.leveling || channels.status || ''),
        giveaways: String(channels.giveaways || channels.announcements || ''),
        polls: String(channels.suggestions || ''),
        social: String(channels.media || channels.announcements || '')
      },
      welcome: {
        enabled: true,
        message: 'Aramıza hoş geldin, {userName}! Kuralları okuyup destek için #destek kanalını kullanabilirsin.',
        dmEnabled: true,
        dmMessage: '{groupName} sunucusuna hoş geldin. Kuralları okuyup destek kanalından yardım alabilirsin.',
        embedEnabled: true,
        cardEnabled: true,
        background: '#071327',
        accent: '#2EA8FF',
        showAvatar: true,
        showServerInfo: false
      },
      leave: { enabled: true, message: 'Kullanıcı #{userId} sunucudan ayrıldı.' },
      autorole: { enabled: true, roleIds: [roles.member].filter(Number.isInteger), removeRoleIds: [] },
      selfRoles: [],
      registration: { enabled: false, roleIds: [roles.verified].filter(Number.isInteger) },
      moderation: {
        enabled: true,
        antiSpam: true,
        antiFlood: true,
        spamMessageCount: 5,
        spamIntervalSeconds: 7,
        duplicateMessageCount: 3,
        duplicateIntervalSeconds: 20,
        blockLinks: false,
        mentionSpam: true,
        mentionLimit: 5,
        capsFilter: true,
        capsPercent: 85,
        capsMinLength: 16,
        deleteViolations: true,
        autoTimeoutAtWarnings: 3,
        autoTimeoutMinutes: 10,
        autoKickAtWarnings: 5,
        muteRoleId: roles.muted || null
      },
      tickets: {
        enabled: true,
        staffRoleIds: [roles.support, roles.moderator, roles.admin].filter(Number.isInteger),
        channelPrefix: 'ticket',
        createPrivateChannel: true,
        deleteChannelOnClose: false,
        welcomeMessage: 'Destek talebin açıldı. Destek ekibi en kısa sürede dönüş yapacak.'
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
        announceLevelUp: true,
        levelUpMessage: '⭐ Tebrikler kullanıcı #{userId}! Seviye {level} oldun.',
        cardEnabled: true,
        cardAccent: '#7C5CFF',
        roleRewards: this.levelRoleRewards(roles)
      },
      customCommands: { enabled: true },
      automations: { enabled: true },
      maintenance: {
        autoBackupEnabled: true,
        autoBackupHours: 24,
        healthAlerts: true,
        healthCheckHours: 6
      }
    });
    return this.app.services.settings.replace(groupId, configured);
  }

  async seedIntegratedFeatures(groupId, channels, roles, { force = false } = {}) {
    const state = await this.readState(groupId);
    const previouslySeeded = new Set(force ? [] : (state?.seeded || []));
    const seeded = [...previouslySeeded];
    const posts = [
      [channels.guide, 'guide', [
        '🧭 BAŞLANGIÇ REHBERİ',
        '1. Önce #kurallar kanalını oku.',
        '2. Genel sorular için #sikca-sorulanlar kanalına göz at.',
        `3. Özel destek için ${this.app.config.prefix}ticket aç <sorun> komutunu kullan.`,
        `4. Bot komut merkezini açmak için yalnızca ${this.app.config.prefix} gönder.`,
        `5. Seviyeni görmek için ${this.app.config.prefix}rank, sıralama için ${this.app.config.prefix}toprank yaz.`,
        '6. Hata bildirirken sorunu yeniden oluşturma adımlarını ekle.'
      ].join('\n')],
      [channels.rules, 'rules', [
        '📜 SUNUCU KURALLARI',
        '1. Saygılı ve yapıcı iletişim kur.',
        '2. Spam, flood, hakaret ve izinsiz reklam yapma.',
        '3. Kişisel bilgileri paylaşma.',
        '4. Destek taleplerini yalnızca destek sistemi üzerinden aç.',
        '5. Yönetim kararlarına itiraz için ticket kullan.'
      ].join('\n')],
      [channels.announcements, 'announcements', '📢 Duyuru kanalı hazır. Yönetim panelinden duyuru gönderebilirsin.'],
      [channels.updates, 'updates', '🛠️ Güncelleme notları ve bakım duyuruları bu kanalda paylaşılır.'],
      [channels.faq, 'faq', [
        '📚 SIKÇA SORULANLAR',
        `• Destek almak: ${this.app.config.prefix}ticket aç <sorun>`,
        `• Komut merkezini açmak: yalnızca ${this.app.config.prefix} gönder`,
        `• Sistem durumunu görmek: ${this.app.config.prefix}sistemkontrol`,
        '• Yetkili başvuruları ve özel talepler için ticket aç.'
      ].join('\n')],
      [channels.status, 'status', `🟢 ToplyBot sistemi kuruldu ve çalışıyor.\nKontrol: ${this.app.config.prefix}sistemkontrol\nOnarım: ${this.app.config.prefix}sistemonar`],
      [channels.roleGuide, 'role-guide', [
        '🎭 ROL VE SEVİYE ÖDÜLLERİ',
        `• Yeni üyeler otomatik olarak Üye (#${roles.member}) rolünü alır.`,
        '• Seviye rolleri ücretsizdir; para veya rozet şartı yoktur.',
        ...LEVEL_ROLE_SPECS.map((spec) => `• Lv.${spec.level}: ${spec.emoji} ${spec.title} rolü + SVG logolu rozet`),
        `• Eksik ödüller için: ${this.app.config.prefix}seviyesenkron <kullanıcıId>`
      ].join('\n')],
      [channels.leveling, 'leveling', [
        '⭐ SEVİYE VE RANK MERKEZİ',
        `• Profil kartı: ${this.app.config.prefix}rank`,
        `• Görsel sıralama: ${this.app.config.prefix}toprank`,
        '• Mesaj yazdıkça XP kazanılır ve kilometre taşı rolleri otomatik verilir.'
      ].join('\n')],
      [channels.commands, 'commands', `🤖 Bot yönetim panelini açmak için yalnızca ${this.app.config.prefix} gönder.`],
      [channels.giveaways, 'giveaways', `🎉 Çekilişler bu kanalda yayınlanır. Yönetim panelinden yeni çekiliş oluşturulabilir.`],
      [channels.media, 'media', '🖼️ Topluluk görselleri, videoları ve sosyal medya içerikleri bu kanalda paylaşılır.'],
      [channels.applications, 'applications', `📝 Yetkili başvurusu için kendini, deneyimini ve katkı sağlayabileceğin alanı açıkça yaz. Özel bilgi paylaşma; gerekirse ${this.app.config.prefix}ticket aç.`],
      [channels.staffAnnouncements, 'staff-announcements', '📣 Ekip operasyon duyuruları ve görev değişiklikleri bu kanalda paylaşılır.'],
      [channels.staffCommands, 'staff-commands', `⚙️ Yönetim işlemleri için komut merkezini ${this.app.config.prefix} ile açabilirsin.`],
      [channels.ticketLogs, 'ticket-logs', '🎫 Ticket açma ve kapatma kayıtları bu kanala yönlendirilir.'],
      [channels.moderationLogs, 'moderation-logs', '🛡️ Moderasyon işlemleri bu kanala yönlendirilir.'],
      [channels.logs, 'system-logs', '📋 Sistem, ayar, bakım ve şablon kayıtları bu kanala yönlendirilir.'],
      [channels.bugs, 'bugs', `🐞 Hata bildirirken adımları, beklenen sonucu ve oluşan hatayı yaz. Özel bilgi paylaşma; gerekirse ${this.app.config.prefix}ticket aç komutunu kullan.`],
      [channels.suggestions, 'suggestions', '💡 Önerini açık, kısa ve uygulanabilir şekilde paylaş. Yönetim ekibi değerlendirecektir.']
    ];
    for (const [channelId, key, text] of posts) {
      if (!channelId || previouslySeeded.has(key)) continue;
      try {
        await this.app.client.sendPost(channelId, text);
        seeded.push(key);
      } catch (error) {
        this.app.logger?.warn('Destek şablonu başlangıç mesajı gönderilemedi.', { groupId, channelId, key, message: error.message });
      }
    }

    // Hazır özel komutlar mevcut komutların üzerine yazılmaz.
    const defaults = {
      kurallar: { type: 'text', content: `Kurallar kanalı: #${channels.rules}`, permission: 'member' },
      destekbilgi: { type: 'text', content: `Destek kanalı: #${channels.support}. Ticket açmak için ${this.app.config.prefix}ticket aç <sorun>`, permission: 'member' },
      sistembilgi: { type: 'text', content: `Sistem durumu kanalı: #${channels.status}`, permission: 'member' }
    };
    await this.app.stores.customCommands.update((items) => {
      for (const [name, command] of Object.entries(defaults)) {
        const key = `${groupId}:${name}`;
        if (items[key]) continue;
        items[key] = {
          name,
          ...command,
          title: name,
          roleId: null,
          enabled: true,
          uses: 0,
          createdBy: this.designatedOwnerId(),
          createdAt: new Date().toISOString(),
          template: `support-v${TEMPLATE_VERSION}`
        };
      }
      return items;
    });

    // Faydalı anahtar kelime yönlendirmeleri; aynı tetikleyici varsa çoğaltılmaz.
    const settings = await this.app.services.settings.get(groupId);
    const replies = [...(settings.automations.keywordReplies || [])];
    const automatic = [
      { trigger: 'nasıl destek alırım', response: `Destek için #${channels.support} kanalını kullan veya ${this.app.config.prefix}ticket aç <sorun> yaz.`, exact: false },
      { trigger: 'bot çalışmıyor', response: `Önce ${this.app.config.prefix}sistemkontrol komutuyla durumu kontrol et; çözülmezse ticket aç.`, exact: false }
    ];
    for (const item of automatic) {
      if (!replies.some((current) => String(current.trigger).toLocaleLowerCase('tr-TR') === item.trigger)) replies.push(item);
    }
    await this.app.services.settings.set(groupId, 'automations.keywordReplies', replies);

    await this.writeState(groupId, {
      seededAt: new Date().toISOString(),
      seededVersion: TEMPLATE_VERSION,
      seeded
    });
    return {
      skipped: seeded.length === previouslySeeded.size,
      seeded,
      added: seeded.filter((key) => !previouslySeeded.has(key))
    };
  }

  async ensureTicketPanel(groupId, supportChannelId, ownerUserId) {
    if (!supportChannelId) return null;
    const code = ticketPanelJtml(this.app.config.prefix);
    const panels = await this.app.stores.ticketPanels.read();
    const existing = panels.find((item) => String(item.groupId) === String(groupId)
      && String(item.channelId) === String(supportChannelId) && item.active && Number.isInteger(Number(item.postId)));

    let postId;
    if (existing) {
      try {
        await updateInteractivePost({
          client: this.app.client,
          postId: existing.postId,
          text: '',
          jtmlCode: code,
          attach: this.app.config.interactions?.attachBumote !== false,
          logger: this.app.logger,
          context: 'Destek şablonu ticket paneli'
        });
        postId = Number(existing.postId);
      } catch (error) {
        this.app.logger?.warn('Kayıtlı ticket paneli güncellenemedi; yenisi oluşturulacak.', {
          groupId,
          postId: existing.postId,
          message: error.message
        });
        await this.app.stores.ticketPanels.update((items) => {
          const stale = items.find((item) => Number(item.id) === Number(existing.id));
          if (stale) {
            stale.active = false;
            stale.disabledAt = new Date().toISOString();
            stale.disabledReason = 'post-update-failed';
          }
          return items;
        });
      }
    }
    if (!Number.isInteger(postId)) {
      const delivery = await sendInteractivePost({
        client: this.app.client,
        channelId: supportChannelId,
        text: '',
        jtmlCode: code,
        attach: this.app.config.interactions?.attachBumote !== false,
        logger: this.app.logger,
        context: 'Destek şablonu ticket paneli'
      });
      postId = delivery.postId;
      if (Number.isInteger(postId)) {
        await this.app.stores.ticketPanels.update((items) => {
          items.push({
            id: nextPanelId(items), groupId, channelId: supportChannelId, postId,
            title: 'Destek Merkezi', active: true, createdBy: ownerUserId,
            createdAt: new Date().toISOString(), template: `support-v${TEMPLATE_VERSION}`
          });
          return items;
        });
      }
    }
    return postId || null;
  }

  async verify(groupId, { roles = null, channels = null } = {}) {
    const listedRoles = await this.app.services.roles.list(groupId).catch(() => []);
    const listedChannels = await this.app.services.channels.list(groupId, { force: true }).catch(() => []);
    const state = await this.readState(groupId);
    const hintedRoles = { ...(state?.roles || {}), ...(roles || {}) };
    const hintedChannels = { ...(state?.channels || {}), ...(channels || {}) };
    const roleMap = Object.fromEntries(ROLE_SPECS.map((spec) => {
      const match = listedRoles.find((role) => role.normalizedName === RoleService.normalizeRoleName(spec.name));
      return [spec.key, match?.id || hintedRoles[spec.key] || null];
    }));
    const channelMap = Object.fromEntries(CHANNEL_SPECS.map((spec) => {
      const targets = [spec.nick, spec.title].map(ChannelResolverService.normalizeChannelName);
      const match = listedChannels.find((channel) => targets.some((target) => channel.aliases.includes(target)));
      return [spec.key, match?.id || hintedChannels[spec.key] || null];
    }));
    const settings = await this.app.services.settings.get(groupId);
    const visibleChannelIds = new Set(listedChannels.map((channel) => Number(channel.id)).filter(Number.isInteger));
    const directlyResolvedChannels = [];
    const candidateChannelIds = [...new Set([
      ...Object.values(channelMap),
      ...Object.values(settings.channels || {})
    ].map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    for (const channelId of candidateChannelIds) {
      if (visibleChannelIds.has(channelId)) continue;
      const direct = await this.app.services.provisioning.findChannelById(groupId, channelId);
      if (direct) {
        visibleChannelIds.add(channelId);
        directlyResolvedChannels.push(channelId);
      }
    }

    const visibleRoleIds = new Set(listedRoles.map((role) => Number(role.id)).filter(Number.isInteger));
    const directlyResolvedRoles = [];
    for (const [key, roleIdValue] of Object.entries(roleMap)) {
      const roleId = Number(roleIdValue);
      if (!Number.isInteger(roleId) || visibleRoleIds.has(roleId)) continue;
      const spec = ROLE_SPECS.find((item) => item.key === key);
      const direct = await this.app.services.provisioning.findRoleById(groupId, roleId, spec);
      if (direct) {
        visibleRoleIds.add(roleId);
        directlyResolvedRoles.push(roleId);
      }
    }

    const missingRoles = ROLE_SPECS
      .filter((spec) => !visibleRoleIds.has(Number(roleMap[spec.key])))
      .map((spec) => spec.name);
    const missingChannels = CHANNEL_SPECS
      .filter((spec) => !visibleChannelIds.has(Number(channelMap[spec.key])))
      .map((spec) => spec.nick);
    const staleSettingChannels = Object.entries(settings.channels || {})
      .filter(([, value]) => value && !visibleChannelIds.has(Number(value)))
      .map(([key, value]) => `${key}=${value}`);
    const missingLevelRoleRewards = LEVEL_ROLE_SPECS
      .filter((spec) => Number(settings.leveling?.roleRewards?.[String(spec.level)]) !== Number(roleMap[spec.key]))
      .map((spec) => spec.level);
    const missingLevelBadgeRewards = LEVEL_ROLE_SPECS
      .filter((spec) => !Number.isInteger(Number(settings.leveling?.badgeRewards?.[String(spec.level)])))
      .map((spec) => spec.level);
    const expectedStaffRoles = [roleMap.support, roleMap.moderator, roleMap.admin].map(Number).filter(Number.isInteger);
    const actualStaffRoles = (settings.tickets?.staffRoleIds || []).map(Number).filter(Number.isInteger);
    const issues = [
      ...missingRoles.map((name) => `Eksik rol: ${name}`),
      ...missingChannels.map((name) => `Eksik kanal: #${name}`),
      ...staleSettingChannels.map((item) => `Geçersiz kanal ayarı: ${item}`),
      ...(!settings.welcome.enabled ? ['Hoş geldin sistemi kapalı'] : []),
      ...(!settings.tickets.enabled ? ['Ticket sistemi kapalı'] : []),
      ...(!settings.autorole?.enabled ? ['Otorol sistemi kapalı'] : []),
      ...(!(settings.autorole?.roleIds || []).map(Number).includes(Number(roleMap.member)) ? ['Üye otorolü bağlı değil'] : []),
      ...(Number(settings.moderation?.muteRoleId) !== Number(roleMap.muted) ? ['Susturma rolü moderasyona bağlı değil'] : []),
      ...(expectedStaffRoles.some((roleId) => !actualStaffRoles.includes(roleId)) ? ['Ticket yetkili rolleri eksik'] : []),
      ...missingLevelRoleRewards.map((level) => `Eksik seviye rolü eşlemesi: Lv.${level}`),
      ...missingLevelBadgeRewards.map((level) => `Eksik SVG rozet eşlemesi: Lv.${level}`)
    ];
    const result = {
      ok: issues.length === 0,
      checkedAt: new Date().toISOString(),
      missingRoles,
      missingChannels,
      staleSettingChannels,
      missingLevelRoleRewards,
      missingLevelBadgeRewards,
      issues,
      roleCount: visibleRoleIds.size,
      channelCount: visibleChannelIds.size,
      directlyResolvedRoles,
      directlyResolvedChannels,
      roles: roleMap,
      channels: channelMap
    };
    await this.writeState(groupId, { verification: result });
    return result;
  }

  async install({
    groupId,
    userId,
    forceSeed = false,
    reason = 'install',
    progress = null,
    existingBackup = null,
    alreadyLocked = false
  }) {
    if (!this.canInstall(userId)) throw new Error('Bu destek şablonunu yalnızca yapılandırılmış bot sahibi kurabilir.');
    const numericGroupId = Number(groupId);
    if (!Number.isInteger(numericGroupId)) throw new Error('Geçerli sunucu/grup ID gerekli.');

    const operation = async () => {
      const initial = stateBase(numericGroupId, userId);
      await this.writeState(numericGroupId, { ...initial, status: 'running', stage: 'backup', progress: 1, reason });
      await progress?.update?.(2, 'Kurulum hazırlanıyor', `Sunucu #${numericGroupId}`);
      try {
        const backup = existingBackup || await this.app.services.backups.create(numericGroupId, {
          actorUserId: userId,
          reason: 'pre-template-install',
          label: `Destek şablonu v${TEMPLATE_VERSION} öncesi`
        });
        await this.writeState(numericGroupId, { backupId: backup.id, progress: 4 });
        await progress?.update?.(4, 'Güvenlik yedeği oluşturuldu', backup.id);

        const botUserId = await this.app.client.getCurrentUserId();
        await progress?.update?.(5, 'Bot kimliği doğrulandı', `Bot kullanıcı ID: ${botUserId}`);
        const persistedState = await this.readState(numericGroupId);
        const roleResult = await this.ensureRoles(numericGroupId, persistedState, progress);
        const privilegedAssignments = await this.ensurePrivilegedAssignments(
          numericGroupId,
          roleResult.ids,
          Number(userId),
          botUserId
        );
        const channelResult = await this.ensureChannels(numericGroupId, roleResult.ids, Number(userId), botUserId, progress);
        await this.writeState(numericGroupId, { stage: 'settings', progress: 62 });
        await progress?.update?.(62, 'Sunucu ayarları uygulanıyor');
        await this.configureSettings(numericGroupId, roleResult.ids, channelResult.ids);
        await this.writeState(numericGroupId, { stage: 'level-rewards', progress: 63 });
        const levelRewards = await this.ensureLevelRewards(
          numericGroupId,
          roleResult.ids,
          progress,
          { forceBadges: reason === 'full-rebuild' }
        );
        const levelSync = typeof this.app.services.leveling.syncAllRewards === 'function'
          ? await this.app.services.leveling.syncAllRewards(numericGroupId)
          : { total: 0, succeeded: 0, failed: [], results: [] };
        await this.remapChannelBoundSystems(numericGroupId, channelResult.ids);
        await this.writeState(numericGroupId, { stage: 'content', progress: 70 });
        await progress?.update?.(70, 'Kurallar ve otomasyonlar hazırlanıyor');
        const seedResult = await this.seedIntegratedFeatures(numericGroupId, channelResult.ids, roleResult.ids, { force: forceSeed });
        await this.writeState(numericGroupId, { stage: 'ticket-panel', progress: 82 });
        await progress?.update?.(82, 'Ticket paneli hazırlanıyor');
        const ticketPanelPostId = await this.ensureTicketPanel(numericGroupId, channelResult.ids.support, Number(userId));
        await this.writeState(numericGroupId, { stage: 'welcome-repair', progress: 90, ticketPanelPostId });
        await progress?.update?.(90, 'Hoş geldin sistemi ve kanal erişimleri onarılıyor');
        const welcomeRepair = await this.app.services.welcome.repair(numericGroupId, { enable: true, sendTest: false });
        await progress?.update?.(96, 'Kurulum doğrulanıyor');
        const verification = await this.verify(numericGroupId, { roles: roleResult.ids, channels: channelResult.ids });

        const result = {
          groupId: numericGroupId,
          version: TEMPLATE_VERSION,
          roles: roleResult.ids,
          channels: channelResult.ids,
          createdRoles: roleResult.created.map((item) => item.name),
          createdChannels: channelResult.created.map((item) => item.nick),
          recoveredRoles: roleResult.recovered.map((item) => item.name),
          recoveredChannels: channelResult.recovered.map((item) => item.nick),
          privilegedAssignments,
          ticketPanelPostId,
          seedResult,
          levelRewards,
          levelSync,
          welcomeRepair,
          verification,
          installedBy: Number(userId),
          botUserId,
          backupId: backup.id,
          installedAt: new Date().toISOString()
        };
        await this.writeState(numericGroupId, {
          status: verification.ok ? 'completed' : 'completed-with-warnings',
          stage: 'completed',
          progress: 100,
          completedAt: result.installedAt,
          roles: result.roles,
          channels: result.channels,
          createdRoles: result.createdRoles,
          createdChannels: result.createdChannels,
          warnings: verification.issues,
          levelRewards: {
            roleRewards: result.levelRewards.roleRewards,
            badgeRewards: result.levelRewards.badgeRewards,
            failed: result.levelRewards.failed
          },
          verification,
          ticketPanelPostId
        });
        await this.app.services.audit.write('template.support.install', result, {
          groupId: numericGroupId,
          text: `Destek sunucusu şablonu v${TEMPLATE_VERSION} kuruldu.\nRoller: ${Object.values(result.roles).join(', ')}\nKanallar: ${Object.values(result.channels).join(', ')}`
        });
        return result;
      } catch (error) {
        await this.writeState(numericGroupId, {
          status: 'failed',
          lastError: {
            message: error.message,
            stack: String(error.stack || '').slice(0, 2500),
            response: safePreview(error.apiResponse || error.cause?.apiResponse || '')
          }
        });
        throw error;
      }
    };
    if (alreadyLocked) return operation();
    return this.app.services.provisioning.withGroupLock(numericGroupId, operation);
  }

  async rebuild({ groupId, userId, confirmation = '', progress = null }) {
    if (!this.canInstall(userId)) throw new Error('Bu destek şablonunu yalnızca yapılandırılmış bot sahibi sıfırlayabilir.');
    if (String(confirmation || '').trim().toLocaleUpperCase('tr-TR') !== 'TAM SIFIRLA') {
      throw new Error('Tam yeniden kurulum için onay alanına TAM SIFIRLA yazılmalıdır.');
    }
    const numericGroupId = Number(groupId);
    if (!Number.isInteger(numericGroupId) || numericGroupId <= 0) throw new Error('Geçerli sunucu/grup ID gerekli.');

    return this.app.services.provisioning.withGroupLock(numericGroupId, async () => {
      const levelAssets = await this.app.services.cards.publishLevelBadgeAssets(
        this.levelAssetDirectory(),
        LEVEL_ROLE_SPECS.map((spec) => spec.level)
      );
      const unpublished = Object.values(levelAssets).filter((asset) => !asset.url);
      if (unpublished.length) {
        throw new Error('SVG logoları için dışarıdan erişilebilir HTTPS kart adresi oluşturulamadı; hiçbir kanal veya rol silinmedi.');
      }
      const botUserId = await this.app.client.getCurrentUserId();
      await progress?.update?.(3, 'Tam yeniden kurulum ön kontrolü tamamlandı', `${Object.keys(levelAssets).length} SVG • Bot #${botUserId}`);

      const backup = await this.app.services.backups.create(numericGroupId, {
        actorUserId: userId,
        reason: 'pre-template-rebuild',
        label: `Destek şablonu v${TEMPLATE_VERSION} tam sıfırlama öncesi`
      });
      const inventory = await this.remoteInventory(numericGroupId);
      const bootstrapRole = await this.createBootstrapRole(
        numericGroupId,
        Number(userId),
        botUserId
      );
      await this.replaceState(numericGroupId, {
        installedBy: Number(userId),
        status: 'running',
        stage: 'deleting-existing-structure',
        progress: 5,
        reason: 'full-rebuild',
        backupId: backup.id,
        preRebuildInventory: inventory,
        bootstrapRole: { id: bootstrapRole.id, name: bootstrapRole.name },
        levelAssetDirectory: this.levelAssetDirectory(),
        levelAssets: Object.fromEntries(
          Object.entries(levelAssets).map(([level, asset]) => [level, {
            sourceName: asset.sourceName,
            url: asset.url,
            title: asset.title,
            emoji: asset.emoji
          }])
        )
      });
      await this.clearRuntimeReferences(numericGroupId);
      const deletion = await this.deleteExistingStructure(numericGroupId, inventory, progress);
      await this.writeState(numericGroupId, {
        stage: 'installing-new-structure',
        progress: 29,
        deletedChannels: deletion.deletedChannels.map((item) => item.id),
        deletedRoles: deletion.deletedRoles.map((item) => item.id),
        deletionFailures: [...deletion.failedChannels, ...deletion.failedRoles]
      });

      const result = await this.install({
        groupId: numericGroupId,
        userId,
        forceSeed: true,
        reason: 'full-rebuild',
        progress,
        existingBackup: backup,
        alreadyLocked: true
      });
      result.bootstrapCleanup = await this.removeBootstrapRole(
        numericGroupId,
        bootstrapRole,
        result.roles,
        Number(userId),
        botUserId
      ).catch((error) => ({ removed: false, roleId: bootstrapRole.id, message: error.message }));
      result.rebuild = {
        previousChannels: inventory.channels.length,
        previousRoles: inventory.roles.length,
        deletedChannels: deletion.deletedChannels.length,
        deletedRoles: deletion.deletedRoles.length,
        failedChannels: deletion.failedChannels,
        failedRoles: deletion.failedRoles
      };
      const deletionFailureCount = deletion.failedChannels.length + deletion.failedRoles.length;
      if (deletionFailureCount) {
        result.verification.ok = false;
        result.verification.issues.push(`${deletionFailureCount} eski kanal/rol silinemedi.`);
        await this.writeState(numericGroupId, {
          status: 'completed-with-warnings',
          warnings: result.verification.issues,
          verification: result.verification,
          rebuild: result.rebuild
        });
      } else {
        await this.writeState(numericGroupId, { rebuild: result.rebuild });
      }
      return result;
    });
  }

  async resumeRebuild({ groupId, userId, confirmation = '' }) {
    if (!this.canInstall(userId)) throw new Error('Bu destek şablonunu yalnızca yapılandırılmış bot sahibi tamamlayabilir.');
    if (String(confirmation || '').trim().toLocaleUpperCase('tr-TR') !== 'KURULUMU TAMAMLA') {
      throw new Error('Yarım kurulumu sürdürmek için KURULUMU TAMAMLA onayı gereklidir.');
    }
    const numericGroupId = Number(groupId);
    return this.app.services.provisioning.withGroupLock(numericGroupId, async () => {
      const state = await this.readState(numericGroupId);
      if (!state?.preRebuildInventory || !state?.backupId) {
        throw new Error('Sürdürülebilecek yarım bir tam kurulum kaydı bulunamadı.');
      }
      const staleChannels = (state.deletionFailures || []).filter((item) => item.nick || item.title);
      const staleRoles = (state.deletionFailures || []).filter((item) => item.name && !item.nick);
      const result = await this.install({
        groupId: numericGroupId,
        userId,
        forceSeed: true,
        reason: 'full-rebuild',
        existingBackup: { id: state.backupId },
        alreadyLocked: true
      });
      const currentRoleIds = new Set(Object.values(result.roles).map(Number));
      const currentChannelIds = new Set(Object.values(result.channels).map(Number));
      const cleanup = { channels: [], roles: [], failed: [] };
      for (const channel of staleChannels) {
        if (currentChannelIds.has(Number(channel.id))) continue;
        try {
          const response = await this.app.client.deleteChannel(Number(channel.id));
          assertApiSuccess(response, `Eski kanal #${channel.id} temizleme`);
          cleanup.channels.push(Number(channel.id));
        } catch (error) {
          cleanup.failed.push({ type: 'channel', id: Number(channel.id), message: error.message });
        }
      }
      for (const role of staleRoles) {
        if (currentRoleIds.has(Number(role.id))) continue;
        try {
          const response = await this.app.client.deleteRole(Number(role.id));
          assertApiSuccess(response, `Eski rol #${role.id} temizleme`);
          cleanup.roles.push(Number(role.id));
        } catch (error) {
          cleanup.failed.push({ type: 'role', id: Number(role.id), message: error.message });
        }
      }
      this.app.services.channels.invalidate(numericGroupId);
      this.app.services.roles.invalidate(numericGroupId);
      result.privilegedAssignments = await this.ensurePrivilegedAssignments(
        numericGroupId,
        result.roles,
        Number(userId),
        Number(result.botUserId)
      );
      result.verification = await this.verify(numericGroupId, {
        roles: result.roles,
        channels: result.channels
      });
      result.rebuild = {
        previousChannels: state.preRebuildInventory.channels?.length || 0,
        previousRoles: state.preRebuildInventory.roles?.length || 0,
        deletedChannels: (state.deletedChannels || []).length + cleanup.channels.length,
        deletedRoles: (state.deletedRoles || []).length + cleanup.roles.length,
        failedChannels: cleanup.failed.filter((item) => item.type === 'channel'),
        failedRoles: cleanup.failed.filter((item) => item.type === 'role'),
        resumed: true
      };
      await this.writeState(numericGroupId, {
        status: result.verification.ok && cleanup.failed.length === 0 ? 'completed' : 'completed-with-warnings',
        stage: 'completed',
        progress: 100,
        rebuild: result.rebuild,
        verification: result.verification,
        warnings: [...result.verification.issues, ...cleanup.failed.map((item) => item.message)]
      });
      return result;
    });
  }

  async repair({ groupId, userId, sendWelcomeTest = false, progress = null }) {
    const result = await this.install({ groupId, userId, forceSeed: false, reason: 'repair', progress });
    if (sendWelcomeTest) {
      result.welcomeTest = await this.app.services.welcome.sendWelcome({
        groupId: Number(groupId), userId: Number(userId), source: 'template-repair-test'
      });
    }
    return result;
  }
}

SupportTemplateService.TEMPLATE_VERSION = TEMPLATE_VERSION;
SupportTemplateService.ROLE_SPECS = ROLE_SPECS;
SupportTemplateService.LEVEL_ROLE_SPECS = LEVEL_ROLE_SPECS;
SupportTemplateService.CHANNEL_SPECS = CHANNEL_SPECS;
SupportTemplateService.channelPayload = channelPayload;
SupportTemplateService.rolePayload = rolePayload;
module.exports = SupportTemplateService;
