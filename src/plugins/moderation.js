const { truncate } = require('../utils/text');
const { findArray } = require('../utils/api');
const { parseDuration, formatDuration } = require('../utils/duration');

const linkPattern = /(?:https?:\/\/|www\.)\S+/i;
const domainPattern = /(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})(?:[/:?]|$)/gi;
const mentionPattern = /(?:^|\s)@[\p{L}\p{N}_.-]+/gu;

function uppercaseRatio(text) {
  const letters = [...text].filter((char) => /[a-zA-ZÇĞİÖŞÜçğıöşü]/.test(char));
  if (letters.length === 0) return 0;
  const uppercase = letters.filter((char) => char === char.toLocaleUpperCase('tr-TR') && char !== char.toLocaleLowerCase('tr-TR'));
  return Math.round((uppercase.length / letters.length) * 100);
}

function normalizeText(text) {
  return String(text).toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim();
}

function findBannedWord(text, words) {
  const normalized = normalizeText(text);
  return (words || []).find((word) => normalized.includes(normalizeText(word)));
}

function extractDomains(text) {
  const domains = [];
  let match;
  domainPattern.lastIndex = 0;
  while ((match = domainPattern.exec(String(text))) !== null) domains.push(match[1].toLowerCase());
  return domains;
}

function domainMatches(domain, rule) {
  const normalizedRule = String(rule).toLowerCase().replace(/^\*\./, '');
  return domain === normalizedRule || domain.endsWith(`.${normalizedRule}`);
}

function inspectLinks(text, settings) {
  if (!linkPattern.test(String(text))) return null;
  linkPattern.lastIndex = 0;
  const domains = extractDomains(text);
  const banned = domains.find((domain) => (settings.bannedDomains || []).some((rule) => domainMatches(domain, rule)));
  if (banned) return `Yasaklı domain paylaşımı: ${banned}`;
  if (!settings.blockLinks) return null;
  const unauthorized = domains.find((domain) => !(settings.allowedDomains || []).some((rule) => domainMatches(domain, rule)));
  return unauthorized ? `İzinsiz bağlantı paylaşımı: ${unauthorized}` : null;
}

function postIdOf(post) {
  const id = Number(post?.id ?? post?.post_id);
  return Number.isInteger(id) ? id : null;
}

