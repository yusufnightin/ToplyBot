const { renderTemplate } = require('../utils/templates');

function normalize(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/\s+/g, '-');
}

function nextId(items) {
  return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

class InteractionService {
  constructor({ store, app }) {
    this.store = store;
    this.app = app;
    this.cooldowns = new Map();
    this.locks = new Set();
  }

  async register({ postId, groupId, channelId, embedName = null, actions = [], createdBy = null, options = {} }) {
    const normalizedPostId = Number(postId);
    if (!Number.isInteger(normalizedPostId)) throw new TypeError('Etkileşim kaydı için geçerli post ID gerekli.');
    if (!Array.isArray(actions) || actions.length === 0) throw new TypeError('En az bir etkileşim eylemi gerekli.');

    let saved;
    await this.store.update((items) => {
      const existing = items.find((item) => Number(item.postId) === normalizedPostId);
      const value = {
        id: existing?.id || nextId(items),
        postId: normalizedPostId,
        groupId,
        channelId,
        embedName,
        active: options.active !== false,
        expiresAt: options.expiresAt || null,
        maxUses: Number.isInteger(Number(options.maxUses)) ? Math.max(0, Number(options.maxUses)) : 0,
        uses: existing?.uses || 0,
        oneUsePerUser: Boolean(options.oneUsePerUser),
        usedBy: Array.isArray(existing?.usedBy) ? existing.usedBy : [],
        createdBy: createdBy === null ? null : Number(createdBy),
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        actions: actions.map((action, index) => this.normalizeAction(action, index))
      };

      if (existing) Object.assign(existing, value);
      else items.push(value);
      saved = structuredClone(value);
      return items;
    });
    return saved;
  }

  normalizeAction(action, index = 0) {
    const id = normalize(action?.id || action?.label || `action-${index + 1}`);
    const type = String(action?.type || 'reply').toLowerCase();
    const allowedTypes = new Set(['command', 'reply', 'dm', 'role_add', 'role_remove', 'role_toggle', 'link']);
    if (!id) throw new TypeError('Etkileşim eylemi için ID gerekli.');
    if (!allowedTypes.has(type)) throw new TypeError(`Desteklenmeyen etkileşim tipi: ${type}`);
    const requiredPermission = String(action?.requiredPermission || 'member').toLowerCase();
    if (!['member', 'moderator', 'admin', 'owner'].includes(requiredPermission)) {
      throw new TypeError(`Desteklenmeyen etkileşim yetkisi: ${requiredPermission}`);
    }
    return {
      id,
      label: String(action?.label || id),
      type,
      target: String(action?.target ?? ''),
      style: String(action?.style || 'primary'),
      requiredPermission,
      cooldownMs: Math.max(0, Number(action?.cooldownMs) || 1500),
      disabled: Boolean(action?.disabled)
    };
  }

  async list(groupId) {
    const items = await this.store.read();
    return items.filter((item) => String(item.groupId) === String(groupId));
  }

  async getByPostId(postId) {
    const items = await this.store.read();
    return items.find((item) => Number(item.postId) === Number(postId)) || null;
  }

  async setActive(postId, active) {
    let changed = null;
    await this.store.update((items) => {
      const item = items.find((entry) => Number(entry.postId) === Number(postId));
      if (item) {
        item.active = Boolean(active);
        item.updatedAt = new Date().toISOString();
        changed = structuredClone(item);
      }
      return items;
    });
    return changed;
  }

  extractActionId(event, record) {
    const form = event?.message?.form && typeof event.message.form === 'object' ? event.message.form : {};
    // Güncel Topluyo istemcisi tıklanan düğmenin `value` alanını
    // message.submit içinde gönderebiliyor. Aynı isimli düğmeler nedeniyle
    // form alanı son düğmenin metniyle ezilebildiğinden submit önce denenir.
    // submit etiket olarak gelirse de aşağıdaki eşleşme action.label üzerinden
    // çalışmaya devam eder.
    const candidates = [
      event?.message?.submit,
      form.action_id,
      form.custom_id,
      form.button_id,
      form.action,
      form.value
    ].map(normalize).filter(Boolean);

    for (const candidate of candidates) {
      const action = record.actions.find((item) => normalize(item.id) === candidate || normalize(item.label) === candidate);
      if (action) return action;
    }
    return record.actions.length === 1 ? record.actions[0] : null;
  }

  variables(event, record, action) {
    return {
      userId: Number(event.user_id),
      groupId: record.groupId,
      channelId: record.channelId,
      postId: record.postId,
      actionId: action.id,
      actionLabel: action.label,
      submit: event?.message?.submit || '',
      form: event?.message?.form || {}
    };
  }

  async reply(record, text) {
    if (record.channelId !== undefined && record.channelId !== null && record.channelId !== '') {
      return this.app.client.sendPost(record.channelId, text);
    }
    return null;
  }

  async executeAction(event, record, action) {
    const userId = Number(event.user_id);
    const variables = this.variables(event, record, action);
    const target = renderTemplate(action.target, variables);

    switch (action.type) {
      case 'command': {
        const content = target.startsWith(this.app.config.prefix) ? target : `${this.app.config.prefix}${target}`;
        return this.app.router.handle({
          action: 'post/add',
          message: content,
          user_id: userId,
          channel_id: record.channelId,
          group_id: record.groupId,
          interaction: { post_id: record.postId, action_id: action.id }
        }, this.app);
      }
      case 'reply':
        return this.reply(record, target || `#${userId} işlemin tamamlandı.`);
      case 'dm':
        return this.app.client.sendDirectMessage(userId, target || 'İşlemin tamamlandı.');
      case 'role_add': {
        const roleId = Number(target);
        if (!Number.isInteger(roleId)) throw new Error('Rol verme eyleminde geçerli rol ID bulunamadı.');
        await this.app.services.roles.addMemberRoles(record.groupId, userId, [roleId]);
        return this.reply(record, `✅ Kullanıcı #${userId} için rol #${roleId} verildi.`);
      }
      case 'role_remove': {
        const roleId = Number(target);
        if (!Number.isInteger(roleId)) throw new Error('Rol kaldırma eyleminde geçerli rol ID bulunamadı.');
        await this.app.services.roles.removeMemberRoles(record.groupId, userId, [roleId]);
        return this.reply(record, `✅ Kullanıcı #${userId} üzerinden rol #${roleId} kaldırıldı.`);
      }
      case 'role_toggle': {
        const roleId = Number(target);
        if (!Number.isInteger(roleId)) throw new Error('Rol değiştirme eyleminde geçerli rol ID bulunamadı.');
        const current = await this.app.services.roles.memberRoleIds(record.groupId, userId);
        if (current.includes(roleId)) {
          await this.app.services.roles.removeMemberRoles(record.groupId, userId, [roleId]);
          return this.reply(record, `➖ Kullanıcı #${userId} üzerinden rol #${roleId} kaldırıldı.`);
        }
        await this.app.services.roles.addMemberRoles(record.groupId, userId, [roleId]);
        return this.reply(record, `➕ Kullanıcı #${userId} için rol #${roleId} verildi.`);
      }
      case 'link':
        return this.app.client.sendDirectMessage(userId, `🔗 ${action.label}: ${target}`);
      default:
        throw new Error(`Bilinmeyen etkileşim tipi: ${action.type}`);
    }
  }

  async handle(event) {
    if (event?.action !== 'post/bumote' || !event.message?.form) return false;
    const record = await this.getByPostId(event.post_id);
    if (!record) return false;

    if (!record.active) return true;
    if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) return true;
    if (record.maxUses > 0 && record.uses >= record.maxUses) return true;

    const action = this.extractActionId(event, record);
    if (!action || action.disabled) return true;

    const userId = Number(event.user_id);
    if (!this.app.permissionManager.has(userId, action.requiredPermission)) {
      await this.reply(record, `⛔ Kullanıcı #${userId}, bu işlem için ${action.requiredPermission} yetkisi gerekiyor.`);
      return true;
    }

    if (record.oneUsePerUser && record.usedBy.includes(userId)) {
      await this.reply(record, `ℹ️ Kullanıcı #${userId}, bu etkileşimi daha önce kullandın.`);
      return true;
    }

    const cooldownKey = `${record.postId}:${action.id}:${userId}`;
    const availableAt = this.cooldowns.get(cooldownKey) || 0;
    if (availableAt > Date.now()) return true;

    const lockKey = cooldownKey;
    if (this.locks.has(lockKey)) return true;
    this.locks.add(lockKey);

    try {
      await this.executeAction(event, record, action);
      this.cooldowns.set(cooldownKey, Date.now() + action.cooldownMs);
      await this.store.update((items) => {
        const item = items.find((entry) => Number(entry.postId) === Number(record.postId));
        if (!item) return items;
        item.uses = (Number(item.uses) || 0) + 1;
        if (item.oneUsePerUser && !item.usedBy.includes(userId)) item.usedBy.push(userId);
        item.lastUsedAt = new Date().toISOString();
        item.lastUsedBy = userId;
        return items;
      });
      await this.app.services.audit?.write('interaction.use', {
        actorUserId: userId,
        postId: record.postId,
        actionId: action.id,
        actionType: action.type
      }, { groupId: record.groupId });
    } catch (error) {
      this.app.logger?.error('Bumote etkileşimi çalıştırılamadı.', error);
      await this.reply(record, `⚠️ Kullanıcı #${userId}, işlem gerçekleştirilemedi.`).catch(() => {});
    } finally {
      this.locks.delete(lockKey);
    }
    return true;
  }
}

module.exports = InteractionService;
module.exports.normalizeInteractionValue = normalize;
