const { findArray, findObject, parseMaybeJson, unwrapApiResult, extractCreatedEntityId } = require('../utils/api');
const { assertApiSuccess } = require('../utils/apiResult');
const { safePreview } = require('../utils/preview');
const ChannelResolverService = require('./ChannelResolverService');
const RoleService = require('./RoleService');

const CHANNEL_FIELDS = new Set([
  'nick', 'title', 'description', 'type', 'data',
  'read_role_ids', 'write_role_ids', 'control_role_ids',
  'read_plus_user_ids', 'read_minus_user_ids',
  'write_plus_user_ids', 'write_minus_user_ids',
  'control_plus_user_ids', 'control_minus_user_ids'
]);

const ROLE_POWER_FIELDS = [
  'power_group', 'power_role', 'power_channel', 'power_post',
  'power_member', 'power_room', 'power_team', 'power_mention'
];

const ROLE_PRESETS = Object.freeze({
  member: {},
  uye: {},
  üye: {},
  content: { power_post: 1, power_mention: 1 },
  icerik: { power_post: 1, power_mention: 1 },
  içerik: { power_post: 1, power_mention: 1 },
  support: { power_post: 1, power_member: 1, power_mention: 1 },
  destek: { power_post: 1, power_member: 1, power_mention: 1 },
  moderator: { power_channel: 1, power_post: 1, power_member: 1, power_mention: 1 },
  mod: { power_channel: 1, power_post: 1, power_member: 1, power_mention: 1 },
  admin: Object.fromEntries(ROLE_POWER_FIELDS.map((field) => [field, 1])),
  yonetici: Object.fromEntries(ROLE_POWER_FIELDS.map((field) => [field, 1])),
  yönetici: Object.fromEntries(ROLE_POWER_FIELDS.map((field) => [field, 1]))
});

function scalar(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return fallback;
}

function normalizeList(value, preferredKeys = []) {
  let items = findArray(value, preferredKeys);
  if (!items.length) {
    const root = unwrapApiResult(parseMaybeJson(value));
    if (root && typeof root === 'object' && !Array.isArray(root)) {
      items = Object.entries(root)
        .filter(([key, item]) => /^\d+$/.test(key) || (item && typeof item === 'object'))
        .map(([key, item]) => {
          if (item && typeof item === 'object' && !Array.isArray(item) && item.id === undefined) return { id: Number(key) || undefined, ...item };
          return item;
        });
    }
  }
  return items.filter((item) => item !== null && item !== undefined);
}

function normalizeId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizeToggle(value) {
  const text = String(value ?? '').trim().toLocaleLowerCase('tr-TR');
  if (['1', 'aç', 'ac', 'on', 'true', 'evet', 'aktif'].includes(text)) return 1;
  if (['0', 'kapat', 'off', 'false', 'hayır', 'hayir', 'pasif'].includes(text)) return 0;
  return null;
}

function displayName(item, fallback = 'Bilinmiyor') {
  return String(item?.name ?? item?.title ?? item?.nick ?? item?.user_name ?? item?.username ?? fallback).trim();
}

function objectFromResult(result, keys) {
  return findObject(result, keys) || unwrapApiResult(result) || {};
}

function copyChannelPayload(channelId, source = {}) {
  const payload = { channel_id: Number(channelId) };
  for (const field of CHANNEL_FIELDS) {
    const value = source[field];
    if (value !== undefined && value !== null) payload[field] = value;
  }
  payload.nick = String(payload.nick ?? source.channel_nick ?? source.slug ?? `kanal-${channelId}`);
  payload.title = String(payload.title ?? source.name ?? source.channel_name ?? payload.nick);
  payload.description = String(payload.description ?? '');
  payload.type = Number.isFinite(Number(payload.type)) ? Number(payload.type) : 1;
  payload.data = scalar(payload.data, '');
  for (const field of [...CHANNEL_FIELDS].filter((item) => item.endsWith('_ids'))) {
    if (payload[field] === undefined || payload[field] === null) payload[field] = '';
    if (Array.isArray(payload[field])) payload[field] = payload[field].join(',');
    payload[field] = String(payload[field]);
  }
  return payload;
}

