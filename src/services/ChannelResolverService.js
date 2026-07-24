const { findArray, findObject, parseMaybeJson, unwrapApiResult } = require('../utils/api');

function normalizeChannelName(value) {
  return String(value ?? '')
    .trim()
    .replace(/^#+/, '')
    .replace(/^<#+|>$/g, '')
    .normalize('NFKC')
    .toLocaleLowerCase('tr-TR')
    .replace(/[’'`]/g, '')
    .replace(/[^\p{L}\p{N}-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function channelOrder(channel) {
  const value = Number(
    channel?.order ?? channel?.sort ?? channel?.position ?? channel?.row ??
    channel?.channel_order ?? channel?.channelOrder ?? channel?.sequence ?? channel?.index
  );
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function extractChannelObject(value) {
  const root = unwrapApiResult(parseMaybeJson(value));
  if (!root || typeof root !== 'object' || Array.isArray(root)) return null;
  for (const key of ['channel', 'item', 'info']) {
    const candidate = unwrapApiResult(root[key]);
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) return candidate;
  }
  return root;
}

function normalizeChannel(value, fallbackId = null) {
  const channel = extractChannelObject(value);
  if (!channel) return null;

  const id = Number(
    channel.id ?? channel.channel_id ?? channel.channelId ?? channel.cid ??
    channel.group_channel_id ?? channel.groupChannelId ?? fallbackId
  );
  if (!Number.isInteger(id) || id <= 0) return null;

  const aliasValues = [
    channel.nick,
    channel.slug,
    channel.channel_nick,
    channel.channelNick,
    channel.name,
    channel.title,
    channel.channel_name,
    channel.channelName,
    channel.label
  ].map((item) => String(item ?? '').trim().replace(/^#+/, '')).filter(Boolean);

  const nick = String(channel.nick ?? channel.slug ?? channel.channel_nick ?? '').trim().replace(/^#+/, '');
  const title = String(channel.title ?? channel.name ?? channel.channel_name ?? '').trim().replace(/^#+/, '');
  const name = nick || title || aliasValues[0] || `kanal-${id}`;
  const aliases = [...new Set([...aliasValues, name].map(normalizeChannelName).filter(Boolean))];
  const type = Number(channel.type ?? channel.channel_type ?? channel.channelType);

  return {
    id,
    name,
    nick: nick || name,
    title: title || name,
    description: String(channel.description ?? channel.about ?? '').trim(),
    type: Number.isFinite(type) ? type : null,
    order: channelOrder(channel),
    normalizedName: normalizeChannelName(name),
    aliases,
    raw: channel
  };
}

function collectChannelLikeObjects(value, output = [], seen = new Set(), depth = 0, fallbackId = null) {
  const parsed = parseMaybeJson(value);
  if (depth > 9 || parsed === null || parsed === undefined) return output;
  if (typeof parsed !== 'object' || seen.has(parsed)) return output;
  seen.add(parsed);

  const normalized = normalizeChannel(parsed, fallbackId);
  if (normalized) output.push(normalized);

  if (Array.isArray(parsed)) {
    parsed.forEach((child) => collectChannelLikeObjects(child, output, seen, depth + 1));
  } else {
    for (const [key, child] of Object.entries(parsed)) {
      collectChannelLikeObjects(child, output, seen, depth + 1, /^\d+$/.test(key) ? Number(key) : null);
    }
  }
  return output;
}

function extractGroupNick(value) {
  const candidates = [];
  const visited = new Set();
  function walk(input, depth = 0) {
    const node = parseMaybeJson(input);
    if (depth > 7 || !node || typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);
    if (!Array.isArray(node)) {
      for (const key of ['nick', 'group_nick', 'groupNick', 'slug']) {
        const text = String(node[key] ?? '').trim();
        if (text) candidates.push(text);
      }
    }
    for (const child of Array.isArray(node) ? node : Object.values(node)) walk(child, depth + 1);
  }
  walk(value);
  return candidates[0] || '';
}

function preview(value) {
  try { return JSON.stringify(value).slice(0, 700); }
  catch { return String(value).slice(0, 700); }
}

class ChannelResolverService {
  constructor({ client, logger, cacheTtlMs = 120000 } = {}) {
    this.client = client;
    this.logger = logger;
    this.cacheTtlMs = Math.max(5000, Number(cacheTtlMs) || 120000);
    this.cache = new Map();
  }

  normalizeReference(reference) {
    const value = String(reference ?? '').trim();
    const mentionMatch = value.match(/^<#(\d+)>$/);
    if (mentionMatch) return { type: 'id', value: Number(mentionMatch[1]), raw: value };
    if (/^\d+$/.test(value)) return { type: 'id', value: Number(value), raw: value };
    return { type: 'name', value: normalizeChannelName(value), raw: value.replace(/^#+/, '').trim() };
  }

  async list(groupId, { force = false } = {}) {
    const numericGroupId = Number(groupId);
    if (!Number.isInteger(numericGroupId) || numericGroupId <= 0) {
      throw new TypeError('Kanal çözümlemek için geçerli bir sunucu/grup ID gerekli.');
    }

    const key = String(numericGroupId);
    const cached = this.cache.get(key);
    if (!force && cached && cached.expiresAt > Date.now()) return cached.channels;

    const result = await this.client.listChannels(numericGroupId, force ? { bypassCache: true, cacheTtlMs: 0 } : {});
    let candidates = findArray(result, ['channels', 'channel_list', 'list', 'items'])
      .map((item, index) => normalizeChannel(item, Number.isInteger(Number(item?.key)) ? Number(item.key) : null))
      .filter(Boolean);

    if (!candidates.length) candidates = collectChannelLikeObjects(result);

    const unique = new Map();
    for (const channel of candidates) {
      const current = unique.get(channel.id);
      if (!current || current.aliases.length < channel.aliases.length) unique.set(channel.id, channel);
    }
    const channels = [...unique.values()].sort((a, b) => {
      const orderDiff = a.order - b.order;
      if (Number.isFinite(orderDiff) && orderDiff !== 0) return orderDiff;
      return a.name.localeCompare(b.name, 'tr');
    });

    if (!channels.length) {
      this.logger?.warn('Topluyo channel/list cevabından kanal çıkarılamadı.', {
        groupId: numericGroupId,
        responsePreview: preview(result)
      });
    }
    this.cache.set(key, { expiresAt: Date.now() + this.cacheTtlMs, channels, raw: result });
    return channels;
  }

  async resolveViaShowInfo(groupId, reference) {
    if (!this.client?.getChannelByNick) return null;
    let groupNick = '';
    try {
      const group = await this.client.getGroup(groupId);
      groupNick = extractGroupNick(group);
    } catch (error) {
      this.logger?.warn('Kanal adı fallback çözümlemesinde grup bilgisi alınamadı.', {
        groupId,
        message: error.message
      });
    }

    const payloads = [];
    if (groupNick) payloads.push({ group_nick: groupNick, channel_nick: reference });
    payloads.push({ group_id: Number(groupId), channel_nick: reference });

    for (const payload of payloads) {
      try {
        const result = await this.client.getChannelByNick(payload);
        const candidates = collectChannelLikeObjects(result);
        const exact = candidates.find((channel) => channel.aliases.includes(normalizeChannelName(reference)));
        const channel = exact || candidates[0] || normalizeChannel(findObject(result, ['channel', 'info']));
        if (channel) {
          const key = String(groupId);
          const current = this.cached(groupId);
          const merged = [...current.filter((item) => item.id !== channel.id), channel];
          this.cache.set(key, { expiresAt: Date.now() + this.cacheTtlMs, channels: merged, raw: result });
          return channel;
        }
      } catch (error) {
        this.logger?.warn('channel/show/info ile kanal adı çözümlenemedi.', {
          groupId,
          channel: reference,
          groupNick: groupNick || undefined,
          message: error.message
        });
      }
    }
    return null;
  }

  async prime(groupId) {
    try {
      return await this.list(groupId);
    } catch (error) {
      this.logger?.warn('Sunucu kanal listesi önbelleğe alınamadı.', {
        groupId,
        message: error.message
      });
      return [];
    }
  }

  cached(groupId) {
    return this.cache.get(String(groupId))?.channels || [];
  }

  label(groupId, channelId) {
    const id = Number(channelId);
    if (!Number.isInteger(id)) return '';
    const match = this.cached(groupId).find((channel) => channel.id === id);
    return match ? `#${match.nick || match.name}` : '';
  }

  describe(groupId, channelId) {
    const id = Number(channelId);
    if (!Number.isInteger(id) || id <= 0) return 'Ayarsız';
    const label = this.label(groupId, id);
    return label ? `${label} · ${id}` : `Kanal #${id}`;
  }

  async resolve(groupId, reference, { refreshOnMiss = true } = {}) {
    const parsed = this.normalizeReference(reference);
    if (parsed.type === 'id') {
      if (!Number.isInteger(parsed.value) || parsed.value <= 0) throw new Error('Geçerli bir kanal ID girilmelidir.');
      const cached = await this.prime(groupId);
      const known = cached.find((channel) => channel.id === parsed.value);
      return known || { id: parsed.value, name: '', nick: '', title: '', normalizedName: '', aliases: [], raw: null };
    }

    if (!parsed.value) throw new Error('Kanal adı boş bırakılamaz. Örnek: #hoş-geldin');

    let channels = await this.list(groupId);
    let matches = channels.filter((channel) => (channel.aliases || [channel.normalizedName]).includes(parsed.value));
    if (!matches.length && refreshOnMiss) {
      channels = await this.list(groupId, { force: true });
      matches = channels.filter((channel) => (channel.aliases || [channel.normalizedName]).includes(parsed.value));
    }

    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error(`“#${parsed.raw}” adı birden fazla kanalla eşleşti. Kanal ID kullan.`);

    const direct = await this.resolveViaShowInfo(groupId, parsed.raw || parsed.value);
    if (direct) return direct;

    const partial = channels.filter((channel) => (channel.aliases || [channel.normalizedName]).some((alias) => (
      alias.startsWith(parsed.value) || parsed.value.startsWith(alias)
    )));
    if (partial.length === 1) return partial[0];
    if (partial.length > 1) throw new Error(`“#${parsed.raw}” birden fazla kanalla benzer. Tam kanal adını veya ID’yi kullan.`);

    const sample = channels.slice(0, 10).map((channel) => `#${channel.nick || channel.name}`).join(', ');
    throw new Error(`“#${parsed.raw || parsed.value}” kanalı bu sunucuda bulunamadı.${sample ? ` Mevcut örnekler: ${sample}` : ' Kanal listesi API tarafından boş döndü.'}`);
  }

  invalidate(groupId) {
    this.cache.delete(String(groupId));
  }
}

ChannelResolverService.normalizeChannelName = normalizeChannelName;
ChannelResolverService.normalizeChannel = normalizeChannel;
ChannelResolverService.collectChannelLikeObjects = collectChannelLikeObjects;
module.exports = ChannelResolverService;
