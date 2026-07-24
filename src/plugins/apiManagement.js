const ApiBatchQueue = require('../core/ApiBatchQueue');
const { assertApiSuccess } = require('../utils/apiResult');
const { findArray, findObject, unwrapApiResult, extractCreatedEntityId } = require('../utils/api');
const { truncate } = require('../utils/text');
const ApiManagementService = require('../services/ApiManagementService');

function pipeArgs(args, min = 1) {
  const parts = args.join(' ').split('|').map((item) => item.trim());
  if (parts.length < min || parts.slice(0, min).some((item) => !item)) return null;
  return parts;
}

function numberId(value, label = 'ID') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`Geçerli ${label} gerekli.`);
  return id;
}

function onOff(value) {
  return ApiManagementService.normalizeToggle(value);
}

function text(value, fallback = '—') {
  const output = String(value ?? '').trim();
  return output || fallback;
}

function entityId(item) {
  return Number(item?.id ?? item?.user_id ?? item?.userId ?? item?.member_id ?? item?.badge_id ?? item?.crew_id ?? item?.team_id ?? item?.post_id);
}

function entityName(item) {
  return ApiManagementService.displayName(item, entityId(item) ? `#${entityId(item)}` : 'Bilinmiyor');
}

function jsonPreview(value, max = 1700) {
  try { return truncate(JSON.stringify(value, null, 2), max); }
  catch { return truncate(String(value), max); }
}

async function resolveRole(ctx, reference) {
  const raw = String(reference || '').trim().replace(/^@/, '');
  const roles = await ctx.services.roles.list(ctx.groupId);
  if (/^\d+$/.test(raw)) {
    const id = Number(raw);
    return roles.find((item) => Number(item.id) === id) || { id, name: `Rol ${id}` };
  }
  const normalized = ctx.services.roles.constructor.normalizeRoleName(raw);
  const matches = roles.filter((item) => item.normalizedName === normalized || item.normalizedName.startsWith(normalized));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error('Rol adı birden fazla rolle eşleşti; rol ID kullan.');
  throw new Error(`“${raw}” rolü bulunamadı.`);
}

function formatApiMetrics(metrics) {
  const api = metrics.api;
  const storeTotals = metrics.stores.reduce((total, item) => ({
    reads: total.reads + item.reads,
    diskReads: total.diskReads + item.diskReads,
    writes: total.writes + item.writes
  }), { reads: 0, diskReads: 0, writes: 0 });
  const hitTotal = api.cacheHits + api.dedupeHits;
  const savedPercent = api.totalRequests ? Math.round((hitTotal / api.totalRequests) * 100) : 0;
  return [
    '⚡ TOPLUYO API PERFORMANS',
    `Toplam çağrı: ${api.totalRequests}`,
    `Ağa çıkan istek: ${api.networkRequests}`,
    `Batch sayısı: ${api.batches} · son batch: ${api.lastBatchSize}`,
    `Önbellek isabeti: ${api.cacheHits} · birleştirilen: ${api.dedupeHits} · tasarruf: %${savedPercent}`,
    `Ortalama batch gecikmesi: ${api.averageLatencyMs} ms · son: ${api.lastLatencyMs} ms`,
    `Kuyruk: ${api.queued} · aktif batch: ${api.inFlightBatches} · zirve: ${api.queueHighWaterMark}`,
    `Retry: ${api.retries} · hata: ${api.failures} · cache girdisi: ${api.cacheEntries}`,
    `JSON Store: ${storeTotals.reads} okuma · ${storeTotals.diskReads} disk okuması · ${storeTotals.writes} yazma`,
    `Ayar: ${api.config.flushIntervalMs}ms pencere · ${api.config.maxBatchSize} batch · ${api.config.maxConcurrentBatches} paralel`
  ].join('\n');
}