function copyRolePayload(roleId, source = {}) {
  const payload = {
    role_id: Number(roleId),
    name: String(source.name ?? source.title ?? `Rol ${roleId}`),
    color: String(source.color ?? '#94a3b8')
  };
  for (const field of ROLE_POWER_FIELDS) payload[field] = Number(source[field]) ? 1 : 0;
  return payload;
}

class ApiManagementService {
  constructor({ app }) {
    this.app = app;
  }

  async groupSummary(groupId) {
    const tasks = await Promise.allSettled([
      this.app.client.getGroup(groupId),
      this.app.client.getGroupFounder(groupId),
      this.app.services.channels.list(groupId),
      this.app.services.roles.list(groupId),
      this.app.client.listMembers(groupId),
      this.app.client.listOnline(groupId),
      this.app.client.listJoinRequests(groupId),
      this.app.client.listBadges(groupId),
      this.app.client.listCrews(groupId),
      this.app.client.listTeams(groupId)
    ]);
    const value = (index, fallback) => tasks[index].status === 'fulfilled' ? tasks[index].value : fallback;
    const group = objectFromResult(value(0, {}), ['group', 'info']);
    const founder = objectFromResult(value(1, {}), ['founder', 'user', 'member']);
    const members = normalizeList(value(4, []), ['members', 'users', 'list', 'items']);
    const online = normalizeList(value(5, []), ['users', 'online', 'user_ids', 'list']);
    const waiters = normalizeList(value(6, []), ['members', 'users', 'waiters', 'joinlist', 'list']);
    const badges = normalizeList(value(7, []), ['badges', 'list', 'items']);
    const crews = normalizeList(value(8, []), ['crews', 'list', 'items']);
    const teams = normalizeList(value(9, []), ['teams', 'list', 'items']);
    return {
      group,
      founder,
      channels: value(2, []),
      roles: value(3, []),
      members,
      online,
      waiters,
      badges,
      crews,
      teams,
      errors: tasks.map((task, index) => task.status === 'rejected' ? { index, message: task.reason?.message || String(task.reason) } : null).filter(Boolean)
    };
  }

  async updateGroupProfile(groupId, { name, image, description }) {
    const current = objectFromResult(await this.app.client.getGroup(groupId), ['group', 'info']);
    const payload = {
      name: String(name || current.name || current.title || current.nick || `Grup ${groupId}`),
      image: String(image ?? current.image ?? ''),
      description: String(description ?? current.description ?? '')
    };
    const result = await this.app.client.setGroupProfile(groupId, payload);
    assertApiSuccess(result, 'Grup profili güncelleme');
    return payload;
  }

  async updateGroupSocial(groupId, platform, value) {
    const key = `social_${String(platform).trim().toLocaleLowerCase('tr-TR')}`;
    const allowed = new Set(['social_instagram', 'social_x', 'social_youtube', 'social_tiktok', 'social_kick', 'social_twitch', 'social_github', 'social_steam', 'social_linkedin', 'social_website']);
    if (!allowed.has(key)) throw new Error(`Desteklenmeyen platform: ${platform}`);
    const payload = { [key]: value === 'sil' ? '' : String(value || '') };
    const result = await this.app.client.setGroupSocials(groupId, payload);
    assertApiSuccess(result, 'Grup sosyal bağlantısı güncelleme');
    return payload;
  }

