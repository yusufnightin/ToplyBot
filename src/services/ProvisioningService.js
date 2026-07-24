const { extractCreatedEntityId } = require('../utils/api');
const { assertApiSuccess } = require('../utils/apiResult');
const { poll, sleep, isLikelyTransientError } = require('../utils/retry');
const { safePreview } = require('../utils/preview');
const ChannelResolverService = require('./ChannelResolverService');
const RoleService = require('./RoleService');

function exactChannelMatch(channel, { nick, title }) {
  const targets = [nick, title]
    .map(ChannelResolverService.normalizeChannelName)
    .filter(Boolean);
  return targets.some((target) => (channel.aliases || []).includes(target));
}

function exactRoleMatch(role, { name }) {
  return role.normalizedName === RoleService.normalizeRoleName(name);
}

class ProvisioningService {
  constructor({ app }) {
    this.app = app;
    this.groupLocks = new Map();
  }

  async withGroupLock(groupId, operation) {
    const key = String(Number(groupId));
    const previous = this.groupLocks.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const chained = previous.then(() => gate, () => gate);
    this.groupLocks.set(key, chained);
    await previous.catch(() => {});
    try {
      return await operation();
    } finally {
      release();
      if (this.groupLocks.get(key) === chained) this.groupLocks.delete(key);
    }
  }

  async findChannel(groupId, spec, { force = true } = {}) {
    const channels = await this.app.services.channels.list(groupId, { force });
    return channels.find((channel) => exactChannelMatch(channel, spec)) || null;
  }

  async findChannelById(groupId, channelId, spec = null) {
    const id = Number(channelId);
    if (!Number.isInteger(id) || id <= 0 || typeof this.app.client.getChannel !== 'function') return null;
    try {
      const result = await this.app.client.getChannel(id);
      assertApiSuccess(result, `Kanal #${id} doğrulama`);
      const candidates = ChannelResolverService.collectChannelLikeObjects(result);
      const channel = candidates.find((item) => Number(item.id) === id)
        || ChannelResolverService.normalizeChannel(result, id);
      if (!channel) return null;
      const rawGroupId = Number(
        channel.raw?.group_id ?? channel.raw?.groupId ??
        channel.raw?.server_id ?? channel.raw?.serverId
      );
      if (Number.isInteger(rawGroupId) && rawGroupId > 0 && rawGroupId !== Number(groupId)) return null;
      if (spec && !exactChannelMatch(channel, spec)) return null;
      return channel;
    } catch {
      return null;
    }
  }

  async findRole(groupId, spec) {
    const roles = await this.app.services.roles.list(groupId);
    return roles.find((role) => exactRoleMatch(role, spec)) || null;
  }

  async findRoleById(groupId, roleId, spec = null) {
    const id = Number(roleId);
    if (!Number.isInteger(id) || id <= 0 || typeof this.app.client.getRole !== 'function') return null;
    try {
      const result = await this.app.client.getRole(id);
      assertApiSuccess(result, `Rol #${id} doğrulama`);
      const candidates = RoleService.collectRoles(result);
      const role = candidates.find((item) => Number(item.id) === id)
        || RoleService.normalizeRole(result, id);
      if (!role) return null;
      const rawGroupId = Number(role.raw?.group_id ?? role.raw?.groupId);
      if (Number.isInteger(rawGroupId) && rawGroupId > 0 && rawGroupId !== Number(groupId)) return null;
      if (spec && !exactRoleMatch(role, spec)) return null;
      return role;
    } catch {
      return null;
    }
  }

  async recoverChannel(groupId, spec, { attempts = 10 } = {}) {
    let found = null;
    await poll(
      async () => {
        this.app.services.channels.invalidate(groupId);
        try { return await this.findChannel(groupId, spec, { force: true }); }
        catch { return null; }
      },
      (value) => {
        found = value || found;
        return Boolean(value);
      },
      {
        attempts,
        intervalMs: 420,
        factor: 1.28,
        maxIntervalMs: 1700
      }
    );
    if (found) return found;

    // channel/list gecikirse nick tabanlı uçtan son bir doğrulama yap.
    for (const reference of [spec.nick, spec.title].filter(Boolean)) {
      try {
        const direct = await this.app.services.channels.resolveViaShowInfo(groupId, reference);
        if (direct && exactChannelMatch(direct, spec)) return direct;
      } catch {}
    }
    return null;
  }

  async recoverRole(groupId, spec, { attempts = 9 } = {}) {
    let found = null;
    await poll(
      async () => {
        this.app.services.roles.invalidate?.(groupId);
        try { return await this.findRole(groupId, spec); }
        catch { return null; }
      },
      (value) => {
        found = value || found;
        return Boolean(value);
      },
      { attempts, intervalMs: 400, factor: 1.25, maxIntervalMs: 1500 }
    );
    return found;
  }

