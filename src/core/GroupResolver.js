class GroupResolver {
  constructor({ defaultGroupId = null, channelGroups = {} } = {}) {
    this.defaultGroupId = this.normalizeId(defaultGroupId);
    this.channelGroups = new Map(
      Object.entries(channelGroups || {}).map(([channelId, groupId]) => [String(channelId), this.normalizeId(groupId)])
    );
  }

  normalizeId(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isInteger(numeric) ? numeric : String(value);
  }

  resolve(message) {
    const direct = this.normalizeId(message?.group_id);
    if (direct !== null) return direct;
    const channelId = message?.channel_id;
    if (channelId !== null && channelId !== undefined) {
      const mapped = this.channelGroups.get(String(channelId));
      if (mapped !== undefined && mapped !== null) return mapped;
    }
    return this.defaultGroupId;
  }
}

module.exports = GroupResolver;