  async createChannel(groupId, { nick, title, description = '', type = 1 }) {
    const normalizedNick = ChannelResolverService.normalizeChannelName(nick || title);
    if (!normalizedNick) throw new Error('Geçerli kanal kısa adı gerekli.');
    const payload = {
      group_id: Number(groupId),
      nick: normalizedNick,
      title: String(title || nick || normalizedNick),
      description: String(description || ''),
      type: Number.isFinite(Number(type)) ? Number(type) : 1,
      data: '',
      read_role_ids: '-1,0',
      write_role_ids: '0',
      control_role_ids: '',
      read_plus_user_ids: '', read_minus_user_ids: '',
      write_plus_user_ids: '', write_minus_user_ids: '',
      control_plus_user_ids: '', control_minus_user_ids: ''
    };
    const ensured = await this.app.services.provisioning.ensureChannel({
      groupId,
      spec: { nick: payload.nick, title: payload.title },
      payload
    });
    this.app.services.channels.invalidate(groupId);
    return { ...ensured, payload };
  }

  async updateChannel(groupId, reference, field, value) {
    if (!CHANNEL_FIELDS.has(field)) throw new Error(`Kanal alanı desteklenmiyor: ${field}`);
    const channel = await this.app.services.channels.resolve(groupId, reference);
    const result = await this.app.client.getChannel(channel.id);
    const source = objectFromResult(result, ['channel', 'info']);
    const payload = copyChannelPayload(channel.id, { ...channel.raw, ...source });
    payload[field] = field === 'type' ? Number(value) : String(value ?? '');
    const response = await this.app.client.updateChannel(payload);
    assertApiSuccess(response, 'Kanal güncelleme');
    this.app.services.channels.invalidate(groupId);
    return { channel, payload, response };
  }

  async channelDetail(groupId, reference) {
    const channel = await this.app.services.channels.resolve(groupId, reference);
    const [info, detail] = await Promise.all([
      this.app.client.getChannel(channel.id),
      this.app.client.getChannelDetail(channel.id)
    ]);
    return { channel, info: objectFromResult(info, ['channel', 'info']), detail: objectFromResult(detail, ['channel', 'detail', 'permissions']) };
  }

  async setChannelUserPermission(groupId, reference, userId, permission, mode) {
    const channel = await this.app.services.channels.resolve(groupId, reference);
    const normalizedPermission = String(permission).toLocaleLowerCase('tr-TR');
    const normalizedMode = String(mode).toLocaleLowerCase('tr-TR');
    const map = { oku: 'read', read: 'read', yaz: 'write', write: 'write', kontrol: 'control', control: 'control' };
    const permissionKey = map[normalizedPermission];
    if (!permissionKey) throw new Error('Yetki türü oku, yaz veya kontrol olmalıdır.');
    const add = ['ver', 'ekle', 'add', 'on'].includes(normalizedMode);
    const remove = ['al', 'sil', 'del', 'remove', 'off'].includes(normalizedMode);
    if (!add && !remove) throw new Error('İşlem ver veya al olmalıdır.');
    const option = `${add ? 'add' : 'del'}_${permissionKey}_plus_user_id`;
    const result = await this.app.client.setChannelOptions(channel.id, { [option]: Number(userId) });
    assertApiSuccess(result, 'Kanal kullanıcı yetkisi güncelleme');
    return { channel, option, userId: Number(userId) };
  }

  async createRole(groupId, { name, color = '#94a3b8', preset = 'member' }) {
    if (!String(name || '').trim()) throw new Error('Rol adı gerekli.');
    const powers = this.rolePreset(preset);
    const payload = { group_id: Number(groupId), name: String(name).trim(), color: String(color || '#94a3b8'), ...Object.fromEntries(ROLE_POWER_FIELDS.map((field) => [field, powers[field] || 0])) };
    const ensured = await this.app.services.provisioning.ensureRole({ groupId, spec: { name: payload.name }, payload });
    this.app.services.roles.invalidate?.(groupId);
    return { ...ensured, payload };
  }

  rolePreset(name) {
    const key = String(name || 'member').trim().toLocaleLowerCase('tr-TR');
    const preset = ROLE_PRESETS[key];
    if (!preset) throw new Error(`Bilinmeyen rol şablonu: ${name}. Kullanılabilir: member, content, support, moderator, admin`);
    return preset;
  }

