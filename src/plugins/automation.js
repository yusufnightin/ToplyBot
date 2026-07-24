const { parseDuration, formatDuration } = require('../utils/duration');
const { renderTemplate } = require('../utils/templates');
const { truncate } = require('../utils/text');

function nextId(items) { return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1; }

module.exports = {
  name: 'Otomasyon ve Zamanlayıcılar',
  setup(app) {
    app.client.on('message', async (event) => {
      try {
        if (!['post/add', 'post/mention'].includes(event?.action) || typeof event.message !== 'string') return;
        if (event.message.trim().startsWith(app.config.prefix)) return;
        const groupId = app.groupResolver.resolve(event); if (groupId === null) return;
        const settings = await app.services.settings.get(groupId); if (!settings.automations.enabled) return;
        const text = event.message.toLocaleLowerCase('tr-TR');
        for (const item of settings.automations.keywordReplies || []) {
          const trigger = String(item.trigger).toLocaleLowerCase('tr-TR');
          const matches = item.exact ? text.trim() === trigger : text.includes(trigger);
          if (matches) await app.client.sendPost(event.channel_id, truncate(renderTemplate(item.response, { userId: event.user_id, channelId: event.channel_id, groupId }), 1800));
        }
        const hooks = (await app.stores.webhooks.read()).filter((hook) => hook.active && hook.events?.includes('message') && String(hook.groupId) === String(groupId));
        for (const hook of hooks) {
          fetch(hook.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'message', groupId, channelId: event.channel_id, userId: event.user_id, message: event.message }) }).catch((error) => app.logger.error('Webhook gönderilemedi.', error));
        }
      } catch (error) { app.logger.error('Kelime otomasyonu işlenemedi.', error); }
    });

    app.services.scheduler.register('automations', async (now) => {
      const due = [];
      await app.stores.automations.update((items) => {
        for (const item of items) {
          if (!item.active || Date.parse(item.nextRunAt) > now) continue;
          due.push({ ...item });
          if (item.repeatMs) item.nextRunAt = new Date(now + item.repeatMs).toISOString();
          else if (item.dailyAt) {
            const [hour, minute] = item.dailyAt.split(':').map(Number); const next = new Date(); next.setHours(hour, minute, 0, 0); if (next.getTime() <= now) next.setDate(next.getDate() + 1); item.nextRunAt = next.toISOString();
          } else item.active = false;
          item.lastRunAt = new Date().toISOString(); item.runCount = (item.runCount || 0) + 1;
        }
        return items;
      });
      for (const item of due) {
        try { await app.client.sendPost(item.channelId, item.message); } catch (error) { app.logger.error('Zamanlanmış mesaj gönderilemedi.', error); }
      }
    });

    app.router.register({
      name: 'kelimecevap', category: 'Otomasyon', description: 'Anahtar kelime cevaplarını yönetir.', usage: 'kelimecevap <liste|ekle tetik | cevap|sil id>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) { const action = String(ctx.args.shift() || 'liste').toLowerCase(); const settings = await ctx.services.settings.get(ctx.groupId); let items = [...settings.automations.keywordReplies]; if (action === 'liste') return ctx.reply(`Kelime cevapları:\n${items.map((item, index) => `${index + 1}. ${item.trigger} → ${truncate(item.response, 80)}`).join('\n') || 'yok'}`); if (action === 'sil') { const index = Number(ctx.args[0]) - 1; if (!items[index]) return ctx.reply('Kayıt bulunamadı.'); items.splice(index, 1); await ctx.services.settings.set(ctx.groupId, 'automations.keywordReplies', items); return ctx.reply('Kelime cevabı silindi.'); } if (action === 'ekle') { const [trigger, response] = ctx.args.join(' ').split('|').map((value) => value.trim()); if (!trigger || !response) return ctx.reply(`Kullanım: ${ctx.config.prefix}kelimecevap ekle merhaba | Merhaba {userId}!`); items.push({ trigger, response: truncate(response, 1500), exact: false }); await ctx.services.settings.set(ctx.groupId, 'automations.keywordReplies', items); return ctx.reply('Kelime cevabı eklendi.'); } return ctx.reply('Bilinmeyen işlem.'); }
    });

    app.router.register({
      name: 'zamanlayıcı', aliases: ['zamanlayici', 'schedule'], category: 'Otomasyon', description: 'Tek seferlik, tekrarlayan veya günlük mesaj planlar.', usage: 'zamanlayıcı <sonra süre kanalId | mesaj|tekrar süre kanalId | mesaj|günlük SS:DD kanalId | mesaj|liste|sil id>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) { const action = String(ctx.args.shift() || 'liste').toLocaleLowerCase('tr-TR'); if (action === 'liste') { const items = (await ctx.stores.automations.read()).filter((item) => String(item.groupId) === String(ctx.groupId) && item.active); return ctx.reply(`Zamanlayıcılar:\n${items.map((item) => `#${item.id} — ${item.nextRunAt} — ${item.repeatMs ? `her ${formatDuration(item.repeatMs)}` : item.dailyAt ? `günlük ${item.dailyAt}` : 'tek sefer'}`).join('\n') || 'yok'}`); } if (action === 'sil') { const id = Number(ctx.args[0]); let removed = false; await ctx.stores.automations.update((items) => { const item = items.find((entry) => Number(entry.id) === id && String(entry.groupId) === String(ctx.groupId)); if (item) { item.active = false; removed = true; } return items; }); return ctx.reply(removed ? 'Zamanlayıcı silindi.' : 'Bulunamadı.'); }
        const rawTime = ctx.args.shift(); const channelId = ctx.args.shift(); const parts = ctx.args.join(' ').split('|'); const message = (parts.length > 1 ? parts.slice(1).join('|') : parts[0]).trim(); if (!channelId || !message) return ctx.reply(`Kullanım: ${ctx.config.prefix}zamanlayıcı sonra 10m <kanalId> | mesaj`);
        let nextRunAt; let repeatMs = null; let dailyAt = null;
        if (['sonra', 'after'].includes(action)) { const ms = parseDuration(rawTime, { min: 10_000, max: 365 * 86_400_000 }); if (ms === null) return ctx.reply('Geçersiz süre.'); nextRunAt = new Date(Date.now() + ms).toISOString(); }
        else if (['tekrar', 'repeat'].includes(action)) { repeatMs = parseDuration(rawTime, { min: 60_000, max: 365 * 86_400_000 }); if (repeatMs === null) return ctx.reply('Tekrar süresi en az 1 dakika olmalı.'); nextRunAt = new Date(Date.now() + repeatMs).toISOString(); }
        else if (['günlük', 'gunluk', 'daily'].includes(action)) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(rawTime)) return ctx.reply('Saat SS:DD biçiminde olmalı.'); dailyAt = rawTime; const [hour, minute] = rawTime.split(':').map(Number); const next = new Date(); next.setHours(hour, minute, 0, 0); if (next <= new Date()) next.setDate(next.getDate() + 1); nextRunAt = next.toISOString(); }
        else return ctx.reply('Bilinmeyen zamanlayıcı türü.');
        let item; await ctx.stores.automations.update((items) => { item = { id: nextId(items), groupId: ctx.groupId, channelId, message: truncate(message, 1800), active: true, createdBy: ctx.userId, createdAt: new Date().toISOString(), nextRunAt, repeatMs, dailyAt, runCount: 0 }; items.push(item); return items; }); return ctx.reply(`Zamanlayıcı #${item.id} oluşturuldu: ${nextRunAt}`); }
    });

    app.router.register({
      name: 'kanaloluştur', aliases: ['kanalolustur'], category: 'Otomasyon', description: 'Yeni kanalı resmî channel/add API’siyle oluşturur ve ID dönmezse listeden kurtarır.', usage: 'kanaloluştur <nick> | <başlık> | [açıklama] | [tip]', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const [nick, title, description = '', type = '1'] = ctx.args.join(' ').split('|').map((value) => value.trim());
        if (!nick || !title) return ctx.reply(`Kullanım: ${ctx.config.prefix}kanaloluştur sohbet | Sohbet Kanalı | Açıklama | 1`);
        const created = await ctx.services.apiManagement.createChannel(ctx.groupId, { nick, title, description, type });
        return ctx.reply(`✅ Kanal hazır: #${created.payload.nick} · ID ${created.id}${created.created ? ' · oluşturuldu' : ' · zaten vardı'}${created.recovered ? ' · ID listeden kurtarıldı' : ''}`);
      }
    });

    app.router.register({
      name: 'kanalsil', category: 'Otomasyon', description: 'Kanalı ID veya #kanaladıyla siler; onay gerekir.', usage: 'kanalsil <#kanal/id> onay', guildOnly: true, requiredPermission: 'owner',
      async execute(ctx) {
        if (String(ctx.args[1] || '').toLocaleLowerCase('tr-TR') !== 'onay') return ctx.reply(`Silmek için: ${ctx.config.prefix}kanalsil <#kanal/id> onay`);
        const channel = await ctx.services.channels.resolve(ctx.groupId, ctx.args[0]);
        await ctx.client.deleteChannel(channel.id);
        ctx.services.channels.invalidate(ctx.groupId);
        return ctx.reply(`🗑️ Kanal silindi: #${channel.nick} (${channel.id})`);
      }
    });

    app.router.register({
      name: 'webhook', category: 'Otomasyon', description: 'Dış webhook bildirimlerini yönetir.', usage: 'webhook <liste|ekle url eventler|sil id>', guildOnly: true, requiredPermission: 'owner',
      async execute(ctx) { const action = String(ctx.args.shift() || 'liste').toLowerCase(); if (action === 'liste') { const hooks = (await ctx.stores.webhooks.read()).filter((item) => String(item.groupId) === String(ctx.groupId) && item.active); return ctx.reply(`Webhooklar:\n${hooks.map((item) => `#${item.id} — ${item.url} — ${item.events.join(',')}`).join('\n') || 'yok'}`); } if (action === 'sil') { const id = Number(ctx.args[0]); await ctx.stores.webhooks.update((items) => { const item = items.find((entry) => Number(entry.id) === id); if (item) item.active = false; return items; }); return ctx.reply('Webhook kapatıldı.'); } if (action === 'ekle') { const url = String(ctx.args.shift() || ''); const events = ctx.args.join(',').split(',').map((item) => item.trim()).filter(Boolean); if (!/^https?:\/\//i.test(url) || !events.length) return ctx.reply(`Kullanım: ${ctx.config.prefix}webhook ekle <https://...> <message,join,...>`); let hook; await ctx.stores.webhooks.update((items) => { hook = { id: nextId(items), groupId: ctx.groupId, url, events, active: true, createdBy: ctx.userId, createdAt: new Date().toISOString() }; items.push(hook); return items; }); return ctx.reply(`Webhook #${hook.id} eklendi.`); } return ctx.reply('Bilinmeyen işlem.'); }
    });
  }
};
