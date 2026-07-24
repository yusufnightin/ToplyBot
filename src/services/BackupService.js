const crypto = require('node:crypto');

const ARRAY_STORES = [
  'tickets', 'registrations', 'sanctions', 'bans', 'tempRoles', 'giveaways', 'polls',
  'rolePanels', 'ticketPanels', 'automations', 'webhooks', 'feeds', 'statistics',
  'interactions', 'commandMenus', 'transfers'
];

const OBJECT_STORES = ['warnings', 'levels', 'customCommands', 'embeds'];

function groupMatches(item, groupId) {
  return item && typeof item === 'object' && String(item.groupId ?? item.group_id ?? '') === String(groupId);
}

function extractObjectScope(value, groupId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const key = String(groupId);
  const result = {};
  if (Object.prototype.hasOwnProperty.call(value, key)) result[key] = structuredClone(value[key]);
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey.startsWith(`${key}:`) || groupMatches(entryValue, groupId)) {
      result[entryKey] = structuredClone(entryValue);
    }
  }
  return result;
}

function replaceObjectScope(current, groupId, snapshot) {
  const next = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const key = String(groupId);
  for (const entryKey of Object.keys(next)) {
    if (entryKey === key || entryKey.startsWith(`${key}:`) || groupMatches(next[entryKey], groupId)) delete next[entryKey];
  }
  Object.assign(next, structuredClone(snapshot || {}));
  return next;
}

class BackupService {
  constructor({ app, maxPerGroup = 20 }) {
    this.app = app;
    this.maxPerGroup = Math.max(3, Number(maxPerGroup) || 20);
  }

  async snapshotPayload(groupId) {
    const payload = {
      settings: await this.app.services.settings.get(groupId),
      arrays: {},
      objects: {}
    };
    for (const name of ARRAY_STORES) {
      const store = this.app.stores[name];
      if (!store) continue;
      const value = await store.read();
      payload.arrays[name] = Array.isArray(value) ? value.filter((item) => groupMatches(item, groupId)) : [];
    }
    for (const name of OBJECT_STORES) {
      const store = this.app.stores[name];
      if (!store) continue;
      payload.objects[name] = extractObjectScope(await store.read(), groupId);
    }
    return payload;
  }

  async create(groupId, { actorUserId = null, reason = 'manual', label = '' } = {}) {
    const numericGroupId = Number(groupId);
    const payload = await this.snapshotPayload(numericGroupId);
    const createdAt = new Date().toISOString();
    const id = `${numericGroupId}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const backup = {
      id,
      groupId: numericGroupId,
      actorUserId: Number(actorUserId) || null,
      reason: String(reason || 'manual').slice(0, 80),
      label: String(label || '').slice(0, 100),
      createdAt,
      version: 1,
      payload
    };
    await this.app.stores.backups.update((items) => {
      items.push(backup);
      const groupBackups = items
        .filter((item) => String(item.groupId) === String(numericGroupId))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      const keep = new Set(groupBackups.slice(0, this.maxPerGroup).map((item) => item.id));
      return items.filter((item) => String(item.groupId) !== String(numericGroupId) || keep.has(item.id));
    });
    await this.app.services.audit?.write?.('backup.create', {
      actorUserId: backup.actorUserId,
      backupId: id,
      reason: backup.reason,
      label: backup.label
    }, { groupId: numericGroupId, notify: false });
    return backup;
  }

  async list(groupId) {
    return (await this.app.stores.backups.read())
      .filter((item) => String(item.groupId) === String(groupId))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async get(groupId, id) {
    return (await this.list(groupId)).find((item) => String(item.id) === String(id)) || null;
  }

  async restore(groupId, id, { actorUserId = null, createSafetyBackup = true } = {}) {
    const backup = await this.get(groupId, id);
    if (!backup) throw new Error('Yedek bulunamadı.');
    if (createSafetyBackup) {
      await this.create(groupId, {
        actorUserId,
        reason: 'pre-restore',
        label: `Geri yükleme öncesi: ${id}`
      });
    }

    await this.app.services.settings.replace(groupId, structuredClone(backup.payload.settings));
    for (const [name, scoped] of Object.entries(backup.payload.arrays || {})) {
      const store = this.app.stores[name];
      if (!store) continue;
      await store.update((current) => [
        ...(Array.isArray(current) ? current.filter((item) => !groupMatches(item, groupId)) : []),
        ...structuredClone(scoped)
      ]);
    }
    for (const [name, scoped] of Object.entries(backup.payload.objects || {})) {
      const store = this.app.stores[name];
      if (!store) continue;
      await store.update((current) => replaceObjectScope(current, groupId, scoped));
    }
    this.app.services.channels?.invalidate?.(groupId);
    await this.app.services.audit?.write?.('backup.restore', {
      actorUserId: Number(actorUserId) || null,
      backupId: id
    }, { groupId, notify: false });
    return backup;
  }
}

BackupService.ARRAY_STORES = ARRAY_STORES;
BackupService.OBJECT_STORES = OBJECT_STORES;
BackupService.extractObjectScope = extractObjectScope;
BackupService.replaceObjectScope = replaceObjectScope;
module.exports = BackupService;