  async updateRole(groupId, roleId, field, value) {
    const id = normalizeId(roleId);
    if (!id) throw new Error('Geçerli rol ID gerekli.');
    const result = await this.app.client.getRole(id);
    const source = objectFromResult(result, ['role', 'info']);
    const payload = copyRolePayload(id, source);
    if (field === 'name' || field === 'color') payload[field] = String(value);
    else if (ROLE_POWER_FIELDS.includes(field)) payload[field] = normalizeToggle(value);
    else throw new Error(`Rol alanı desteklenmiyor: ${field}`);
    if (payload[field] === null) throw new Error('Yetki değeri aç/kapat veya 1/0 olmalıdır.');
    const response = await this.app.client.updateRole(payload);
    assertApiSuccess(response, 'Rol güncelleme');
    this.app.services.roles.invalidate?.(groupId);
    return { payload, response };
  }

  async applyRolePreset(groupId, roleId, preset) {
    const id = normalizeId(roleId);
    if (!id) throw new Error('Geçerli rol ID gerekli.');
    const result = await this.app.client.getRole(id);
    const source = objectFromResult(result, ['role', 'info']);
    const payload = copyRolePayload(id, source);
    const powers = this.rolePreset(preset);
    for (const field of ROLE_POWER_FIELDS) payload[field] = powers[field] || 0;
    const response = await this.app.client.updateRole(payload);
    assertApiSuccess(response, 'Rol şablonu uygulama');
    this.app.services.roles.invalidate?.(groupId);
    return { payload, response };
  }


  async cloneChannel(groupId, reference, { nick, title }) {
    const sourceChannel = await this.app.services.channels.resolve(groupId, reference);
    const sourceResult = await this.app.client.getChannel(sourceChannel.id);
    const source = objectFromResult(sourceResult, ['channel', 'info']);
    const sourcePayload = copyChannelPayload(sourceChannel.id, { ...sourceChannel.raw, ...source });
    const normalizedNick = ChannelResolverService.normalizeChannelName(nick || `${sourcePayload.nick}-kopya`);
    if (!normalizedNick) throw new Error('Yeni kanal kısa adı geçersiz.');
    const payload = {
      group_id: Number(groupId),
      ...Object.fromEntries([...CHANNEL_FIELDS].map((field) => [field, sourcePayload[field]])),
      nick: normalizedNick,
      title: String(title || `${sourcePayload.title} Kopya`)
    };
    delete payload.channel_id;
    const ensured = await this.app.services.provisioning.ensureChannel({
      groupId,
      spec: { nick: payload.nick, title: payload.title },
      payload
    });
    this.app.services.channels.invalidate(groupId);
    return { ...ensured, sourceChannel, payload };
  }

  async cloneRole(groupId, roleId, { name, color }) {
    const id = normalizeId(roleId);
    if (!id) throw new Error('Geçerli kaynak rol ID gerekli.');
    const result = await this.app.client.getRole(id);
    const source = objectFromResult(result, ['role', 'info']);
    const payload = copyRolePayload(id, source);
    payload.group_id = Number(groupId);
    payload.name = String(name || `${payload.name} Kopya`);
    if (color) payload.color = String(color);
    delete payload.role_id;
    const ensured = await this.app.services.provisioning.ensureRole({
      groupId,
      spec: { name: payload.name },
      payload
    });
    this.app.services.roles.invalidate?.(groupId);
    return { ...ensured, sourceRoleId: id, payload };
  }

