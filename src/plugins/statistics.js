const {
  extractCreatedPostId,
  findArray,
  findObject,
  unwrapApiResult
} = require('../utils/api');
const { sendInteractivePost, updateInteractivePost } = require('../utils/jtmlDelivery');
const { serializeJtml } = require('../utils/bumote');

const UPDATE_INTERVAL_MS = 15_000;
const CHANNEL_SPEC = { nick: 'ozel-istatistik', title: '📊 Canlı Sunucu İstatistikleri' };
const PANEL_MARKER = 'CANLI SUNUCU İSTATİSTİKLERİ';

function nextId(items) {
  return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

function csv(values) {
  return [...new Set(values.map(Number).filter((value) => Number.isInteger(value) && value > 0))].join(',');
}

function panelPostIdFromList(result) {
  const posts = findArray(result, ['posts', 'list']);
  const matches = posts.filter((post) => {
    const text = String(post?.text ?? post?.message ?? '');
    return text.includes(PANEL_MARKER);
  });
  const ids = matches.map(extractCreatedPostId).filter(Number.isInteger);
  return ids.length ? Math.max(...ids) : null;
}

async function recoverPanelPostId(client, channelId, { attempts = 6 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      // post/list önbelleğini atlayarak yeni oluşturulan gönderinin görünmesini bekle.
      const result = await client.api('/!api/post/list', {
        channel_id: Number(channelId), after: 0, before: 999999999
      }, { cacheTtlMs: 0, dedupe: false });
      const postId = panelPostIdFromList(result);
      if (Number.isInteger(postId)) return postId;
    } catch {}
    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 350 + attempt * 200));
    }
  }
  return null;
}

function parseOnlinePresence(result) {
  const raw = unwrapApiResult(result);
  let entries = [];

  if (Array.isArray(raw)) {
    entries = raw;
  } else if (typeof raw === 'string') {
    entries = raw.split(',');
  } else if (raw && typeof raw === 'object') {
    entries = Object.values(raw);
  } else if (raw !== null && raw !== undefined && raw !== '') {
    entries = [raw];
  }

  const onlineUserIds = new Set();
  const voiceUserIds = new Set();

  for (const entry of entries) {
    let userId;
    let channelId;

    if (entry && typeof entry === 'object') {
      userId = Number(entry.user_id ?? entry.userId ?? entry.id);
      channelId = Number(
        entry.channel_id ?? entry.channelId ?? entry.room_id ?? entry.roomId
      );
    } else {
      const [userPart, channelPart] = String(entry ?? '').trim().split('-', 2);
      userId = Number.parseInt(userPart, 10);
      channelId = Number.parseInt(channelPart, 10);
    }

    if (!Number.isInteger(userId) || userId <= 0) continue;
    onlineUserIds.add(userId);
    if (Number.isInteger(channelId) && channelId > 0) {
      voiceUserIds.add(userId);
    }
  }

  return {
    onlineUserIds: [...onlineUserIds],
    voiceUserIds: [...voiceUserIds],
    online: onlineUserIds.size,
    voice: voiceUserIds.size
  };
}

async function collect(app, groupId) {
  const [membersResult, onlineResult, groupResult] = await Promise.allSettled([
    app.client.listMembers(groupId),
    app.client.listOnline(groupId),
    app.client.getGroup(groupId)
  ]);
  const members = membersResult.status === 'fulfilled' ? findArray(membersResult.value, ['members', 'list']) : [];
  const presence = onlineResult.status === 'fulfilled'
    ? parseOnlinePresence(onlineResult.value)
    : { online: 0, voice: 0 };
  const group = groupResult.status === 'fulfilled' ? findObject(groupResult.value, ['group']) || {} : {};
  const activityPercent = members.length
    ? Math.min(100, Math.round((presence.online / members.length) * 100))
    : 0;
  return {
    groupName: group.name || group.nick || `Grup #${groupId}`,
    members: members.length,
    online: presence.online,
    voice: presence.voice,
    activityPercent,
    updatedAt: new Date()
  };
}

