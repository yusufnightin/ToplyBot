const { truncate } = require('../utils/text');
const { extractCreatedPostId } = require('../utils/api');

function nextTicketId(tickets) { return tickets.reduce((max, ticket) => Math.max(max, Number(ticket.id) || 0), 0) + 1; }

module.exports = {
  name: 'Gelişmiş Ticket Sistemi',
  setup(app) {
    const openTicket = async ({ groupId, userId, sourceChannelId, subject, panelId = null }) => {
      const settings = await app.services.settings.get(groupId);
      if (!settings.tickets.enabled) return { disabled: true };
      const tickets = await app.stores.tickets.read();
      let existing = tickets.find((ticket) => String(ticket.groupId) === String(groupId) && Number(ticket.userId) === Number(userId) && ticket.status === 'open');
      if (existing?.channelId && app.services.provisioning?.findChannelById) {
        const existingChannel = await app.services.provisioning.findChannelById(groupId, existing.channelId);
        if (!existingChannel) {
          await app.stores.tickets.update((items) => {
            const stale = items.find((item) => Number(item.id) === Number(existing.id));
            if (stale) {
              stale.status = 'closed';
              stale.closedAt = new Date().toISOString();
              stale.closedBy = 0;
              stale.closeReason = 'channel-missing';
            }
            return items;
          });
          app.logger?.warn('Kanalı silinmiş açık ticket otomatik kapatıldı.', {
            groupId,
            ticketId: existing.id,
            channelId: existing.channelId,
            userId
          });
          existing = null;
        }
      }
      if (existing) return { existing };

      let channelId = sourceChannelId || settings.channels.tickets || null;
      if (settings.tickets.createPrivateChannel) {
        const staffRoles = (settings.tickets.staffRoleIds || []).map(Number).filter(Number.isInteger);
        const nick = `${settings.tickets.channelPrefix || 'ticket'}-${userId}-${Date.now().toString(36)}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
        try {
          const ticketNumber = nextTicketId(tickets);
          const title = `Ticket #${ticketNumber} · ${userId}`;
          const botUserId = await app.client.getCurrentUserId().catch(() => null);
          const privilegedUsers = [userId, botUserId].map(Number).filter(Number.isInteger).join(',');
          const provisioned = await app.services.provisioning.ensureChannel({
            groupId,
            spec: { nick, title },
            payload: {
              group_id: groupId,
              nick,
              title,
              description: truncate(subject, 500),
              type: 1,
              data: '',
              read_role_ids: staffRoles.join(','),
              write_role_ids: staffRoles.join(','),
              control_role_ids: staffRoles.join(','),
              read_plus_user_ids: privilegedUsers,
              read_minus_user_ids: '',
              write_plus_user_ids: privilegedUsers,
              write_minus_user_ids: '',
              control_plus_user_ids: botUserId ? String(botUserId) : '',
              control_minus_user_ids: ''
            }
          });
          channelId = provisioned.id || channelId;
          if (channelId) {
            await app.client.grantChannelAccess(channelId, userId, { read: true, write: true }).catch(() => {});
            if (botUserId) await app.client.grantChannelAccess(channelId, botUserId, { read: true, write: true, control: true }).catch(() => {});
          }
        } catch (error) {
          app.logger.error('Özel ticket kanalı oluşturulamadı; mevcut kanala düşülüyor.', error);
        }
      }

      let created;
      await app.stores.tickets.update((items) => {
        created = {
          id: nextTicketId(items), groupId, userId: Number(userId), channelId,
          sourceChannelId: sourceChannelId || null, panelId, subject: truncate(subject, 1000),
          status: 'open', createdAt: new Date().toISOString(), closedAt: null, closedBy: null,
          messages: []
        };
        items.push(created); return items;
      });
      const ticketMessage = `🎫 Ticket #${created.id}\nKullanıcı: #${userId}\nKonu: ${created.subject}\n${settings.tickets.welcomeMessage}\nKapatmak: ${app.config.prefix}ticket kapat ${created.id}`;
      if (channelId) {
        try {
          await app.client.sendPost(channelId, ticketMessage);
        } catch (error) {
          const fallbackChannelId = sourceChannelId || settings.channels.tickets || null;
          if (!fallbackChannelId || String(fallbackChannelId) === String(channelId)) throw error;
          const failedChannelId = channelId;
          channelId = fallbackChannelId;
          created.channelId = fallbackChannelId;
          await app.stores.tickets.update((items) => {
            const stored = items.find((item) => Number(item.id) === Number(created.id));
            if (stored) {
              stored.channelId = fallbackChannelId;
              stored.privateChannelFailure = truncate(error.message, 500);
            }
            return items;
          });
          await app.client.sendPost(fallbackChannelId, ticketMessage);
          app.logger?.warn('Ticket özel kanalına yazılamadı; ana destek kanalına yönlendirildi.', {
            groupId,
            ticketId: created.id,
            failedChannelId,
            fallbackChannelId,
            message: error.message
          });
        }
      }
      try { await app.client.sendDirectMessage(userId, `Ticket #${created.id} açıldı.${channelId ? ` Kanal: #${channelId}` : ''}`); } catch {}
      await app.services.audit.write('ticket.open', { targetUserId: Number(userId), ticketId: created.id, channelId, subject: created.subject }, { groupId, text: `Ticket açıldı.\n#${created.id}\nKullanıcı: #${userId}\nKonu: ${created.subject}` });
      return { created };
    };

    app.client.on('message', async (event) => {
      if (event?.action !== 'post/bumote' || !event.message?.form) return;
      try {
        const panels = await app.stores.ticketPanels.read();
        const panel = panels.find((item) => String(item.postId) === String(event.post_id) && item.active);
        if (!panel) return;
        const subject = event.message.form.subject || event.message.form.konu || event.message.form.message || 'Panel üzerinden destek talebi';
        await openTicket({ groupId: panel.groupId, userId: event.user_id, sourceChannelId: panel.channelId, subject, panelId: panel.id });
      } catch (error) { app.logger.error('Ticket panel formu işlenemedi.', error); }
    });

    app.router.register({
      name: 'ticket', aliases: ['destek'], category: 'Ticket', description: 'Ticket açar, kapatır ve yönetir.', usage: 'ticket <aç konu|kapat id|liste|bilgi id>', guildOnly: true, cooldownMs: 5000,
      async execute(ctx) {
        const action = String(ctx.args.shift() || 'aç').toLocaleLowerCase('tr-TR');
        if (['aç', 'ac', 'oluştur', 'olustur'].includes(action)) {
          const subject = ctx.args.join(' ').trim(); if (!subject) return ctx.reply(`Kullanım: ${ctx.config.prefix}ticket aç <sorun>`);
          const result = await openTicket({ groupId: ctx.groupId, userId: ctx.userId, sourceChannelId: ctx.channelId, subject });
          if (result.disabled) return ctx.reply('Ticket sistemi şu anda kapalı.');
          return ctx.reply(result.existing ? `Zaten açık ticketın var: #${result.existing.id}` : `Ticket #${result.created.id} açıldı.`);
        }
        if (action === 'liste') {
          if (!ctx.isModerator) return ctx.reply('Bu işlem için moderatör yetkisi gerekiyor.');
          const items = (await ctx.stores.tickets.read()).filter((ticket) => String(ticket.groupId) === String(ctx.groupId) && ticket.status === 'open').slice(-25);
          return ctx.reply(`Açık ticketlar:\n${items.map((ticket) => `#${ticket.id} — kullanıcı #${ticket.userId} — kanal ${ticket.channelId || '-'} — ${truncate(ticket.subject, 80)}`).join('\n') || 'yok'}`);
        }
        const id = Number(ctx.args[0]); if (!Number.isInteger(id)) return ctx.reply(`Kullanım: ${ctx.config.prefix}ticket <kapat|bilgi> <id>`);
        const tickets = await ctx.stores.tickets.read(); const ticket = tickets.find((item) => Number(item.id) === id && String(item.groupId) === String(ctx.groupId));
        if (!ticket) return ctx.reply('Ticket bulunamadı.');
        if (action === 'bilgi') { if (ticket.userId !== ctx.userId && !ctx.isModerator) return ctx.reply('Bu ticketı görüntüleyemezsin.'); return ctx.reply(truncate(JSON.stringify(ticket, null, 2), 1700), 'json'); }
        if (action === 'kapat') {
          if (ticket.userId !== ctx.userId && !ctx.isModerator) return ctx.reply('Bu ticketı kapatamazsın.');
          let closed;
          await ctx.stores.tickets.update((items) => { const item = items.find((entry) => Number(entry.id) === id); if (!item || item.status !== 'open') return items; item.status = 'closed'; item.closedAt = new Date().toISOString(); item.closedBy = ctx.userId; closed = { ...item }; return items; });
          if (!closed) return ctx.reply('Ticket zaten kapalı.');
          const settings = await ctx.services.settings.get(ctx.groupId);
          try { await ctx.client.sendDirectMessage(closed.userId, `Ticket #${id} kapatıldı.`); } catch {}
          await ctx.services.audit.write('ticket.close', { actorUserId: ctx.userId, targetUserId: closed.userId, ticketId: id, channelId: closed.channelId }, { groupId: ctx.groupId });
          if (settings.tickets.deleteChannelOnClose && closed.channelId && String(closed.channelId) !== String(closed.sourceChannelId)) { try { await ctx.client.deleteChannel(closed.channelId); } catch {} }
          return ctx.reply(`Ticket #${id} kapatıldı.`);
        }
        return ctx.reply('Bilinmeyen ticket işlemi.');
      }
    });

    app.router.register({
      name: 'ticketpanel', category: 'Ticket', description: 'Buton/Bumote uyumlu ticket paneli oluşturur.', usage: 'ticketpanel <başlık>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) { const title = ctx.args.join(' ').trim() || 'Destek Merkezi'; const result = await ctx.client.sendPost(ctx.channelId, `🎫 ${title}\nTicket açmak için: ${ctx.config.prefix}ticket aç <sorununuz>\nBumote formu subject/konu alanı gönderirse panelden otomatik ticket açılır.`); const postId = extractCreatedPostId(result); let panel; await ctx.stores.ticketPanels.update((items) => { panel = { id: nextTicketId(items), groupId: ctx.groupId, channelId: ctx.channelId, postId, title, active: true, createdBy: ctx.userId, createdAt: new Date().toISOString() }; items.push(panel); return items; }); return ctx.reply(`Ticket paneli #${panel.id} oluşturuldu.${postId ? ` Post ID: ${postId}` : ''}`); }
    });

    app.router.register({
      name: 'ticketyetkili', category: 'Ticket', description: 'Ticket yetkili rollerini ayarlar.', usage: 'ticketyetkili <rolId,rolId|temizle>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) { const raw = ctx.args.join(',').trim(); const roleIds = ['temizle', '0'].includes(raw.toLowerCase()) ? [] : [...new Set(raw.split(',').map((item) => Number(item.trim())).filter(Number.isInteger))]; if (!raw || (!roleIds.length && !['temizle', '0'].includes(raw.toLowerCase()))) return ctx.reply(`Kullanım: ${ctx.config.prefix}ticketyetkili <rolId,rolId|temizle>`); await ctx.services.settings.set(ctx.groupId, 'tickets.staffRoleIds', roleIds); return ctx.reply(`Ticket yetkili rolleri: ${roleIds.join(', ') || 'yok'}`); }
    });

    app.router.register({
      name: 'ticketayar', category: 'Ticket', description: 'Ticket kanal davranışını ayarlar.', usage: 'ticketayar <özelkanal|kanalsil> <aç|kapat>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) { const key = String(ctx.args[0] || '').toLocaleLowerCase('tr-TR'); const action = String(ctx.args[1] || '').toLocaleLowerCase('tr-TR'); if (!['özelkanal', 'ozelkanal', 'kanalsil'].includes(key) || !['aç', 'ac', 'kapat'].includes(action)) return ctx.reply(`Kullanım: ${ctx.config.prefix}ticketayar <özelkanal|kanalsil> <aç|kapat>`); const path = key === 'kanalsil' ? 'tickets.deleteChannelOnClose' : 'tickets.createPrivateChannel'; await ctx.services.settings.set(ctx.groupId, path, action !== 'kapat'); return ctx.reply('Ticket ayarı güncellendi.'); }
    });


    app.router.register({
      name: 'destekşablon', aliases: ['desteksablon', 'destekkur', 'supporttemplate'], category: 'Yönetim',
      description: 'Bot sahibine özel gelişmiş destek sunucusunu kurar, onarır veya onayla tamamen yeniden oluşturur.',
      usage: 'destekşablon <kur|onar|doğrula|durum|test|sıfırla TAM SIFIRLA>', guildOnly: true, requiredPermission: 'owner', cooldownMs: 15000,
      async execute(ctx) {
        const action = String(ctx.args[0] || 'durum').toLocaleLowerCase('tr-TR');
        if (!ctx.services.supportTemplate?.canInstall(ctx.userId)) {
          return ctx.reply('Bu şablonu yalnızca config.json içinde belirlenen tek bot sahibi kullanabilir.');
        }

        if (['durum', 'status'].includes(action)) {
          const settings = await ctx.services.settings.get(ctx.groupId);
          const state = await ctx.services.supportTemplate.readState(ctx.groupId);
          return ctx.reply([
            `🧰 Destek şablonu · Sunucu #${ctx.groupId}`,
            `Durum: ${state?.status || 'kurulmamış'} · Aşama: ${state?.stage || '—'} · İlerleme: %${state?.progress || 0}`,
            `Sürüm: ${state?.version || '—'} · Son güncelleme: ${state?.updatedAt || '—'}`,
            `Hoş geldin: ${settings.channels.welcome || 'ayarsız'}`,
            `Destek: ${settings.channels.tickets || 'ayarsız'}`,
            `Ticket log: ${settings.channels.ticketLogs || 'ayarsız'}`,
            `Moderasyon log: ${settings.channels.moderationLogs || 'ayarsız'}`,
            `Sistem log: ${settings.channels.logs || 'ayarsız'}`,
            `Ticket: ${settings.tickets.enabled ? 'açık' : 'kapalı'}`,
            `Ticket rolleri: ${(settings.tickets.staffRoleIds || []).join(', ') || 'ayarsız'}`,
            `Timeout rolü: ${settings.moderation.muteRoleId || 'ayarsız'}`,
            state?.backupId ? `Güvenlik yedeği: ${state.backupId}` : null,
            state?.lastError?.message ? `Son hata: ${state.lastError.message}` : null
          ].filter(Boolean).join('\n'));
        }

        if (['doğrula', 'dogrula', 'verify'].includes(action)) {
          const verification = await ctx.services.supportTemplate.verify(ctx.groupId);
          return ctx.reply([
            verification.ok ? '✅ Destek şablonu doğrulaması başarılı.' : '⚠️ Destek şablonunda eksikler bulundu.',
            `Kanal sayısı: ${verification.channelCount} · Rol sayısı: ${verification.roleCount}`,
            verification.issues.length ? `Sorunlar:\n${verification.issues.map((item) => `• ${item}`).join('\n')}` : 'Sorun bulunamadı.'
          ].join('\n'));
        }

        if (['test'].includes(action)) {
          const verification = await ctx.services.supportTemplate.verify(ctx.groupId);
          let welcome = null;
          if (verification.ok) {
            welcome = await ctx.services.welcome.sendWelcome({ groupId: ctx.groupId, userId: ctx.userId, source: 'template-test' });
          }
          return ctx.reply(`${verification.ok ? '✅' : '⚠️'} Şablon testi ${verification.ok ? 'başarılı' : 'eksiklerle tamamlandı'}.${welcome ? ` Hoş geldin mesajı #${welcome.channelId} kanalına gönderildi.` : ''}${verification.issues.length ? `\n${verification.issues.join('\n')}` : ''}`);
        }

        if (['sıfırla', 'sifirla', 'yenidenkur', 'rebuild'].includes(action)) {
          const confirmation = ctx.args.slice(1).join(' ').trim();
          if (confirmation.toLocaleUpperCase('tr-TR') !== 'TAM SIFIRLA') {
            return ctx.reply(`⚠️ Bu işlem mevcut kanalları ve rolleri siler.\nOnaylamak için: ${ctx.config.prefix}destekşablon sıfırla TAM SIFIRLA`);
          }
          await ctx.reply('⚠️ Tam yeniden kurulum başlıyor. Mevcut kanal ve roller yedek envantere alınıp silinecek; sonuç özel mesajla ve yeni bot-komut kanalında bildirilecek.');
          if (ctx.progress) ctx.progress.unupdatable = true;
          await ctx.client.sendDirectMessage(ctx.userId, `⏳ Sunucu #${ctx.groupId} tam yeniden kuruluyor. Bu işlem bitene kadar yeni komut gönderme.`).catch(() => {});
          try {
            const result = await ctx.services.supportTemplate.rebuild({
              groupId: ctx.groupId,
              userId: ctx.userId,
              confirmation,
              progress: ctx.progress
            });
            const summary = [
              result.verification.ok ? '✅ Destek sunucusu tamamen yeniden kuruldu.' : '⚠️ Yeniden kurulum uyarılarla tamamlandı.',
              `Şablon v${result.version} • ${Object.keys(result.channels).length} kanal • ${Object.keys(result.roles).length} rol`,
              `Silinen eski yapı: ${result.rebuild.deletedChannels}/${result.rebuild.previousChannels} kanal • ${result.rebuild.deletedRoles}/${result.rebuild.previousRoles} rol`,
              `Seviye ödülleri: ${Object.keys(result.levelRewards.roleRewards).length} rol • ${Object.keys(result.levelRewards.badgeRewards).length} SVG rozet`,
              `Yeni bot-komut kanalı: #${result.channels.commands}`,
              `Güvenlik yedeği: ${result.backupId}`,
              result.verification.issues.length ? `Uyarılar: ${result.verification.issues.join(' | ')}` : null
            ].filter(Boolean).join('\n');
            await ctx.client.sendPost(result.channels.commands, summary).catch(() => {});
            await ctx.client.sendDirectMessage(ctx.userId, summary).catch(() => {});
            return;
          } catch (error) {
            await ctx.client.sendDirectMessage(ctx.userId, `❌ Tam yeniden kurulum tamamlanamadı: ${error.message}`).catch(() => {});
            throw error;
          }
        }

        const installActions = ['kur', 'yükle', 'yukle', 'install'];
        const repairActions = ['onar', 'tamir', 'devam', 'resume', 'repair'];
        if (!installActions.includes(action) && !repairActions.includes(action)) {
          return ctx.reply(`Kullanım: ${ctx.config.prefix}destekşablon <kur|onar|doğrula|durum|test|sıfırla TAM SIFIRLA>`);
        }

        await ctx.reply(repairActions.includes(action)
          ? '🔧 Destek sunucusu denetleniyor; eksik kanal, rol, erişim ve ayarlar tamamlanacak.'
          : '⏳ Destek sunucusu şablonu kuruluyor. İşlem güvenlik yedeği alır, adım adım ilerler ve yarıda kalırsa tekrar çalıştırılabilir.');
        const result = repairActions.includes(action)
          ? await ctx.services.supportTemplate.repair({ groupId: ctx.groupId, userId: ctx.userId, sendWelcomeTest: false, progress: ctx.progress })
          : await ctx.services.supportTemplate.install({ groupId: ctx.groupId, userId: ctx.userId, progress: ctx.progress });
        return ctx.reply([
          result.verification.ok ? '✅ Destek sunucusu sistemi tamamen hazır.' : '⚠️ Kurulum tamamlandı fakat doğrulama uyarıları var.',
          `Şablon sürümü: ${result.version}`,
          `Roller: ${Object.entries(result.roles).map(([key, id]) => `${key}=#${id}`).join(', ')}`,
          `Kanallar: ${Object.entries(result.channels).map(([key, id]) => `${key}=#${id}`).join(', ')}`,
          `Ticket panel postu: ${result.ticketPanelPostId || 'oluşturulamadı'}`,
          `Seviye ödülleri: ${Object.keys(result.levelRewards?.roleRewards || {}).length} rol • ${Object.keys(result.levelRewards?.badgeRewards || {}).length} SVG rozet`,
          `Güvenlik yedeği: ${result.backupId}`,
          `Yeni roller: ${result.createdRoles.join(', ') || 'yok; mevcutlar kullanıldı'}`,
          `Yeni kanallar: ${result.createdChannels.join(', ') || 'yok; mevcutlar kullanıldı'}`,
          `Listeden kurtarılan ID'ler: ${[...result.recoveredRoles, ...result.recoveredChannels].join(', ') || 'yok'}`,
          result.verification.issues.length ? `Uyarılar: ${result.verification.issues.join(' | ')}` : null
        ].filter(Boolean).join('\n'));
      }
    });
  }
};