  async setMemberRoles(groupId, userId, roleIds) {
    const normalized = [...new Set((roleIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    const result = await this.app.client.setMemberRoles(groupId, userId, normalized);
    assertApiSuccess(result, 'Üye rolleri güncelleme');
    return normalized;
  }

  async bulkWaiterAction(groupId, action, limit = 25) {
    const normalizedAction = String(action || '').toLocaleLowerCase('tr-TR');
    const endpoint = ['kabul', 'accept'].includes(normalizedAction)
      ? '/!api/member/waiter/accept'
      : ['reddet', 'red', 'reject'].includes(normalizedAction)
        ? '/!api/member/waiter/reject'
        : null;
    if (!endpoint) throw new Error('İşlem kabul veya reddet olmalıdır.');
    const waiters = (await this.listWaiters(groupId)).slice(0, Math.max(1, Math.min(100, Number(limit) || 25)));
    const ids = waiters.map((item) => normalizeId(item?.user_id ?? item?.userId ?? item?.id)).filter(Boolean);
    if (!ids.length) return { action: normalizedAction, attempted: 0, succeeded: [], failed: [] };
    const settled = await Promise.allSettled(ids.map((userId) => this.app.client.api(endpoint, {
      group_id: Number(groupId),
      user_id: userId
    }, { priority: 'high', cacheTtlMs: 0 })));
    const succeeded = [];
    const failed = [];
    settled.forEach((item, index) => {
      if (item.status === 'fulfilled') {
        try {
          assertApiSuccess(item.value, `Kullanıcı #${ids[index]} işlemi`);
          succeeded.push(ids[index]);
        } catch (error) {
          failed.push({ userId: ids[index], message: error.message });
        }
      } else failed.push({ userId: ids[index], message: item.reason?.message || String(item.reason) });
    });
    return { action: normalizedAction, attempted: ids.length, succeeded, failed };
  }

  async memberInfo(groupId, reference) {
    const text = String(reference || '').trim();
    const data = /^\d+$/.test(text)
      ? { group_id: Number(groupId), user_id: Number(text) }
      : { group_id: Number(groupId), user_nick: text.replace(/^@/, '') };
    const result = await this.app.client.api('/!api/member/get', data, { cacheTtlMs: 3000 });
    return objectFromResult(result, ['member', 'user', 'info']);
  }

  async listWaiters(groupId) {
    const result = await this.app.client.listJoinRequests(groupId);
    return normalizeList(result, ['members', 'users', 'waiters', 'joinlist', 'list']);
  }

  async listBadges(groupId) {
    return normalizeList(await this.app.client.listBadges(groupId), ['badges', 'list', 'items']);
  }

  async createBadge(groupId, { name, nick, description = '', image = '', level = '1/5' }) {
    const payload = { group_id: Number(groupId), name: String(name), nick: ChannelResolverService.normalizeChannelName(nick || name), description: String(description), image: String(image), level: String(level) };
    const result = await this.app.client.createBadge(payload);
    assertApiSuccess(result, 'Rozet oluşturma');
    return { id: extractCreatedEntityId(result, ['badge_id', 'badgeId', 'id']), payload, result };
  }

  async listCrews(groupId) {
    return normalizeList(await this.app.client.listCrews(groupId), ['crews', 'list', 'items']);
  }

  async listTeams(groupId) {
    return normalizeList(await this.app.client.listTeams(groupId), ['teams', 'list', 'items']);
  }

  async apiBenchmark(count = 20) {
    const requestCount = Math.max(1, Math.min(100, Number(count) || 20));
    const startedAt = process.hrtime.bigint();
    const results = await Promise.all(Array.from({ length: requestCount }, () => (
      this.app.client.api('/!api/test/time', {}, { bypassCache: true, cacheTtlMs: 0, dedupe: false, priority: 'high' })
    )));
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    return { count: requestCount, elapsedMs: Math.round(elapsedMs), perRequestMs: Math.round((elapsedMs / requestCount) * 100) / 100, results };
  }

  apiMetrics() {
    const stores = Object.values(this.app.stores).filter((store) => typeof store.metrics === 'function').map((store) => store.metrics());
    return { api: this.app.client.apiMetrics(), stores };
  }
}

ApiManagementService.CHANNEL_FIELDS = CHANNEL_FIELDS;
ApiManagementService.ROLE_POWER_FIELDS = ROLE_POWER_FIELDS;
ApiManagementService.ROLE_PRESETS = ROLE_PRESETS;
ApiManagementService.normalizeToggle = normalizeToggle;
ApiManagementService.normalizeList = normalizeList;
ApiManagementService.displayName = displayName;
ApiManagementService.safePreview = safePreview;
module.exports = ApiManagementService;