module.exports = {
  name: 'Gelişmiş Moderasyon ve Audit',
  setup(app) {
    const messageWindows = new Map();
    const duplicateWindows = new Map();
    const slowmodeWindows = new Map();
    const lastAutomodNotice = new Map();

    const activeBan = async (groupId, userId) => {
      const bans = await app.stores.bans.read();
      const ban = bans.find((item) => String(item.groupId) === String(groupId) && Number(item.userId) === Number(userId) && item.active);
      if (!ban) return null;
      if (ban.expiresAt && Date.parse(ban.expiresAt) <= Date.now()) {
        await app.stores.bans.update((items) => {
          const target = items.find((item) => item.id === ban.id);
          if (target) { target.active = false; target.expiredAt = new Date().toISOString(); }
          return items;
        });
        return null;
      }
      return ban;
    };

    app.client.on('action:group/join', async (event) => {
      try {
        const ban = await activeBan(event.group_id, event.user_id);
        if (!ban) return;
        await app.client.kickMember(event.group_id, event.user_id);
        await app.services.audit.write('moderation.ban_enforced', {
          targetUserId: Number(event.user_id),
          reason: ban.reason,
          banId: ban.id
        }, { groupId: event.group_id, text: `Yasaklı kullanıcı yeniden katıldığı için çıkarıldı.\nKullanıcı: #${event.user_id}\nSebep: ${ban.reason}` });
      } catch (error) {
        app.logger.error('Yerel ban uygulanamadı.', error);
      }
    });

    const resolveRecentPostId = async (event) => {
      const direct = Number(event.post_id ?? event.id);
      if (Number.isInteger(direct)) return direct;
      try {
        const result = await app.client.listPosts(event.channel_id, { after: 0, before: 999999999 });
        const posts = findArray(result, ['posts', 'list']).slice(-25).reverse();
        const match = posts.find((post) => Number(post.user_id) === Number(event.user_id)
          && normalizeText(post.message ?? post.text) === normalizeText(event.message));
        return postIdOf(match);
      } catch {
        return null;
      }
    };

    const deleteViolation = async (event, moderation) => {
      if (!moderation.deleteViolations) return false;
      const postId = await resolveRecentPostId(event);
      if (!postId) return false;
      await app.client.deletePost(postId);
      return true;
    };

    const warnAndMaybeSanction = async ({ groupId, userId, reason, channelId, source = 'automod', actorUserId = null, event = null }) => {
      const warning = await app.services.warnings.add(groupId, userId, { reason, moderatorUserId: actorUserId, source });
      const warnings = await app.services.warnings.list(groupId, userId);
      const settings = await app.services.settings.get(groupId);
      let deleted = false;
      if (event) {
        try { deleted = await deleteViolation(event, settings.moderation); } catch {}
      }

      await app.services.audit.write('moderation.warning', {
        actorUserId,
        targetUserId: userId,
        reason,
        warningId: warning.id,
        warningCount: warnings.length,
        source,
        deleted
      }, { groupId, text: `Uyarı verildi.\nKullanıcı: #${userId}\nUyarı: ${warnings.length}\nSebep: ${reason}\nKaynak: ${source}${deleted ? '\nMesaj silindi.' : ''}` });

      try { await app.client.sendDirectMessage(userId, `Grup #${groupId} içinde uyarıldınız.\nSebep: ${reason}\nToplam uyarı: ${warnings.length}`); } catch {}

      if (channelId) {
        const noticeKey = `${groupId}:${userId}:${reason}`;
        const lastNotice = lastAutomodNotice.get(noticeKey) || 0;
        if (Date.now() - lastNotice > 5000) {
          lastAutomodNotice.set(noticeKey, Date.now());
          await app.client.sendPost(channelId, `Kullanıcı #${userId} uyarıldı. Sebep: ${reason} (${warnings.length} uyarı)`);
        }
      }

      const timeoutAt = Number(settings.moderation.autoTimeoutAtWarnings) || 0;
      const muteRoleId = Number(settings.moderation.muteRoleId);
      if (timeoutAt > 0 && warnings.length >= timeoutAt && Number.isInteger(muteRoleId)) {
        const hasActive = (await app.stores.sanctions.read()).some((item) => String(item.groupId) === String(groupId)
          && Number(item.userId) === Number(userId) && item.type === 'mute' && item.active);
        if (!hasActive) {
          const minutes = Math.max(1, Number(settings.moderation.autoTimeoutMinutes) || 10);
          await app.services.roles.addMemberRoles(groupId, userId, [muteRoleId]);
          await app.stores.sanctions.update((items) => {
            items.push({
              id: `${Date.now()}-${userId}`,
              type: 'mute', groupId, userId, roleId: muteRoleId,
              reason: `${warnings.length} uyarı nedeniyle otomatik timeout`,
              moderatorUserId: null, createdAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(), active: true
            });
            return items;
          });
        }
      }

      const kickAt = Number(settings.moderation.autoKickAtWarnings) || 0;
      if (kickAt > 0 && warnings.length >= kickAt) {
        await app.client.kickMember(groupId, userId);
        await app.services.audit.write('moderation.auto_kick', { targetUserId: userId, reason: `${warnings.length} uyarıya ulaştı.` }, {
          groupId, text: `Otomatik uzaklaştırma.\nKullanıcı: #${userId}\nUyarı sayısı: ${warnings.length}`
        });
      }
      return warnings.length;
    };

    app.client.on('message', async (event) => {
      try {
        if (!['post/add', 'post/mention'].includes(event?.action) || typeof event.message !== 'string') return;
        if (app.permissionManager.isStaff(event.user_id)) return;
        const groupId = app.groupResolver.resolve(event);
        if (groupId === null) return;
        const settings = await app.services.settings.get(groupId);
        const moderation = settings.moderation;
        if (!moderation.enabled) return;
        const text = event.message.trim();
        if (!text || text.startsWith(app.config.prefix)) return;

        let reason = null;
        const bannedWord = findBannedWord(text, moderation.bannedWords);
        if (bannedWord) reason = `Yasaklı/küfürlü kelime kullanımı: ${bannedWord}`;
        if (!reason) reason = inspectLinks(text, moderation);
        if (!reason && moderation.capsFilter && text.length >= moderation.capsMinLength && uppercaseRatio(text) >= moderation.capsPercent) {
          reason = `Aşırı büyük harf kullanımı (%${uppercaseRatio(text)})`;
        }
        if (!reason && moderation.mentionSpam) {
          const count = (text.match(mentionPattern) || []).length;
          if (count >= Math.max(2, Number(moderation.mentionLimit) || 5)) reason = `Mention spamı (${count} mention)`;
        }

        const key = `${groupId}:${event.user_id}`;
        const now = Date.now();
        if (!reason && Number(moderation.slowmodeSeconds) > 0) {
          const last = slowmodeWindows.get(key) || 0;
          const remaining = Number(moderation.slowmodeSeconds) * 1000 - (now - last);
          slowmodeWindows.set(key, now);
          if (last && remaining > 0) reason = `Slowmode ihlali (${Math.ceil(remaining / 1000)} saniye erken)`;
        }

        if (!reason && moderation.antiSpam) {
          const interval = Math.max(1, Number(moderation.spamIntervalSeconds) || 7) * 1000;
          const previous = (messageWindows.get(key) || []).filter((timestamp) => now - timestamp <= interval);
          previous.push(now);
          messageWindows.set(key, previous);
          if (previous.length >= Math.max(3, Number(moderation.spamMessageCount) || 5)) {
            reason = `${moderation.spamIntervalSeconds} saniyede ${previous.length} mesaj ile spam`;
            messageWindows.set(key, []);
          }
        }

        if (!reason && moderation.antiFlood) {
          const interval = Math.max(5, Number(moderation.duplicateIntervalSeconds) || 20) * 1000;
          const entries = (duplicateWindows.get(key) || []).filter((entry) => now - entry.at <= interval);
          entries.push({ at: now, text: normalizeText(text) });
          duplicateWindows.set(key, entries);
          const duplicateCount = entries.filter((entry) => entry.text === normalizeText(text)).length;
          if (duplicateCount >= Math.max(2, Number(moderation.duplicateMessageCount) || 3)) {
            reason = `Aynı mesajı ${duplicateCount} kez göndererek flood`;
            duplicateWindows.set(key, []);
          }
        }

        if (reason) await warnAndMaybeSanction({ groupId, userId: Number(event.user_id), reason, channelId: event.channel_id, source: 'automod', event });
      } catch (error) {
        app.logger.error('Otomatik moderasyon olayı işlenemedi.', error);
      }
    });

    const expireSanctions = async () => {
      const now = Date.now();
      const expired = [];
      await app.stores.sanctions.update((sanctions) => {
        for (const sanction of sanctions) {
          if (sanction.type === 'mute' && sanction.active && sanction.expiresAt && Date.parse(sanction.expiresAt) <= now) {
            sanction.active = false;
            sanction.expiredAt = new Date().toISOString();
            expired.push({ ...sanction });
          }
        }
        return sanctions;
      });
      for (const sanction of expired) {
        try {
          await app.services.roles.removeMemberRoles(sanction.groupId, sanction.userId, [sanction.roleId]);
          await app.services.audit.write('moderation.timeout_expired', { targetUserId: sanction.userId, roleId: sanction.roleId }, {
            groupId: sanction.groupId, text: `Timeout süresi doldu.\nKullanıcı: #${sanction.userId}`
          });
        } catch (error) { app.logger.error('Süresi dolan timeout kaldırılamadı.', error); }
      }
    };
    app.services.scheduler.register('moderation-sanctions', async () => {
      await expireSanctions();
      const expiredBans = [];
      await app.stores.bans.update((items) => {
        for (const ban of items) {
          if (ban.active && ban.expiresAt && Date.parse(ban.expiresAt) <= Date.now()) {
            ban.active = false; ban.expiredAt = new Date().toISOString(); expiredBans.push({ ...ban });
          }
        }
        return items;
      });
      for (const ban of expiredBans) await app.services.audit.write('moderation.ban_expired', { targetUserId: ban.userId, banId: ban.id }, { groupId: ban.groupId, notify: false });
    });

    app.router.register({
      name: 'uyar', aliases: ['warn'], category: 'Moderasyon', description: 'Bir üyeye kalıcı uyarı verir.',
      usage: 'uyar <kullanıcıId> <sebep>', guildOnly: true, requiredPermission: 'moderator',
      async execute(ctx) {
        const userId = Number(ctx.args.shift()); const reason = ctx.args.join(' ').trim();
        if (!Number.isInteger(userId) || !reason) return ctx.reply(`Kullanım: ${ctx.config.prefix}uyar <kullanıcıId> <sebep>`);
        const count = await warnAndMaybeSanction({ groupId: ctx.groupId, userId, reason: truncate(reason, 500), channelId: ctx.channelId, source: 'manual', actorUserId: ctx.userId });
        return ctx.reply(`Kullanıcı #${userId} uyarıldı. Toplam uyarı: ${count}`);
      }
    });

    app.router.register({
      name: 'uyarılar', aliases: ['uyarilar', 'warns'], category: 'Moderasyon', description: 'Uyarı geçmişini gösterir.', usage: 'uyarılar [kullanıcıId]', guildOnly: true,
      async execute(ctx) {
        const userId = Number(ctx.args[0] || ctx.userId);
        if (!Number.isInteger(userId)) return ctx.reply('Geçerli kullanıcı ID girin.');
        if (userId !== ctx.userId && !ctx.isModerator) return ctx.reply('Yalnızca kendi uyarılarınızı görebilirsiniz.');
        const warnings = await ctx.services.warnings.list(ctx.groupId, userId);
        if (!warnings.length) return ctx.reply(`Kullanıcı #${userId} için uyarı yok.`);
        return ctx.reply(`Kullanıcı #${userId} uyarıları:\n${truncate(warnings.map((warning) => `#${warning.id} — ${warning.reason} — ${warning.source}`).join('\n'), 1800)}`);
      }
    });

    app.router.register({
      name: 'uyarısil', aliases: ['uyarisil'], category: 'Moderasyon', description: 'Tek veya tüm uyarıları siler.', usage: 'uyarısil <kullanıcıId> <uyarıId|tümü>', guildOnly: true, requiredPermission: 'moderator',
      async execute(ctx) {
        const userId = Number(ctx.args[0]); const selector = String(ctx.args[1] || '').toLocaleLowerCase('tr-TR');
        const warningId = ['tümü', 'tumu', 'all'].includes(selector) ? 'all' : Number(selector);
        if (!Number.isInteger(userId) || (warningId !== 'all' && !Number.isInteger(warningId))) return ctx.reply(`Kullanım: ${ctx.config.prefix}uyarısil <kullanıcıId> <uyarıId|tümü>`);
        const removed = await ctx.services.warnings.remove(ctx.groupId, userId, warningId);
        await ctx.services.audit.write('moderation.warning_remove', { actorUserId: ctx.userId, targetUserId: userId, removed }, { groupId: ctx.groupId });
        return ctx.reply(`${removed} uyarı silindi.`);
      }
    });

    app.router.register({
      name: 'kick', aliases: ['at'], category: 'Moderasyon', description: 'Üyeyi gruptan çıkarır.', usage: 'kick <kullanıcıId> [sebep]', guildOnly: true, requiredPermission: 'moderator', cooldownMs: 4000,
      async execute(ctx) {
        const userId = Number(ctx.args.shift()); const reason = ctx.args.join(' ').trim() || 'Sebep belirtilmedi.';
        if (!Number.isInteger(userId)) return ctx.reply(`Kullanım: ${ctx.config.prefix}kick <kullanıcıId> [sebep]`);
        if (ctx.app.permissionManager.isStaff(userId) && !ctx.app.permissionManager.has(ctx.userId, 'owner')) return ctx.reply('Bot yetkilisini yalnızca bot sahibi çıkarabilir.');
        await ctx.client.kickMember(ctx.groupId, userId);
        await ctx.services.audit.write('moderation.kick', { actorUserId: ctx.userId, targetUserId: userId, reason }, { groupId: ctx.groupId, text: `Üye çıkarıldı.\nHedef: #${userId}\nYetkili: #${ctx.userId}\nSebep: ${reason}` });
        return ctx.reply(`Kullanıcı #${userId} gruptan çıkarıldı.`);
      }
    });

    app.router.register({
      name: 'ban', category: 'Moderasyon', description: 'Yerel grup yasağı ekler ve üyeyi çıkarır.', usage: 'ban <kullanıcıId> [süre|0] [sebep]', guildOnly: true, requiredPermission: 'admin', cooldownMs: 4000,
      async execute(ctx) {
        const userId = Number(ctx.args.shift());
        if (!Number.isInteger(userId)) return ctx.reply(`Kullanım: ${ctx.config.prefix}ban <kullanıcıId> [süre|0] [sebep]`);
        let durationMs = 0;
        if (ctx.args[0] && (ctx.args[0] === '0' || parseDuration(ctx.args[0], { min: 1000, max: 365 * 86_400_000 }) !== null)) {
          const raw = ctx.args.shift(); durationMs = raw === '0' ? 0 : parseDuration(raw);
        }
        const reason = ctx.args.join(' ').trim() || 'Sebep belirtilmedi.';
        const expiresAt = durationMs ? new Date(Date.now() + durationMs).toISOString() : null;
        await ctx.stores.bans.update((bans) => {
          bans.filter((ban) => String(ban.groupId) === String(ctx.groupId) && Number(ban.userId) === userId && ban.active).forEach((ban) => { ban.active = false; ban.replacedAt = new Date().toISOString(); });
          bans.push({ id: `${Date.now()}-${userId}`, groupId: ctx.groupId, userId, reason, moderatorUserId: ctx.userId, createdAt: new Date().toISOString(), expiresAt, active: true });
          return bans;
        });
        try { await ctx.client.kickMember(ctx.groupId, userId); } catch {}
        await ctx.services.audit.write('moderation.ban', { actorUserId: ctx.userId, targetUserId: userId, reason, durationMs }, { groupId: ctx.groupId });
        return ctx.reply(`Kullanıcı #${userId} ${durationMs ? formatDuration(durationMs) : 'kalıcı'} yasaklandı.`);
      }
    });

    app.router.register({
      name: 'unban', aliases: ['yasakkaldır', 'yasakkaldir'], category: 'Moderasyon', description: 'Yerel grup yasağını kaldırır.', usage: 'unban <kullanıcıId>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const userId = Number(ctx.args[0]); if (!Number.isInteger(userId)) return ctx.reply(`Kullanım: ${ctx.config.prefix}unban <kullanıcıId>`);
        let removed = 0;
        await ctx.stores.bans.update((bans) => { bans.filter((ban) => String(ban.groupId) === String(ctx.groupId) && Number(ban.userId) === userId && ban.active).forEach((ban) => { ban.active = false; ban.unbannedAt = new Date().toISOString(); ban.unbannedBy = ctx.userId; removed += 1; }); return bans; });
        await ctx.services.audit.write('moderation.unban', { actorUserId: ctx.userId, targetUserId: userId, removed }, { groupId: ctx.groupId });
        return ctx.reply(removed ? `Kullanıcı #${userId} yasağı kaldırıldı.` : 'Aktif yasak bulunamadı.');
      }
    });

    app.router.register({
      name: 'softban', category: 'Moderasyon', description: 'Üyeyi çıkarır, kalıcı yasak bırakmaz.', usage: 'softban <kullanıcıId> [sebep]', guildOnly: true, requiredPermission: 'moderator',
      async execute(ctx) {
        const userId = Number(ctx.args.shift()); const reason = ctx.args.join(' ').trim() || 'Sebep belirtilmedi.';
        if (!Number.isInteger(userId)) return ctx.reply(`Kullanım: ${ctx.config.prefix}softban <kullanıcıId> [sebep]`);
        await ctx.client.kickMember(ctx.groupId, userId);
        await ctx.services.audit.write('moderation.softban', { actorUserId: ctx.userId, targetUserId: userId, reason }, { groupId: ctx.groupId });
        return ctx.reply(`Kullanıcı #${userId} softban ile çıkarıldı.`);
      }
    });

    app.router.register({
      name: 'timeout', aliases: ['sustur', 'mute'], category: 'Moderasyon', description: 'Susturma rolüyle süreli timeout uygular.', usage: 'timeout <kullanıcıId> <süre|0> [sebep]', guildOnly: true, requiredPermission: 'moderator',
      async execute(ctx) {
        const userId = Number(ctx.args.shift()); const rawDuration = String(ctx.args.shift() || '');
        const durationMs = rawDuration === '0' ? 0 : parseDuration(rawDuration, { min: 1000, max: 365 * 86_400_000 });
        const reason = ctx.args.join(' ').trim() || 'Sebep belirtilmedi.';
        if (!Number.isInteger(userId) || durationMs === null) return ctx.reply(`Kullanım: ${ctx.config.prefix}timeout <kullanıcıId> <10m|2h|1d|0> [sebep]`);
        const settings = await ctx.services.settings.get(ctx.groupId); const roleId = Number(settings.moderation.muteRoleId);
        if (!Number.isInteger(roleId)) return ctx.reply(`Önce ${ctx.config.prefix}susturrol <rolId> kullanın.`);
        await ctx.services.roles.addMemberRoles(ctx.groupId, userId, [roleId]);
        const expiresAt = durationMs ? new Date(Date.now() + durationMs).toISOString() : null;
        await ctx.stores.sanctions.update((items) => { items.filter((item) => String(item.groupId) === String(ctx.groupId) && Number(item.userId) === userId && item.type === 'mute' && item.active).forEach((item) => { item.active = false; }); items.push({ id: `${Date.now()}-${userId}`, type: 'mute', groupId: ctx.groupId, userId, roleId, reason, moderatorUserId: ctx.userId, createdAt: new Date().toISOString(), expiresAt, active: true }); return items; });
        await ctx.services.audit.write('moderation.timeout', { actorUserId: ctx.userId, targetUserId: userId, reason, durationMs, roleId }, { groupId: ctx.groupId });
        return ctx.reply(`Kullanıcı #${userId} ${durationMs ? formatDuration(durationMs) : 'kalıcı'} timeout aldı.`);
      }
    });

    app.router.register({
      name: 'untimeout', aliases: ['susturmaç', 'susturmac', 'unmute'], category: 'Moderasyon', description: 'Timeout rolünü kaldırır.', usage: 'untimeout <kullanıcıId>', guildOnly: true, requiredPermission: 'moderator',
      async execute(ctx) {
        const userId = Number(ctx.args[0]); if (!Number.isInteger(userId)) return ctx.reply(`Kullanım: ${ctx.config.prefix}untimeout <kullanıcıId>`);
        const settings = await ctx.services.settings.get(ctx.groupId); const roleId = Number(settings.moderation.muteRoleId);
        if (!Number.isInteger(roleId)) return ctx.reply('Susturma rolü ayarlı değil.');
        await ctx.services.roles.removeMemberRoles(ctx.groupId, userId, [roleId]);
        await ctx.stores.sanctions.update((items) => { items.filter((item) => String(item.groupId) === String(ctx.groupId) && Number(item.userId) === userId && item.type === 'mute' && item.active).forEach((item) => { item.active = false; item.removedAt = new Date().toISOString(); }); return items; });
        return ctx.reply(`Kullanıcı #${userId} timeout kaldırıldı.`);
      }
    });

    app.router.register({
      name: 'susturrol', category: 'Moderasyon', description: 'Timeout rolünü ayarlar.', usage: 'susturrol <rolId|0>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const roleId = Number(ctx.args[0]); if (!Number.isInteger(roleId) || roleId < 0) return ctx.reply(`Kullanım: ${ctx.config.prefix}susturrol <rolId|0>`);
        await ctx.services.settings.set(ctx.groupId, 'moderation.muteRoleId', roleId || null);
        return ctx.reply(roleId ? `Timeout rolü #${roleId} ayarlandı.` : 'Timeout rolü kapatıldı.');
      }
    });

    app.router.register({
      name: 'sil', aliases: ['mesajsil'], category: 'Moderasyon', description: 'ID ile gönderi siler.', usage: 'sil <postId>', guildOnly: true, requiredPermission: 'moderator',
      async execute(ctx) { const postId = Number(ctx.args[0]); if (!Number.isInteger(postId)) return ctx.reply(`Kullanım: ${ctx.config.prefix}sil <postId>`); await ctx.client.deletePost(postId); await ctx.services.audit.write('moderation.post_delete', { actorUserId: ctx.userId, postId }, { groupId: ctx.groupId }); return ctx.reply(`Gönderi #${postId} silindi.`); }
    });

    app.router.register({
      name: 'temizle', aliases: ['clear', 'purge'], category: 'Moderasyon', description: 'Kanaldaki son mesajları siler.', usage: 'temizle <1-100> [kullanıcıId]', guildOnly: true, requiredPermission: 'moderator', cooldownMs: 5000,
      async execute(ctx) {
        const count = Number(ctx.args[0]); const userId = ctx.args[1] ? Number(ctx.args[1]) : null;
        if (!Number.isInteger(count) || count < 1 || count > 100 || (userId !== null && !Number.isInteger(userId))) return ctx.reply(`Kullanım: ${ctx.config.prefix}temizle <1-100> [kullanıcıId]`);
        const result = await ctx.client.listPosts(ctx.channelId);
        const posts = findArray(result, ['posts', 'list']).reverse().filter((post) => userId === null || Number(post.user_id) === userId).slice(0, count);
        let deleted = 0;
        for (const post of posts) { const id = postIdOf(post); if (!id) continue; try { await ctx.client.deletePost(id); deleted += 1; } catch {} }
        await ctx.services.audit.write('moderation.purge', { actorUserId: ctx.userId, channelId: ctx.channelId, requested: count, deleted, targetUserId: userId }, { groupId: ctx.groupId });
        return ctx.reply(`${deleted} gönderi silindi.`);
      }
    });

    const listSettingCommand = (name, aliases, key, label) => app.router.register({
      name, aliases, category: 'Moderasyon', description: `${label} listesini yönetir.`, usage: `${name} <liste|ekle değer|sil değer>`, guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const action = String(ctx.args.shift() || 'liste').toLocaleLowerCase('tr-TR'); const value = ctx.args.join(' ').trim();
        const settings = await ctx.services.settings.get(ctx.groupId); let values = [...settings.moderation[key]];
        if (action === 'liste') return ctx.reply(`${label}: ${values.join(', ') || 'yok'}`);
        if (!value || !['ekle', 'sil'].includes(action)) return ctx.reply(`Kullanım: ${ctx.config.prefix}${name} <liste|ekle değer|sil değer>`);
        values = action === 'ekle' ? [...new Set([...values, value])] : values.filter((item) => normalizeText(item) !== normalizeText(value));
        await ctx.services.settings.set(ctx.groupId, `moderation.${key}`, values);
        return ctx.reply(`${label} güncellendi: ${values.join(', ') || 'yok'}`);
      }
    });
    listSettingCommand('küfürlistesi', ['kufurlistesi', 'yasaklıkelime', 'yasaklikelime'], 'bannedWords', 'Küfür/yasaklı kelimeler');
    listSettingCommand('yasaklıdomain', ['yasaklidomain'], 'bannedDomains', 'Yasaklı domainler');
    listSettingCommand('izinlidomain', [], 'allowedDomains', 'İzinli domainler');

    app.router.register({
      name: 'otomod', category: 'Moderasyon', description: 'Otomatik moderasyonu yapılandırır.', usage: 'otomod <durum|aç|kapat>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const action = String(ctx.args[0] || 'durum').toLocaleLowerCase('tr-TR'); const settings = await ctx.services.settings.get(ctx.groupId);
        if (action === 'durum') return ctx.reply(`Otomod: ${settings.moderation.enabled ? 'açık' : 'kapalı'}\nKüfür: ${settings.moderation.bannedWords.length}\nSpam: ${settings.moderation.antiSpam ? 'açık' : 'kapalı'}\nFlood: ${settings.moderation.antiFlood ? 'açık' : 'kapalı'}\nLink: ${settings.moderation.blockLinks ? 'engelli' : 'serbest'}\nMention limiti: ${settings.moderation.mentionLimit}\nSlowmode: ${settings.moderation.slowmodeSeconds} sn`);
        if (!['aç', 'ac', 'kapat'].includes(action)) return ctx.reply(`Kullanım: ${ctx.config.prefix}otomod <durum|aç|kapat>`);
        await ctx.services.settings.set(ctx.groupId, 'moderation.enabled', action !== 'kapat'); return ctx.reply(`Otomod ${action === 'kapat' ? 'kapatıldı' : 'açıldı'}.`);
      }
    });

    const toggleCommand = (name, aliases, path, label) => app.router.register({
      name, aliases, category: 'Moderasyon', description: `${label} açar/kapatır.`, usage: `${name} <aç|kapat>`, guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) { const action = String(ctx.args[0] || '').toLocaleLowerCase('tr-TR'); if (!['aç', 'ac', 'kapat'].includes(action)) return ctx.reply(`Kullanım: ${ctx.config.prefix}${name} <aç|kapat>`); await ctx.services.settings.set(ctx.groupId, path, action !== 'kapat'); return ctx.reply(`${label} ${action === 'kapat' ? 'kapatıldı' : 'açıldı'}.`); }
    });
    toggleCommand('linkengel', [], 'moderation.blockLinks', 'Link engeli');
    toggleCommand('spamkoruma', [], 'moderation.antiSpam', 'Spam koruması');
    toggleCommand('floodkoruma', [], 'moderation.antiFlood', 'Flood koruması');
    toggleCommand('capsfiltre', [], 'moderation.capsFilter', 'Caps filtresi');
    toggleCommand('mentionspam', [], 'moderation.mentionSpam', 'Mention spam koruması');
    toggleCommand('ihlalsil', [], 'moderation.deleteViolations', 'İhlal mesajı silme');

    app.router.register({
      name: 'slowmode', category: 'Moderasyon', description: 'Bot tabanlı slowmode ayarlar.', usage: 'slowmode <saniye|0>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) { const seconds = Number(ctx.args[0]); if (!Number.isInteger(seconds) || seconds < 0 || seconds > 3600) return ctx.reply(`Kullanım: ${ctx.config.prefix}slowmode <0-3600>`); await ctx.services.settings.set(ctx.groupId, 'moderation.slowmodeSeconds', seconds); return ctx.reply(seconds ? `Slowmode ${seconds} saniye.` : 'Slowmode kapatıldı.'); }
    });

    app.router.register({
      name: 'mentionlimit', category: 'Moderasyon', description: 'Mention spam limitini ayarlar.', usage: 'mentionlimit <2-50>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) { const count = Number(ctx.args[0]); if (!Number.isInteger(count) || count < 2 || count > 50) return ctx.reply(`Kullanım: ${ctx.config.prefix}mentionlimit <2-50>`); await ctx.services.settings.set(ctx.groupId, 'moderation.mentionLimit', count); return ctx.reply(`Mention limiti ${count}.`); }
    });

    app.router.register({
      name: 'spamlimit', category: 'Moderasyon', description: 'Spam limitini ayarlar.', usage: 'spamlimit <mesaj> <saniye>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) { const count = Number(ctx.args[0]); const seconds = Number(ctx.args[1]); if (!Number.isInteger(count) || count < 3 || !Number.isInteger(seconds) || seconds < 2) return ctx.reply(`Kullanım: ${ctx.config.prefix}spamlimit <en az 3> <en az 2>`); await ctx.services.settings.set(ctx.groupId, 'moderation.spamMessageCount', count); await ctx.services.settings.set(ctx.groupId, 'moderation.spamIntervalSeconds', seconds); return ctx.reply(`Spam limiti ${seconds} saniyede ${count} mesaj.`); }
    });

    app.router.register({
      name: 'floodlimit', category: 'Moderasyon', description: 'Tekrarlanan mesaj flood limitini ayarlar.', usage: 'floodlimit <tekrar> <saniye>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) { const count = Number(ctx.args[0]); const seconds = Number(ctx.args[1]); if (!Number.isInteger(count) || count < 2 || !Number.isInteger(seconds) || seconds < 5) return ctx.reply(`Kullanım: ${ctx.config.prefix}floodlimit <en az 2> <en az 5>`); await ctx.services.settings.set(ctx.groupId, 'moderation.duplicateMessageCount', count); await ctx.services.settings.set(ctx.groupId, 'moderation.duplicateIntervalSeconds', seconds); return ctx.reply(`Flood limiti ${seconds} saniyede ${count} aynı mesaj.`); }
    });

    app.router.register({
      name: 'modlog', aliases: ['auditlog'], category: 'Moderasyon', description: 'Son moderasyon/audit kayıtlarını gösterir.', usage: 'modlog [adet]', guildOnly: true, requiredPermission: 'moderator',
      async execute(ctx) { const count = Math.max(1, Math.min(20, Number(ctx.args[0]) || 10)); const entries = (await ctx.stores.audit.read()).filter((entry) => String(entry.groupId) === String(ctx.groupId)).slice(-count).reverse(); if (!entries.length) return ctx.reply('Audit kaydı yok.'); return ctx.reply(truncate(entries.map((entry) => `${entry.createdAt} | ${entry.type} | yapan #${entry.actorUserId ?? '-'} | hedef #${entry.targetUserId ?? '-'}`).join('\n'), 1800)); }
    });

    app.router.register({
      name: 'modkomutları', aliases: ['modkomutlari'], category: 'Moderasyon', description: 'Moderasyon komutlarını listeler.', usage: 'modkomutları', guildOnly: true, requiredPermission: 'moderator',
      async execute(ctx) { const commands = ctx.router.list({ userId: ctx.userId }).filter((command) => command.category === 'Moderasyon'); return ctx.reply(`Moderasyon komutları:\n${commands.map((command) => `${ctx.config.prefix}${command.usage} — ${command.description}`).join('\n')}`); }
    });
  }
};
