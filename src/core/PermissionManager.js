const PERMISSION_LEVELS = Object.freeze({
  member: 0,
  moderator: 10,
  admin: 20,
  owner: 30
});

class PermissionManager {
  constructor({ ownerUserIds = [], adminUserIds = [], moderatorUserIds = [] } = {}) {
    this.owners = new Set(ownerUserIds.map(Number));
    this.admins = new Set(adminUserIds.map(Number));
    this.moderators = new Set(moderatorUserIds.map(Number));
  }

  level(userId) {
    const id = Number(userId);
    if (this.owners.has(id)) return PERMISSION_LEVELS.owner;
    if (this.admins.has(id)) return PERMISSION_LEVELS.admin;
    if (this.moderators.has(id)) return PERMISSION_LEVELS.moderator;
    return PERMISSION_LEVELS.member;
  }

  name(userId) {
    const level = this.level(userId);
    return Object.entries(PERMISSION_LEVELS).find(([, value]) => value === level)?.[0] || 'member';
  }

  requiredLevel(permission = 'member') {
    if (typeof permission === 'number') return permission;
    const level = PERMISSION_LEVELS[String(permission).toLocaleLowerCase('tr-TR')];
    if (level === undefined) throw new Error(`Bilinmeyen yetki seviyesi: ${permission}`);
    return level;
  }

  has(userId, requiredPermission = 'member') {
    return this.level(userId) >= this.requiredLevel(requiredPermission);
  }

  isStaff(userId) {
    return this.level(userId) >= PERMISSION_LEVELS.moderator;
  }
}

PermissionManager.LEVELS = PERMISSION_LEVELS;
module.exports = PermissionManager;
