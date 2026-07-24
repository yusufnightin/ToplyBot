const crypto = require('node:crypto');
const { parseDuration, formatDuration } = require('../utils/duration');

function nextId(items) { return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1; }

function chooseWinners(entries, count) {
  const pool = [...new Set(entries.map(Number).filter(Number.isInteger))];
  const winners = [];
  while (pool.length && winners.length < count) {
    winners.push(pool.splice(crypto.randomInt(pool.length), 1)[0]);
  }
  return winners;
}

module.exports = {
  name: 'Çekiliş Sistemi',
  setup(app) {
    const finish = async (giveaway, automatic = false) => {
      let updated = null;
      await app.stores.giveaways.update((items) => {
        const item = items.find((entry) => Number(entry.id) === Number(giveaway.id));
        if (!item || item.status !== 'open') return items;
        item.status = 'ended'; item.endedAt = new Date().toISOString(); item.automatic = automatic;
        item.winners = chooseWinners(item.entries, item.winnerCount);
        updated = { ...item };
        return items;
      });
      if (!updated) return null;
      const result = updated.winners.length ? updated.winners.map((id) => `#${id}`).join(', ') : 'Yeterli katılımcı yok.';
      await app.client.sendPost(updated.channelId, `🎉 Çekiliş #${updated.id} sona erdi!\nÖdül: ${updated.prize}\nKazananlar: ${result}\nKatılımcı: ${updated.entries.length}`);
      await app.services.audit.write('giveaway.end', { giveawayId: updated.id, winners: updated.winners, automatic }, { groupId: updated.groupId, notify: false });
      return updated;
    };

    app.services.scheduler.register('giveaways', async (now) => {
      const items = await app.stores.giveaways.read();
      for (const giveaway of items.filter((item) => item.status === 'open' && Date.parse(item.endsAt) <= now)) await finish(giveaway, true);
    });

    app.client.on('message', async (event) => {
      if (event?.action !== 'post/bumote' || !event.message?.form) return;
      const giveawayId = Number(event.message.form.giveaway_id ?? event.message.form.id);
      if (!Number.isInteger(giveawayId)) return;
      await app.stores.giveaways.update((items) => {
        const item = items.find((entry) => Number(entry.id) === giveawayId && entry.status === 'open');
        if (item && !item.entries.includes(Number(event.user_id))) item.entries.push(Number(event.user_id));
        return items;
      });
    });

    app.router.register({
      name: 'çekiliş', aliases: ['cekilis', 'giveaway'], category: 'Çekiliş', description: 'Çekiliş oluşturur veya durumunu gösterir.', usage: 'çekiliş <oluştur süre kazanan ödül|durum id|bitir id|yeniden id>', guildOnly: true, requiredPermission: 'moderator',
      async execute(ctx) {
        const action = String(ctx.args.shift() || '').toLocaleLowerCase('tr-TR');
        if (['oluştur', 'olustur', 'create'].includes(action)) {
          const durationMs = parseDuration(ctx.args.shift(), { min: 30_000, max: 365 * 86_400_000 });
          const winnerCount = Number(ctx.args.shift()); const prize = ctx.args.join(' ').trim();
          if (durationMs === null || !Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 50 || !prize) return ctx.reply(`Kullanım: ${ctx.config.prefix}çekiliş oluştur <10m|2h|1d> <kazananSayısı> <ödül>`);
          let created;
          await ctx.stores.giveaways.update((items) => { created = { id: nextId(items), groupId: ctx.groupId, channelId: ctx.channelId, prize, winnerCount, entries: [], winners: [], status: 'open', createdBy: ctx.userId, createdAt: new Date().toISOString(), endsAt: new Date(Date.now() + durationMs).toISOString() }; items.push(created); return items; });
          await ctx.client.sendPost(ctx.channelId, `🎉 Çekiliş #${created.id}\nÖdül: ${prize}\nKazanan: ${winnerCount}\nBitiş: ${created.endsAt}\nKatılım: ${ctx.config.prefix}çekilişkatıl ${created.id}\nBumote formu giveaway_id=${created.id} gönderirse buton/form katılımı da işlenir.`);
          return ctx.reply(`Çekiliş #${created.id} oluşturuldu. Süre: ${formatDuration(durationMs)}`);
        }
        const id = Number(ctx.args[0]); if (!Number.isInteger(id)) return ctx.reply(`Kullanım: ${ctx.config.prefix}çekiliş <oluştur|durum|bitir|yeniden> ...`);
        const item = (await ctx.stores.giveaways.read()).find((entry) => Number(entry.id) === id && String(entry.groupId) === String(ctx.groupId));
        if (!item) return ctx.reply('Çekiliş bulunamadı.');
        if (action === 'durum') return ctx.reply(`Çekiliş #${id}\nÖdül: ${item.prize}\nDurum: ${item.status}\nKatılımcı: ${item.entries.length}\nBitiş: ${item.endsAt}`);
        if (action === 'bitir') { await finish(item, false); return ctx.reply(`Çekiliş #${id} bitirildi.`); }
        if (['yeniden', 'reroll'].includes(action)) { if (item.status !== 'ended') return ctx.reply('Yalnızca bitmiş çekiliş yeniden çekilebilir.'); const winners = chooseWinners(item.entries.filter((id) => !item.winners.includes(id)), item.winnerCount); await ctx.stores.giveaways.update((items) => { const target = items.find((entry) => Number(entry.id) === id); target.rerolls = target.rerolls || []; target.rerolls.push({ at: new Date().toISOString(), by: ctx.userId, winners }); return items; }); await ctx.client.sendPost(item.channelId, `🔄 Çekiliş #${id} yeniden çekildi. Yeni kazananlar: ${winners.map((userId) => `#${userId}`).join(', ') || 'yok'}`); return ctx.reply('Yeniden çekiliş tamamlandı.'); }
        return ctx.reply('Bilinmeyen çekiliş işlemi.');
      }
    });

    app.router.register({
      name: 'çekilişkatıl', aliases: ['cekiliskatil', 'gkatıl', 'gkatil'], category: 'Çekiliş', description: 'Açık çekilişe katılır.', usage: 'çekilişkatıl <id>', guildOnly: true,
      async execute(ctx) { const id = Number(ctx.args[0]); if (!Number.isInteger(id)) return ctx.reply(`Kullanım: ${ctx.config.prefix}çekilişkatıl <id>`); let state = 'notfound'; await ctx.stores.giveaways.update((items) => { const item = items.find((entry) => Number(entry.id) === id && String(entry.groupId) === String(ctx.groupId)); if (!item || item.status !== 'open' || Date.parse(item.endsAt) <= Date.now()) return items; if (item.entries.includes(ctx.userId)) { state = 'exists'; return items; } item.entries.push(ctx.userId); state = 'joined'; return items; }); return ctx.reply(state === 'joined' ? `Çekiliş #${id} katılımın alındı.` : state === 'exists' ? 'Zaten katıldın.' : 'Açık çekiliş bulunamadı.'); }
    });
  }
};
