const {
  LiveStreamService,
  DEFAULT_TEMPLATE,
  DEFAULT_VIDEO_TEMPLATE
} = require('../services/LiveStreamService');
const { truncate } = require('../utils/text');
const { assertApiSuccess } = require('../utils/apiResult');
const nextId = (items) => items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
const belongsTo = (item, groupId) => String(item.groupId) === String(groupId);

module.exports = {
  name: 'Canlı Yayın Duyuruları',
  setup(app) {
    const service = new LiveStreamService({ config: app.config.liveStreams });
    app.services.liveStreams = service;

    const sendAnnouncement = async (watcher, status) => {
      let message = service.message(watcher, status);
      const platform = String(watcher.platform || '').toLowerCase();
      if (['kick', 'youtube'].includes(platform)
        && typeof app.services.cards?.createLiveAnnouncementCard === 'function') {
        try {
          const card = await app.services.cards.createLiveAnnouncementCard({
            platform,
            eventType: status.eventType || (status.live ? 'live' : 'video'),
            name: watcher.name,
            title: status.title,
            category: status.category,
            viewers: status.viewers,
            avatarUrl: watcher.logoUrl || status.profileImage || status.thumbnail || '',
            thumbnailUrl: status.thumbnail || '',
            targetUrl: status.url || ''
          });
          // Topluyo iç içe Markdown görsel bağlantısını metin olarak gösteriyor.
          // Çıplak .png adresi banner önizlemesini üretir; karta tıklanarak yapılan
          // HTML isteğini CardService güvenli yayın/video adresine yönlendirir.
          const visual = card.url || card.jtml;
          if (visual) {
            const suffix = `\n${visual}`;
            message = `${truncate(message, Math.max(1, 1800 - suffix.length))}${suffix}`;
          }
        } catch (error) {
          app.logger?.warn?.('Canlı yayın bannerı üretilemedi; metin duyurusu kullanılacak.', {
            platform,
            name: watcher.name,
            message: error.message
          });
        }
      }

      try {
        const result = await app.client.sendPost(watcher.channelId, truncate(message, 1800));
        assertApiSuccess(result, 'Canlı yayın duyurusu');
        return result;
      } catch (firstError) {
        if (typeof app.client.getCurrentUserId !== 'function' || typeof app.client.grantChannelAccess !== 'function') throw firstError;
        const botUserId = await app.client.getCurrentUserId();
        await app.client.grantChannelAccess(watcher.channelId, botUserId, {
          read: true,
          write: true,
          control: true
        });
        const retry = await app.client.sendPost(watcher.channelId, truncate(message, 1800));
        assertApiSuccess(retry, 'Canlı yayın duyurusu (izin onarımından sonra)');
        return retry;
      }
    };

    const persist = async (
      watcher,
      status,
      now,
      error = null,
      { rememberContent = true } = {}
    ) => app.stores.liveStreams.update((items) => {
      const item = items.find((entry) => Number(entry.id) === Number(watcher.id));
      if (!item) return items;
      item.lastCheckedAt = new Date(now).toISOString();
      item.nextCheckAt = new Date(now + Math.max(1, Number(item.pollMinutes) || 3) * 60000).toISOString();
      item.lastError = error ? String(error.message || error).slice(0, 500) : null;
      if (status) {
        const contentId = status.contentId || status.streamId || '';
        item.isLive = status.live;
        item.hasSuccessfulCheck = true;
        item.lastEventType = status.eventType || (status.live ? 'live' : 'offline');
        item.lastTitle = status.title || '';
        if (contentId && rememberContent) item.lastSeenContentId = contentId;
        if (status.live) item.lastLiveId = status.streamId || item.lastLiveId;
      }
      return items;
    });

    const checkOne = async (watcher, { announce = true, now = Date.now() } = {}) => {
      let status;
      try {
        status = await service.check(watcher);
      } catch (error) {
        await persist(watcher, null, now, error);
        throw error;
      }

      const isFirstSuccessfulCheck = watcher.hasSuccessfulCheck !== true;
      const eventType = status.eventType || (status.live ? 'live' : 'offline');
      const contentId = status.contentId || status.streamId || '';
      const hasVideoBaseline = Boolean(watcher.lastSeenContentId);
      const isNewLive = eventType === 'live' && (contentId
        ? contentId !== watcher.lastAnnouncedId
        : !watcher.isLive);
      const isNewVideo = eventType === 'video'
        && Boolean(contentId)
        && hasVideoBaseline
        && contentId !== watcher.lastSeenContentId;
      const isNewAnnouncement = isNewLive || isNewVideo;
      const rememberContent = eventType !== 'video' || !isNewVideo;

      // Elle yapılan "Şimdi Kontrol Et" işlemi yalnızca durumu gösterir.
      // Zamanlayıcının ilk başarılı kontrolünde kanal canlıysa ise kullanıcı
      // beklentisine uygun olarak bir kez duyuru gönderilir.
      if (isFirstSuccessfulCheck) {
        await persist(watcher, status, now, null, { rememberContent });
        if (!announce || eventType !== 'live') {
          return { status, announced: false, baseline: true };
        }
      } else {
        await persist(watcher, status, now, null, { rememberContent });
      }

      // Eski YouTube kayıtları için ilk görülen video yalnızca başlangıç noktasıdır;
      // sonraki farklı video kimliği geldiğinde duyuru gönderilir.
      if (eventType === 'video' && !hasVideoBaseline) {
        return { status, announced: false, baseline: true };
      }

      if (announce && isNewAnnouncement) {
        try {
          await sendAnnouncement(watcher, status);
          await app.stores.liveStreams.update((items) => {
            const item = items.find((entry) => Number(entry.id) === Number(watcher.id));
            if (item) {
              item.lastAnnouncedId = contentId || `${eventType}-${now}`;
              item.lastAnnouncedEventType = eventType;
              if (contentId) item.lastSeenContentId = contentId;
              item.lastAnnouncedAt = new Date(now).toISOString();
              item.announcementCount = (item.announcementCount || 0) + 1;
            }
            return items;
          });
        } catch (error) {
          error.liveStreamStage = 'announcement';
          await persist(watcher, status, now, error, { rememberContent: !isNewVideo });
          throw error;
        }
      }
      return { status, announced: announce && isNewAnnouncement, baseline: false };
    };
    service.checkWatcher = checkOne;
    service.sendTest = async (watcher) => {
      const source = String(watcher.source).replace(/^@/, '');
      let observed = {};
      try {
        observed = await service.check(watcher);
      } catch {}
      const fake = {
        live: watcher.platform !== 'youtube',
        eventType: watcher.platform === 'youtube' ? 'video' : 'live',
        contentId: `test-${Date.now()}`,
        title: watcher.platform === 'youtube' ? 'Test videosu' : 'Test canlı yayını',
        category: 'Test', viewers: 123,
        profileImage: watcher.logoUrl || observed.profileImage || observed.thumbnail || '',
        thumbnail: observed.thumbnail || '',
        url: watcher.platform === 'youtube'
          ? `https://youtube.com/channel/${source}/videos`
          : `https://${watcher.platform}.com/${source}`
      };
      return sendAnnouncement(watcher, fake);
    };

    app.services.scheduler.register('live-stream-announcements', async (now) => {
      const watchers = await app.stores.liveStreams.read();
      for (const watcher of watchers.filter((item) => item.active && (!item.nextCheckAt || Date.parse(item.nextCheckAt) <= now))) {
        try { await checkOne(watcher, { now }); }
        catch (error) {
          if (watcher.lastError !== error.message) {
            const label = error.liveStreamStage === 'announcement'
              ? 'Canlı yayın duyurusu gönderilemedi'
              : 'Canlı yayın kontrol edilemedi';
            app.logger.error(`${label}: ${watcher.name}`, { platform: watcher.platform, message: error.message });
          }
        }
      }
    });

    app.router.register({
      name: 'yayın', aliases: ['yayin', 'canlıyayın', 'canliyayin', 'live'],
      category: 'Sosyal Medya', description: 'Kick, Twitch ve YouTube canlı yayın duyurularını yönetir.',
      usage: 'yayın <liste|ekle|ayarla|kontrol|test|sil>', guildOnly: true, requiredPermission: 'admin', cooldownMs: 500,
      async execute(ctx) {
        const action = String(ctx.args.shift() || 'liste').toLocaleLowerCase('tr-TR');
        const watchers = await ctx.stores.liveStreams.read();
        if (action === 'liste') {
          const own = watchers.filter((item) => belongsTo(item, ctx.groupId) && item.active);
          return ctx.reply(`Canlı yayın takipleri:\n${own.map((item) => `#${item.id} — ${item.platform} — ${item.name} — ${item.source} — kanal ${item.channelId} — ${item.isLive ? 'CANLI' : item.lastEventType === 'video' ? 'video takibi aktif' : 'çevrimdışı'}${item.lastError ? ` — hata: ${item.lastError}` : ''}`).join('\n') || 'yok'}`);
        }
        if (action === 'ekle') {
          const platform = String(ctx.args.shift() || '').toLowerCase();
          const channelId = ctx.args.shift();
          const [nameRaw, sourceRaw] = ctx.args.join(' ').split('|');
          const name = String(nameRaw || '').trim();
          const source = String(sourceRaw || '').trim();
          if (!['kick', 'twitch', 'youtube'].includes(platform) || !channelId || !name || !source) {
            return ctx.reply(`Kullanım: ${ctx.config.prefix}yayın ekle <kick|twitch|youtube> <duyuruKanalId> <yayıncı adı> | <kullanıcı adı veya YouTube kanal ID>`);
          }
          let item;
          await ctx.stores.liveStreams.update((items) => {
            item = {
              id: nextId(items), groupId: ctx.groupId, platform, channelId, name, source,
              mention: ctx.config.liveStreams?.defaultMention || '@millet',
              template: ctx.config.liveStreams?.defaultTemplate || DEFAULT_TEMPLATE,
              videoTemplate: ctx.config.liveStreams?.defaultVideoTemplate || DEFAULT_VIDEO_TEMPLATE,
              logoUrl: '',
              pollMinutes: ctx.config.liveStreams?.defaultPollMinutes || 3,
              active: true, isLive: false, lastLiveId: null, lastAnnouncedId: null,
              lastSeenContentId: null, lastEventType: null,
              hasSuccessfulCheck: false,
              lastCheckedAt: null, nextCheckAt: new Date().toISOString(), lastError: null,
              lastAnnouncedAt: null, announcementCount: 0, createdBy: ctx.userId, createdAt: new Date().toISOString()
            };
            items.push(item); return items;
          });
          try {
            const result = await checkOne(item, { announce: false });
            return ctx.reply(`Yayın takibi #${item.id} eklendi. İlk kontrol: ${result.status.live ? 'şu anda canlı' : 'çevrimdışı'}.`);
          } catch (error) { return ctx.reply(`Yayın takibi #${item.id} kaydedildi; ilk kontrol hatası: ${error.message}`); }
        }
        const id = Number(ctx.args.shift());
        const watcher = watchers.find((item) => Number(item.id) === id && belongsTo(item, ctx.groupId));
        if (!watcher) return ctx.reply('Yayın takibi bulunamadı.');
        if (action === 'sil') {
          await ctx.stores.liveStreams.update((items) => { const item = items.find((entry) => Number(entry.id) === id); if (item) item.active = false; return items; });
          return ctx.reply(`Yayın takibi #${id} kapatıldı.`);
        }
        if (action === 'kontrol') {
          try {
            const result = await checkOne(watcher, { announce: false });
            const state = result.status.live
              ? `CANLI — ${result.status.title}`
              : result.status.eventType === 'video'
                ? `son video — ${result.status.title}`
                : 'çevrimdışı';
            return ctx.reply(`#${id} kontrol edildi: ${state}.`);
          } catch (error) { return ctx.reply(`#${id} kontrol hatası: ${error.message}`); }
        }
        if (action === 'test') {
          await service.sendTest(watcher);
          return ctx.reply(`#${id} için test duyurusu gönderildi.`);
        }
        if (action === 'ayarla') {
          const field = String(ctx.args.shift() || '').toLocaleLowerCase('tr-TR');
          const value = ctx.args.join(' ').replace(/^\|\s*/, '').trim();
          const changes = {};
          if (['kanal', 'channel'].includes(field) && value) changes.channelId = value;
          else if (['etiket', 'mention'].includes(field)) changes.mention = value === 'yok' ? '' : value;
          else if (['mesaj', 'şablon', 'sablon', 'template'].includes(field) && value) changes.template = value.replace(/\\n/g, '\n');
          else if (['videomesaj', 'videoşablon', 'videosablon', 'videotemplate'].includes(field) && value) changes.videoTemplate = value.replace(/\\n/g, '\n');
          else if (['logo', 'görsel', 'gorsel', 'avatar'].includes(field)) {
            if (value !== 'yok' && value && !/^https:\/\//i.test(value)) {
              return ctx.reply('Logo adresi HTTPS ile başlamalı veya kaldırmak için yok yazılmalı.');
            }
            changes.logoUrl = value === 'yok' ? '' : value;
          }
          else if (['aralık', 'aralik', 'süre', 'sure', 'interval'].includes(field) && Number(value) >= 1 && Number(value) <= 60) changes.pollMinutes = Number(value);
          else if (['aktif', 'active'].includes(field) && ['aç', 'ac', 'kapat', 'true', 'false'].includes(value.toLowerCase())) changes.active = ['aç', 'ac', 'true'].includes(value.toLowerCase());
          else if (['isim', 'name'].includes(field) && value) changes.name = value;
          else if (['kaynak', 'source'].includes(field) && value) changes.source = value;
          else return ctx.reply('Alanlar: kanal, etiket, mesaj, videomesaj, logo, aralık (1-60), aktif, isim, kaynak.\nDeğişkenler: {mention} {name} {platform} {title} {category} {viewers} {url} {thumbnail} {profile} {publishedAt} {event}\nSatır sonu: \\n');
          await ctx.stores.liveStreams.update((items) => { const item = items.find((entry) => Number(entry.id) === id); if (item) Object.assign(item, changes, { nextCheckAt: new Date().toISOString() }); return items; });
          return ctx.reply(`#${id} güncellendi: ${field}.`);
        }
        return ctx.reply('Bilinmeyen işlem. Kullanım: yayın <liste|ekle|ayarla|kontrol|test|sil>');
      }
    });
  }
};
