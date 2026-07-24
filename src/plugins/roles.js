const { truncate } = require('../utils/text');
const { parseDuration, formatDuration } = require('../utils/duration');
const { findObject } = require('../utils/api');

function parseRoleIds(args) {
  return [...new Set(args.join(',').split(',').map((item) => Number(item.trim())).filter(Number.isInteger))];
}

function apiCreatedId(result) {
  const object = findObject(result, ['role', 'channel', 'data']) || {};
  const id = Number(object.id ?? object.role_id ?? result?.id ?? result?.data?.id);
  return Number.isInteger(id) ? id : null;
}

module.exports = {
  name: 'Gelişmiş Rol Yönetimi',
  setup(app) {
    app.client.on('action:group/join', async (event) => {
      try {
        const settings = await app.services.settings.get(event.group_id);
        if (settings.autorole.removeRoleIds.length) await app.services.roles.removeMemberRoles(event.group_id, event.user_id, settings.autorole.removeRoleIds);
        if (!settings.autorole.enabled || !settings.autorole.roleIds.length) return;
        await app.services.roles.applyAutorole(event.group_id, event.user_id, settings);
        await app.services.audit.write('role.autorole', { targetUserId: event.user_id, roleIds: settings.autorole.roleIds }, {
          groupId: event.group_id, text: `Otorol verildi.\nKullanıcı: #${event.user_id}\nRoller: ${settings.autorole.roleIds.join(', ')}`
        });
      } catch (error) { app.logger.error('Otorol uygulanamadı.', error); }
    });

    app.client.on('message', async (event) => {
      if (event?.action !== 'post/bumote' || !event.message?.form) return;
      try {
        const panelId = String(event.post_id);
        const panels = await app.stores.rolePanels.read();
        const panel = panels.find((item) => String(item.postId) === panelId && item.active);
        if (!panel) return;
        const selected = Number(event.message.form.role_id ?? event.message.form.role ?? event.message.form.value);
        if (!Number.isInteger(selected) || !panel.roleIds.includes(selected)) return;
        const action = String(event.message.form.action || event.message.submit || 'toggle').toLowerCase();
        const current = await app.services.roles.memberRoleIds(panel.groupId, event.user_id);
        const hasRole = current.includes(selected);
        if (action.includes('kaldır') || action.includes('remove') || (action === 'toggle' && hasRole)) {
          await app.services.roles.removeMemberRoles(panel.groupId, event.user_id, [selected]);
        } else {
          await app.services.roles.addMemberRoles(panel.groupId, event.user_id, [selected]);
        }
      } catch (error) { app.logger.error('Rol paneli formu işlenemedi.', error); }
    });

    app.services.scheduler.register('temporary-roles', async (now) => {
      const expired = [];
      await app.stores.tempRoles.update((items) => {
        for (const item of items) {
          if (item.active && item.expiresAt && Date.parse(item.expiresAt) <= now) {
            item.active = false; item.expiredAt = new Date().toISOString(); expired.push({ ...item });
          }
        }
        return items;
      });
      for (const item of expired) {
        try {
          await app.services.roles.removeMemberRoles(item.groupId, item.userId, [item.roleId]);
          await app.services.audit.write('role.temporary_expired', { targetUserId: item.userId, roleId: item.roleId }, { groupId: item.groupId });
        } catch (error) { app.logger.error('Geçici rol kaldırılamadı.', error); }
      }
    });

    app.router.register({
      name: 'roller', category: 'Roller', description: 'Gruptaki rolleri listeler.', usage: 'roller', guildOnly: true,
      async execute(ctx) { const roles = await ctx.services.roles.list(ctx.groupId); if (!roles.length) return ctx.reply('Rol bulunamadı.'); return ctx.reply(`Roller:\n${truncate(roles.map((role) => `#${role.id} — ${role.name || role.title || 'İsimsiz'}`).join('\n'), 1800)}`); }
    });

    app.router.register({
      name: 'üyerolleri', aliases: ['uyerolleri'], category: 'Roller', description: 'Üyenin rollerini gösterir.', usage: 'üyerolleri [kullanıcıId]', guildOnly: true,
      async execute(ctx) { const userId = Number(ctx.args[0] || ctx.userId); if (!Number.isInteger(userId)) return ctx.reply('Geçerli kullanıcı ID girin.'); const ids = await ctx.services.roles.memberRoleIds(ctx.groupId, userId); const names = await ctx.services.roles.roleNameMap(ctx.groupId); return ctx.reply(`Kullanıcı #${userId} rolleri:\n${ids.map((id) => `#${id} — ${names.get(id) || 'Bilinmeyen'}`).join('\n') || 'Rol yok.'}`); }
    });

    app.router.register({
      name: 'otorol', category: 'Roller', description: 'Yeni katılanlara otomatik rol verir.', usage: 'otorol <durum|aç rolId...|kapat|kaldır rolId...>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const action = String(ctx.args.shift() || 'durum').toLocaleLowerCase('tr-TR'); const settings = await ctx.services.settings.get(ctx.groupId);
        if (['durum', 'göster', 'liste'].includes(action)) return ctx.reply(`Otorol: ${settings.autorole.enabled ? 'açık' : 'kapalı'}\nVerilecek: ${settings.autorole.roleIds.join(', ') || 'yok'}\nKatılırken kaldırılacak: ${settings.autorole.removeRoleIds.join(', ') || 'yok'}`);
        if (action === 'kapat') { await ctx.services.settings.set(ctx.groupId, 'autorole.enabled', false); return ctx.reply('Otorol kapatıldı.'); }
        const roleIds = parseRoleIds(ctx.args); if (!roleIds.length) return ctx.reply(`Kullanım: ${ctx.config.prefix}otorol <aç|kaldır> <rolId...>`);
        if (['aç', 'ac'].includes(action)) { await ctx.services.settings.set(ctx.groupId, 'autorole.roleIds', roleIds); await ctx.services.settings.set(ctx.groupId, 'autorole.enabled', true); return ctx.reply(`Otorol açıldı: ${roleIds.join(', ')}`); }
        if (['kaldır', 'kaldir', 'remove'].includes(action)) { await ctx.services.settings.set(ctx.groupId, 'autorole.removeRoleIds', roleIds); return ctx.reply(`Katılımda kaldırılacak roller: ${roleIds.join(', ')}`); }
        return ctx.reply(`Kullanım: ${ctx.config.prefix}otorol <durum|aç rolId...|kapat|kaldır rolId...>`);
      }
    });

    const memberRoleCommand = (name, aliases, mode) => app.router.register({
      name, aliases, category: 'Roller', description: mode === 'add' ? 'Üyeye rol verir.' : 'Üyeden rol alır.', usage: `${name} <kullanıcıId> <rolId...>`, guildOnly: true, requiredPermission: 'moderator',
      async execute(ctx) { const userId = Number(ctx.args.shift()); const ids = parseRoleIds(ctx.args); if (!Number.isInteger(userId) || !ids.length) return ctx.reply(`Kullanım: ${ctx.config.prefix}${name} <kullanıcıId> <rolId...>`); const next = mode === 'add' ? await ctx.services.roles.addMemberRoles(ctx.groupId, userId, ids) : await ctx.services.roles.removeMemberRoles(ctx.groupId, userId, ids); await ctx.services.audit.write(`role.${mode}`, { actorUserId: ctx.userId, targetUserId: userId, roleIds: ids }, { groupId: ctx.groupId }); return ctx.reply(`Kullanıcı #${userId} rolleri: ${next.join(', ') || 'yok'}`); }
    });
    memberRoleCommand('rolver', [], 'add');
    memberRoleCommand('rolal', ['rolkaldır', 'rolkaldir'], 'remove');

    app.router.register({
      name: 'geçicirol', aliases: ['gecicirol', 'temprole'], category: 'Roller', description: 'Üyeye süreli rol verir.', usage: 'geçicirol <kullanıcıId> <rolId> <süre>', guildOnly: true, requiredPermission: 'moderator',
      async execute(ctx) {
        const userId = Number(ctx.args[0]); const roleId = Number(ctx.args[1]); const durationMs = parseDuration(ctx.args[2], { min: 60_000, max: 365 * 86_400_000 });
        if (!Number.isInteger(userId) || !Number.isInteger(roleId) || durationMs === null) return ctx.reply(`Kullanım: ${ctx.config.prefix}geçicirol <kullanıcıId> <rolId> <10m|2h|1d>`);
        await ctx.services.roles.addMemberRoles(ctx.groupId, userId, [roleId]);
        await ctx.stores.tempRoles.update((items) => { items.push({ id: `${Date.now()}-${userId}-${roleId}`, groupId: ctx.groupId, userId, roleId, givenBy: ctx.userId, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + durationMs).toISOString(), active: true }); return items; });
        return ctx.reply(`Rol #${roleId}, kullanıcı #${userId} için ${formatDuration(durationMs)} verildi.`);
      }
    });

    app.router.register({
      name: 'kendinerol', aliases: ['rolseç', 'rolsec'], category: 'Roller', description: 'İzin verilen rolü alır veya bırakır.', usage: 'kendinerol <rolId>', guildOnly: true,
      async execute(ctx) { const roleId = Number(ctx.args[0]); const settings = await ctx.services.settings.get(ctx.groupId); if (!Number.isInteger(roleId) || !settings.selfRoles.includes(roleId)) return ctx.reply(`Alınabilir roller: ${settings.selfRoles.join(', ') || 'yok'}`); const current = await ctx.services.roles.memberRoleIds(ctx.groupId, ctx.userId); if (current.includes(roleId)) { await ctx.services.roles.removeMemberRoles(ctx.groupId, ctx.userId, [roleId]); return ctx.reply(`Rol #${roleId} kaldırıldı.`); } await ctx.services.roles.addMemberRoles(ctx.groupId, ctx.userId, [roleId]); return ctx.reply(`Rol #${roleId} verildi.`); }
    });

    app.router.register({
      name: 'selfrol', category: 'Roller', description: 'Kendin-al rollerini yönetir.', usage: 'selfrol <liste|ekle rolId|sil rolId>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) { const action = String(ctx.args[0] || 'liste').toLowerCase(); const roleId = Number(ctx.args[1]); const settings = await ctx.services.settings.get(ctx.groupId); let roles = [...settings.selfRoles]; if (action === 'liste') return ctx.reply(`Kendin-al rolleri: ${roles.join(', ') || 'yok'}`); if (!Number.isInteger(roleId) || !['ekle', 'sil'].includes(action)) return ctx.reply(`Kullanım: ${ctx.config.prefix}selfrol <liste|ekle rolId|sil rolId>`); roles = action === 'ekle' ? [...new Set([...roles, roleId])] : roles.filter((id) => id !== roleId); await ctx.services.settings.set(ctx.groupId, 'selfRoles', roles); return ctx.reply(`Kendin-al rolleri: ${roles.join(', ') || 'yok'}`); }
    });

    app.router.register({
      name: 'rolpanel', aliases: ['reactionrole', 'buttonrole', 'butonrol', 'tepkirol'], category: 'Roller', description: 'Komut/Bumote uyumlu rol paneli oluşturur.', usage: 'rolpanel oluştur <başlık> | <rolId,rolId>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const action = String(ctx.args.shift() || 'liste').toLowerCase();
        if (action === 'liste') { const panels = (await ctx.stores.rolePanels.read()).filter((item) => String(item.groupId) === String(ctx.groupId) && item.active); return ctx.reply(`Rol panelleri:\n${panels.map((item) => `#${item.id} — ${item.title} — ${item.roleIds.join(', ')}`).join('\n') || 'yok'}`); }
        if (action !== 'oluştur' && action !== 'olustur') return ctx.reply(`Kullanım: ${ctx.config.prefix}rolpanel oluştur <başlık> | <rolId,rolId>`);
        const input = ctx.args.join(' '); const [titleRaw, roleRaw] = input.split('|'); const title = titleRaw?.trim(); const roleIds = parseRoleIds([roleRaw || '']);
        if (!title || !roleIds.length) return ctx.reply(`Kullanım: ${ctx.config.prefix}rolpanel oluştur Renk Rolleri | 1,2,3`);
        const names = await ctx.services.roles.roleNameMap(ctx.groupId);
        const text = `🎭 ${title}\n${roleIds.map((id) => `• #${id} — ${names.get(id) || 'Rol'}: ${ctx.config.prefix}rolseç ${id}`).join('\n')}\n\nTopluyo Bumote formu bu post üzerinde role_id alanı gönderirse buton/form seçimi de otomatik işlenir.`;
        const result = await ctx.client.sendPost(ctx.channelId, truncate(text, 1800)); const postId = apiCreatedId(result);
        let panel;
        await ctx.stores.rolePanels.update((items) => { panel = { id: items.length ? Math.max(...items.map((item) => Number(item.id) || 0)) + 1 : 1, groupId: ctx.groupId, channelId: ctx.channelId, postId, title, roleIds, createdBy: ctx.userId, createdAt: new Date().toISOString(), active: true }; items.push(panel); return items; });
        return ctx.reply(`Rol paneli #${panel.id} oluşturuldu.${postId ? ` Post ID: ${postId}` : ''}`);
      }
    });

    app.router.register({
      name: 'rolekle', category: 'Roller', description: 'Rolü resmî role/add API’siyle oluşturur; hazır yetki şablonu destekler.', usage: 'rolekle <isim> | <#renk> | [member/content/support/moderator/admin]', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const [nameRaw, colorRaw, presetRaw] = ctx.args.join(' ').split('|');
        const name = nameRaw?.trim(); const color = colorRaw?.trim() || '#999999'; const preset = presetRaw?.trim() || 'member';
        if (!name || !/^#[0-9a-f]{6}$/i.test(color)) return ctx.reply(`Kullanım: ${ctx.config.prefix}rolekle Moderatör | #ff83c8 | moderator`);
        const created = await ctx.services.apiManagement.createRole(ctx.groupId, { name, color, preset });
        return ctx.reply(`✅ Rol hazır: ${created.payload.name} · ID ${created.id}${created.created ? ' · oluşturuldu' : ' · zaten vardı'}`);
      }
    });

    app.router.register({
      name: 'rolsil', category: 'Roller', description: 'Rolü siler; onay gerekir.', usage: 'rolsil <rolId> onay', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) {
        const roleId = Number(ctx.args[0]);
        if (!Number.isInteger(roleId) || String(ctx.args[1] || '').toLocaleLowerCase('tr-TR') !== 'onay') return ctx.reply(`Silmek için: ${ctx.config.prefix}rolsil <rolId> onay`);
        await ctx.client.deleteRole(roleId);
        ctx.services.roles.invalidate?.(ctx.groupId);
        return ctx.reply(`🗑️ Rol #${roleId} silindi.`);
      }
    });
  }
};
