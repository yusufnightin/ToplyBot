const { truncate } = require('../utils/text');
const { findObject } = require('../utils/api');

function progressBar(percent, width = 16) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  const filled = Math.round((value / 100) * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} %${Math.round(value)}`;
}

function parsePositiveInt(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

module.exports = {
  name: 'Seviye ve Rozet Sistemi',
  setup(app) {
    const cooldowns = new Map();
    const duplicateGuard = new Map();
    const countedPostGuard = new Map();

    app.client.on('message', async (event) => {
      try {
        if (!['post/add', 'post/mention'].includes(event?.action) || typeof event.message !== 'string') return;
        const groupId = app.groupResolver.resolve(event);
        const eventUserId = Number(event.user_id);
        if (groupId === null || !Number.isInteger(eventUserId)) return;
        if (Number(app.client.userId) === eventUserId) return;
        const settings = await app.services.leveling.settings(groupId);
        const now = Date.now();
        const normalizedMessage = event.message.toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim().slice(0, 300);
        const postId = Number(event.post_id ?? event.postId ?? event.id);
        const countKey = Number.isInteger(postId) && postId > 0
          ? `${groupId}:post:${postId}`
          : `${groupId}:${eventUserId}:${Number(event.channel_id) || 0}:${normalizedMessage}`;
        const countWindowMs = Number.isInteger(postId) && postId > 0 ? 10 * 60_000 : 2_000;
        const lastCountedAt = countedPostGuard.get(countKey) || 0;
        if (now - lastCountedAt < countWindowMs) return;
        countedPostGuard.set(countKey, now);
        if (countedPostGuard.size > 5000) {
          for (const [key, seenAt] of countedPostGuard) {
            if (now - seenAt > 10 * 60_000) countedPostGuard.delete(key);
          }
        }

        let counted;
        try {
          counted = await app.services.leveling.recordMessage({
            groupId,
            userId: eventUserId,
            channelId: event.channel_id,
            message: event.message,
            settings
          });
        } catch (error) {
          countedPostGuard.delete(countKey);
          throw error;
        }
        if (!counted.counted) return;

        const eligibility = app.services.leveling.canEarnFromMessage({ settings, channelId: event.channel_id, message: event.message });
        if (!eligibility.allowed) return;

        const key = `${groupId}:${event.user_id}`;
        const cooldownMs = Math.max(0, Number(settings.cooldownSeconds) || 0) * 1000;
        if (now - (cooldowns.get(key) || 0) < cooldownMs) return;

        const duplicate = duplicateGuard.get(key);
        if (duplicate && duplicate.text === normalizedMessage && now - duplicate.at < Math.max(30_000, cooldownMs * 2)) return;
        cooldowns.set(key, now);
        duplicateGuard.set(key, { text: normalizedMessage, at: now });

        const result = await app.services.leveling.addMessageXp({
          groupId,
          userId: eventUserId,
          channelId: event.channel_id,
          message: event.message,
          countMessage: false
        });
        if (!result.awarded || result.afterLevel <= result.beforeLevel) return;

        const groupSettings = await app.services.settings.get(groupId);
        const channelId = groupSettings.channels.levels || event.channel_id;
        if (settings.announceLevelUp !== false && channelId) {
          const template = String(settings.levelUpMessage || '⭐ Tebrikler kullanıcı #{userId}! Seviye {level} oldun.');
          const rewardParts = [];
          if (result.rewards.roles.length) rewardParts.push(`🎭 ${result.rewards.roles.length} rol`);
          if (result.rewards.badges.length) rewardParts.push(`🏅 ${result.rewards.badges.length} rozet`);
          const text = template
            .replaceAll('{userId}', String(event.user_id))
            .replaceAll('{level}', String(result.afterLevel))
            .replaceAll('{xp}', String(result.profile.xp));
          await app.client.sendPost(channelId, `${text}${rewardParts.length ? `\nÖdüller: ${rewardParts.join(' • ')}` : ''}`);
        }
        await app.services.audit.write('level.up', {
          targetUserId: eventUserId, level: result.afterLevel, xp: result.profile.xp,
          roles: result.rewards.roles, badges: result.rewards.badges
        }, { groupId, notify: false });
      } catch (error) {
        app.logger.error('Seviye olayı işlenemedi.', error);
      }
    });

    app.router.register({
      name: 'rank', aliases: ['seviye', 'level'], category: 'Seviye', description: 'Seviye, XP, ilerleme ve kazanılan rozetleri gösterir.', usage: 'rank [kullanıcıId]', guildOnly: true, cooldownMs: 3000,
      async execute(ctx) {
        const userId = Number(ctx.args[0] || ctx.userId);
        if (!Number.isInteger(userId)) return ctx.reply('Geçerli kullanıcı ID girin.');
        const [profile, settings] = await Promise.all([
          ctx.services.leveling.getProfile(ctx.groupId, userId),
          ctx.services.leveling.settings(ctx.groupId)
        ]);
        const progress = ctx.services.leveling.progress(profile, settings);
        let userName = `Kullanıcı #${userId}`;
        try {
          const user = findObject(await ctx.client.getUser(userId), ['user', 'profile']) || {};
          userName = user.name || user.nick || userName;
        } catch {}
        const nextBadge = ctx.services.leveling.nextBadgeReward(settings, profile.level);
        if (settings.cardEnabled) {
          try {
            const card = await ctx.services.cards.createRankCard({
              userId, userName, level: profile.level, xp: profile.xp,
              currentLevelXp: progress.currentLevelXp, nextLevelXp: progress.nextLevelXp,
              messages: profile.messages,
              earnedBadges: profile.awardedBadgeIds.length,
              nextBadge,
              accent: settings.cardAccent
            });
            // URL tek satır olmalı; Topluyo bu şekilde kartı doğrudan görsel
            // olarak açar. Public URL yoksa aynı bilgiler native JTML kartındadır.
            if (card.url) return ctx.reply(card.url);
            if (card.jtml) return ctx.reply(card.jtml);
          } catch (error) {
            app.logger?.warn?.('Rank kartı üretilemedi; metin görünümüne dönülüyor.', {
              groupId: ctx.groupId, userId, message: error.message
            });
          }
        }
        const lines = [
          `⭐ ${userName}`,
          `Seviye: ${profile.level} • Toplam XP: ${profile.xp}`,
          `${progressBar(progress.percent)} (${progress.gained}/${progress.required})`,
          `Mesaj: ${profile.messages} • Kazanılan seviye rozeti: ${profile.awardedBadgeIds.length}`,
          `Sonraki seviye: ${profile.level + 1} • ${Math.max(0, progress.nextLevelXp - profile.xp)} XP kaldı`,
          `Sıradaki rozet: ${nextBadge ? `${nextBadge.emoji} ${nextBadge.title} (Lv.${nextBadge.level})` : 'henüz bağlı değil'}`
        ];
        return ctx.reply(lines.join('\n'));
      }
    });

    app.router.register({
      name: 'toprank', aliases: ['leveltop', 'liderlik', 'leaderboard', 'top'], category: 'Seviye', description: 'Sunucunun XP liderlik tablosunu SVG görseliyle gösterir.', usage: 'toprank [sayfa]', guildOnly: true, cooldownMs: 5000,
      async execute(ctx) {
        const profiles = (await ctx.services.leveling.listProfiles(ctx.groupId))
          .sort((a, b) => b.xp - a.xp || b.messages - a.messages || a.userId - b.userId);
        if (!profiles.length) return ctx.reply('Henüz seviye verisi yok.');

        const pageSize = 5;
        const totalPages = Math.max(1, Math.ceil(profiles.length / pageSize));
        const requestedPage = Math.max(1, Math.trunc(Number(ctx.args[0]) || 1));
        const page = Math.min(requestedPage, totalPages);
        const offset = (page - 1) * pageSize;
        const pageProfiles = profiles.slice(offset, offset + pageSize);
        const ranking = await Promise.all(pageProfiles.map(async (profile, index) => {
          let userName = `Kullanıcı #${profile.userId}`;
          try {
            const user = findObject(await ctx.client.getUser(profile.userId), ['user', 'profile']) || {};
            userName = user.name || user.nick || user.username || userName;
          } catch {}
          return {
            rank: offset + index + 1,
            userId: profile.userId,
            userName,
            level: profile.level,
            xp: profile.xp,
            messages: profile.messages,
            badges: profile.awardedBadgeIds?.length || 0
          };
        }));
        let groupName = `Sunucu #${ctx.groupId}`;
        try {
          const group = findObject(await ctx.client.getGroup(ctx.groupId), ['group', 'info']) || {};
          groupName = group.name || group.title || group.nick || groupName;
        } catch {}

        try {
          const settings = await ctx.services.leveling.settings(ctx.groupId);
          const card = await ctx.services.cards.createTopRankCard({
            groupName,
            ranking,
            page,
            totalProfiles: profiles.length,
            totalPages,
            accent: settings.cardAccent
          });
          if (card.url) return ctx.reply(card.url);
          if (card.jtml) return ctx.reply(card.jtml);
        } catch (error) {
          app.logger?.warn?.('Toprank kartı üretilemedi; metin görünümüne dönülüyor.', {
            groupId: ctx.groupId, page, message: error.message
          });
        }
        return ctx.reply(`🏆 Seviye sıralaması • Sayfa ${page}/${totalPages}:\n${truncate(ranking.map((item) => `${item.rank}. ${item.userName} — Lv.${item.level} — ${item.xp} XP — ${item.badges} rozet`).join('\n'), 1800)}`);
      }
    });

    app.router.register({
      name: 'istatistik', aliases: ['kullanıcıistatistik', 'kullaniciistatistik'], category: 'Seviye', description: 'Kullanıcının mesaj, XP, günlük XP ve rozet istatistiklerini gösterir.', usage: 'istatistik [kullanıcıId]', guildOnly: true,
      async execute(ctx) {
        const userId = Number(ctx.args[0] || ctx.userId);
        const profile = await ctx.services.leveling.getProfile(ctx.groupId, userId);
        return ctx.reply(`Kullanıcı #${userId}\nMesaj: ${profile.messages}\nXP: ${profile.xp}\nSeviye: ${profile.level}\nBugünkü XP: ${profile.daily.xp}\nSeviye rozetleri: ${profile.awardedBadgeIds.join(', ') || 'yok'}\nSon aktivite: ${profile.updatedAt || 'yok'}`);
      }
    });

    app.router.register({
      name: 'leveldurum', aliases: ['seviyedurum'], category: 'Seviye', description: 'Sunucunun seviye ve rozet ayarlarını özetler.', usage: 'leveldurum', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const snapshot = await ctx.services.leveling.dashboard(ctx.groupId, ctx.userId);
        const s = snapshot.settings;
        return ctx.reply([
          `⭐ Seviye sistemi: ${s.enabled ? 'Açık' : 'Kapalı'}`,
          `XP: ${s.xpMin}-${s.xpMax} • Çarpan x${s.multiplier} • Cooldown ${s.cooldownSeconds} sn`,
          `Minimum mesaj: ${s.minMessageLength} • Günlük tavan: ${s.dailyXpCap || 'sınırsız'}`,
          `Üye profili: ${snapshot.totalProfiles} • Toplam XP: ${snapshot.totalXp}`,
          `Rol ödülü: ${Object.keys(snapshot.roleRewards).length} • Rozet ödülü: ${Object.keys(snapshot.badgeRewards).length}`
        ].join('\n'));
      }
    });

    app.router.register({
      name: 'seviyeayar', category: 'Seviye', description: 'Seviye sistemini açar veya kapatır.', usage: 'seviyeayar <aç|kapat>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const action = String(ctx.args[0] || '').toLocaleLowerCase('tr-TR');
        if (!['aç', 'ac', 'kapat'].includes(action)) return ctx.reply(`Kullanım: ${ctx.config.prefix}seviyeayar <aç|kapat>`);
        await ctx.services.settings.set(ctx.groupId, 'leveling.enabled', action !== 'kapat');
        return ctx.reply(`Seviye sistemi ${action === 'kapat' ? 'kapatıldı' : 'açıldı'}.`);
      }
    });

    app.router.register({
      name: 'xpayar', category: 'Seviye', description: 'Mesaj XP aralığını ve cooldown süresini ayarlar.', usage: 'xpayar <minXP> [maxXP] <saniye>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        let min = Number(ctx.args[0]);
        let max = Number(ctx.args[1]);
        let seconds = Number(ctx.args[2]);
        if (ctx.args.length === 2) {
          max = min;
          seconds = Number(ctx.args[1]);
        }
        if (!Number.isInteger(min) || min < 1 || min > 1000 || !Number.isInteger(max) || max < min || max > 1000 || !Number.isInteger(seconds) || seconds < 0 || seconds > 3600) {
          return ctx.reply(`Kullanım: ${ctx.config.prefix}xpayar <1-1000 min> [max] <0-3600 saniye>`);
        }
        await ctx.services.settings.set(ctx.groupId, 'leveling.xpMin', min);
        await ctx.services.settings.set(ctx.groupId, 'leveling.xpMax', max);
        await ctx.services.settings.set(ctx.groupId, 'leveling.xpPerMessage', min);
        await ctx.services.settings.set(ctx.groupId, 'leveling.cooldownSeconds', seconds);
        return ctx.reply(`Mesaj XP: ${min}-${max}, cooldown: ${seconds} sn.`);
      }
    });

    app.router.register({
      name: 'xpçarpan', aliases: ['xpcarpan'], category: 'Seviye', description: 'Sunucunun XP çarpanını ayarlar.', usage: 'xpçarpan <0.1-100>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const multiplier = Number(ctx.args[0]);
        if (!Number.isFinite(multiplier) || multiplier < 0.1 || multiplier > 100) return ctx.reply(`Kullanım: ${ctx.config.prefix}xpçarpan <0.1-100>`);
        await ctx.services.settings.set(ctx.groupId, 'leveling.multiplier', multiplier);
        return ctx.reply(`XP çarpanı x${multiplier}.`);
      }
    });

    app.router.register({
      name: 'xpver', aliases: ['addxp'], category: 'Seviye', description: 'Kullanıcıya XP ekler ve seviye ödüllerini uygular.', usage: 'xpver <kullanıcıId> <miktar>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const userId = parsePositiveInt(ctx.args[0]);
        const amount = parsePositiveInt(ctx.args[1]);
        if (!userId || !amount || amount > 100000000) return ctx.reply(`Kullanım: ${ctx.config.prefix}xpver <kullanıcıId> <miktar>`);
        const result = await ctx.services.leveling.changeXp({ groupId: ctx.groupId, userId, delta: amount, source: `admin:${ctx.userId}` });
        return ctx.reply(`✅ #${userId} kullanıcısına ${amount} XP verildi. Seviye ${result.profile.level}, toplam ${result.profile.xp} XP.${result.rewards.badges.length ? ` Rozet: ${result.rewards.badges.join(', ')}` : ''}`);
      }
    });

    app.router.register({
      name: 'xpal', aliases: ['removexp'], category: 'Seviye', description: 'Kullanıcıdan XP düşer.', usage: 'xpal <kullanıcıId> <miktar>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const userId = parsePositiveInt(ctx.args[0]);
        const amount = parsePositiveInt(ctx.args[1]);
        if (!userId || !amount) return ctx.reply(`Kullanım: ${ctx.config.prefix}xpal <kullanıcıId> <miktar>`);
        const result = await ctx.services.leveling.changeXp({ groupId: ctx.groupId, userId, delta: -amount, source: `admin:${ctx.userId}` });
        return ctx.reply(`✅ #${userId} kullanıcısından ${amount} XP düşüldü. Seviye ${result.profile.level}, toplam ${result.profile.xp} XP.`);
      }
    });

    app.router.register({
      name: 'seviyeset', aliases: ['levelset'], category: 'Seviye', description: 'Kullanıcıyı doğrudan belirli seviyeye getirir.', usage: 'seviyeset <kullanıcıId> <seviye>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const userId = parsePositiveInt(ctx.args[0]);
        const level = Number(ctx.args[1]);
        if (!userId || !Number.isInteger(level) || level < 0 || level > 10000) return ctx.reply(`Kullanım: ${ctx.config.prefix}seviyeset <kullanıcıId> <seviye>`);
        const result = await ctx.services.leveling.setLevel({ groupId: ctx.groupId, userId, level, source: `admin:${ctx.userId}` });
        return ctx.reply(`✅ #${userId} kullanıcısı Seviye ${result.profile.level} olarak ayarlandı (${result.profile.xp} XP).`);
      }
    });

    app.router.register({
      name: 'seviyerol', category: 'Seviye', description: 'Bir seviyeye otomatik rol ödülü bağlar.', usage: 'seviyerol <seviye> <rolId|sil>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const level = Number(ctx.args[0]);
        const roleValue = String(ctx.args[1] || '');
        if (!Number.isInteger(level) || level < 1 || !roleValue) return ctx.reply(`Kullanım: ${ctx.config.prefix}seviyerol <seviye> <rolId|sil>`);
        const remove = ['sil', '0'].includes(roleValue.toLocaleLowerCase('tr-TR'));
        const roleId = remove ? null : parsePositiveInt(roleValue);
        if (!remove && !roleId) return ctx.reply('Geçerli rol ID girin.');
        await ctx.services.leveling.mapRoleReward(ctx.groupId, level, roleId);
        if (remove) return ctx.reply(`✅ Seviye ${level} rol bağlantısı silindi.`);
        return ctx.reply(`✅ Seviye ${level} → Rol #${roleId} bağlandı.\nBu rol ücretsizdir; para veya rozet gerektirmez.`);
      }
    });

    app.router.register({
      name: 'seviyerozet', aliases: ['levelbadge'], category: 'Rozet', description: 'Bir seviyeye mevcut Topluyo rozetini bağlar.', usage: 'seviyerozet <seviye> <rozetId|sil>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const level = Number(ctx.args[0]);
        const badgeValue = String(ctx.args[1] || '');
        if (!Number.isInteger(level) || level < 1 || !badgeValue) return ctx.reply(`Kullanım: ${ctx.config.prefix}seviyerozet <seviye> <rozetId|sil>`);
        const remove = ['sil', '0'].includes(badgeValue.toLocaleLowerCase('tr-TR'));
        const badgeId = remove ? null : parsePositiveInt(badgeValue);
        if (!remove && !badgeId) return ctx.reply('Geçerli rozet ID girin.');
        const rewards = await ctx.services.leveling.mapBadgeReward(ctx.groupId, level, badgeId);
        return ctx.reply(`🏅 Seviye rozet ödülleri:\n${truncate(JSON.stringify(rewards, null, 2), 1200)}`, 'json');
      }
    });

    app.router.register({
      name: 'seviyerozetkur', aliases: ['levelbadgecreate'], category: 'Rozet', description: 'Yeni Topluyo rozeti oluşturur ve seviyeye otomatik bağlar.', usage: 'seviyerozetkur <seviye> [ad|nick|açıklama|görsel|kademe]', guildOnly: true, requiredPermission: 'owner', cooldownMs: 8000,
      async execute(ctx) {
        const level = Number(ctx.args.shift());
        if (!Number.isInteger(level) || level < 1) return ctx.reply(`Kullanım: ${ctx.config.prefix}seviyerozetkur <seviye> [ad|nick|açıklama|görsel|kademe]`);
        const parts = ctx.args.join(' ').split('|').map((item) => item.trim());
        const created = await ctx.services.leveling.createBadgeReward(ctx.groupId, level, {
          name: parts[0] || undefined,
          nick: parts[1] || undefined,
          description: parts[2] || undefined,
          image: parts[3] || undefined,
          tier: parts[4] || undefined
        });
        return ctx.reply(`✅ Seviye ${level} rozeti oluşturuldu ve bağlandı: ${created.payload.name} · ID ${created.id}`);
      }
    });

    app.router.register({
      name: 'seviyerozetpaket', aliases: ['levelbadgepack'], category: 'Rozet', description: 'Sunucu sahibine özel simgeli seviye rozet paketini oluşturur.', usage: 'seviyerozetpaket [1,5,10,20,30,50,75,100]', guildOnly: true, cooldownMs: 12000,
      async execute(ctx) {
        const levels = ctx.args.join(' ').trim()
          ? ctx.args.join(' ').split(/[\s,;]+/).map(Number)
          : [1, 5, 10, 20, 30, 50, 75, 100];
        const result = await ctx.services.leveling.createOwnerBadgePack({
          groupId: ctx.groupId,
          userId: ctx.userId,
          levels,
          progress: ctx.progress
        });
        return ctx.reply([
          `🎨 Simgeli rozet paketi tamamlandı.`,
          `Oluşturulan: ${result.created.map((item) => `Lv.${item.level}=#${item.badgeId}`).join(', ') || 'yok'}`,
          `Atlanan mevcut seviyeler: ${result.skipped.join(', ') || 'yok'}`,
          `Başarısız: ${result.failed.map((item) => `Lv.${item.level}: ${item.message}`).join(' • ') || 'yok'}`
        ].join('\n'));
      }
    });

    app.router.register({
      name: 'seviyerozetler', aliases: ['levelbadges'], category: 'Rozet', description: 'Seviyelere bağlı rol ve rozet ödüllerini listeler.', usage: 'seviyerozetler', guildOnly: true,
      async execute(ctx) {
        const settings = await ctx.services.leveling.settings(ctx.groupId);
        const levels = [...new Set([...Object.keys(settings.roleRewards || {}), ...Object.keys(settings.badgeRewards || {})])].map(Number).filter(Number.isInteger).sort((a, b) => a - b);
        if (!levels.length) return ctx.reply('Henüz seviye rolü veya rozeti bağlanmamış.');
        return ctx.reply(`🎁 Seviye ödülleri:\n${truncate(levels.map((level) => `Lv.${level} • Rol: ${settings.roleRewards?.[level] || '—'} • Rozet: ${settings.badgeRewards?.[level] || '—'}`).join('\n'), 1800)}`);
      }
    });

    app.router.register({
      name: 'levelrozetver', aliases: ['seviyerozetver', 'badgever'], category: 'Rozet', description: 'Bir Topluyo rozetini kullanıcıya verir ve seviye profiline kaydeder.', usage: 'levelrozetver <rozetId> <kullanıcıId>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const badgeId = parsePositiveInt(ctx.args[0]);
        const userId = parsePositiveInt(ctx.args[1]);
        if (!badgeId || !userId) return ctx.reply(`Kullanım: ${ctx.config.prefix}levelrozetver <rozetId> <kullanıcıId>`);
        await ctx.services.leveling.giveBadge({ groupId: ctx.groupId, userId, badgeId, source: `admin:${ctx.userId}` });
        return ctx.reply(`🏅 Rozet #${badgeId}, kullanıcı #${userId} hesabına verildi.`);
      }
    });

    app.router.register({
      name: 'seviyesenkron', aliases: ['levelsync', 'ödülsenkr', 'odulsenkr'], category: 'Seviye', description: 'Mevcut seviyeye göre eksik rol ve rozet ödüllerini yeniden uygular.', usage: 'seviyesenkron <kullanıcıId|tümü>', guildOnly: true, requiredPermission: 'admin', longRunning: true, cooldownMs: 8000,
      async execute(ctx) {
        const selector = String(ctx.args[0] || ctx.userId).toLocaleLowerCase('tr-TR');
        if (['tümü', 'tumu', 'all'].includes(selector)) {
          const result = await ctx.services.leveling.syncAllRewards(ctx.groupId, ctx.progress);
          return ctx.reply(`🔄 Ödül senkronizasyonu tamamlandı. Başarılı: ${result.succeeded}/${result.total}. Başarısız: ${result.failed.length}.`);
        }
        const userId = parsePositiveInt(selector);
        if (!userId) return ctx.reply(`Kullanım: ${ctx.config.prefix}seviyesenkron <kullanıcıId|tümü>`);
        const result = await ctx.services.leveling.syncUserRewards(ctx.groupId, userId, { source: `admin:${ctx.userId}` });
        return ctx.reply(`🔄 #${userId} ödülleri senkronlandı. Rol: ${result.rewards.roles.join(', ') || 'yok'} • Rozet: ${result.rewards.badges.join(', ') || 'yok'} • Hata: ${result.rewards.roleFailures.length + result.rewards.badgeFailures.length}`);
      }
    });

    app.router.register({
      name: 'levelreset', aliases: ['seviyesıfırla', 'seviyesifirla'], category: 'Seviye', description: 'Kullanıcı veya tüm grubun seviye verisini sıfırlar.', usage: 'levelreset <kullanıcıId|tümü>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const selector = String(ctx.args[0] || '');
        if (!selector) return ctx.reply(`Kullanım: ${ctx.config.prefix}levelreset <kullanıcıId|tümü>`);
        let removed = 0;
        await ctx.stores.levels.update((levels) => {
          if (['tümü', 'tumu', 'all'].includes(selector.toLocaleLowerCase('tr-TR'))) {
            for (const key of Object.keys(levels)) if (String(levels[key].groupId) === String(ctx.groupId)) { delete levels[key]; removed += 1; }
          } else {
            const userId = Number(selector);
            const key = `${ctx.groupId}:${userId}`;
            if (levels[key]) { delete levels[key]; removed = 1; }
          }
          return levels;
        });
        return ctx.reply(`${removed} seviye kaydı sıfırlandı. Topluyo üzerinde daha önce verilmiş rozetler API’de geri alma ucu bulunmadığı için korunur.`);
      }
    });

    app.router.register({
      name: 'rankkart', category: 'Seviye', description: 'SVG rank kartını açar veya kapatır.', usage: 'rankkart <aç|kapat>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const action = String(ctx.args[0] || '').toLocaleLowerCase('tr-TR');
        if (!['aç', 'ac', 'kapat'].includes(action)) return ctx.reply(`Kullanım: ${ctx.config.prefix}rankkart <aç|kapat>`);
        await ctx.services.settings.set(ctx.groupId, 'leveling.cardEnabled', action !== 'kapat');
        return ctx.reply(`Rank kartı ${action === 'kapat' ? 'kapatıldı' : 'açıldı'}.`);
      }
    });
  }
};
