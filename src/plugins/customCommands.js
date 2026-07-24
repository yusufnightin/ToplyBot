const { tokenize, truncate } = require('../utils/text');
const { renderTemplate } = require('../utils/templates');
const { findObject } = require('../utils/api');

function key(groupId, name) { return `${groupId}:${String(name).toLocaleLowerCase('tr-TR')}`; }

module.exports = {
  name: 'Özel Komut Oluşturucu',
  setup(app) {
    app.client.on('message', async (event) => {
      try {
        if (!['post/add', 'post/mention'].includes(event?.action) || typeof event.message !== 'string') return;
        const content = event.message.trim(); if (!content.startsWith(app.config.prefix)) return;
        const tokens = tokenize(content.slice(app.config.prefix.length)); const commandName = tokens.shift()?.toLocaleLowerCase('tr-TR');
        if (!commandName || app.router.getCommand(commandName)) return;
        const groupId = app.groupResolver.resolve(event); if (groupId === null) return;
        const settings = await app.services.settings.get(groupId);
        if (!settings.customCommands.enabled) return;
        const commands = await app.stores.customCommands.read(); const command = commands[key(groupId, commandName)];
        if (!command || !command.enabled) return;
        if (!app.permissionManager.has(event.user_id, command.permission || 'member')) { await app.client.sendPost(event.channel_id, `Bu özel komut için ${command.permission} yetkisi gerekiyor.`); return; }
        let user = {}; let group = {};
        try { user = findObject(await app.client.getUser(event.user_id), ['user', 'profile']) || {}; } catch {}
        try { group = findObject(await app.client.getGroup(groupId), ['group']) || {}; } catch {}
        const variables = {
          userId: event.user_id,
          userName: user.name || user.nick || `Kullanıcı #${event.user_id}`,
          userNick: user.nick || '',
          groupId,
          groupName: group.name || group.nick || `Grup #${groupId}`,
          channelId: event.channel_id,
          args: tokens.join(' '),
          arg1: tokens[0] || '', arg2: tokens[1] || '', arg3: tokens[2] || ''
        };
        const output = truncate(renderTemplate(command.content, variables), 1800);
        if (command.type === 'dm') await app.client.sendDirectMessage(event.user_id, output);
        else if (command.type === 'role_add') await app.services.roles.addMemberRoles(groupId, event.user_id, [Number(command.roleId)]);
        else if (command.type === 'role_remove') await app.services.roles.removeMemberRoles(groupId, event.user_id, [Number(command.roleId)]);
        else await app.client.sendPost(event.channel_id, command.type === 'embed' ? `╭─ ${command.title || commandName}\n${output}\n╰─` : output);
        await app.stores.customCommands.update((items) => { const item = items[key(groupId, commandName)]; if (item) { item.uses = (item.uses || 0) + 1; item.lastUsedAt = new Date().toISOString(); } return items; });
      } catch (error) { app.logger.error('Özel komut çalıştırılamadı.', error); }
    });

    app.router.register({
      name: 'komutoluştur', aliases: ['komutolustur', 'customcommand'], category: 'Özel Komutlar', description: 'Metin/embed/DM/rol özel komutu oluşturur.', usage: 'komutoluştur <ad> <text|embed|dm|role_add|role_remove> <içerik|rolId>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) { const name = String(ctx.args.shift() || '').toLocaleLowerCase('tr-TR').replace(/[^a-z0-9çğıöşü_-]/gi, ''); const type = String(ctx.args.shift() || 'text').toLowerCase(); const content = ctx.args.join(' ').trim(); if (!name || ctx.router.getCommand(name) || !['text', 'embed', 'dm', 'role_add', 'role_remove'].includes(type) || !content) return ctx.reply(`Kullanım: ${ctx.config.prefix}komutoluştur <ad> <text|embed|dm|role_add|role_remove> <içerik|rolId>`); const command = { name, type, content: ['role_add', 'role_remove'].includes(type) ? '' : truncate(content, 3000), roleId: ['role_add', 'role_remove'].includes(type) ? Number(content) : null, title: name, permission: 'member', enabled: true, uses: 0, createdBy: ctx.userId, createdAt: new Date().toISOString() }; if (['role_add', 'role_remove'].includes(type) && !Number.isInteger(command.roleId)) return ctx.reply('Geçerli rol ID girin.'); await ctx.stores.customCommands.update((items) => { items[key(ctx.groupId, name)] = command; return items; }); return ctx.reply(`Özel komut oluşturuldu: ${ctx.config.prefix}${name}`); }
    });

    app.router.register({
      name: 'komutsil', category: 'Özel Komutlar', description: 'Özel komutu siler.', usage: 'komutsil <ad>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) { const name = String(ctx.args[0] || '').toLocaleLowerCase('tr-TR'); let removed = false; await ctx.stores.customCommands.update((items) => { const itemKey = key(ctx.groupId, name); if (items[itemKey]) { delete items[itemKey]; removed = true; } return items; }); return ctx.reply(removed ? `Komut ${name} silindi.` : 'Özel komut bulunamadı.'); }
    });

    app.router.register({
      name: 'komutizin', category: 'Özel Komutlar', description: 'Özel komut yetkisini ayarlar.', usage: 'komutizin <ad> <member|moderator|admin|owner>', guildOnly: true, requiredPermission: 'admin',
      async execute(ctx) { const name = String(ctx.args[0] || '').toLocaleLowerCase('tr-TR'); const permission = String(ctx.args[1] || '').toLowerCase(); if (!['member', 'moderator', 'admin', 'owner'].includes(permission)) return ctx.reply(`Kullanım: ${ctx.config.prefix}komutizin <ad> <member|moderator|admin|owner>`); let found = false; await ctx.stores.customCommands.update((items) => { const command = items[key(ctx.groupId, name)]; if (command) { command.permission = permission; found = true; } return items; }); return ctx.reply(found ? `Komut yetkisi ${permission}.` : 'Komut bulunamadı.'); }
    });

    app.router.register({
      name: 'özelkomutlar', aliases: ['ozelkomutlar'], category: 'Özel Komutlar', description: 'Özel komutları listeler.', usage: 'özelkomutlar', guildOnly: true,
      async execute(ctx) { const entries = Object.entries(await ctx.stores.customCommands.read()).filter(([itemKey]) => itemKey.startsWith(`${ctx.groupId}:`)).map(([, command]) => command); return ctx.reply(`Özel komutlar:\n${entries.map((command) => `${ctx.config.prefix}${command.name} — ${command.type} — ${command.permission} — ${command.uses || 0} kullanım`).join('\n') || 'yok'}`); }
    });
  }
};
