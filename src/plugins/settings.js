const { truncate } = require('../utils/text');

const CHANNEL_KEYS = new Set([
  'welcome', 'leave', 'logs', 'ticketlogs', 'moderationlogs', 'announcements',
  'levels', 'tickets', 'giveaways', 'social', 'polls', 'statistics', 'system'
]);

const CHANNEL_SETTING_PATHS = {
  ticketlogs: 'ticketLogs',
  moderationlogs: 'moderationLogs'
};

function isDisableValue(value) {
  return ['kapat', 'sil', '0', 'boş', 'bos'].includes(String(value || '').trim().toLocaleLowerCase('tr-TR'));
}

async function resolveChannel(ctx, reference) {
  if (isDisableValue(reference)) return { id: '', name: '' };
  const channel = await ctx.services.channels.resolve(ctx.groupId, reference);
  return { id: String(channel.id), name: channel.nick || channel.name || channel.title || '' };
}

function channelSort(items, mode) {
  const normalized = String(mode || 'sıra').toLocaleLowerCase('tr-TR');
  const list = [...items];
  if (['ad', 'isim', 'name'].includes(normalized)) return list.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  if (['id', 'kimlik'].includes(normalized)) return list.sort((a, b) => a.id - b.id);
  if (['tip', 'type'].includes(normalized)) return list.sort((a, b) => (a.type ?? 999) - (b.type ?? 999) || a.name.localeCompare(b.name, 'tr'));
  return list.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name, 'tr'));
}

function roleSort(items, mode) {
  const normalized = String(mode || 'sıra').toLocaleLowerCase('tr-TR');
  const list = [...items];
  if (['ad', 'isim', 'name'].includes(normalized)) return list.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  if (['id', 'kimlik'].includes(normalized)) return list.sort((a, b) => a.id - b.id);
  if (['güç', 'guc', 'power'].includes(normalized)) return list.sort((a, b) => (b.power ?? 0) - (a.power ?? 0) || a.name.localeCompare(b.name, 'tr'));
  return list.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name, 'tr'));
}

