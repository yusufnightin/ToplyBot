const { truncate } = require('../utils/text');
const { renderTemplate } = require('../utils/templates');
const { findObject } = require('../utils/api');
const { buildButtonBumote } = require('../utils/bumote');
const { sendInteractivePost, updateInteractivePost } = require('../utils/jtmlDelivery');

function key(groupId, name) {
  return `${groupId}:${String(name).toLocaleLowerCase('tr-TR')}`;
}

function slug(value) {
  return String(value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/[^a-z0-9çğıöşü_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function createdPostId(result) {
  const object = findObject(result, ['post', 'data']) || {};
  const id = Number(object.id ?? object.post_id ?? result?.id ?? result?.post_id ?? result?.data?.id ?? result?.data?.post_id);
  return Number.isInteger(id) ? id : null;
}


function extractPostText(value) {
  const visited = new Set();
  const containerKeys = ['post', 'data', 'result', 'response', 'payload', 'item'];

  function walk(node, depth = 0) {
    if (depth > 8 || node === null || node === undefined) return null;
    if (typeof node !== 'object' || visited.has(node)) return null;
    visited.add(node);

    if (typeof node.text === 'string') return node.text;
    if (typeof node.content === 'string') return node.content;

    for (const key of containerKeys) {
      if (Object.prototype.hasOwnProperty.call(node, key)) {
        const found = walk(node[key], depth + 1);
        if (found !== null) return found;
      }
    }
    for (const child of Array.isArray(node) ? node : Object.values(node)) {
      const found = walk(child, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }

  return walk(value);
}

function normalizeType(value) {
  const type = String(value || '').toLocaleLowerCase('tr-TR');
  const aliases = {
    komut: 'command', command: 'command',
    yanıt: 'reply', yanit: 'reply', cevap: 'reply', reply: 'reply',
    dm: 'dm', özelmesaj: 'dm', ozelmesaj: 'dm',
    rolver: 'role_add', role_add: 'role_add',
    rolal: 'role_remove', rolkaldır: 'role_remove', rolkaldir: 'role_remove', role_remove: 'role_remove',
    roltoggle: 'role_toggle', rolseç: 'role_toggle', rolsec: 'role_toggle', role_toggle: 'role_toggle',
    link: 'link', url: 'link'
  };
  return aliases[type] || null;
}

function renderEmbed(embed, variables = {}) {
  const lines = [];
  const color = embed.color || '#ff83c8';
  if (embed.title) lines.push(`▌ ${renderTemplate(embed.title, variables)}`);
  if (embed.description) lines.push(renderTemplate(embed.description, variables));
  if (embed.thumbnail) lines.push(`◩ Thumbnail: ${renderTemplate(embed.thumbnail, variables)}`);
  for (const field of embed.fields || []) {
    lines.push(`◆ ${renderTemplate(field.name, variables)}\n${renderTemplate(field.value, variables)}`);
  }
  if (embed.image) lines.push(`▧ Görsel: ${renderTemplate(embed.image, variables)}`);
  if (embed.buttons?.length) {
    lines.push(`Etkileşimler:\n${embed.buttons.map((button) => (
      button.type === 'link'
        ? `• [${button.label}](${button.target})`
        : `• 【${button.label}】`
    )).join('\n')}`);
  }
  if (embed.footer) lines.push(`— ${renderTemplate(embed.footer, variables)}`);
  lines.push(`Renk: ${color}`);
  return truncate(lines.join('\n\n'), 1800);
}

async function saveEmbed(ctx, name, embed) {
  await ctx.stores.embeds.update((items) => {
    items[key(ctx.groupId, name)] = embed;
    return items;
  });
}

module.exports = {
  name: 'Görsel Embed ve Tıklama Sistemi',
  setup(app) {
    app.router.register({
      name: 'embed', category: 'Embed',
      description: 'Görsel kart, Bumote butonu ve tıklama eylemi olan mesajlar oluşturur.',
      usage: 'embed <oluştur|başlık|açıklama|alan|buton|butonsil|bumote|kart|önizle|gönder|bağla|liste|sil>',
      guildOnly: true, requiredPermission: 'admin', cooldownMs: 500,
      async execute(ctx) {
        const action = String(ctx.args.shift() || 'liste').toLocaleLowerCase('tr-TR');

        if (action === 'liste') {
          const entries = Object.entries(await ctx.stores.embeds.read())
            .filter(([itemKey]) => itemKey.startsWith(`${ctx.groupId}:`))
            .map(([, item]) => item);
          return ctx.reply(`Embedler:\n${entries.map((item) => `${item.name} — ${item.title || 'Başlıksız'} — ${item.buttons?.length || 0} buton`).join('\n') || 'yok'}`);
        }

        if (['oluştur', 'olustur'].includes(action)) {
          const [nameRaw, titleRaw, descriptionRaw] = ctx.args.join(' ').split('|').map((item) => item.trim());
          const name = slug(nameRaw);
          if (!name || !titleRaw) return ctx.reply(`Kullanım: ${ctx.config.prefix}embed oluştur <ad> | <başlık> | <açıklama>`);
          const embed = {
            name,
            title: titleRaw,
            description: descriptionRaw || '',
            color: '#ff83c8',
            thumbnail: '',
            image: '',
            footer: '',
            fields: [],
            buttons: [],
            bumoteCode: '',
            cardEnabled: true,
            interactionOptions: { oneUsePerUser: false, maxUses: 0 },
            createdBy: ctx.userId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          await saveEmbed(ctx, name, embed);
          return ctx.reply(`Embed '${name}' oluşturuldu.`);
        }

        const name = slug(ctx.args.shift());
        if (!name) return ctx.reply('Embed adı gerekli.');
        const embeds = await ctx.stores.embeds.read();
        const embed = embeds[key(ctx.groupId, name)];
        if (!embed) return ctx.reply('Embed bulunamadı.');
        embed.buttons = Array.isArray(embed.buttons) ? embed.buttons : [];
        embed.fields = Array.isArray(embed.fields) ? embed.fields : [];
        embed.interactionOptions = embed.interactionOptions || { oneUsePerUser: false, maxUses: 0 };

        if (action === 'sil') {
          await ctx.stores.embeds.update((items) => {
            delete items[key(ctx.groupId, name)];
            return items;
          });
          return ctx.reply('Embed silindi.');
        }

        if (['önizle', 'onizle'].includes(action)) {
          return ctx.reply(renderEmbed(embed, {
            userId: ctx.userId,
            groupId: ctx.groupId,
            channelId: ctx.channelId
          }));
        }

        if (['gönder', 'gonder', 'bağla', 'bagla'].includes(action)) {
          const isBind = ['bağla', 'bagla'].includes(action);
          const channelId = isBind ? ctx.channelId : (ctx.args[0] || ctx.channelId);
          const variables = { userId: ctx.userId, groupId: ctx.groupId, channelId };
          const autoGenerate = ctx.config.interactions?.autoGenerateBumote !== false;
          const bumoteCode = embed.buttons.length > 0
            ? String(embed.bumoteCode || (autoGenerate ? buildButtonBumote(embed.buttons) : '')).trim()
            : '';
          let postId;

          if (isBind) {
            postId = Number(ctx.args[0]);
            if (!Number.isInteger(postId)) return ctx.reply(`Kullanım: ${ctx.config.prefix}embed bağla <ad> <postId>`);

            if (bumoteCode) {
              try {
                const currentPost = await ctx.client.getPost(postId);
                const currentText = extractPostText(currentPost);
                if (typeof currentText !== 'string') {
                  return ctx.reply('Post metni API cevabından okunamadığı için butonlar güvenli biçimde bağlanamadı. Embed’i yeniden gönder komutuyla oluştur.');
                }
                await updateInteractivePost({
                  client: ctx.client,
                  postId,
                  text: currentText,
                  jtmlCode: bumoteCode,
                  attach: ctx.config.interactions?.attachBumote !== false,
                  logger: ctx.logger,
                  context: 'Embed JTML'
                });
              } catch (error) {
                ctx.logger?.error('Mevcut posta native JTML bağlanamadı.', error);
                return ctx.reply('Mevcut post güncellenemedi. Postun erişilebilir ve bota ait olduğundan emin ol.');
              }
            }
          } else {
            let text = renderEmbed(embed, variables);
            if (embed.cardEnabled !== false) {
              const card = await ctx.services.cards.createEmbedCard({
                title: renderTemplate(embed.title, variables),
                description: renderTemplate(embed.description, variables),
                fields: embed.fields.map((field) => ({
                  name: renderTemplate(field.name, variables),
                  value: renderTemplate(field.value, variables)
                })),
                footer: renderTemplate(embed.footer, variables),
                color: embed.color,
                thumbnail: renderTemplate(embed.thumbnail, variables)
              });
              if (card.url) text = truncate(`${text}\n\n🖼️ ${card.url}`, 1800);
            }
            const delivery = await sendInteractivePost({
              client: ctx.client,
              channelId,
              text,
              jtmlCode: bumoteCode,
              attach: ctx.config.interactions?.attachBumote !== false,
              logger: ctx.logger,
              context: 'Embed JTML'
            });
            postId = delivery.postId;
          }

          if (embed.buttons.length > 0) {
            if (!Number.isInteger(postId)) {
              return ctx.reply(`Embed gönderildi ancak API post ID döndürmedi. Etkileşimi sonradan bağlamak için: ${ctx.config.prefix}embed bağla ${name} <postId>`);
            }
            await ctx.services.interactions.register({
              postId,
              groupId: ctx.groupId,
              channelId,
              embedName: name,
              actions: embed.buttons,
              createdBy: ctx.userId,
              options: embed.interactionOptions
            });
          }

          return ctx.reply(`Embed hazırlandı.${Number.isInteger(postId) ? ` Post ID: ${postId}` : ''}${embed.buttons.length ? ` · ${embed.buttons.length} etkileşim görsel ve tıklanabilir olarak bağlandı.` : ''}`);
        }

        if (action === 'renk') {
          const color = String(ctx.args[0] || '');
          if (!/^#[0-9a-f]{6}$/i.test(color)) return ctx.reply('Geçerli #RRGGBB renk girin.');
          embed.color = color;
        } else if (['başlık', 'baslik'].includes(action)) {
          embed.title = ctx.args.join(' ').trim();
        } else if (['açıklama', 'aciklama'].includes(action)) {
          embed.description = ctx.args.join(' ').trim();
        } else if (['görsel', 'gorsel'].includes(action)) {
          embed.image = String(ctx.args[0] || '');
        } else if (action === 'thumbnail') {
          embed.thumbnail = String(ctx.args[0] || '');
        } else if (action === 'footer') {
          embed.footer = ctx.args.join(' ');
        } else if (action === 'alan') {
          const [fieldName, fieldValue] = ctx.args.join(' ').split('|').map((item) => item.trim());
          if (!fieldName || !fieldValue) return ctx.reply(`Kullanım: ${ctx.config.prefix}embed alan <ad> <alan adı> | <değer>`);
          if (embed.fields.length >= 10) return ctx.reply('En fazla 10 alan eklenebilir.');
          embed.fields.push({ name: fieldName, value: fieldValue });
        } else if (['alantemizle', 'alanlarıtemizle', 'alanlaritemizle'].includes(action)) {
          embed.fields = [];
        } else if (action === 'buton') {
          const [labelRaw, typeRaw, targetRaw, permissionRaw, styleRaw] = ctx.args.join(' ').split('|').map((item) => item.trim());
          const type = normalizeType(typeRaw);
          if (!labelRaw || !type || !targetRaw) {
            return ctx.reply(`Kullanım: ${ctx.config.prefix}embed buton <ad> <etiket> | <komut|yanıt|dm|rolver|rolal|roltoggle|link> | <hedef> | [member|moderator|admin|owner] | [primary|success|danger]`);
          }
          if (type === 'link' && !/^https?:\/\//i.test(targetRaw)) return ctx.reply('Link butonu için http:// veya https:// ile başlayan URL girin.');
          if (['role_add', 'role_remove', 'role_toggle'].includes(type) && !Number.isInteger(Number(targetRaw))) return ctx.reply('Rol butonu için hedef olarak geçerli rol ID girin.');
          if (permissionRaw && !['member', 'moderator', 'admin', 'owner'].includes(permissionRaw.toLowerCase())) return ctx.reply('Buton yetkisi member, moderator, admin veya owner olmalıdır.');
          const idBase = slug(labelRaw) || `buton-${embed.buttons.length + 1}`;
          let id = idBase;
          let suffix = 2;
          while (embed.buttons.some((button) => button.id === id)) id = `${idBase}-${suffix++}`;
          embed.buttons.push({
            id,
            label: labelRaw,
            type,
            target: targetRaw,
            requiredPermission: permissionRaw || 'member',
            style: styleRaw || 'primary',
            cooldownMs: 1500,
            disabled: false
          });
        } else if (action === 'butonsil') {
          const buttonId = slug(ctx.args[0]);
          const before = embed.buttons.length;
          embed.buttons = embed.buttons.filter((button) => button.id !== buttonId);
          if (embed.buttons.length === before) return ctx.reply('Buton bulunamadı.');
        } else if (action === 'butonlar') {
          return ctx.reply(`Butonlar:\n${embed.buttons.map((button) => `${button.id} — ${button.label} — ${button.type} → ${button.target}`).join('\n') || 'yok'}`);
        } else if (action === 'bumote') {
          const code = ctx.args.join(' ').replace(/^\s*\|\s*/, '');
          if (!code) return ctx.reply(`Kullanım: ${ctx.config.prefix}embed bumote <ad> | <Topluyo Bumote/JTML kodu>`);
          embed.bumoteCode = code;
        } else if (['bumotetemizle', 'bumotesil'].includes(action)) {
          embed.bumoteCode = '';
        } else if (action === 'kart') {
          const state = String(ctx.args[0] || '').toLocaleLowerCase('tr-TR');
          if (!['aç', 'ac', 'kapat'].includes(state)) return ctx.reply(`Kullanım: ${ctx.config.prefix}embed kart <ad> <aç|kapat>`);
          embed.cardEnabled = state !== 'kapat';
        } else if (action === 'tekkullanım' || action === 'tekkullanim') {
          const state = String(ctx.args[0] || '').toLocaleLowerCase('tr-TR');
          if (!['aç', 'ac', 'kapat'].includes(state)) return ctx.reply(`Kullanım: ${ctx.config.prefix}embed tekkullanım <ad> <aç|kapat>`);
          embed.interactionOptions.oneUsePerUser = state !== 'kapat';
        } else if (action === 'maksimum') {
          const maxUses = Number(ctx.args[0]);
          if (!Number.isInteger(maxUses) || maxUses < 0) return ctx.reply('0 veya daha büyük tam sayı girin. 0 sınırsızdır.');
          embed.interactionOptions.maxUses = maxUses;
        } else {
          return ctx.reply('Bilinmeyen embed işlemi.');
        }

        embed.updatedAt = new Date().toISOString();
        await saveEmbed(ctx, name, embed);
        return ctx.reply('Embed güncellendi.');
      }
    });
  }
};

module.exports.renderEmbed = renderEmbed;
module.exports.createdPostId = createdPostId;