module.exports = {
  name: 'Resmî API Yönetim Merkezi',
  setup(app) {
    const register = (command) => app.router.register({ category: 'Yönetim', guildOnly: true, requiredPermission: 'admin', cooldownMs: 2500, ...command });

    register({
      name: 'sunucuozet', aliases: ['sunucuözet', 'yonetimozet', 'yönetimözet'],
      description: 'Resmî API uçlarından sunucu, üye, kanal, rol, bekleyen, rozet ve ekip özetini tek batch ile getirir.',
      usage: 'sunucuozet', cooldownMs: 7000,
      async execute(ctx) {
        const summary = await ctx.services.apiManagement.groupSummary(ctx.groupId);
        const group = summary.group;
        const founderId = entityId(summary.founder);
        return ctx.reply([
          `🏠 ${text(group.name ?? group.title ?? group.nick, `Sunucu #${ctx.groupId}`)}`,
          `Grup ID: ${ctx.groupId} · Kurucu: ${founderId ? `${entityName(summary.founder)} (#${founderId})` : 'alınamadı'}`,
          `Kanallar: ${summary.channels.length} · Roller: ${summary.roles.length}`,
          `Üyeler: ${summary.members.length} · Çevrimiçi: ${summary.online.length} · Bekleyen: ${summary.waiters.length}`,
          `Rozetler: ${summary.badges.length} · Ekipler: ${summary.crews.length} · Takımlar: ${summary.teams.length}`,
          `API uyarıları: ${summary.errors.length ? summary.errors.map((item) => item.message).join(' | ') : 'yok'}`
        ].join('\n'));
      }
    });


    register({
      name: 'sunucukurucu', aliases: ['kurucubilgi'],
      description: 'Sunucunun kurucu hesabını group/founder üzerinden gösterir.', usage: 'sunucukurucu', cooldownMs: 4000,
      async execute(ctx) {
        const result = await ctx.client.getGroupFounder(ctx.groupId);
        const founder = findObject(result, ['founder', 'user', 'member', 'info']) || unwrapApiResult(result) || {};
        return ctx.reply(`👑 Sunucu kurucusu: ${entityName(founder)} · ID ${entityId(founder) || '?'}\n${jsonPreview(founder, 900)}`);
      }
    });

    register({
      name: 'grupprofil', aliases: ['grupprofilayarla'], requiredPermission: 'owner',
      description: 'Grup adını, açıklamasını ve görselini resmî group/set/profile API’siyle günceller.',
      usage: 'grupprofil <ad>|<açıklama>|[görselURL]', cooldownMs: 8000,
      async execute(ctx) {
        const parts = pipeArgs(ctx.args, 2);
        if (!parts) return ctx.reply(`Kullanım: ${ctx.config.prefix}grupprofil <ad>|<açıklama>|[görselURL]`);
        const profile = await ctx.services.apiManagement.updateGroupProfile(ctx.groupId, { name: parts[0], description: parts[1], image: parts[2] });
        return ctx.reply(`✅ Grup profili güncellendi.\nAd: ${profile.name}\nAçıklama: ${profile.description}\nGörsel: ${profile.image || 'değişmedi/boş'}`);
      }
    });

    register({
      name: 'grupana', aliases: ['grupanasayfa'], requiredPermission: 'owner',
      description: 'Sunucunun ana sayfa içeriğini group/set/home ile değiştirir.',
      usage: 'grupana <içerik>', cooldownMs: 8000,
      async execute(ctx) {
        const home = ctx.args.join(' ').trim();
        if (!home) return ctx.reply(`Kullanım: ${ctx.config.prefix}grupana <içerik>`);
        const result = await ctx.client.setGroupHome(ctx.groupId, home);
        assertApiSuccess(result, 'Grup ana sayfası güncelleme');
        return ctx.reply('✅ Grup ana sayfası güncellendi.');
      }
    });

    register({
      name: 'grupizin', aliases: ['grupayar'], requiredPermission: 'owner',
      description: 'Keşfet, herkesi üye yapma, kötüye kullanım filtresi ve reklam izinlerini değiştirir.',
      usage: 'grupizin <keşfet> <herkesÜye> <filtre> <reklam>', cooldownMs: 8000,
      async execute(ctx) {
        if (ctx.args.length < 4) return ctx.reply(`Kullanım: ${ctx.config.prefix}grupizin <aç/kapat> <aç/kapat> <aç/kapat> <aç/kapat>`);
        const values = ctx.args.slice(0, 4).map(onOff);
        if (values.some((value) => value === null)) return ctx.reply('Değerler aç/kapat veya 1/0 olmalıdır.');
        const result = await ctx.client.setGroupPermissions(ctx.groupId, {
          discover_me: values[0], everyone_member: values[1], abuse_filter: values[2], enable_ads: values[3]
        });
        assertApiSuccess(result, 'Grup izinleri güncelleme');
        return ctx.reply(`✅ Grup izinleri güncellendi. Keşfet:${values[0]} HerkesÜye:${values[1]} Filtre:${values[2]} Reklam:${values[3]}`);
      }
    });

    register({
      name: 'grupsosyal', requiredPermission: 'owner',
      description: 'Sunucu sosyal medya bağlantısını günceller.',
      usage: 'grupsosyal <instagram|x|youtube|tiktok|kick|twitch|github|steam|linkedin|website> <değer|sil>',
      async execute(ctx) {
        const platform = ctx.args.shift();
        const value = ctx.args.join(' ').trim();
        if (!platform || !value) return ctx.reply(`Kullanım: ${ctx.config.prefix}grupsosyal <platform> <değer|sil>`);
        const payload = await ctx.services.apiManagement.updateGroupSocial(ctx.groupId, platform, value);
        return ctx.reply(`✅ Sosyal bağlantı güncellendi: ${Object.keys(payload)[0]} = ${Object.values(payload)[0] || 'silindi'}`);
      }
    });


    register({
      name: 'kanalduzenle', aliases: ['kanaldüzenle'], requiredPermission: 'owner',
      description: 'Kanalın nick, başlık, açıklama, tip veya izin listesi alanını channel/set ile değiştirir.',
      usage: 'kanalduzenle <#kanal/id> <alan> <değer>', cooldownMs: 7000,
      async execute(ctx) {
        const reference = ctx.args.shift();
        const field = ctx.args.shift();
        const value = ctx.args.join(' ');
        if (!reference || !field || value === '') return ctx.reply(`Kullanım: ${ctx.config.prefix}kanalduzenle <#kanal/id> <nick|title|description|type|...> <değer>`);
        const updated = await ctx.services.apiManagement.updateChannel(ctx.groupId, reference, field, value);
        return ctx.reply(`✅ Kanal #${updated.channel.id} güncellendi: ${field} = ${value || 'boş'}`);
      }
    });


    register({
      name: 'kanalkopyala', aliases: ['kanalklonla'], requiredPermission: 'owner',
      description: 'Bir kanalın tipi ve bütün rol/kullanıcı izinlerini yeni kanala kopyalar.',
      usage: 'kanalkopyala <#kaynak/id> <yeniNick>|[yeniBaşlık]', cooldownMs: 10000,
      async execute(ctx) {
        const source = ctx.args.shift();
        const parts = pipeArgs(ctx.args, 1);
        if (!source || !parts) return ctx.reply(`Kullanım: ${ctx.config.prefix}kanalkopyala <#kaynak/id> <yeniNick>|[yeniBaşlık]`);
        const result = await ctx.services.apiManagement.cloneChannel(ctx.groupId, source, { nick: parts[0], title: parts[1] });
        return ctx.reply(`✅ Kanal kopyalandı. Kaynak #${result.sourceChannel.id} → ${result.payload.title}${result.id ? ` · Yeni ID ${result.id}` : ''}`);
      }
    });

    register({
      name: 'kanalizinbilgi', aliases: ['kanalizinleri'],
      description: 'Kanal bilgisi ve artı/eksi kullanıcı izinlerini channel/get + channel/detail ile getirir.',
      usage: 'kanaldetay <#kanal/id>', cooldownMs: 4000,
      async execute(ctx) {
        const reference = ctx.args[0];
        if (!reference) return ctx.reply(`Kullanım: ${ctx.config.prefix}kanalizinbilgi <#kanal/id>`);
        const result = await ctx.services.apiManagement.channelDetail(ctx.groupId, reference);
        return ctx.reply(jsonPreview({
          id: result.channel.id, nick: result.channel.nick, title: result.channel.title,
          description: result.channel.description, type: result.channel.type,
          info: result.info, permissions: result.detail
        }), 'json');
      }
    });

    register({
      name: 'kanalizin', aliases: ['kanalyetki'], requiredPermission: 'owner',
      description: 'Bir kullanıcıya kanal okuma, yazma veya kontrol artı izni verir/alır.',
      usage: 'kanalizin <#kanal/id> <kullanıcıId> <oku|yaz|kontrol> <ver|al>', cooldownMs: 5000,
      async execute(ctx) {
        if (ctx.args.length < 4) return ctx.reply(`Kullanım: ${ctx.config.prefix}kanalizin <#kanal/id> <kullanıcıId> <oku|yaz|kontrol> <ver|al>`);
        const result = await ctx.services.apiManagement.setChannelUserPermission(ctx.groupId, ctx.args[0], numberId(ctx.args[1], 'kullanıcı ID'), ctx.args[2], ctx.args[3]);
        return ctx.reply(`✅ Kanal yetkisi güncellendi. Kanal #${result.channel.id} · Kullanıcı #${result.userId} · ${result.option}`);
      }
    });



    register({
      name: 'rolduzenle', aliases: ['roldüzenle'], requiredPermission: 'owner',
      description: 'Rol adı, rengi veya tek bir power_* yetkisini değiştirir.',
      usage: 'rolduzenle <rolId/ad> <name|color|power_*> <değer>', cooldownMs: 7000,
      async execute(ctx) {
        const role = await resolveRole(ctx, ctx.args.shift());
        const field = ctx.args.shift();
        const value = ctx.args.join(' ');
        if (!field || value === '') return ctx.reply(`Kullanım: ${ctx.config.prefix}rolduzenle <rolId/ad> <alan> <değer>`);
        const updated = await ctx.services.apiManagement.updateRole(ctx.groupId, role.id, field, value);
        return ctx.reply(`✅ Rol #${role.id} güncellendi: ${field} = ${updated.payload[field]}`);
      }
    });

    register({
      name: 'rolsablon', aliases: ['rolşablon'], requiredPermission: 'owner',
      description: 'Bir role hazır member/content/support/moderator/admin yetki paketi uygular.',
      usage: 'rolsablon <rolId/ad> <şablon>', cooldownMs: 7000,
      async execute(ctx) {
        const role = await resolveRole(ctx, ctx.args[0]);
        const preset = ctx.args[1];
        if (!preset) return ctx.reply(`Kullanım: ${ctx.config.prefix}rolsablon <rolId/ad> <member|content|support|moderator|admin>`);
        await ctx.services.apiManagement.applyRolePreset(ctx.groupId, role.id, preset);
        return ctx.reply(`✅ ${role.name} rolüne “${preset}” yetki şablonu uygulandı.`);
      }
    });



    register({
      name: 'rolkopyala', aliases: ['rolklonla'], requiredPermission: 'owner',
      description: 'Bir rolün rengini ve bütün power_* yetkilerini yeni role kopyalar.',
      usage: 'rolkopyala <rolId/ad> <yeniAd>|[renk]', cooldownMs: 10000,
      async execute(ctx) {
        const role = await resolveRole(ctx, ctx.args.shift());
        const parts = pipeArgs(ctx.args, 1);
        if (!parts) return ctx.reply(`Kullanım: ${ctx.config.prefix}rolkopyala <rolId/ad> <yeniAd>|[renk]`);
        const result = await ctx.services.apiManagement.cloneRole(ctx.groupId, role.id, { name: parts[0], color: parts[1] });
        return ctx.reply(`✅ Rol kopyalandı. ${role.name} (#${role.id}) → ${result.payload.name}${result.id ? ` · Yeni ID ${result.id}` : ''}`);
      }
    });

    register({
      name: 'uyerolayarla', aliases: ['üyerolayarla', 'rolleriayarla'], requiredPermission: 'admin',
      description: 'Üyenin bütün rollerini tek işlemde verilen rol ID listesiyle değiştirir.',
      usage: 'uyerolayarla <kullanıcıId> <rolId,rolId|temizle>', cooldownMs: 5000,
      async execute(ctx) {
        const userId = numberId(ctx.args.shift(), 'kullanıcı ID');
        const raw = ctx.args.join('').trim();
        if (!raw) return ctx.reply(`Kullanım: ${ctx.config.prefix}uyerolayarla <kullanıcıId> <rolId,rolId|temizle>`);
        const roleIds = ['temizle', 'sil', 'none'].includes(raw.toLocaleLowerCase('tr-TR'))
          ? []
          : raw.split(',').map(Number).filter((id) => Number.isInteger(id) && id > 0);
        if (raw && !roleIds.length && !['temizle', 'sil', 'none'].includes(raw.toLocaleLowerCase('tr-TR'))) return ctx.reply('Geçerli rol ID listesi gerekli.');
        const saved = await ctx.services.apiManagement.setMemberRoles(ctx.groupId, userId, roleIds);
        return ctx.reply(`✅ Kullanıcı #${userId} rolleri güncellendi: ${saved.join(', ') || 'rol yok'}`);
      }
    });

    register({
      name: 'uyebilgi', aliases: ['üyebilgi', 'memberinfo'],
      description: 'Üyeyi ID veya kullanıcı adıyla member/get üzerinden sorgular.',
      usage: 'uyebilgi <kullanıcıId|@nick>', cooldownMs: 3000,
      async execute(ctx) {
        if (!ctx.args[0]) return ctx.reply(`Kullanım: ${ctx.config.prefix}uyebilgi <kullanıcıId|@nick>`);
        const member = await ctx.services.apiManagement.memberInfo(ctx.groupId, ctx.args[0]);
        return ctx.reply(jsonPreview(member), 'json');
      }
    });

    register({
      name: 'uyeler', aliases: ['üyeler', 'memberlist'],
      description: 'Sunucu üyelerini sayfalı olarak listeler.',
      usage: 'uyeler [sayfa]', cooldownMs: 5000,
      async execute(ctx) {
        const page = Math.max(1, Number(ctx.args[0]) || 1);
        const result = await ctx.client.listMembers(ctx.groupId);
        const items = ApiManagementService.normalizeList(result, ['members', 'users', 'list', 'items']);
        const pageSize = 25;
        const slice = items.slice((page - 1) * pageSize, page * pageSize);
        return ctx.reply(`👥 Üyeler · Sayfa ${page}/${Math.max(1, Math.ceil(items.length / pageSize))} · Toplam ${items.length}\n${slice.map((item, i) => `${(page - 1) * pageSize + i + 1}. ${entityName(item)} · ID ${entityId(item) || '?'}`).join('\n') || 'Üye bulunamadı.'}`);
      }
    });

    register({
      name: 'cevrimici', aliases: ['çevrimiçi', 'online'],
      description: 'Sunucudaki çevrimiçi kullanıcı ID’lerini listeler.',
      usage: 'cevrimici', cooldownMs: 4000,
      async execute(ctx) {
        const result = await ctx.client.listOnline(ctx.groupId);
        const root = unwrapApiResult(result);
        const ids = (Array.isArray(root) ? root : findArray(result, ['users', 'online', 'user_ids', 'list']))
          .flatMap((item) => typeof item === 'object' ? [entityId(item)] : String(item).split(','))
          .map(Number).filter(Number.isInteger);
        return ctx.reply(`🟢 Çevrimiçi: ${ids.length}\n${ids.slice(0, 100).map((id) => `#${id}`).join(', ') || 'Kimse görünmüyor.'}`);
      }
    });

    register({
      name: 'bekleyenler', aliases: ['katilimbekleyen', 'katılımbekleyen'],
      description: 'Sunucuya katılım bekleyen kullanıcıları listeler.',
      usage: 'bekleyenler', cooldownMs: 4000,
      async execute(ctx) {
        const items = await ctx.services.apiManagement.listWaiters(ctx.groupId);
        return ctx.reply(`⏳ Katılım bekleyenler: ${items.length}\n${items.slice(0, 50).map((item, i) => `${i + 1}. ${entityName(item)} · ID ${entityId(item) || '?'}`).join('\n') || 'Bekleyen kullanıcı yok.'}`);
      }
    });


    register({
      name: 'bekleyentoplu', aliases: ['toplukatilim'], requiredPermission: 'owner',
      description: 'Katılım bekleyen kullanıcıları /!apis batch motoruyla toplu kabul eder veya reddeder.',
      usage: 'bekleyentoplu <kabul|reddet> [adet] onay', cooldownMs: 20000,
      async execute(ctx) {
        const action = String(ctx.args[0] || '').toLocaleLowerCase('tr-TR');
        const confirmed = ctx.args.some((item) => String(item).toLocaleLowerCase('tr-TR') === 'onay');
        const limit = Math.max(1, Math.min(100, Number(ctx.args[1]) || 25));
        if (!['kabul', 'accept', 'reddet', 'red', 'reject'].includes(action) || !confirmed) {
          return ctx.reply(`Kullanım: ${ctx.config.prefix}bekleyentoplu <kabul|reddet> [1-100] onay`);
        }
        const result = await ctx.services.apiManagement.bulkWaiterAction(ctx.groupId, action, limit);
        return ctx.reply(`✅ Toplu katılım işlemi tamamlandı. Denenen: ${result.attempted} · Başarılı: ${result.succeeded.length} · Hatalı: ${result.failed.length}${result.failed.length ? `\n${result.failed.slice(0, 10).map((item) => `#${item.userId}: ${item.message}`).join('\n')}` : ''}`);
      }
    });

    register({
      name: 'uyekabul', aliases: ['üyekabul'], requiredPermission: 'admin',
      description: 'Katılım bekleyen kullanıcıyı kabul eder.', usage: 'uyekabul <kullanıcıId>', cooldownMs: 4000,
      async execute(ctx) {
        const id = numberId(ctx.args[0], 'kullanıcı ID');
        const result = await ctx.client.acceptJoinRequest(ctx.groupId, id);
        assertApiSuccess(result, 'Üye kabul etme');
        return ctx.reply(`✅ Kullanıcı #${id} sunucuya kabul edildi.`);
      }
    });

    register({
      name: 'uyereddet', aliases: ['üyereddet'], requiredPermission: 'admin',
      description: 'Katılım bekleyen kullanıcıyı reddeder.', usage: 'uyereddet <kullanıcıId>', cooldownMs: 4000,
      async execute(ctx) {
        const id = numberId(ctx.args[0], 'kullanıcı ID');
        const result = await ctx.client.rejectJoinRequest(ctx.groupId, id);
        assertApiSuccess(result, 'Üye reddetme');
        return ctx.reply(`⛔ Kullanıcı #${id} katılım listesinden reddedildi.`);
      }
    });

    register({
      name: 'yetkiguc', aliases: ['yetkigüç', 'permissionpower'],
      description: 'Kullanıcının grup ve isteğe bağlı kanal gücünü sorgular.',
      usage: 'yetkiguc <kullanıcıId> [#kanal/id]', cooldownMs: 3000,
      async execute(ctx) {
        const userId = numberId(ctx.args[0], 'kullanıcı ID');
        const groupPower = await ctx.client.getGroupPower(ctx.groupId, userId);
        let channelResult = null;
        if (ctx.args[1]) {
          const channel = await ctx.services.channels.resolve(ctx.groupId, ctx.args[1]);
          channelResult = { channel, power: await ctx.client.getChannelPower(channel.id, userId) };
        }
        return ctx.reply(jsonPreview({ groupId: ctx.groupId, userId, groupPower, channel: channelResult }), 'json');
      }
    });

    register({
      name: 'rozetler', category: 'Rozet', description: 'Sunucudaki rozetleri listeler.', usage: 'rozetler', cooldownMs: 5000,
      async execute(ctx) {
        const items = await ctx.services.apiManagement.listBadges(ctx.groupId);
        return ctx.reply(`🏅 Rozetler: ${items.length}\n${items.slice(0, 50).map((item, i) => `${i + 1}. ${entityName(item)} · ID ${entityId(item) || '?'} · ${text(item.level)}`).join('\n') || 'Rozet yok.'}`);
      }
    });

    register({
      name: 'rozetolustur', aliases: ['rozetoluştur'], category: 'Rozet', requiredPermission: 'owner',
      description: 'Sunucuya yeni rozet ekler.', usage: 'rozetolustur <ad>|<nick>|<açıklama>|[görsel]|[seviye]', cooldownMs: 8000,
      async execute(ctx) {
        const parts = pipeArgs(ctx.args, 3);
        if (!parts) return ctx.reply(`Kullanım: ${ctx.config.prefix}rozetolustur <ad>|<nick>|<açıklama>|[görsel]|[seviye]`);
        const created = await ctx.services.apiManagement.createBadge(ctx.groupId, { name: parts[0], nick: parts[1], description: parts[2], image: parts[3], level: parts[4] });
        return ctx.reply(`✅ Rozet oluşturuldu: ${created.payload.name}${created.id ? ` · ID ${created.id}` : ''}`);
      }
    });

    register({
      name: 'ekipler', aliases: ['crewlist'], description: 'Sunucudaki crew/ekipleri listeler.', usage: 'ekipler', cooldownMs: 5000,
      async execute(ctx) {
        const items = await ctx.services.apiManagement.listCrews(ctx.groupId);
        return ctx.reply(`🧑‍🤝‍🧑 Ekipler: ${items.length}\n${items.slice(0, 50).map((item, i) => `${i + 1}. ${entityName(item)} · ID ${entityId(item) || '?'} · ${text(item.color)}`).join('\n') || 'Ekip yok.'}`);
      }
    });


    register({
      name: 'ekipbilgi', aliases: ['crewinfo'], description: 'Bir ekibin ayrıntılarını crew/get ile getirir.', usage: 'ekipbilgi <ekipId>', cooldownMs: 3000,
      async execute(ctx) {
        const crewId = numberId(ctx.args[0], 'ekip ID');
        const result = await ctx.client.api('/!api/crew/get', { crew_id: crewId }, { cacheTtlMs: 5000 });
        return ctx.reply(jsonPreview(result), 'json');
      }
    });

    register({
      name: 'ekipolustur', aliases: ['ekipoluştur'], requiredPermission: 'owner',
      description: 'Sunucuya crew/add ile ekip ekler.', usage: 'ekipolustur <ad>|[renk]|[görsel]', cooldownMs: 8000,
      async execute(ctx) {
        const parts = pipeArgs(ctx.args, 1);
        if (!parts) return ctx.reply(`Kullanım: ${ctx.config.prefix}ekipolustur <ad>|[renk]|[görsel]`);
        const result = await ctx.client.createCrew({ group_id: ctx.groupId, name: parts[0], color: parts[1] || '#3b82f6', image: parts[2] || '' });
        assertApiSuccess(result, 'Ekip oluşturma');
        return ctx.reply(`✅ Ekip oluşturuldu: ${parts[0]}${extractCreatedEntityId(result, ['crew_id', 'id']) ? ` · ID ${extractCreatedEntityId(result, ['crew_id', 'id'])}` : ''}`);
      }
    });

    register({
      name: 'ekipduzenle', aliases: ['ekipdüzenle'], requiredPermission: 'owner',
      description: 'Bir ekibin adını, rengini ve görselini değiştirir.', usage: 'ekipduzenle <ekipId>|<ad>|<renk>|[görsel]', cooldownMs: 7000,
      async execute(ctx) {
        const parts = pipeArgs(ctx.args, 3);
        if (!parts) return ctx.reply(`Kullanım: ${ctx.config.prefix}ekipduzenle <ekipId>|<ad>|<renk>|[görsel]`);
        const result = await ctx.client.updateCrew({ crew_id: numberId(parts[0], 'ekip ID'), name: parts[1], color: parts[2], image: parts[3] || '' });
        assertApiSuccess(result, 'Ekip güncelleme');
        return ctx.reply(`✅ Ekip #${parts[0]} güncellendi.`);
      }
    });

    register({
      name: 'ekipsil', requiredPermission: 'owner', description: 'Ekibi siler; onay gerekir.', usage: 'ekipsil <ekipId> onay', cooldownMs: 8000,
      async execute(ctx) {
        if (String(ctx.args[1] || '').toLocaleLowerCase('tr-TR') !== 'onay') return ctx.reply(`Silmek için: ${ctx.config.prefix}ekipsil <ekipId> onay`);
        const id = numberId(ctx.args[0], 'ekip ID');
        const result = await ctx.client.deleteCrew(id);
        assertApiSuccess(result, 'Ekip silme');
        return ctx.reply(`🗑️ Ekip #${id} silindi.`);
      }
    });

    register({
      name: 'ekipsirala', aliases: ['ekipsırala'], requiredPermission: 'owner', description: 'Ekip sırasını crew/sort ile değiştirir.', usage: 'ekipsirala <id,id,id>', cooldownMs: 7000,
      async execute(ctx) {
        const ids = ctx.args.join('').split(',').map(Number).filter(Number.isInteger);
        if (!ids.length) return ctx.reply(`Kullanım: ${ctx.config.prefix}ekipsirala <id,id,id>`);
        const result = await ctx.client.sortCrews(ctx.groupId, ids);
        assertApiSuccess(result, 'Ekip sıralama');
        return ctx.reply(`✅ ${ids.length} ekip için sıra uygulandı.`);
      }
    });

    register({
      name: 'takimlar', aliases: ['takımlar', 'teamlist'], description: 'Sunucudaki team kayıtlarını listeler.', usage: 'takimlar', cooldownMs: 5000,
      async execute(ctx) {
        const items = await ctx.services.apiManagement.listTeams(ctx.groupId);
        return ctx.reply(`👥 Takımlar: ${items.length}\n${items.slice(0, 50).map((item, i) => `${i + 1}. ${entityName(item)} · ID ${entityId(item) || '?'}`).join('\n') || 'Takım yok.'}`);
      }
    });


    register({
      name: 'postbilgi', aliases: ['postinfo'], description: 'Bir postun ayrıntılarını post/get ile getirir.', usage: 'postbilgi <postId>', cooldownMs: 3000,
      async execute(ctx) {
        const postId = numberId(ctx.args[0], 'post ID');
        const result = await ctx.client.getPost(postId);
        return ctx.reply(jsonPreview(result), 'json');
      }
    });

    register({
      name: 'postlar', description: 'Kanalın son postlarını post/list ile getirir.', usage: 'postlar <#kanal/id> [adet]', cooldownMs: 5000,
      async execute(ctx) {
        const channel = await ctx.services.channels.resolve(ctx.groupId, ctx.args[0]);
        const limit = Math.max(1, Math.min(50, Number(ctx.args[1]) || 15));
        const result = await ctx.client.listPosts(channel.id);
        const posts = ApiManagementService.normalizeList(result, ['posts', 'list', 'items']).slice(-limit).reverse();
        return ctx.reply(`📝 #${channel.nick} son postlar:\n${posts.map((item) => `#${entityId(item) || '?'} · U:${item.user_id ?? '?'} · ${truncate(item.text ?? item.message ?? '', 100)}`).join('\n') || 'Post yok.'}`);
      }
    });

    register({
      name: 'postduzenle', aliases: ['postdüzenle'], requiredPermission: 'admin', description: 'Post metnini post/set ile değiştirir.', usage: 'postduzenle <postId> <metin>', cooldownMs: 4000,
      async execute(ctx) {
        const id = numberId(ctx.args.shift(), 'post ID');
        const body = ctx.args.join(' ').trim();
        if (!body) return ctx.reply(`Kullanım: ${ctx.config.prefix}postduzenle <postId> <metin>`);
        const result = await ctx.client.updatePost(id, body);
        assertApiSuccess(result, 'Post güncelleme');
        return ctx.reply(`✅ Post #${id} güncellendi.`);
      }
    });

    register({
      name: 'postsil', requiredPermission: 'admin', description: 'Postu siler; onay gerekir.', usage: 'postsil <postId> onay', cooldownMs: 4000,
      async execute(ctx) {
        if (String(ctx.args[1] || '').toLocaleLowerCase('tr-TR') !== 'onay') return ctx.reply(`Silmek için: ${ctx.config.prefix}postsil <postId> onay`);
        const id = numberId(ctx.args[0], 'post ID');
        const result = await ctx.client.deletePost(id);
        assertApiSuccess(result, 'Post silme');
        return ctx.reply(`🗑️ Post #${id} silindi.`);
      }
    });

    register({
      name: 'kullanicilar', aliases: ['kullanıcılar', 'userlist'],
      description: 'En fazla 100 kullanıcı ID’sini user/list ile tek çağrıda çözümler.', usage: 'kullanicilar <id,id,id>', cooldownMs: 4000,
      async execute(ctx) {
        const ids = ctx.args.join('').split(',').map(Number).filter(Number.isInteger).slice(0, 100);
        if (!ids.length) return ctx.reply(`Kullanım: ${ctx.config.prefix}kullanicilar <id,id,id>`);
        const result = await ctx.client.listUsers(ids);
        const users = ApiManagementService.normalizeList(result, ['users', 'list', 'items']);
        return ctx.reply(`👤 Kullanıcılar:\n${users.map((item) => `${entityName(item)} · ID ${entityId(item) || '?'}`).join('\n') || jsonPreview(result)}`);
      }
    });


    register({
      name: 'apidurum', aliases: ['apiping'], requiredPermission: 'owner', guildOnly: false,
      description: 'Topluyo sunucu saati, uzak IP ve batch motoru gecikmesini birlikte ölçer.', usage: 'apidurum', cooldownMs: 5000,
      async execute(ctx) {
        const started = Date.now();
        const [timeResult, ipResult] = await Promise.all([
          ctx.client.getServerTime(),
          ctx.client.getRemoteIp()
        ]);
        return ctx.reply(`🛰️ Topluyo API durumu\nGörünür gecikme: ${Date.now() - started} ms\nSunucu zamanı: ${jsonPreview(timeResult, 450)}\nUzak IP: ${jsonPreview(ipResult, 250)}\n\n${formatApiMetrics(ctx.services.apiManagement.apiMetrics())}`);
      }
    });

    register({
      name: 'apiperformans', aliases: ['apihiz', 'apihız'], guildOnly: false,
      description: 'Batch, cache, dedupe, retry, kuyruk ve JSON depolama performansını gösterir.', usage: 'apiperformans', cooldownMs: 2000,
      async execute(ctx) { return ctx.reply(formatApiMetrics(ctx.services.apiManagement.apiMetrics())); }
    });

    register({
      name: 'apionbellek', aliases: ['apiönbellek'], requiredPermission: 'owner', guildOnly: false,
      description: 'API, kanal ve rol önbelleklerini temizler veya yeniden ısıtır.', usage: 'apionbellek <temizle|isit>', cooldownMs: 5000,
      async execute(ctx) {
        const action = String(ctx.args[0] || 'temizle').toLocaleLowerCase('tr-TR');
        const cleared = ctx.client.clearApiCache();
        if (ctx.groupId) {
          ctx.services.channels.invalidate(ctx.groupId);
          ctx.services.roles.invalidate?.(ctx.groupId);
        }
        if (['isit', 'ısıt', 'warm'].includes(action) && ctx.groupId) {
          const started = Date.now();
          const [channels, roles, members] = await Promise.all([
            ctx.services.channels.prime(ctx.groupId),
            ctx.services.roles.list(ctx.groupId, { force: true }),
            ctx.client.listMembers(ctx.groupId)
          ]);
          return ctx.reply(`🔥 Önbellek ısıtıldı (${Date.now() - started} ms). ${channels.length} kanal · ${roles.length} rol · ${ApiManagementService.normalizeList(members, ['members', 'users', 'list']).length} üye. API cache temizlenen: ${cleared}`);
        }
        return ctx.reply(`✅ Önbellekler temizlendi. API girdisi: ${cleared}`);
      }
    });

    register({
      name: 'apistres', aliases: ['apibench'], requiredPermission: 'owner', guildOnly: false,
      description: 'Resmî test/time ucunu /!apis üzerinden batch ederek kontrollü hız testi yapar.', usage: 'apistres [1-100]', cooldownMs: 15000,
      async execute(ctx) {
        const result = await ctx.services.apiManagement.apiBenchmark(ctx.args[0]);
        return ctx.reply(`⚡ API batch testi tamamlandı.\nİstek: ${result.count}\nToplam: ${result.elapsedMs} ms\nİstek başına görünür süre: ${result.perRequestMs} ms\n${formatApiMetrics(ctx.services.apiManagement.apiMetrics())}`);
      }
    });

    register({
      name: 'apioku', requiredPermission: 'owner', guildOnly: false,
      description: 'Yalnızca dokümanda salt-okunur olarak tanımlanan bir API ucunu güvenli biçimde sorgular.', usage: 'apioku </!api/yol> [JSON]', cooldownMs: 3000,
      async execute(ctx) {
        const api = String(ctx.args.shift() || '').trim();
        if (!ApiBatchQueue.READ_ONLY_ENDPOINTS.has(api)) return ctx.reply('Bu uç salt-okunur izin listesinde değil. Yazma uçları apioku ile çalıştırılamaz.');
        let data = {};
        const raw = ctx.args.join(' ').trim();
        if (raw) {
          try { data = JSON.parse(raw); }
          catch { return ctx.reply('JSON verisi geçersiz. Örnek: !apioku /!api/group/get {"id":1}'); }
        }
        const result = await ctx.client.api(api, data, { bypassCache: true, cacheTtlMs: 0, flushImmediately: true });
        return ctx.reply(jsonPreview(result), 'json');
      }
    });

    register({
      name: 'hizlandir', aliases: ['hızlandır', 'sunucuisit', 'sunucuısıt'], requiredPermission: 'admin',
      description: 'Sunucu kanal, rol, üye, grup ve ayar verilerini paralel batch ile önceden yükler.', usage: 'hizlandir', cooldownMs: 10000,
      async execute(ctx) {
        ctx.client.clearApiCache();
        ctx.services.channels.invalidate(ctx.groupId);
        ctx.services.roles.invalidate?.(ctx.groupId);
        const started = Date.now();
        const [channels, roles, members, group, settings] = await Promise.all([
          ctx.services.channels.list(ctx.groupId, { force: true }),
          ctx.services.roles.list(ctx.groupId, { force: true }),
          ctx.client.listMembers(ctx.groupId),
          ctx.client.getGroup(ctx.groupId),
          ctx.services.settings.get(ctx.groupId)
        ]);
        return ctx.reply(`🚀 Sunucu önbelleği hazır (${Date.now() - started} ms).\n${channels.length} kanal · ${roles.length} rol · ${ApiManagementService.normalizeList(members, ['members', 'users', 'list']).length} üye\nGrup: ${entityName(findObject(group, ['group', 'info']) || group)} · Ayarlar: ${Object.keys(settings).length} bölüm`);
      }
    });
  }
};
