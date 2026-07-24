const SupportTemplateService = require('./SupportTemplateService');

function scoreFromIssues(issues) {
  const severityWeight = { error: 18, warning: 7, info: 2 };
  const deduction = issues.reduce((sum, item) => sum + (severityWeight[item.severity] || 5), 0);
  return Math.max(0, 100 - deduction);
}

class SystemHealthService {
  constructor({ app }) {
    this.app = app;
  }

  async inspect(groupId) {
    const numericGroupId = Number(groupId);
    const issues = [];
    const checks = {};

    const check = async (name, operation) => {
      try {
        const value = await operation();
        checks[name] = { ok: true, value };
        return value;
      } catch (error) {
        checks[name] = { ok: false, error: error.message };
        issues.push({ severity: 'error', code: name, message: error.message });
        return null;
      }
    };

    const settings = await check('settings', () => this.app.services.settings.get(numericGroupId));
    const channels = await check('channels', () => this.app.services.channels.list(numericGroupId, { force: true })) || [];
    const roles = await check('roles', () => this.app.services.roles.list(numericGroupId)) || [];
    const botUserId = await check('bot-user', () => this.app.client.getCurrentUserId());
    const templateState = await check('template-state', () => this.app.services.supportTemplate.readState(numericGroupId));

    if (settings) {
      const visibleChannelIds = new Set(channels.map((channel) => Number(channel.id)).filter(Number.isInteger));
      const configuredChannelIds = [...new Set(
        Object.values(settings.channels || {}).map(Number).filter((id) => Number.isInteger(id) && id > 0)
      )];
      const directlyResolvedChannels = [];
      for (const channelId of configuredChannelIds) {
        if (visibleChannelIds.has(channelId)) continue;
        const direct = await this.app.services.provisioning.findChannelById(numericGroupId, channelId);
        if (direct) {
          visibleChannelIds.add(channelId);
          directlyResolvedChannels.push(channelId);
        }
      }
      checks['private-channels'] = {
        ok: true,
        value: {
          configured: configuredChannelIds.length,
          resolvedOutsideList: directlyResolvedChannels
        }
      };
      for (const [key, value] of Object.entries(settings.channels || {})) {
        if (!value) continue;
        const exists = visibleChannelIds.has(Number(value));
        if (!exists) issues.push({ severity: 'error', code: `channel:${key}`, message: `${key} kanal ayarı geçersiz: ${value}` });
      }
      if (!settings.welcome?.enabled) issues.push({ severity: 'warning', code: 'welcome-disabled', message: 'Hoş geldin sistemi kapalı.' });
      if (settings.welcome?.enabled && !settings.channels?.welcome) issues.push({ severity: 'error', code: 'welcome-channel', message: 'Hoş geldin kanalı ayarlanmamış.' });
      if (!settings.tickets?.enabled) issues.push({ severity: 'warning', code: 'tickets-disabled', message: 'Ticket sistemi kapalı.' });
      if (settings.tickets?.enabled && !settings.channels?.tickets) issues.push({ severity: 'error', code: 'ticket-channel', message: 'Ticket kanalı ayarlanmamış.' });
      if (settings.autorole?.enabled && !(settings.autorole.roleIds || []).every((id) => roles.some((role) => Number(role.id) === Number(id)))) {
        issues.push({ severity: 'warning', code: 'autorole-stale', message: 'Otorol listesinde sunucuda bulunmayan rol var.' });
      }
      if (settings.moderation?.muteRoleId && !roles.some((role) => Number(role.id) === Number(settings.moderation.muteRoleId))) {
        issues.push({ severity: 'warning', code: 'mute-role-stale', message: 'Susturma rolü sunucuda bulunamadı.' });
      }
    }

    const templateVerification = await check('template-verification', () => this.app.services.supportTemplate.verify(numericGroupId));
    if (templateVerification && !templateVerification.ok) {
      for (const message of templateVerification.issues) {
        issues.push({ severity: 'warning', code: 'template', message });
      }
    }

    const welcomeDiagnostics = await check('welcome-diagnostics', () => this.app.services.welcome.diagnostics(numericGroupId));
    if (welcomeDiagnostics?.last?.status === 'failed') {
      issues.push({ severity: 'warning', code: 'welcome-last-failed', message: `Son hoş geldin gönderimi başarısız: ${welcomeDiagnostics.last.reason || 'bilinmiyor'}` });
    }

    const storeNames = Object.keys(this.app.stores);
    const storeResults = [];
    for (const name of storeNames) {
      try {
        const value = await this.app.stores[name].read();
        storeResults.push({ name, ok: true, type: Array.isArray(value) ? 'array' : typeof value });
      } catch (error) {
        storeResults.push({ name, ok: false, error: error.message });
        issues.push({ severity: 'error', code: `store:${name}`, message: `${name} veri deposu okunamadı: ${error.message}` });
      }
    }
    checks.stores = { ok: storeResults.every((item) => item.ok), value: storeResults };

    const score = scoreFromIssues(issues);
    return {
      groupId: numericGroupId,
      checkedAt: new Date().toISOString(),
      score,
      status: score >= 90 ? 'healthy' : score >= 70 ? 'warning' : 'critical',
      botUserId,
      channelCount: templateVerification?.channelCount || channels.length,
      roleCount: roles.length,
      templateState,
      templateVersion: SupportTemplateService.TEMPLATE_VERSION,
      issues,
      checks
    };
  }

  async repair(groupId, { userId, installTemplate = true, sendWelcomeTest = false, progress = null } = {}) {
    await progress?.update?.(10, 'Sistem onarımı için güvenlik yedeği alınıyor');
    const before = await this.app.services.backups.create(groupId, {
      actorUserId: userId,
      reason: 'pre-system-repair',
      label: 'Sistem onarımı öncesi otomatik yedek'
    });
    const actions = [];
    let template = null;

    if (installTemplate && this.app.services.supportTemplate.canInstall(userId)) {
      template = await this.app.services.supportTemplate.repair({ groupId, userId, sendWelcomeTest: false, progress });
      actions.push('Destek şablonu doğrulandı ve eksikler tamamlandı.');
    } else {
      await progress?.update?.(55, 'Hoş geldin sistemi onarılıyor');
      const welcome = await this.app.services.welcome.repair(groupId, { enable: true, sendTest: false, testUserId: userId });
      actions.push(`Hoş geldin kanalı ve bot erişimi onarıldı (#${welcome.channelId}).`);
    }

    if (sendWelcomeTest) {
      await this.app.services.welcome.sendWelcome({ groupId, userId, source: 'system-repair-test' });
      actions.push('Hoş geldin test mesajı gönderildi.');
    }

    await progress?.update?.(94, 'Sistem sağlık kontrolü yapılıyor');
    const after = await this.inspect(groupId);
    await this.app.services.audit?.write?.('system.repair', {
      actorUserId: Number(userId),
      backupId: before.id,
      actions,
      score: after.score
    }, { groupId, notify: false });
    return { backupId: before.id, actions, template, health: after };
  }
}

module.exports = SystemHealthService;
