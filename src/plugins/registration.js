const { truncate } = require('../utils/text');

function parseRoleIds(args) {
  return [...new Set(args.join(',').split(',').map((item) => Number(item.trim())).filter(Number.isInteger))];
}

module.exports = {
  name: 'Kayıt Sistemi',
  setup(app) {
    app.router.register({
      name: 'kayıt',
      aliases: ['kayit'],
      category: 'Kayıt',
      description: 'Üyeyi kaydeder ve yapılandırılmış kayıt rollerini verir.',
      usage: 'kayıt <kullanıcıId> <isim> [yaş]',
      guildOnly: true,
      requiredPermission: 'moderator',
      cooldownMs: 3000,
      async execute(ctx) {
        const userId = Number(ctx.args.shift());
        const ageCandidate = Number(ctx.args.at(-1));
        const age = Number.isInteger(ageCandidate) && ageCandidate > 0 && ageCandidate < 120 ? ageCandidate : null;
        if (age !== null) ctx.args.pop();
        const name = ctx.args.join(' ').trim();
        if (!Number.isInteger(userId) || !name) return ctx.reply(`Kullanım: ${ctx.config.prefix}kayıt <kullanıcıId> <isim> [yaş]`);

        const settings = await ctx.services.settings.get(ctx.groupId);
        if (!settings.registration.enabled) {
          return ctx.reply(`Kayıt sistemi kapalı. Önce ${ctx.config.prefix}kayıtrol ayarla <rolId...> komutunu kullanın.`);
        }
        const roleIds = settings.registration.roleIds || [];
        if (roleIds.length > 0) await ctx.services.roles.addMemberRoles(ctx.groupId, userId, roleIds);

        const record = {
          groupId: ctx.groupId,
          userId,
          name: truncate(name, 100),
          age,
          registeredBy: ctx.userId,
          registeredAt: new Date().toISOString(),
          active: true
        };
        await ctx.stores.registrations.update((records) => {
          const old = records.find((item) => String(item.groupId) === String(ctx.groupId) && Number(item.userId) === userId && item.active);
          if (old) old.active = false;
          records.push(record);
          return records;
        });
        await ctx.services.audit.write('registration.create', {
          actorUserId: ctx.userId,
          targetUserId: userId,
          name,
          age,
          roleIds
        }, { groupId: ctx.groupId, text: `Üye kaydedildi.\nKullanıcı: #${userId}\nİsim: ${name}${age ? `\nYaş: ${age}` : ''}\nYetkili: #${ctx.userId}` });
        await ctx.reply(`Kullanıcı #${userId}, ${name}${age ? ` (${age})` : ''} olarak kaydedildi.`);
      }
    });

    app.router.register({
      name: 'kayıtrol',
      aliases: ['kayitrol'],
      category: 'Kayıt',
      description: 'Kayıt sırasında verilecek rolleri ayarlar.',
      usage: 'kayıtrol <göster|ayarla rolId...|kapat>',
      guildOnly: true,
      requiredPermission: 'admin',
      async execute(ctx) {
        const action = String(ctx.args.shift() || 'göster').toLocaleLowerCase('tr-TR');
        const settings = await ctx.services.settings.get(ctx.groupId);
        if (['göster', 'liste'].includes(action)) return ctx.reply(`Kayıt rolleri: ${settings.registration.roleIds.join(', ') || 'yok'}\nSistem: ${settings.registration.enabled ? 'açık' : 'kapalı'}`);
        if (action === 'kapat') {
          await ctx.services.settings.set(ctx.groupId, 'registration.enabled', false);
          return ctx.reply('Kayıt sistemi kapatıldı.');
        }
        if (['ayarla', 'aç', 'ac'].includes(action)) {
          const roleIds = parseRoleIds(ctx.args);
          if (!roleIds.length) return ctx.reply(`Kullanım: ${ctx.config.prefix}kayıtrol ayarla <rolId...>`);
          await ctx.services.settings.set(ctx.groupId, 'registration.roleIds', roleIds);
          await ctx.services.settings.set(ctx.groupId, 'registration.enabled', true);
          return ctx.reply(`Kayıt rolleri ayarlandı: ${roleIds.join(', ')}`);
        }
        return ctx.reply(`Kullanım: ${ctx.config.prefix}kayıtrol <göster|ayarla rolId...|kapat>`);
      }
    });

    app.router.register({
      name: 'kayıtsız',
      aliases: ['kayitsiz'],
      category: 'Kayıt',
      description: 'Üyenin kayıt rollerini alır ve kaydını pasif yapar.',
      usage: 'kayıtsız <kullanıcıId>',
      guildOnly: true,
      requiredPermission: 'moderator',
      async execute(ctx) {
        const userId = Number(ctx.args[0]);
        if (!Number.isInteger(userId)) return ctx.reply(`Kullanım: ${ctx.config.prefix}kayıtsız <kullanıcıId>`);
        const settings = await ctx.services.settings.get(ctx.groupId);
        if (settings.registration.roleIds.length) {
          await ctx.services.roles.removeMemberRoles(ctx.groupId, userId, settings.registration.roleIds);
        }
        await ctx.stores.registrations.update((records) => {
          records.filter((item) => String(item.groupId) === String(ctx.groupId) && Number(item.userId) === userId && item.active)
            .forEach((item) => { item.active = false; item.unregisteredAt = new Date().toISOString(); item.unregisteredBy = ctx.userId; });
          return records;
        });
        await ctx.services.audit.write('registration.remove', {
          actorUserId: ctx.userId,
          targetUserId: userId
        }, { groupId: ctx.groupId });
        await ctx.reply(`Kullanıcı #${userId} kayıtsıza alındı.`);
      }
    });

    app.router.register({
      name: 'kayıtbilgi',
      aliases: ['kayitbilgi'],
      category: 'Kayıt',
      description: 'Üyenin son aktif kayıt bilgisini gösterir.',
      usage: 'kayıtbilgi [kullanıcıId]',
      guildOnly: true,
      async execute(ctx) {
        const userId = Number(ctx.args[0] || ctx.userId);
        if (!Number.isInteger(userId)) return ctx.reply(`Kullanım: ${ctx.config.prefix}kayıtbilgi [kullanıcıId]`);
        const records = await ctx.stores.registrations.read();
        const record = [...records].reverse().find((item) => String(item.groupId) === String(ctx.groupId) && Number(item.userId) === userId && item.active);
        if (!record) return ctx.reply(`Kullanıcı #${userId} için aktif kayıt bulunamadı.`);
        await ctx.reply(`Kayıt bilgisi:\nKullanıcı: #${userId}\nİsim: ${record.name}\nYaş: ${record.age || 'belirtilmedi'}\nKaydeden: #${record.registeredBy}\nTarih: ${record.registeredAt}`);
      }
    });
  }
};
