const { renderTemplate } = require('../utils/templates');
const { truncate } = require('../utils/text');
const { assertApiSuccess } = require('../utils/apiResult');

function isDisableValue(value) {
  return ['kapat', 'sil', '0', 'boş', 'bos'].includes(String(value || '').trim().toLocaleLowerCase('tr-TR'));
}

function diagnosticText(result) {
  const last = result.last
    ? `${result.last.status}${result.last.reason ? ` (${result.last.reason})` : ''} · ${result.last.at}`
    : 'Henüz olay yok';
  return [
    `Karşılama eklentisi: ${result.pluginLoaded ? 'yüklü' : 'yüklenmemiş'}`,
    `Sistem: ${result.enabled ? 'açık' : 'kapalı'}`,
    `Kayıtlı kanal: ${result.configuredChannel || 'ayarsız'}`,
    `Çözümlenen kanal ID: ${result.channelId || 'bulunamadı'}`,
    `Bot kullanıcı ID: ${result.botUserId || 'alınamadı'}`,
    result.channelError ? `Kanal hatası: ${result.channelError}` : null,
    result.botIdError ? `Bot ID hatası: ${result.botIdError}` : null,
    `Son işlem: ${last}`
  ].filter(Boolean).join('\n');
}

module.exports = {
  name: 'Gelişmiş Karşılama Sistemi',
  setup(app) {
    app.client.on('action:group/join', (event) => {
      app.services.welcome.handleJoin(event).catch(() => {});
    });

    app.client.on('action:group/leave', async (event) => {
      try {
        const settings = await app.services.settings.get(event.group_id);
        const channelId = settings.channels.leave || settings.channels.logs;
        let leaveMessageSent = false;
        if (settings.leave.enabled && channelId && settings.leave.message) {
          try {
            const result = await app.client.sendPost(channelId, renderTemplate(settings.leave.message, {
              userId: event.user_id,
              groupId: event.group_id
            }));
            assertApiSuccess(result, 'Ayrılma mesajı gönderimi');
            leaveMessageSent = true;
          } catch (error) {
            app.logger.error('Ayrılma mesajı gönderilemedi; log servisi üzerinden yeniden denenecek.', error);
          }
        }
        const alreadySentToLogChannel = leaveMessageSent
          && String(channelId) === String(settings.channels.logs || '');
        await app.services.audit.write('member.leave', { targetUserId: event.user_id }, {
          groupId: event.group_id,
          notify: !alreadySentToLogChannel,
          text: `Üye ayrıldı: #${event.user_id}`
        });
      } catch (error) { app.logger.error('Ayrılma olayı işlenemedi.', error); }
    });

    app.client.on('action:group/kick', async (event) => {
      try {
        await app.services.audit.write('member.kicked_event', { targetUserId: event.user_id }, {
          groupId: event.group_id, text: `Üye gruptan çıkarıldı: #${event.user_id}`
        });
      } catch (error) { app.logger.error('Atılma olayı işlenemedi.', error); }
    });

    app.router.register({
      name: 'welcome', aliases: ['hoşgeldin', 'hosgeldin'], category: 'Karşılama', description: 'Karşılama sistemini yönetir.',
      usage: 'welcome <durum|aç|kapat>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const action = String(ctx.args[0] || 'durum').toLocaleLowerCase('tr-TR');
        const settings = await ctx.services.settings.get(ctx.groupId);
        if (action === 'durum') {
          await ctx.services.channels?.prime?.(ctx.groupId);
          const channelLabel = settings.channels.welcome
            ? ctx.services.channels.describe(ctx.groupId, settings.channels.welcome)
            : 'Ayarsız';
          return ctx.reply(`Welcome: ${settings.welcome.enabled ? 'açık' : 'kapalı'}
DM: ${settings.welcome.dmEnabled ? 'açık' : 'kapalı'}
Kart: ${settings.welcome.cardEnabled ? 'açık' : 'kapalı'}
Embed biçimi: ${settings.welcome.embedEnabled ? 'açık' : 'kapalı'}
Kanal: ${channelLabel}
Ayar kapsamı: Sunucu #${ctx.groupId}
Test: ${ctx.config.prefix}welcometest
Onarım: ${ctx.config.prefix}welcometamir test`);
        }
        if (!['aç', 'ac', 'kapat'].includes(action)) return ctx.reply(`Kullanım: ${ctx.config.prefix}welcome <durum|aç|kapat>`);
        await ctx.services.settings.set(ctx.groupId, 'welcome.enabled', action !== 'kapat');
        return ctx.reply(`Karşılama sistemi ${action === 'kapat' ? 'kapatıldı' : 'açıldı'}.`);
      }
    });


    app.router.register({
      name: 'welcomekanal', aliases: ['hoşgeldinkanal', 'hosgeldinkanal'], category: 'Karşılama', description: 'Hoş geldin kanalını #kanaladı veya ID ile ayarlar.',
      usage: 'welcomekanal <#kanaladı|kanalId|kapat>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const reference = ctx.args.join(' ').trim();
        if (!reference) return ctx.reply(`Kullanım: ${ctx.config.prefix}welcomekanal <#kanaladı|kanalId|kapat>`);
        if (isDisableValue(reference)) {
          await ctx.services.settings.set(ctx.groupId, 'channels.welcome', '');
          await ctx.services.audit.write('settings.welcome_channel', { actorUserId: ctx.userId, value: '' }, { groupId: ctx.groupId });
          return ctx.reply(`Sunucu #${ctx.groupId} için hoş geldin kanalı kapatıldı.`);
        }
        try {
          const channel = await ctx.services.channels.resolve(ctx.groupId, reference);
          await ctx.services.settings.set(ctx.groupId, 'channels.welcome', String(channel.id));
          let accessNote = '';
          try {
            const access = await ctx.services.welcome.ensureBotAccess(channel.id, { force: true });
            accessNote = ` Bot #${access.botUserId} için okuma/yazma erişimi doğrulandı.`;
          } catch (accessError) {
            accessNote = ` Bot erişimi otomatik eklenemedi: ${accessError.message}`;
          }
          await ctx.services.audit.write('settings.welcome_channel', {
            actorUserId: ctx.userId,
            value: String(channel.id),
            channelName: channel.name || undefined
          }, { groupId: ctx.groupId });
          return ctx.reply(`Hoş geldin kanalı bu sunucu için #${channel.name || channel.id} · ${channel.id} olarak ayarlandı.${accessNote}`);
        } catch (error) {
          return ctx.reply(`Hoş geldin kanalı ayarlanamadı: ${error.message}`);
        }
      }
    });


    app.router.register({
      name: 'welcometest', aliases: ['hoşgeldintest', 'hosgeldintest'], category: 'Karşılama', description: 'Hoş geldin sistemini gerçek gönderimle test eder.',
      usage: 'welcometest [kullanıcıId]', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const targetUserId = Number(ctx.args[0]) || Number(ctx.userId);
        try {
          const result = await ctx.services.welcome.sendWelcome({
            groupId: ctx.groupId,
            userId: targetUserId,
            source: 'manual-test'
          });
          return ctx.reply(`Hoş geldin testi başarılı. Kanal ID: ${result.channelId} · Kullanıcı ID: ${targetUserId}`);
        } catch (error) {
          return ctx.reply(`Hoş geldin testi başarısız: ${error.message}`);
        }
      }
    });

    app.router.register({
      name: 'welcometamir', aliases: ['hoşgeldintamir', 'hosgeldintamir'], category: 'Karşılama', description: 'Hoş geldin kanalını, bot erişimini ve gönderimi otomatik onarır.',
      usage: 'welcometamir [test]', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const sendTest = ['test', 'dene', 'gönder', 'gonder'].includes(String(ctx.args[0] || '').toLocaleLowerCase('tr-TR'));
        try {
          const result = await ctx.services.welcome.repair(ctx.groupId, {
            enable: true,
            sendTest,
            testUserId: ctx.userId
          });
          return ctx.reply(`Hoş geldin sistemi onarıldı.
Kanal ID: ${result.channelId}
Bot kullanıcı ID: ${result.botUserId}${sendTest ? '\nTest mesajı gönderildi.' : ''}`);
        } catch (error) {
          return ctx.reply(`Hoş geldin sistemi onarılamadı: ${error.message}`);
        }
      }
    });

    app.router.register({
      name: 'welcomediagnostik', aliases: ['hoşgeldindiagnostik', 'hosgeldindiagnostik'], category: 'Karşılama', description: 'Hoş geldin sisteminin olay, kanal ve bot yetkisi durumunu gösterir.',
      usage: 'welcomediagnostik', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const result = await ctx.services.welcome.diagnostics(ctx.groupId);
        return ctx.reply(diagnosticText(result));
      }
    });

    app.router.register({
      name: 'welcomemesaj', aliases: ['hoşgeldinmesaj', 'hosgeldinmesaj'], category: 'Karşılama', description: 'Welcome mesajını değiştirir.',
      usage: 'welcomemesaj <mesaj>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) { const text = ctx.args.join(' ').trim(); if (!text) return ctx.reply(`Kullanım: ${ctx.config.prefix}welcomemesaj <mesaj>`); await ctx.services.settings.set(ctx.groupId, 'welcome.message', truncate(text, 1000)); return ctx.reply('Welcome mesajı güncellendi. Değişkenler: {userId}, {userName}, {userNick}, {groupName}, {memberCount}'); }
    });

    app.router.register({
      name: 'leavemesaj', category: 'Karşılama', description: 'Ayrılma mesajını değiştirir.', usage: 'leavemesaj <mesaj>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) { const text = ctx.args.join(' ').trim(); if (!text) return ctx.reply(`Kullanım: ${ctx.config.prefix}leavemesaj <mesaj>`); await ctx.services.settings.set(ctx.groupId, 'leave.message', truncate(text, 1000)); return ctx.reply('Ayrılma mesajı güncellendi.'); }
    });

    const toggle = (name, path, label) => app.router.register({
      name, category: 'Karşılama', description: `${label} açar/kapatır.`, usage: `${name} <aç|kapat>`, guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) { const action = String(ctx.args[0] || '').toLocaleLowerCase('tr-TR'); if (!['aç', 'ac', 'kapat'].includes(action)) return ctx.reply(`Kullanım: ${ctx.config.prefix}${name} <aç|kapat>`); await ctx.services.settings.set(ctx.groupId, path, action !== 'kapat'); return ctx.reply(`${label} ${action === 'kapat' ? 'kapatıldı' : 'açıldı'}.`); }
    });
    toggle('welcomedm', 'welcome.dmEnabled', 'DM hoş geldin mesajı');
    toggle('welcomekart', 'welcome.cardEnabled', 'Welcome kartı');
    toggle('welcomeembed', 'welcome.embedEnabled', 'Embed biçimli welcome');
    toggle('leave', 'leave.enabled', 'Ayrılma mesajı');

    app.router.register({
      name: 'welcomedmmesaj', category: 'Karşılama', description: 'DM hoş geldin mesajını ayarlar.', usage: 'welcomedmmesaj <mesaj>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) { const text = ctx.args.join(' ').trim(); if (!text) return ctx.reply(`Kullanım: ${ctx.config.prefix}welcomedmmesaj <mesaj>`); await ctx.services.settings.set(ctx.groupId, 'welcome.dmMessage', truncate(text, 1500)); return ctx.reply('DM welcome mesajı güncellendi.'); }
    });

    app.router.register({
      name: 'welcomearkaplan', category: 'Karşılama', description: 'Welcome kart arka plan rengini veya URL’sini ayarlar.', usage: 'welcomearkaplan <#renk|url>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) { const value = ctx.args.join(' ').trim(); if (!value) return ctx.reply(`Kullanım: ${ctx.config.prefix}welcomearkaplan <#151922|https://...>`); await ctx.services.settings.set(ctx.groupId, 'welcome.background', value); return ctx.reply('Welcome kart arka planı güncellendi.'); }
    });

    app.router.register({
      name: 'welcomerenk', category: 'Karşılama', description: 'Welcome kart vurgu rengini ayarlar.', usage: 'welcomerenk <#hex>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) { const value = String(ctx.args[0] || ''); if (!/^#[0-9a-f]{6}$/i.test(value)) return ctx.reply(`Kullanım: ${ctx.config.prefix}welcomerenk <#ff83c8>`); await ctx.services.settings.set(ctx.groupId, 'welcome.accent', value); return ctx.reply('Welcome kart rengi güncellendi.'); }
    });
  }
};
