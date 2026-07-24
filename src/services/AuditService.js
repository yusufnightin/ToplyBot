const { truncate } = require('../utils/text');
const { assertApiSuccess } = require('../utils/apiResult');

function positiveChannelId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function shouldRepairAccess(error) {
  return /(?:permission|denied|forbidden|unauthorized|access|403|izin|yetki|erişim|yazma)/i
    .test(String(error?.message || error || ''));
}

class AuditService {
  constructor({ store, settings, client, logger }) {
    this.store = store;
    this.settings = settings;
    this.client = client;
    this.logger = logger;
  }

  async write(type, data = {}, options = {}) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      type,
      groupId: options.groupId ?? data.groupId ?? null,
      actorUserId: data.actorUserId ?? null,
      targetUserId: data.targetUserId ?? null,
      createdAt: new Date().toISOString(),
      data
    };

    await this.store.update((entries) => {
      entries.push(entry);
      if (entries.length > 5000) entries.splice(0, entries.length - 5000);
      return entries;
    });

    this.logger?.info(`Denetim kaydı: ${type}`, data);

    entry.delivery = {
      status: options.notify === false ? 'skipped' : 'unconfigured',
      channelId: null
    };
    if (entry.groupId !== null && options.notify !== false) {
      const groupSettings = await this.settings.get(entry.groupId);
      const channels = groupSettings.channels || {};
      const logChannels = [...new Set([
        positiveChannelId(this.channelFor(type, channels)),
        positiveChannelId(channels.logs)
      ].filter(Boolean))];
      if (logChannels.length) {
        const text = options.text || this.format(entry);
        const failures = [];
        for (const logChannel of logChannels) {
          try {
            const result = await this.send(logChannel, truncate(text, 1800));
            entry.delivery = { status: 'sent', channelId: logChannel, repaired: false };
            return entry;
          } catch (firstError) {
            let finalError = firstError;
            if (shouldRepairAccess(firstError)) {
              try {
                await this.repairAccess(logChannel);
                const result = await this.send(logChannel, truncate(text, 1800));
                entry.delivery = { status: 'sent', channelId: logChannel, repaired: true };
                return entry;
              } catch (repairError) {
                finalError = repairError;
              }
            }
            failures.push({ channelId: logChannel, message: finalError.message });
          }
        }
        entry.delivery = {
          status: 'failed',
          channelId: logChannels[0],
          error: failures.map((item) => `#${item.channelId}: ${item.message}`).join(' • ')
        };
        this.logger?.error('Denetim mesajı log kanalına gönderilemedi.', {
          groupId: entry.groupId,
          type,
          failures
        });
      }
    }
    return entry;
  }

  async send(channelId, text) {
    const result = await this.client.sendPost(channelId, text);
    assertApiSuccess(result, `Log kanalı #${channelId} gönderimi`);
    return result;
  }

  async repairAccess(channelId) {
    if (
      typeof this.client.getCurrentUserId !== 'function' ||
      typeof this.client.grantChannelAccess !== 'function'
    ) {
      throw new Error('Bot kanal erişimini otomatik onaramıyor.');
    }
    const botUserId = await this.client.getCurrentUserId();
    return this.client.grantChannelAccess(channelId, botUserId, {
      read: true,
      write: true,
      control: false
    });
  }

  channelFor(type, channels) {
    const normalized = String(type || '').toLocaleLowerCase('tr-TR');
    if (normalized.startsWith('ticket.')) return channels.ticketLogs || channels.logs;
    if (/^(?:moderation|ban|role|registration)\./.test(normalized)) {
      return channels.moderationLogs || channels.logs;
    }
    if (/^(?:system|template|backup|settings)\./.test(normalized)) return channels.logs;
    return channels.logs;
  }

  format(entry) {
    const labels = {
      'member.join': 'Üye katıldı',
      'member.leave': 'Üye ayrıldı',
      'member.kicked_event': 'Üye çıkarıldı',
      'ticket.open': 'Ticket açıldı',
      'ticket.close': 'Ticket kapatıldı',
      'moderation.warning': 'Kullanıcı uyarıldı',
      'moderation.kick': 'Kullanıcı çıkarıldı',
      'moderation.ban': 'Kullanıcı yasaklandı',
      'moderation.unban': 'Kullanıcı yasağı kaldırıldı',
      'moderation.timeout': 'Kullanıcı susturuldu',
      'role.add': 'Rol verildi',
      'role.remove': 'Rol kaldırıldı',
      'role.autorole': 'Otomatik rol verildi',
      'level.up': 'Seviye atlandı',
      'system.log_test': 'Log sistemi testi'
    };
    const parts = [
      `📋 ${labels[entry.type] || 'Sistem kaydı'}`,
      `Tür: ${entry.type}`,
      `Zaman: ${entry.createdAt}`
    ];
    if (entry.actorUserId) parts.push(`İşlemi yapan: #${entry.actorUserId}`);
    if (entry.targetUserId) parts.push(`Hedef: #${entry.targetUserId}`);
    if (entry.data.reason) parts.push(`Sebep: ${entry.data.reason}`);
    const details = [
      ['Kanal', entry.data.channelId],
      ['Ticket', entry.data.ticketId],
      ['Gönderi', entry.data.postId],
      ['Seviye', entry.data.level],
      ['XP', entry.data.xp],
      ['Roller', Array.isArray(entry.data.roleIds) ? entry.data.roleIds.join(', ') : entry.data.roleId],
      ['Rozet', entry.data.badgeId],
      ['Konu', entry.data.subject],
      ['Ayar', entry.data.key],
      ['Değer', entry.data.value]
    ];
    for (const [label, value] of details) {
      if (value !== undefined && value !== null && value !== '') parts.push(`${label}: ${value}`);
    }
    return parts.join('\n');
  }
}

module.exports = AuditService;
module.exports.shouldRepairAccess = shouldRepairAccess;
