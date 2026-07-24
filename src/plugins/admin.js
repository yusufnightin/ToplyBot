const { findArray, findObject } = require('../utils/api');
const { assertApiSuccess } = require('../utils/apiResult');

function parseGroupReference(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Topluyo sunucu bağlantısını yazmalısın.');

  if (/^\d+$/.test(raw)) return { id: Number(raw), label: raw };

  let candidate = raw;
  if (/^(?:[\w-]+\.)*topluyo\.com\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  if (!/^https?:\/\//i.test(candidate)) {
    if (/^[\p{L}\p{N}._~-]{1,100}$/u.test(candidate)) {
      return { nick: candidate, label: candidate };
    }
    throw new Error('Geçerli bir Topluyo sunucu bağlantısı yazmalısın.');
  }

  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('Sunucu bağlantısı okunamadı.');
  }

  const hostname = url.hostname.toLocaleLowerCase('tr-TR');
  if (hostname !== 'topluyo.com' && !hostname.endsWith('.topluyo.com')) {
    throw new Error('Yalnızca topluyo.com sunucu bağlantıları kullanılabilir.');
  }

  const queryId = Number(url.searchParams.get('group_id') || url.searchParams.get('id'));
  if (Number.isInteger(queryId) && queryId > 0) {
    return { id: queryId, label: String(queryId) };
  }

  const parts = url.pathname
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
  if (parts[0]?.toLocaleLowerCase('tr-TR') === 'group') parts.shift();

  const nick = parts[0];
  if (!nick || nick.toLocaleLowerCase('tr-TR') === '!api') {
    throw new Error('Bağlantıda sunucu kısa adı bulunamadı.');
  }
  if (/^\d+$/.test(nick)) return { id: Number(nick), label: nick };
  return { nick, label: nick };
}

async function resolveGroup(client, reference) {
  const result = reference.id
    ? await client.getGroup(reference.id)
    : await client.getGroupByNick(reference.nick);
  assertApiSuccess(result, 'Sunucu bağlantısını çözme');

  const group = findObject(result, ['group', 'info'])
    || findArray(result, ['groups', 'items', 'list'])[0]
    || {};
  const id = Number(group.group_id ?? group.groupId ?? group.id ?? reference.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Sunucu bulundu fakat sunucu ID bilgisi alınamadı.');
  }

  return {
    id,
    name: String(group.name || group.title || group.nick || reference.label || `Sunucu #${id}`)
  };
}

module.exports = {
  name: 'Yönetim Komutları',
  setup(app) {
    app.router.register({
      name: 'bosshere',
      category: 'Yönetim',
      description: 'ToplyBot’u verilen Topluyo sunucusuna katılmaya gönderir.',
      usage: 'bosshere <sunucuLinki>',
      requiredPermission: 'owner',
      cooldownMs: 10000,
      async execute(ctx) {
        const raw = ctx.args.join(' ').trim();
        if (!raw) {
          await ctx.reply(`Kullanım: ${ctx.config.prefix}bosshere <Topluyo sunucu linki>`);
          return;
        }

        const reference = parseGroupReference(raw);
        const target = await resolveGroup(ctx.client, reference);
        const result = await ctx.client.joinGroup(target.id);
        assertApiSuccess(result, 'Sunucuya katılım');

        await ctx.reply([
          `✅ ToplyBot, ${target.name} (#${target.id}) sunucusuna gönderildi.`,
          'Sunucuda katılım onayı açıksa bekleyen bot isteğini sunucu yönetiminden onayla.'
        ].join('\n'));
      }
    });

    app.router.register({
      name: 'duyuru',
      category: 'Yönetim',
      description: 'Yapılandırılmış duyuru kanalına mesaj gönderir.',
      usage: 'duyuru <mesaj>',
      requiredPermission: 'admin',
      guildOnly: true,
      cooldownMs: 5000,
      async execute(ctx) {
        const settings = await ctx.services.settings.get(ctx.groupId);
        const channelId = settings.channels.announcements;
        const text = ctx.args.join(' ').trim();
        if (!channelId) {
          await ctx.reply('Duyuru kanalı tanımlı değil. !kanalayarla announcements <kanalId> komutunu kullanın.');
          return;
        }
        if (!text) {
          await ctx.reply(`Kullanım: ${ctx.config.prefix}duyuru <mesaj>`);
          return;
        }
        await ctx.client.sendPost(channelId, text);
        await ctx.reply('Duyuru gönderildi.');
      }
    });

    app.router.register({
      name: 'mesaj',
      category: 'Yönetim',
      description: 'Bir kullanıcıya özel mesaj gönderir.',
      usage: 'mesaj <kullanıcıId> <mesaj>',
      requiredPermission: 'admin',
      cooldownMs: 3000,
      async execute(ctx) {
        const userId = Number(ctx.args.shift());
        const message = ctx.args.join(' ').trim();
        if (!Number.isInteger(userId) || !message) {
          await ctx.reply(`Kullanım: ${ctx.config.prefix}mesaj <kullanıcıId> <mesaj>`);
          return;
        }
        await ctx.client.sendDirectMessage(userId, message);
        await ctx.reply(`Mesaj kullanıcı #${userId} için gönderildi.`);
      }
    });

    app.router.register({
      name: 'rozetver',
      category: 'Rozet',
      description: 'Bir kullanıcıya rozet verir.',
      usage: 'rozetver <rozetId> <kullanıcıId>',
      requiredPermission: 'admin',
      cooldownMs: 5000,
      async execute(ctx) {
        const badgeId = Number(ctx.args[0]);
        const userId = Number(ctx.args[1]);
        if (!Number.isInteger(badgeId) || !Number.isInteger(userId)) {
          await ctx.reply(`Kullanım: ${ctx.config.prefix}rozetver <rozetId> <kullanıcıId>`);
          return;
        }
        await ctx.client.api('/!api/badge/give', { badge_id: badgeId, user_id: userId });
        await ctx.reply(`Rozet #${badgeId}, kullanıcı #${userId} için gönderildi.`);
      }
    });
  }
};

module.exports.parseGroupReference = parseGroupReference;
module.exports.resolveGroup = resolveGroup;