function parseIds(args) {
  return [...new Set(args.join(',').split(/[\s,;]+/).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

module.exports = {
  name: 'Grup ve Kanal Ayarları',
  setup(app) {
    app.router.register({
      name: 'ayarlar', aliases: ['sunucuayar'], category: 'Yönetim', description: 'Bu sunucuya özel bot ayarlarını özetler.', usage: 'ayarlar', guildOnly: true, requiredPermission: 'admin', cooldownMs: 3000,
      async execute(ctx) {
        const settings = await ctx.services.settings.get(ctx.groupId);
        const summary = {
          scope: `group:${ctx.groupId}`,
          channels: settings.channels,
          welcome: settings.welcome,
          autorole: settings.autorole,
          moderation: settings.moderation,
          leveling: settings.leveling,
          tickets: settings.tickets
        };
        return ctx.reply(`Sunucu #${ctx.groupId} ayarları:\n${truncate(JSON.stringify(summary, null, 2), 1800)}`, 'json');
      }
    });

    app.router.register({
      name: 'kanalayarla', category: 'Yönetim', description: 'Bot özelliklerinin kanalını ID veya #kanaladı ile ayarlar.', usage: 'kanalayarla <tür> <#kanaladı|kanalId|kapat>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const key = String(ctx.args[0] || '').toLowerCase();
        const reference = ctx.args.slice(1).join(' ').trim();
        if (!CHANNEL_KEYS.has(key) || !reference) {
          return ctx.reply(`Kullanım: ${ctx.config.prefix}kanalayarla <${[...CHANNEL_KEYS].join('|')}> <#kanaladı|kanalId|kapat>`);
        }
        try {
          const channel = await resolveChannel(ctx, reference);
          const settingKey = CHANNEL_SETTING_PATHS[key] || key;
          await ctx.services.settings.set(ctx.groupId, `channels.${settingKey}`, channel.id);
          await ctx.services.audit.write('settings.channel', {
            actorUserId: ctx.userId, key: settingKey, value: channel.id, channelName: channel.name || undefined
          }, { groupId: ctx.groupId });
          const label = channel.id ? `${channel.name ? `#${channel.name} · ` : ''}${channel.id}` : 'kapalı';
          return ctx.reply(`${settingKey} kanalı bu sunucu için ${label} olarak ayarlandı.`);
        } catch (error) {
          return ctx.reply(`Kanal ayarlanamadı: ${error.message}`);
        }
      }
    });

    app.router.register({
      name: 'logtest', aliases: ['logdeneme', 'logkontrol'], category: 'Yönetim', description: 'Log kanalını ve botun yazma iznini gerçek gönderimle kontrol eder.', usage: 'logtest', guildOnly: true, requiredPermission: 'admin', cooldownMs: 3000,
      async execute(ctx) {
        const entry = await ctx.services.audit.write('system.log_test', {
          actorUserId: ctx.userId,
          channelId: ctx.channelId
        }, { groupId: ctx.groupId });
        if (entry.delivery?.status === 'sent') {
          return ctx.reply(`✅ Log sistemi çalışıyor. Test kaydı kanal #${entry.delivery.channelId} üzerine gönderildi.${entry.delivery.repaired ? ' Botun kanal izni otomatik onarıldı.' : ''}`);
        }
        if (entry.delivery?.status === 'unconfigured') {
          return ctx.reply(`❌ Log kanalı ayarlanmamış.\nYardım → Sunucu Ayarları → Diğer Kanal Bağlantıları → Log kanalı bölümünden seç.`);
        }
        return ctx.reply(`❌ Log gönderilemedi: ${entry.delivery?.error || 'Bilinmeyen hata'}\nKanalı yardım panelinden yeniden seçip tekrar dene.`);
      }
    });

    app.router.register({
      name: 'kanalliste', aliases: ['kanallar', 'kanalbilgi', 'kanaldetay', 'kanalenvanter'], category: 'Yönetim',
      description: 'Kanal sırası, etiketi, ID, başlık ve tip bilgilerini listeler.', usage: 'kanalliste [sıra|ad|id|tip]',
      guildOnly: true, requiredPermission: 'admin', cooldownMs: 5000,
      async execute(ctx) {
        const mode = ctx.args[0] || 'sıra';
        const channels = channelSort(await ctx.services.channels.list(ctx.groupId, { force: true }), mode);
        if (!channels.length) return ctx.reply('Bu sunucuda kanal listesi alınamadı. API cevabı loga yazıldı.');
        const lines = channels.map((channel, index) => {
          const order = Number.isFinite(channel.order) && channel.order < Number.MAX_SAFE_INTEGER ? channel.order : index + 1;
          const type = channel.type === null || channel.type === undefined ? '—' : channel.type;
          const title = channel.title && channel.title !== channel.name ? ` • ${channel.title}` : '';
          return `${String(index + 1).padStart(2, '0')}. #${channel.nick || channel.name} • ID ${channel.id} • sıra ${order} • tip ${type}${title}`;
        });
        return ctx.reply(truncate([`📡 Sunucu #${ctx.groupId} kanal envanteri (${mode})`, ...lines].join('\n'), 1800));
      }
    });

    app.router.register({
      name: 'rolliste', aliases: ['roller', 'rolbilgi', 'roldetay', 'rolenvanter'], category: 'Yönetim',
      description: 'Rol sırası, adı, ID, renk ve güç bilgilerini listeler.', usage: 'rolliste [sıra|ad|id|güç]',
      guildOnly: true, requiredPermission: 'admin', cooldownMs: 5000,
      async execute(ctx) {
        const mode = ctx.args[0] || 'sıra';
        const roles = roleSort(await ctx.services.roles.list(ctx.groupId), mode);
        if (!roles.length) return ctx.reply('Bu sunucuda rol listesi alınamadı.');
        const lines = roles.map((role, index) => {
          const order = Number.isFinite(role.order) && role.order < Number.MAX_SAFE_INTEGER ? role.order : index + 1;
          return `${String(index + 1).padStart(2, '0')}. ${role.name} • ID ${role.id} • sıra ${order} • renk ${role.color || '—'} • güç ${role.power ?? 0}`;
        });
        return ctx.reply(truncate([`🎭 Sunucu #${ctx.groupId} rol envanteri (${mode})`, ...lines].join('\n'), 1800));
      }
    });

    app.router.register({
      name: 'kanalsırala', aliases: ['kanalsirala'], category: 'Yönetim', description: 'Kanal sırasını verilen ID dizisine göre uygular.',
      usage: 'kanalsırala <kanalId,kanalId,...>', guildOnly: true, requiredPermission: 'admin', cooldownMs: 6000,
      async execute(ctx) {
        const ids = parseIds(ctx.args);
        if (ids.length < 2) return ctx.reply(`Kullanım: ${ctx.config.prefix}kanalsırala <kanalId,kanalId,...>`);
        await ctx.client.sortChannels(ctx.groupId, ids);
        ctx.services.channels.cache?.delete(String(ctx.groupId));
        await ctx.services.audit.write('channels.sort', { actorUserId: ctx.userId, channelIds: ids }, { groupId: ctx.groupId });
        return ctx.reply(`Kanal sırası uygulandı: ${ids.join(' → ')}`);
      }
    });

    app.router.register({
      name: 'rolsırala', aliases: ['rolsirala'], category: 'Yönetim', description: 'Rol sırasını verilen ID dizisine göre uygular.',
      usage: 'rolsırala <rolId,rolId,...>', guildOnly: true, requiredPermission: 'admin', cooldownMs: 6000,
      async execute(ctx) {
        const ids = parseIds(ctx.args);
        if (ids.length < 2) return ctx.reply(`Kullanım: ${ctx.config.prefix}rolsırala <rolId,rolId,...>`);
        await ctx.client.sortRoles(ctx.groupId, ids);
        await ctx.services.audit.write('roles.sort', { actorUserId: ctx.userId, roleIds: ids }, { groupId: ctx.groupId });
        return ctx.reply(`Rol sırası uygulandı: ${ids.join(' → ')}`);
      }
    });

    app.router.register({
      name: 'prefixbilgi', category: 'Yönetim', description: 'Aktif komut prefixini gösterir.', usage: 'prefixbilgi', guildOnly: true,
      async execute(ctx) { return ctx.reply(`Aktif prefix: ${ctx.config.prefix}\nPrefix config.json üzerinden değiştirilir.`); }
    });
  }
};
