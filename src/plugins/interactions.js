const { truncate } = require('../utils/text');

module.exports = {
  name: 'Bumote Etkileşim Motoru',
  setup(app) {
    app.client.on('message', (event) => {
      if (event?.action !== 'post/bumote' || !event.message?.form) return;
      app.logger?.info?.('Bumote/JTML tıklaması alındı.', {
        postId: Number(event.post_id) || null,
        userId: Number(event.user_id) || null,
        submit: String(event.message.submit || '').slice(0, 120),
        resolvedAction: app.services.commandMenu?.extractAction?.(event) || null,
        form: (() => {
          try { return truncate(JSON.stringify(event.message.form), 500); }
          catch { return '[form okunamadı]'; }
        })()
      });
      (async () => {
        const menuHandled = await app.services.commandMenu?.handle(event);
        if (!menuHandled) await app.services.interactions.handle(event);
      })().catch((error) => {
        app.logger.error('JTML/Bumote etkileşim olayı işlenemedi.', error);
      });
    });

    app.router.register({
      name: 'etkileşim', aliases: ['etkilesim', 'interaction'], category: 'Etkileşim',
      description: 'Bumote buton/form etkileşimlerini yönetir.',
      usage: 'etkileşim <liste|durum postId|aç postId|kapat postId>',
      guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const action = String(ctx.args.shift() || 'liste').toLocaleLowerCase('tr-TR');
        if (action === 'liste') {
          const items = await ctx.services.interactions.list(ctx.groupId);
          return ctx.reply(`Etkileşimler:\n${truncate(items.map((item) => `Post #${item.postId} — ${item.active ? 'açık' : 'kapalı'} — ${item.actions.length} işlem — ${item.uses || 0} kullanım`).join('\n') || 'yok', 1800)}`);
        }

        const postId = Number(ctx.args[0]);
        if (!Number.isInteger(postId)) return ctx.reply(`Kullanım: ${ctx.config.prefix}etkileşim <durum|aç|kapat> <postId>`);
        const item = await ctx.services.interactions.getByPostId(postId);
        if (!item || String(item.groupId) !== String(ctx.groupId)) return ctx.reply('Etkileşim kaydı bulunamadı.');

        if (action === 'durum') {
          return ctx.reply(truncate(JSON.stringify(item, null, 2), 1700), 'json');
        }
        if (['aç', 'ac'].includes(action)) {
          await ctx.services.interactions.setActive(postId, true);
          return ctx.reply(`Post #${postId} etkileşimleri açıldı.`);
        }
        if (action === 'kapat') {
          await ctx.services.interactions.setActive(postId, false);
          return ctx.reply(`Post #${postId} etkileşimleri kapatıldı.`);
        }
        return ctx.reply('Bilinmeyen etkileşim işlemi.');
      }
    });
  }
};
