const { truncate } = require('../utils/text');

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, '').trim();
}

function tag(block, names) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
    if (match) return decodeXml(match[1]);
  }
  return '';
}

function attr(block, element, attribute) {
  const match = block.match(new RegExp(`<${element}[^>]*\\s${attribute}=["']([^"']+)["'][^>]*>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function parseFeed(xml) {
  const blocks = [...String(xml).matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((match) => match[2]);
  return blocks.map((block) => {
    const title = tag(block, ['title']);
    const link = tag(block, ['link']) || attr(block, 'link', 'href');
    const id = tag(block, ['guid', 'id']) || link || title;
    const published = tag(block, ['pubDate', 'published', 'updated']);
    const description = tag(block, ['description', 'summary', 'content']);
    return { id, title, link, published, description };
  }).filter((item) => item.id && item.title);
}

function nextId(items) { return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1; }

module.exports = {
  name: 'Sosyal Medya ve RSS Bildirimleri',
  setup(app) {
    const checkFeed = async (feed, announce = true) => {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(feed.url, { signal: controller.signal, headers: { 'user-agent': 'TopluyoProfessionalBot/3.0' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const entries = parseFeed(await response.text());
        if (!entries.length) throw new Error('Feed içinde item/entry bulunamadı.');
        const latest = entries[0];
        if (!feed.lastSeenId) {
          await app.stores.feeds.update((items) => { const item = items.find((entry) => Number(entry.id) === Number(feed.id)); if (item) { item.lastSeenId = latest.id; item.lastCheckedAt = new Date().toISOString(); item.lastError = null; } return items; });
          return { initialized: true, latest };
        }
        const unseen = [];
        for (const entry of entries) { if (entry.id === feed.lastSeenId) break; unseen.push(entry); }
        if (announce) {
          for (const entry of unseen.reverse().slice(-5)) {
            const icon = { youtube: '▶️', twitch: '🟣', tiktok: '🎵', x: '𝕏', instagram: '📷', rss: '📰' }[feed.type] || '📢';
            await app.client.sendPost(feed.channelId, truncate(`${icon} ${feed.name}\n${entry.title}${entry.link ? `\n${entry.link}` : ''}${entry.description ? `\n${truncate(entry.description, 350)}` : ''}`, 1800));
          }
        }
        await app.stores.feeds.update((items) => { const item = items.find((entry) => Number(entry.id) === Number(feed.id)); if (item) { item.lastSeenId = latest.id; item.lastCheckedAt = new Date().toISOString(); item.lastError = null; item.posted = (item.posted || 0) + unseen.length; } return items; });
        return { unseen, latest };
      } catch (error) {
        await app.stores.feeds.update((items) => { const item = items.find((entry) => Number(entry.id) === Number(feed.id)); if (item) { item.lastCheckedAt = new Date().toISOString(); item.lastError = error.message; } return items; });
        throw error;
      } finally { clearTimeout(timer); }
    };

    app.services.scheduler.register('social-feeds', async (now) => {
      const feeds = await app.stores.feeds.read();
      for (const feed of feeds.filter((item) => item.active && (!item.nextCheckAt || Date.parse(item.nextCheckAt) <= now))) {
        try { await checkFeed(feed, true); } catch (error) { app.logger.error(`Feed kontrol edilemedi: ${feed.name}`, error); }
        await app.stores.feeds.update((items) => { const item = items.find((entry) => Number(entry.id) === Number(feed.id)); if (item) item.nextCheckAt = new Date(now + Math.max(1, Number(feed.pollMinutes) || 5) * 60_000).toISOString(); return items; });
      }
    });

    app.router.register({
      name: 'sosyal', aliases: ['feed', 'rss'], category: 'Sosyal Medya', description: 'YouTube ve RSS tabanlı sosyal bildirimleri yönetir.', usage: 'sosyal <liste|ekle tür kanalId isim | url|sil id|kontrol id>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const action = String(ctx.args.shift() || 'liste').toLowerCase();
        if (action === 'liste') { const feeds = (await ctx.stores.feeds.read()).filter((item) => String(item.groupId) === String(ctx.groupId) && item.active); return ctx.reply(`Sosyal feedler:\n${feeds.map((item) => `#${item.id} — ${item.type} — ${item.name} — ${item.url} — son hata: ${item.lastError || 'yok'}`).join('\n') || 'yok'}`); }
        if (action === 'sil') { const id = Number(ctx.args[0]); let removed = false; await ctx.stores.feeds.update((items) => { const item = items.find((entry) => Number(entry.id) === id && String(entry.groupId) === String(ctx.groupId)); if (item) { item.active = false; removed = true; } return items; }); return ctx.reply(removed ? 'Feed kapatıldı.' : 'Feed bulunamadı.'); }
        if (action === 'kontrol') { const id = Number(ctx.args[0]); const feed = (await ctx.stores.feeds.read()).find((item) => Number(item.id) === id && String(item.groupId) === String(ctx.groupId)); if (!feed) return ctx.reply('Feed bulunamadı.'); try { const result = await checkFeed(feed, false); return ctx.reply(`Feed çalışıyor. Son içerik: ${result.latest.title}`); } catch (error) { return ctx.reply(`Feed hatası: ${error.message}`); } }
        if (action === 'ekle') {
          const type = String(ctx.args.shift() || '').toLowerCase(); const channelId = ctx.args.shift(); const [nameRaw, sourceRaw] = ctx.args.join(' ').split('|'); const name = nameRaw?.trim(); let url = sourceRaw?.trim();
          if (!['rss', 'youtube', 'twitch', 'tiktok', 'x', 'instagram'].includes(type) || !channelId || !name || !url) return ctx.reply(`Kullanım: ${ctx.config.prefix}sosyal ekle <rss|youtube|twitch|tiktok|x|instagram> <kanalId> <isim> | <feedUrl veya YouTube kanalId>`);
          if (type === 'youtube' && !/^https?:\/\//i.test(url)) url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(url)}`;
          if (!/^https?:\/\//i.test(url)) return ctx.reply('Kaynak geçerli HTTP/HTTPS feed URL’si olmalı. Twitch, TikTok, X ve Instagram için resmi API yerine RSS köprüsü/webhook feed URL’si gerekir.');
          let feed; await ctx.stores.feeds.update((items) => { feed = { id: nextId(items), groupId: ctx.groupId, type, name, url, channelId, active: true, pollMinutes: 5, lastSeenId: null, lastCheckedAt: null, nextCheckAt: new Date().toISOString(), lastError: null, posted: 0, createdBy: ctx.userId, createdAt: new Date().toISOString() }; items.push(feed); return items; });
          try { await checkFeed(feed, false); } catch (error) { return ctx.reply(`Feed kaydedildi ancak ilk kontrol başarısız: ${error.message}`); }
          return ctx.reply(`Sosyal feed #${feed.id} eklendi.`);
        }
        return ctx.reply('Bilinmeyen sosyal feed işlemi.');
      }
    });
  }
};
