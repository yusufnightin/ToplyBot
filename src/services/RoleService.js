const { findArray, findObject, parseMaybeJson, toIdArray, unwrapApiResult } = require('../utils/api');

function normalizeRoleName(value) {
  return String(value ?? '')
    .trim()
    .normalize('NFKC')
    .toLocaleLowerCase('tr-TR')
    .replace(/[’'`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function roleOrder(role) {
  const value = Number(role?.order ?? role?.sort ?? role?.position ?? role?.row ?? role?.role_order ?? role?.sequence ?? role?.index);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function rolePower(role) {
  const keys = ['power_group', 'power_role', 'power_channel', 'power_post', 'power_member', 'power_room', 'power_team', 'power_mention'];
  return keys.reduce((sum, key) => sum + (Number(role?.[key]) || 0), 0);
}

function extractRoleObject(value) {
  const root = unwrapApiResult(parseMaybeJson(value));
  if (!root || typeof root !== 'object' || Array.isArray(root)) return null;
  for (const key of ['role', 'item', 'info']) {
    const candidate = unwrapApiResult(root[key]);
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) return candidate;
  }
  return root;
}

function normalizeRole(value, fallbackId = null) {
  const role = extractRoleObject(value);
  if (!role) return null;
  const id = Number(role.id ?? role.role_id ?? role.roleId ?? fallbackId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const name = String(role.name ?? role.title ?? role.nick ?? `Rol ${id}`).trim();
  return {
    ...role,
    id,
    name,
    color: String(role.color ?? role.hex ?? '#999999'),
    order: roleOrder(role),
    power: rolePower(role),
    normalizedName: normalizeRoleName(name),
    raw: role
  };
}

function collectRoles(value, output = [], seen = new Set(), depth = 0, fallbackId = null) {
  const parsed = parseMaybeJson(value);
  if (depth > 8 || parsed === null || parsed === undefined || typeof parsed !== 'object' || seen.has(parsed)) return output;
  seen.add(parsed);
  const normalized = normalizeRole(parsed, fallbackId);
  if (normalized) output.push(normalized);
  if (Array.isArray(parsed)) parsed.forEach((child) => collectRoles(child, output, seen, depth + 1));
  else for (const [key, child] of Object.entries(parsed)) collectRoles(child, output, seen, depth + 1, /^\d+$/.test(key) ? Number(key) : null);
  return output;
}

class RoleService {
  constructor({ client, logger, cacheTtlMs = 120000 }) {
    this.client = client;
    this.logger = logger;
    this.cacheTtlMs = Math.max(5000, Number(cacheTtlMs) || 120000);
    this.cache = new Map();
  }

  async list(groupId, { force = false } = {}) {
    const key = String(Number(groupId));
    const cached = this.cache.get(key);
    if (!force && cached && cached.expiresAt > Date.now()) return cached.roles;

    const result = await this.client.api('/!api/role/list', { group_id: groupId }, force ? { bypassCache: true, cacheTtlMs: 0 } : { cacheTtlMs: 10000 });
    let roles = findArray(result, ['roles', 'role_list', 'list', 'items'])
      .map((role) => normalizeRole(role))
      .filter(Boolean);
    if (!roles.length) roles = collectRoles(result);

    const unique = new Map();
    for (const role of roles) if (!unique.has(role.id)) unique.set(role.id, role);
    const normalized = [...unique.values()].sort((a, b) => {
      const diff = a.order - b.order;
      if (Number.isFinite(diff) && diff !== 0) return diff;
      return a.name.localeCompare(b.name, 'tr');
    });
    this.cache.set(key, { expiresAt: Date.now() + this.cacheTtlMs, roles: normalized });
    return normalized;
  }

  invalidate(groupId) {
    if (groupId === undefined || groupId === null) this.cache.clear();
    else this.cache.delete(String(Number(groupId)));
  }

  cached(groupId) {
    return this.cache.get(String(Number(groupId)))?.roles || [];
  }

  async getMember(groupId, userId) {
    const result = await this.client.api('/!api/member/get', {
      group_id: groupId,
      user_id: Number(userId)
    });
    return findObject(result, ['member', 'user']) || {};
  }

  extractRoleIds(member) {
    const candidates = [member?.role_ids, member?.roles, member?.roleIds, member?.role_id];
    for (const candidate of candidates) {
      const ids = toIdArray(candidate);
      if (ids.length > 0) return ids;
    }
    return [];
  }

  async memberRoleIds(groupId, userId) {
    const member = await this.getMember(groupId, userId);
    return this.extractRoleIds(member);
  }

  async setMemberRoles(groupId, userId, roleIds) {
    const normalized = [...new Set(roleIds.map(Number).filter(Number.isInteger))];
    await this.client.api('/!api/member/role/set', {
      group_id: groupId,
      user_id: Number(userId),
      role_ids: normalized.join(',')
    });
    return normalized;
  }

  async addMemberRoles(groupId, userId, roleIds) {
    const current = await this.memberRoleIds(groupId, userId);
    const next = [...new Set([...current, ...roleIds.map(Number).filter(Number.isInteger)])];
    await this.setMemberRoles(groupId, userId, next);
    return next;
  }

  async removeMemberRoles(groupId, userId, roleIds) {
    const remove = new Set(roleIds.map(Number).filter(Number.isInteger));
    const current = await this.memberRoleIds(groupId, userId);
    const next = current.filter((roleId) => !remove.has(roleId));
    await this.setMemberRoles(groupId, userId, next);
    return next;
  }

  async applyAutorole(groupId, userId, settings) {
    const roleIds = settings?.autorole?.enabled ? settings.autorole.roleIds : [];
    if (!Array.isArray(roleIds) || roleIds.length === 0) return [];
    const next = await this.addMemberRoles(groupId, userId, roleIds);
    this.logger?.info('Otorol uygulandı.', { groupId, userId, roleIds });
    return next;
  }

  async roleNameMap(groupId) {
    const roles = await this.list(groupId);
    return new Map(roles.map((role) => [Number(role.id), role.name || `Rol ${role.id}`]));
  }
}

RoleService.normalizeRoleName = normalizeRoleName;
RoleService.normalizeRole = normalizeRole;
RoleService.collectRoles = collectRoles;
module.exports = RoleService;
