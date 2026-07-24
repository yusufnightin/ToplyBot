const { truncate } = require('../utils/text');

function groupCommands(commands) {
  const categories = new Map();
  for (const command of commands) {
    const category = command.category || 'Genel';
    if (!categories.has(category)) categories.set(category, []);
    categories.get(category).push(command);
  }
  return categories;
}

async function fallbackHelp(ctx, requested = null) {
  if (requested) {
    const command = ctx.router.getCommand(requested);
    if (!command || !ctx.app.permissionManager.has(ctx.userId, command.requiredPermission)) {
      return ctx.reply('Bu isimde kullanabileceğiniz bir komut bulunamadı.');
    }
    return ctx.reply([
      `Komut: ${ctx.config.prefix}${command.name}`,
      `Kullanım: ${ctx.config.prefix}${command.usage}`,
      `Kategori: ${command.category}`,
      `Yetki: ${command.requiredPermission}`,
      `Açıklama: ${command.description}`,
      command.aliases.length ? `Takma adlar: ${command.aliases.join(', ')}` : null
    ].filter(Boolean).join('\n'));
  }

  const categories = groupCommands(ctx.router.list({ userId: ctx.userId }));
  const sections = [...categories.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'tr'))
    .map(([category, commands]) => {
      const names = commands.sort((a, b) => a.name.localeCompare(b.name, 'tr'))
        .map((command) => `${ctx.config.prefix}${command.name}`)
        .join(', ');
      return `${category}: ${names}`;
    });
  return ctx.reply(`Komutlar (${ctx.permission}):\n${sections.join('\n')}\n\nAyrıntı: ${ctx.config.prefix}yardım <komut>`);
}

module.exports = {
  name: 'Temel Komutlar ve JTML Komut Merkezi',
  setup(app) {
    // Topluyo bot API'si yazı yazılırken tuş olayını iletmez. Kullanıcı yalnızca
    // prefix karakterini mesaj olarak gönderdiğinde JTML komut merkezi açılır.
    app.client.on('message', (event) => {
      const supported = new Set(['post/add', 'message/send']);
      if (!supported.has(event?.action) || typeof event.message !== 'string') return;
      const menuConfig = app.services.commandMenu?.config?.() || {};
      if (!menuConfig.enabled || !menuConfig.openOnBarePrefix) return;
      if (event.message.trim() !== app.config.prefix) return;

      const groupId = app.groupResolver?.resolve(event) ?? event.group_id ?? null;
      app.services.commandMenu.open({
        userId: Number(event.user_id),
        channelId: event.channel_id,
        groupId
      }).catch((error) => {
        app.logger.error('JTML komut merkezi açılamadı.', error);
      });
    });

    app.router.register({
      name: 'ping',
      aliases: ['test'],
      category: 'Genel',
      description: 'Bot bağlantısını ve cevap süresini kontrol eder.',
      usage: 'ping',
      cooldownMs: 1000,
      async execute(ctx) {
        const startedAt = Date.now();
        await ctx.reply(`Pong! Bot aktif. Yetkin: ${ctx.permission}.`);
        ctx.logger.info('Ping komutu çalıştı.', { userId: ctx.userId, elapsedMs: Date.now() - startedAt });
      }
    });

    app.router.register({
      name: 'yardım',
      aliases: ['yardim', 'help', 'komutlar', 'menü', 'menu', 'komutmenü', 'komutmenu'],
      category: 'Genel',
      description: 'JTML sekmeli görsel komut merkezini açar.',
      usage: 'yardım [komut]',
      cooldownMs: 1200,
      async execute(ctx) {
        const requested = ctx.args[0] || null;
        if (requested) {
          const command = ctx.router.getCommand(requested);
          if (!command || !ctx.app.permissionManager.has(ctx.userId, command.requiredPermission)) {
            return ctx.reply('Bu isimde kullanabileceğiniz bir komut bulunamadı.');
          }
        }
        if (!ctx.services.commandMenu?.config?.().enabled) {
          return fallbackHelp(ctx, requested);
        }

        const result = await ctx.services.commandMenu.openFromContext(ctx, {
          commandName: requested
        });
        if (!result?.opened) return fallbackHelp(ctx, requested);
        if (!result.attached) {
          ctx.logger.warn('Yardım menüsü gönderildi ancak post ID alınamadığı için etkileşim oturumu kaydedilemedi.', {
            channelId: ctx.channelId,
            userId: ctx.userId
          });
        }
        return result;
      }
    });

    app.router.register({
      name: 'kimlik',
      aliases: ['id', 'benkimim'],
      category: 'Genel',
      description: 'Kullanıcı, kanal, grup ve yetki kimliğini gösterir.',
      usage: 'kimlik',
      async execute(ctx) {
        await ctx.reply([
          `Kullanıcı ID: ${ctx.userId}`,
          `Kanal ID: ${ctx.channelId ?? 'özel mesaj'}`,
          `Grup ID: ${ctx.groupId ?? 'eşleştirilmemiş'}`,
          `Bot yetkisi: ${ctx.permission}`
        ].join('\n'));
      }
    });

    app.router.register({
      name: 'ara',
      category: 'Genel',
      description: 'Topluyo üzerinde kullanıcı veya grup arar.',
      usage: 'ara <metin>',
      cooldownMs: 3000,
      async execute(ctx) {
        const text = ctx.args.join(' ').trim();
        if (!text) return ctx.reply(`Kullanım: ${ctx.config.prefix}ara <metin>`);
        const result = await ctx.client.api('/!api/public/search', { text });
        await ctx.reply(`Arama sonucu:\n${truncate(JSON.stringify(result, null, 2), 1500)}`, 'json');
      }
    });

    app.router.register({
      name: 'sunucusaat',
      aliases: ['saat'],
      category: 'Genel',
      description: 'Topluyo sunucu saatini getirir.',
      usage: 'sunucusaat',
      cooldownMs: 3000,
      async execute(ctx) {
        const result = await ctx.client.api('/!api/test/time', {});
        await ctx.reply(`Topluyo sunucu zamanı: ${truncate(JSON.stringify(result), 300)}`);
      }
    });

    app.router.register({
      name: 'sunucu',
      aliases: ['grup'],
      category: 'Genel',
      description: 'Aktif grubun temel bilgilerini getirir.',
      usage: 'sunucu',
      guildOnly: true,
      cooldownMs: 3000,
      async execute(ctx) {
        const result = await ctx.client.api('/!api/group/get', { id: ctx.groupId });
        await ctx.reply(`Grup #${ctx.groupId}:\n${truncate(JSON.stringify(result, null, 2), 1500)}`, 'json');
      }
    });
  }
};

module.exports.fallbackHelp = fallbackHelp;