function buildPanel(stats) {
  const time = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'medium'
  }).format(stats.updatedAt);
  const activityPercent = Number.isFinite(stats.activityPercent)
    ? Math.max(0, Math.min(100, Math.round(stats.activityPercent)))
    : stats.members
      ? Math.max(0, Math.min(100, Math.round((stats.online / stats.members) * 100)))
      : 0;
  const filled = Math.round(activityPercent / 10);
  const metric = (icon, label, value, color) => ({
    type: 'box',
    ui: 'flex-y',
    gap: 0.18,
    background: '#202633',
    children: [
      { type: 'box', ui: 'muted', text: `${icon} ${label}`, color: '#94a3b8' },
      { type: 'box', ui: 'muted', text: String(value), color, size: 1.22 }
    ]
  });
  const metricCell = (node) => ({
    type: 'box',
    ui: 'space',
    children: [node]
  });
  const metricRow = (items) => ({
    type: 'flex-x',
    ui: 'flex-x',
    gap: 0.34,
    children: items.map(metricCell)
  });

  const jtmlCode = serializeJtml({
    type: 'box',
    ui: 'flex-y',
    gap: 0.45,
    background: '#0f1118',
    children: [
      {
        type: 'box', ui: 'flex-y', gap: 0.24, background: '#171921',
        children: [
          { type: 'box', ui: 'muted', text: '📊 CANLI SUNUCU MERKEZİ', color: '#ff83c8', size: 1.18 },
          { type: 'box', ui: 'muted', text: stats.groupName, color: '#f8fafc', size: 1.06 },
          { type: 'box', ui: 'muted', text: 'Sunucunun anlık durumu', color: '#94a3b8' }
        ]
      },
      metricRow([
        metric('👥', 'Toplam Üye', stats.members, '#a78bfa'),
        metric('🟢', 'Çevrimiçi', stats.online, '#4ade80')
      ]),
      metricRow([
        metric('🔊', 'Sesteki Kişi', stats.voice ?? 0, '#67e8f9'),
        metric('⚡', 'Aktiflik Oranı', `%${activityPercent}`, '#fbbf24')
      ]),
      {
        type: 'box', ui: 'flex-y', gap: 0.24, background: '#161d28',
        children: [
          { type: 'box', ui: 'muted', text: `Aktiflik • %${activityPercent}`, color: '#f8fafc' },
          {
            type: 'box',
            ui: 'space',
            text: `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`,
            color: '#f8fafc',
            background: '#176b52'
          },
          { type: 'box', ui: 'muted', text: `⚡ ${time} · 15 saniyede bir otomatik yenilenir`, color: '#94a3b8' }
        ]
      },
      {
        type: 'flex-x',
        gap: 0.2,
        background: '#0f1118',
        children: [
          { type: 'box', ui: 'space', text: '' },
          { type: 'box', ui: 'muted', text: 'ToplyBot ♥ Topluyo', color: '#ff83c8', size: 0.82 }
        ]
      }
    ]
  });
  const text = [
    `## 📊 ${stats.groupName} — ${PANEL_MARKER}`,
    `👥 **Toplam Üye:** ${stats.members}  ·  🟢 **Çevrimiçi:** ${stats.online}`,
    `🔊 **Sesteki Kişi:** ${stats.voice ?? 0}  ·  ⚡ **Aktiflik Oranı:** %${activityPercent}`,
    `> Son güncelleme: ${time} (otomatik)`
  ].join('\n');
  return { text, jtmlCode };
}

