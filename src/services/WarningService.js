class WarningService {
  constructor({ store }) {
    this.store = store;
  }

  key(groupId, userId) {
    return `${groupId}:${userId}`;
  }

  async list(groupId, userId) {
    const all = await this.store.read();
    return all[this.key(groupId, userId)] || [];
  }

  async add(groupId, userId, { reason, moderatorUserId = null, source = 'manual' }) {
    let warning;
    await this.store.update((all) => {
      const key = this.key(groupId, userId);
      const warnings = all[key] || [];
      warning = {
        id: warnings.reduce((highest, item) => Math.max(highest, Number(item.id) || 0), 0) + 1,
        reason: String(reason || 'Sebep belirtilmedi.'),
        moderatorUserId,
        source,
        createdAt: new Date().toISOString()
      };
      warnings.push(warning);
      all[key] = warnings;
      return all;
    });
    return warning;
  }

  async remove(groupId, userId, warningId = 'all') {
    let removed = 0;
    await this.store.update((all) => {
      const key = this.key(groupId, userId);
      const warnings = all[key] || [];
      if (warningId === 'all') {
        removed = warnings.length;
        delete all[key];
        return all;
      }
      const numericId = Number(warningId);
      const next = warnings.filter((warning) => Number(warning.id) !== numericId);
      removed = warnings.length - next.length;
      if (next.length === 0) delete all[key];
      else all[key] = next;
      return all;
    });
    return removed;
  }
}

module.exports = WarningService;