  async ensureChannel({
    groupId,
    spec,
    payload,
    knownId = null,
    existingEntity = null,
    skipInitialLookup = false,
    createAttempts = 3
  }) {
    const existing = existingEntity || (skipInitialLookup
      ? null
      : await this.findChannel(groupId, spec, { force: true }).catch(() => null));
    if (existing) return { id: existing.id, entity: existing, created: false, recovered: false, response: null };

    // Özel kanallar channel/list cevabında görünmeyebilir. Önce önceki kurulumda
    // kaydedilmiş ID'yi doğrudan doğrula; aynı kanalı yeniden oluşturmaya çalışma.
    const persisted = await this.findChannelById(groupId, knownId, spec);
    if (persisted) {
      return {
        id: persisted.id,
        entity: persisted,
        created: false,
        recovered: true,
        persisted: true,
        response: null
      };
    }

    let lastError = null;
    let lastResponse = null;
    for (let attempt = 1; attempt <= createAttempts; attempt += 1) {
      try {
        lastResponse = await this.app.client.createChannel(payload);
        assertApiSuccess(lastResponse, `“${spec.title || spec.nick}” kanalını oluşturma`);
        const directId = extractCreatedEntityId(lastResponse, ['channel_id', 'channelId', 'id']);
        if (Number.isInteger(directId) && directId > 0) {
          this.app.services.channels.invalidate(groupId);
          return { id: directId, entity: null, created: true, recovered: false, response: lastResponse };
        }

        const recovered = await this.recoverChannel(groupId, spec);
        if (recovered) {
          this.app.logger?.info('Kanal oluşturma cevabında ID yoktu; kanal listeden doğrulandı.', {
            groupId: Number(groupId), channelId: recovered.id, nick: spec.nick, attempt
          });
          return { id: recovered.id, entity: recovered, created: true, recovered: true, response: lastResponse };
        }

        throw new Error(`API başarılı göründü ancak kanal ID alınamadı ve kanal listesinde doğrulanamadı. Cevap: ${safePreview(lastResponse)}`);
      } catch (error) {
        lastError = error;
        const recovered = await this.recoverChannel(groupId, spec, { attempts: 5 }).catch(() => null);
        if (recovered) {
          this.app.logger?.warn('Kanal oluşturma çağrısı hata verdi ancak kanal sunucuda bulundu; kurulum devam ediyor.', {
            groupId: Number(groupId), channelId: recovered.id, nick: spec.nick, message: error.message
          });
          return { id: recovered.id, entity: recovered, created: true, recovered: true, response: lastResponse, warning: error.message };
        }
        if (attempt >= createAttempts || !isLikelyTransientError(error)) break;
        const delayMs = 500 * attempt;
        this.app.logger?.warn('Kanal oluşturma geçici hatası yeniden denenecek.', {
          groupId: Number(groupId), nick: spec.nick, attempt, delayMs, message: error.message
        });
        await sleep(delayMs);
      }
    }

    const wrapped = new Error(`“${spec.title || spec.nick}” kanalı oluşturulamadı: ${lastError?.message || 'bilinmeyen hata'}`);
    wrapped.cause = lastError;
    wrapped.apiResponse = lastResponse;
    throw wrapped;
  }

  async ensureRole({
    groupId,
    spec,
    payload,
    knownId = null,
    existingEntity = null,
    skipInitialLookup = false,
    createAttempts = 3
  }) {
    const existing = existingEntity || (skipInitialLookup
      ? null
      : await this.findRole(groupId, spec).catch(() => null));
    if (existing) return { id: existing.id, entity: existing, created: false, recovered: false, response: null };

    const persisted = await this.findRoleById(groupId, knownId, spec);
    if (persisted) {
      return {
        id: persisted.id,
        entity: persisted,
        created: false,
        recovered: true,
        persisted: true,
        response: null
      };
    }

    let lastError = null;
    let lastResponse = null;
    for (let attempt = 1; attempt <= createAttempts; attempt += 1) {
      try {
        lastResponse = await this.app.client.createRole(payload);
        assertApiSuccess(lastResponse, `“${spec.name}” rolünü oluşturma`);
        const directId = extractCreatedEntityId(lastResponse, ['role_id', 'roleId', 'id']);
        if (Number.isInteger(directId) && directId > 0) {
          this.app.services.roles.invalidate?.(groupId);
          return { id: directId, entity: null, created: true, recovered: false, response: lastResponse };
        }
        const recovered = await this.recoverRole(groupId, spec);
        if (recovered) {
          this.app.logger?.info('Rol oluşturma cevabında ID yoktu; rol listeden doğrulandı.', {
            groupId: Number(groupId), roleId: recovered.id, name: spec.name, attempt
          });
          return { id: recovered.id, entity: recovered, created: true, recovered: true, response: lastResponse };
        }
        throw new Error(`API başarılı göründü ancak rol ID alınamadı ve rol listesinde doğrulanamadı. Cevap: ${safePreview(lastResponse)}`);
      } catch (error) {
        lastError = error;
        const recovered = await this.recoverRole(groupId, spec, { attempts: 5 }).catch(() => null);
        if (recovered) return { id: recovered.id, entity: recovered, created: true, recovered: true, response: lastResponse, warning: error.message };
        if (attempt >= createAttempts || !isLikelyTransientError(error)) break;
        await sleep(500 * attempt);
      }
    }
    const wrapped = new Error(`“${spec.name}” rolü oluşturulamadı: ${lastError?.message || 'bilinmeyen hata'}`);
    wrapped.cause = lastError;
    wrapped.apiResponse = lastResponse;
    throw wrapped;
  }
}

ProvisioningService.exactChannelMatch = exactChannelMatch;
ProvisioningService.exactRoleMatch = exactRoleMatch;
module.exports = ProvisioningService;
