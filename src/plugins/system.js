const { truncate } = require('../utils/text');

function formatHealth(health, { detailed = false } = {}) {
  const icon = health.status === 'healthy' ? '✅' : health.status === 'warning' ? '⚠️' : '🚨';
  const lines = [
    `${icon} Sistem sağlığı: ${health.score}/100 · ${health.status}`,
    `Sunucu: #${health.groupId} · Bot: #${health.botUserId || '—'}`,
    `Kanallar: ${health.channelCount} · Roller: ${health.roleCount}`,
    `Şablon: v${health.templateVersion} · ${health.templateState?.status || 'kurulmamış'}`,
    `Kontrol: ${health.checkedAt}`
  ];
  if (health.issues.length) {
    lines.push('', 'Bulunan sorunlar:');
    lines.push(...health.issues.slice(0, detailed ? 25 : 10).map((item) => `• [${item.severity}] ${item.message}`));
    if (health.issues.length > (detailed ? 25 : 10)) lines.push(`• +${health.issues.length - (detailed ? 25 : 10)} ek sorun`);
  } else lines.push('', 'Sorun bulunamadı.');
  return truncate(lines.join('\n'), 1800);
}

module.exports = {
  name: 'Sistem Sağlığı, Yedek ve Bakım',
  setup(app) {
    app.services.scheduler.register('integrated-maintenance', async (now) => {
      const groupIds = await app.services.settings.listGroupIds();
      const state = await app.stores.maintenanceState.read();
      for (const groupId of groupIds) {
        const settings = await app.services.settings.get(groupId);
        const groupState = state[String(groupId)] || {};
        const autoBackupHours = Math.max(1, Number(settings.maintenance?.autoBackupHours) || 24);
        const healthHours = Math.max(1, Number(settings.maintenance?.healthCheckHours) || 6);
        const backupDue = !groupState.lastBackupAt || now - Date.parse(groupState.lastBackupAt) >= autoBackupHours * 3600000;
        const healthDue = !groupState.lastHealthAt || now - Date.parse(groupState.lastHealthAt) >= healthHours * 3600000;
        let changed = false;

        if (settings.maintenance?.autoBackupEnabled && backupDue) {
          try {
            const backup = await app.services.backups.create(groupId, { reason: 'scheduled', label: 'Otomatik zamanlanmış yedek' });
            groupState.lastBackupAt = backup.createdAt;
            groupState.lastBackupId = backup.id;
            changed = true;
          } catch (error) {
            app.logger.error('Otomatik yedek oluşturulamadı.', { groupId, message: error.message });
          }
        }

        if (settings.maintenance?.healthAlerts && healthDue) {
          try {
            const health = await app.services.systemHealth.inspect(groupId);
            groupState.lastHealthAt = health.checkedAt;
            groupState.lastHealthScore = health.score;
            changed = true;
            const alertChannel = settings.channels.system || settings.channels.logs;
            const shouldAlert = health.score < 80 && alertChannel
              && (!groupState.lastAlertAt || now - Date.parse(groupState.lastAlertAt) >= healthHours * 3600000);
            if (shouldAlert) {
              await app.client.sendPost(alertChannel, formatHealth(health));
              groupState.lastAlertAt = new Date(now).toISOString();
            }
          } catch (error) {
            app.logger.error('Otomatik sistem sağlığı kontrolü başarısız.', { groupId, message: error.message });
          }
        }

        if (changed) {
          await app.stores.maintenanceState.update((current) => {
            current[String(groupId)] = groupState;
            return current;
          });
        }
      }
    });

    app.router.register({
      name: 'sistemkontrol', aliases: ['saglik', 'sağlık', 'healthcheck'], category: 'Yönetim',
      description: 'Sunucu ayarlarını, kanal/rol bağlantılarını, veri dosyalarını ve şablonu denetler.',
      usage: 'sistemkontrol [detay]', guildOnly: true, requiredPermission: 'admin', cooldownMs: 10000,
      async execute(ctx) {
        const detailed = ['detay', 'ayrıntı', 'ayrinti', 'full'].includes(String(ctx.args[0] || '').toLocaleLowerCase('tr-TR'));
        const health = await ctx.services.systemHealth.inspect(ctx.groupId);
        return ctx.reply(formatHealth(health, { detailed }));
      }
    });

    app.router.register({
      name: 'sistemonar', aliases: ['sistemonarım', 'sistemonarim', 'repairall'], category: 'Yönetim',
      description: 'Yedek alıp destek şablonu, kanallar, roller, erişimler ve hoş geldin sistemini onarır.',
      usage: 'sistemonar [test]', guildOnly: true, requiredPermission: 'owner', cooldownMs: 30000,
      async execute(ctx) {
        const sendTest = ['test', 'dene'].includes(String(ctx.args[0] || '').toLocaleLowerCase('tr-TR'));
        await ctx.reply('🔧 Sistem onarımı başladı. Önce otomatik güvenlik yedeği alınacak.');
        const result = await ctx.services.systemHealth.repair(ctx.groupId, {
          userId: ctx.userId,
          installTemplate: true,
          sendWelcomeTest: sendTest,
          progress: ctx.progress
        });
        return ctx.reply([
          '✅ Sistem onarımı tamamlandı.',
          `Sağlık puanı: ${result.health.score}/100`,
          `Güvenlik yedeği: ${result.backupId}`,
          ...result.actions.map((item) => `• ${item}`),
          result.health.issues.length ? `Kalan uyarılar: ${result.health.issues.map((item) => item.message).join(' | ')}` : 'Kalan sorun yok.'
        ].join('\n'));
      }
    });

    app.router.register({
      name: 'yedek', aliases: ['backup'], category: 'Yönetim',
      description: 'Sunucuya özel bot verilerini yedekler, listeler ve geri yükler.',
      usage: 'yedek <oluştur [etiket]|liste|bilgi id|geri id>', guildOnly: true, requiredPermission: 'admin', cooldownMs: 8000,
      async execute(ctx) {
        const action = String(ctx.args.shift() || 'liste').toLocaleLowerCase('tr-TR');
        if (['oluştur', 'olustur', 'al', 'create'].includes(action)) {
          const backup = await ctx.services.backups.create(ctx.groupId, {
            actorUserId: ctx.userId,
            reason: 'manual',
            label: ctx.args.join(' ').trim()
          });
          return ctx.reply(`✅ Yedek oluşturuldu.\nID: ${backup.id}\nTarih: ${backup.createdAt}\nEtiket: ${backup.label || '—'}`);
        }
        if (['liste', 'list'].includes(action)) {
          const items = (await ctx.services.backups.list(ctx.groupId)).slice(0, 15);
          return ctx.reply(`📦 Sunucu yedekleri:\n${items.map((item, index) => `${index + 1}. ${item.id} · ${item.createdAt} · ${item.reason}${item.label ? ` · ${item.label}` : ''}`).join('\n') || 'Yedek yok.'}`);
        }
        const id = ctx.args[0];
        if (!id) return ctx.reply(`Kullanım: ${ctx.config.prefix}yedek <oluştur [etiket]|liste|bilgi id|geri id>`);
        if (['bilgi', 'info'].includes(action)) {
          const backup = await ctx.services.backups.get(ctx.groupId, id);
          if (!backup) return ctx.reply('Yedek bulunamadı.');
          return ctx.reply(truncate(JSON.stringify({
            id: backup.id,
            groupId: backup.groupId,
            actorUserId: backup.actorUserId,
            reason: backup.reason,
            label: backup.label,
            createdAt: backup.createdAt,
            arrayStores: Object.fromEntries(Object.entries(backup.payload.arrays || {}).map(([key, value]) => [key, value.length])),
            objectStores: Object.fromEntries(Object.entries(backup.payload.objects || {}).map(([key, value]) => [key, Object.keys(value).length]))
          }, null, 2), 1800), 'json');
        }
        if (['geri', 'yükle', 'yukle', 'restore'].includes(action)) {
          if (!ctx.app.permissionManager.has(ctx.userId, 'owner')) return ctx.reply('Yedek geri yükleme yalnızca bot sahibi tarafından yapılabilir.');
          const restored = await ctx.services.backups.restore(ctx.groupId, id, { actorUserId: ctx.userId });
          return ctx.reply(`✅ Yedek geri yüklendi: ${restored.id}\nGeri yükleme öncesi ayrıca güvenlik yedeği oluşturuldu.`);
        }
        return ctx.reply(`Kullanım: ${ctx.config.prefix}yedek <oluştur [etiket]|liste|bilgi id|geri id>`);
      }
    });

    app.router.register({
      name: 'önbellektemizle', aliases: ['onbellektemizle', 'cacheclear'], category: 'Yönetim',
      description: 'Kanal çözümleyici önbelleğini temizleyip sunucu verilerini yeniden yükler.',
      usage: 'önbellektemizle', guildOnly: true, requiredPermission: 'admin', cooldownMs: 5000,
      async execute(ctx) {
        ctx.services.channels.invalidate(ctx.groupId);
        const channels = await ctx.services.channels.prime(ctx.groupId);
        const roles = await ctx.services.roles.list(ctx.groupId);
        return ctx.reply(`✅ Önbellek yenilendi. ${channels.length} kanal ve ${roles.length} rol tekrar okundu.`);
      }
    });

    app.router.register({
      name: 'bakımayar', aliases: ['bakimayar'], category: 'Yönetim',
      description: 'Otomatik yedek ve sağlık kontrolü ayarlarını yönetir.',
      usage: 'bakımayar <durum|yedek aç/kapat|yedeksaat sayı|uyarı aç/kapat|kontrolsaat sayı>', guildOnly: true, requiredPermission: 'owner',
      async execute(ctx) {
        const action = String(ctx.args.shift() || 'durum').toLocaleLowerCase('tr-TR');
        const settings = await ctx.services.settings.get(ctx.groupId);
        if (action === 'durum') {
          return ctx.reply([
            `Otomatik yedek: ${settings.maintenance.autoBackupEnabled ? 'açık' : 'kapalı'}`,
            `Yedek aralığı: ${settings.maintenance.autoBackupHours} saat`,
            `Sağlık uyarıları: ${settings.maintenance.healthAlerts ? 'açık' : 'kapalı'}`,
            `Kontrol aralığı: ${settings.maintenance.healthCheckHours} saat`,
            `Sistem kanalı: ${settings.channels.system || settings.channels.logs || 'ayarsız'}`
          ].join('\n'));
        }
        const value = String(ctx.args[0] || '').toLocaleLowerCase('tr-TR');
        if (action === 'yedek' && ['aç', 'ac', 'kapat'].includes(value)) {
          await ctx.services.settings.set(ctx.groupId, 'maintenance.autoBackupEnabled', value !== 'kapat');
        } else if (action === 'uyarı' && ['aç', 'ac', 'kapat'].includes(value)) {
          await ctx.services.settings.set(ctx.groupId, 'maintenance.healthAlerts', value !== 'kapat');
        } else if (action === 'yedeksaat' && Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 168) {
          await ctx.services.settings.set(ctx.groupId, 'maintenance.autoBackupHours', Number(value));
        } else if (action === 'kontrolsaat' && Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 72) {
          await ctx.services.settings.set(ctx.groupId, 'maintenance.healthCheckHours', Number(value));
        } else {
          return ctx.reply(`Kullanım: ${ctx.config.prefix}bakımayar <durum|yedek aç/kapat|yedeksaat sayı|uyarı aç/kapat|kontrolsaat sayı>`);
        }
        return ctx.reply('✅ Bakım ayarı güncellendi.');
      }
    });
  }
};
