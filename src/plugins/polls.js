const { parseDuration, formatDuration } = require('../utils/duration');
const { truncate } = require('../utils/text');

const EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
function nextId(items) { return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1; }

function resultsText(poll) {
  const counts = poll.options.map((_, index) => Object.values(poll.votes).filter((value) => Number(value) === index).length);
  const total = counts.reduce((sum, count) => sum + count, 0);
  return poll.options.map((option, index) => `${EMOJIS[index]} ${option} — ${counts[index]} oy${total ? ` (%${Math.round(counts[index] / total * 100)})` : ''}`).join('\n');
}

module.exports = {
  name: 'Süreli Anket Sistemi',
  setup(app) {
    const finish = async (poll, automatic = false) => {
      let ended = null;
      await app.stores.polls.update((items) => { const item = items.find((entry) => Number(entry.id) === Number(poll.id)); if (!item || item.status !== 'open') return items; item.status = 'ended'; item.endedAt = new Date().toISOString(); item.automatic = automatic; ended = { ...item }; return items; });
      if (ended) await app.client.sendPost(ended.channelId, `📊 Anket #${ended.id} sonuçlandı\n${ended.question}\n${resultsText(ended)}`);
    };
    app.services.scheduler.register('polls', async (now) => { const polls = await app.stores.polls.read(); for (const poll of polls.filter((item) => item.status === 'open' && item.endsAt && Date.parse(item.endsAt) <= now)) await finish(poll, true); });

    app.client.on('message', async (event) => {
      if (event?.action !== 'post/bumote' || !event.message?.form) return;
      const pollId = Number(event.message.form.poll_id ?? event.message.form.id); const option = Number(event.message.form.option);
      if (!Number.isInteger(pollId) || !Number.isInteger(option)) return;
      await app.stores.polls.update((items) => { const poll = items.find((entry) => Number(entry.id) === pollId && entry.status === 'open'); if (poll && option >= 1 && option <= poll.options.length) poll.votes[String(event.user_id)] = option - 1; return items; });
    });

    app.router.register({
      name: 'anket', aliases: ['poll'], category: 'Anket', description: 'Çok seçenekli süreli anket oluşturur.', usage: 'anket oluştur <süre|0> <soru> | seçenek | seçenek', guildOnly: true, requiredPermission: 'moderator',
      async execute(ctx) {
        const action = String(ctx.args.shift() || '').toLowerCase();
        if (['oluştur', 'olustur', 'create'].includes(action)) {
          const rawDuration = ctx.args.shift(); const durationMs = rawDuration === '0' ? 0 : parseDuration(rawDuration, { min: 30_000, max: 30 * 86_400_000 });
          const parts = ctx.args.join(' ').split('|').map((part) => part.trim()).filter(Boolean); const question = parts.shift(); const options = parts.slice(0, 10);
          if (durationMs === null || !question || options.length < 2) return ctx.reply(`Kullanım: ${ctx.config.prefix}anket oluştur <10m|2h|0> Soru | Seçenek 1 | Seçenek 2`);
          let poll; await ctx.stores.polls.update((items) => { poll = { id: nextId(items), groupId: ctx.groupId, channelId: ctx.channelId, question, options, votes: {}, status: 'open', createdBy: ctx.userId, createdAt: new Date().toISOString(), endsAt: durationMs ? new Date(Date.now() + durationMs).toISOString() : null }; items.push(poll); return items; });
          await ctx.client.sendPost(ctx.channelId, `📋 Anket #${poll.id}\n${question}\n${options.map((option, index) => `${EMOJIS[index]} ${option} — ${ctx.config.prefix}oy ${poll.id} ${index + 1}`).join('\n')}\n${durationMs ? `Süre: ${formatDuration(durationMs)}` : 'Süresiz'}\nBumote alanları: poll_id=${poll.id}, option=1..${options.length}`);
          return ctx.reply(`Anket #${poll.id} oluşturuldu.`);
        }
        const id = Number(ctx.args[0]); const poll = (await ctx.stores.polls.read()).find((entry) => Number(entry.id) === id && String(entry.groupId) === String(ctx.groupId)); if (!poll) return ctx.reply('Anket bulunamadı.');
        if (action === 'sonuç' || action === 'sonuc') return ctx.reply(`📊 ${poll.question}\n${truncate(resultsText(poll), 1600)}`);
        if (action === 'bitir') { await finish(poll, false); return ctx.reply(`Anket #${id} bitirildi.`); }
        return ctx.reply(`Kullanım: ${ctx.config.prefix}anket <oluştur|sonuç id|bitir id>`);
      }
    });

    app.router.register({
      name: 'oy', aliases: ['vote'], category: 'Anket', description: 'Ankette oy verir.', usage: 'oy <anketId> <seçenekNo>', guildOnly: true,
      async execute(ctx) { const id = Number(ctx.args[0]); const option = Number(ctx.args[1]); let state = 'notfound'; await ctx.stores.polls.update((items) => { const poll = items.find((entry) => Number(entry.id) === id && String(entry.groupId) === String(ctx.groupId) && entry.status === 'open'); if (!poll || (poll.endsAt && Date.parse(poll.endsAt) <= Date.now())) return items; if (!Number.isInteger(option) || option < 1 || option > poll.options.length) { state = 'badoption'; return items; } poll.votes[String(ctx.userId)] = option - 1; state = 'ok'; return items; }); return ctx.reply(state === 'ok' ? `Anket #${id} oyun kaydedildi.` : state === 'badoption' ? 'Geçersiz seçenek.' : 'Açık anket bulunamadı.'); }
    });
  }
};