module.exports = {
  name: 'Sunucu İstatistikleri',
  setup(app) {
    const accessReadyChannels = new Set();

    const ensurePrivateAccess = async (config) => {
      const channelId = Number(config.channelId);
      if (!Number.isInteger(channelId) || accessReadyChannels.has(channelId)) return;
      const botUserId = await app.client.getCurrentUserId();
      const allowedUserIds = csv([
        botUserId,
        ...(app.config.ownerUserIds || []),
        ...String(config.allowedUserIds || '').split(',')
      ]);
      const users = allowedUserIds.split(',').map(Number).filter(Number.isInteger);
      for (const userId of users) {
        await app.client.grantChannelAccess(channelId, userId, {
          read: true, write: true, control: true
        });
      }
      config.allowedUserIds = allowedUserIds;
      accessReadyChannels.add(channelId);
    };

    const updatePanel = async (config) => {
      await ensurePrivateAccess(config);
      const stats = await collect(app, config.groupId);
      const panel = buildPanel(stats);
      const knownPostId = Number.isInteger(Number(config.postId))
        ? Number(config.postId)
        : await recoverPanelPostId(app.client, config.channelId, { attempts: 1 });
      if (Number.isInteger(knownPostId)) {
        try {
          await updateInteractivePost({
            client: app.client, postId: knownPostId, ...panel,
            attach: app.config.interactions?.attachBumote !== false,
            logger: app.logger, context: 'Canlı istatistik paneli'
          });
          return knownPostId;
        } catch (error) {
          app.logger.warn('İstatistik gönderisi güncellenemedi; yeniden oluşturulacak.', {
            groupId: config.groupId, postId: knownPostId, message: error.message
          });
        }
      }
      const delivery = await sendInteractivePost({
        client: app.client, channelId: Number(config.channelId), ...panel,
        attach: app.config.interactions?.attachBumote !== false,
        logger: app.logger, context: 'Canlı istatistik paneli'
      });
      if (Number.isInteger(delivery.postId)) return delivery.postId;

      const recoveredPostId = await recoverPanelPostId(app.client, config.channelId);
      if (Number.isInteger(recoveredPostId)) {
        await updateInteractivePost({
          client: app.client, postId: recoveredPostId, ...panel,
          attach: app.config.interactions?.attachBumote !== false,
          logger: app.logger, context: 'Canlı istatistik paneli'
        });
        app.logger.info('İstatistik gönderisi ID bilgisi kanal listesinden kurtarıldı.', {
          groupId: config.groupId, channelId: config.channelId, postId: recoveredPostId
        });
        return recoveredPostId;
      }
      throw new Error('İstatistik gönderisi oluşturuldu ancak post ID kanal listesinden de bulunamadı.');
    };

    const persistUpdate = async (config, now = Date.now()) => {
      const postId = await updatePanel(config);
      await app.stores.statistics.update((items) => {
        const item = items.find((entry) => Number(entry.id) === Number(config.id));
        if (item) {
          item.postId = postId;
          item.allowedUserIds = config.allowedUserIds;
          item.nextUpdateAt = new Date(now + UPDATE_INTERVAL_MS).toISOString();
          item.lastUpdatedAt = new Date(now).toISOString();
          delete item.channels;
        }
        return items;
      });
      return postId;
    };

    app.services.scheduler.register('statistics-panel', async (now) => {
      const configs = await app.stores.statistics.read();
      for (const config of configs.filter((item) => item.active && item.channelId
        && (!item.nextUpdateAt || Date.parse(item.nextUpdateAt) <= now))) {
        try {
          await persistUpdate(config, now);
        } catch (error) {
          app.logger.error('Canlı istatistik paneli güncellenemedi.', {
            groupId: config.groupId, channelId: config.channelId, message: error.message
          });
        }
      }
    });

    app.router.register({
      name: 'sunucuistatistik', aliases: ['stats', 'istatistikler'], category: 'İstatistik',
      description: 'Grup istatistiklerini gösterir.', usage: 'sunucuistatistik',
      guildOnly: true, cooldownMs: 5000,
      async execute(ctx) {
        const stats = await collect(ctx.app, ctx.groupId);
        return ctx.reply(buildPanel(stats).text);
      }
    });

    app.router.register({
      name: 'statskanal', category: 'İstatistik',
      description: 'Tek ve özel canlı istatistik kanalını yönetir.',
      usage: 'statskanal <kur|güncelle|sil>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const action = String(ctx.args[0] || 'güncelle').toLocaleLowerCase('tr-TR');
        const configs = await ctx.stores.statistics.read();
        let config = configs.find((item) => String(item.groupId) === String(ctx.groupId) && item.active);

        if (['kur', 'oluştur', 'olustur'].includes(action)) {
          if (config?.channelId) return ctx.reply(`İstatistik paneli zaten kurulu. Kanal ID: ${config.channelId}`);
          const botUserId = await ctx.client.getCurrentUserId();
          const allowedUsers = csv([ctx.userId, botUserId, ...(ctx.config.ownerUserIds || [])]);
          const payload = {
            group_id: ctx.groupId,
            nick: CHANNEL_SPEC.nick,
            title: CHANNEL_SPEC.title,
            description: 'Bot tarafından anlık güncellenen özel istatistik paneli',
            type: 1,
            data: '',
            read_role_ids: '',
            write_role_ids: '',
            control_role_ids: '',
            read_plus_user_ids: allowedUsers,
            read_minus_user_ids: '-1,0',
            write_plus_user_ids: allowedUsers,
            write_minus_user_ids: '-1,0',
            control_plus_user_ids: allowedUsers,
            control_minus_user_ids: '-1,0'
          };
          const provisioned = await ctx.services.provisioning.ensureChannel({
            groupId: ctx.groupId, spec: CHANNEL_SPEC, payload
          });
          const channelId = Number(provisioned.id);
          if (!Number.isInteger(channelId)) throw new Error('Özel istatistik kanalı ID bilgisi alınamadı.');
          for (const userId of allowedUsers.split(',').map(Number).filter(Number.isInteger)) {
            await ctx.client.grantChannelAccess(channelId, userId, {
              read: true, write: true, control: true
            });
          }
          accessReadyChannels.add(channelId);

          await ctx.stores.statistics.update((items) => {
            const stale = items.find((item) => String(item.groupId) === String(ctx.groupId) && item.active);
            if (stale) {
              stale.channelId = channelId;
              stale.allowedUserIds = allowedUsers;
              stale.nextUpdateAt = new Date().toISOString();
              delete stale.channels;
              config = stale;
            } else {
              config = {
                id: nextId(items), groupId: ctx.groupId, channelId, postId: null,
                allowedUserIds: allowedUsers, active: true,
                createdAt: new Date().toISOString(), nextUpdateAt: new Date().toISOString()
              };
              items.push(config);
            }
            return items;
          });
          const postId = await persistUpdate(config);
          return ctx.reply(`✅ Özel canlı istatistik paneli kuruldu.\nKanal ID: ${channelId} · Panel ID: ${postId}\nYalnızca izin verilen kullanıcılar erişebilir.`);
        }

        if (!config?.channelId) return ctx.reply(`Önce ${ctx.config.prefix}statskanal kur kullanın.`);
        if (['güncelle', 'guncelle'].includes(action)) {
          const postId = await persistUpdate(config);
          return ctx.reply(`✅ İstatistik paneli anlık olarak güncellendi. Panel ID: ${postId}`);
        }
        if (action === 'sil') {
          await ctx.client.deleteChannel(config.channelId);
          await ctx.stores.statistics.update((items) => {
            const item = items.find((entry) => Number(entry.id) === Number(config.id));
            if (item) item.active = false;
            return items;
          });
          return ctx.reply('İstatistik kanalı ve canlı panel kaldırıldı.');
        }
        return ctx.reply(`Kullanım: ${ctx.config.prefix}statskanal <kur|güncelle|sil>`);
      }
    });
  },
  collect,
  buildPanel,
  parseOnlinePresence,
  panelPostIdFromList,
  recoverPanelPostId
};
