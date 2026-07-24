const DEFAULT_TEMPLATE = '{mention}\n🔴 {name} şu anda {platform} üzerinde canlı!\n{title}\n👉 {url}';
const DEFAULT_VIDEO_TEMPLATE = '{mention}\n▶️ {name} yeni bir video paylaştı!\n{title}\n👉 {url}';
const clean = (value) => String(value ?? '').trim();

function slugFromSource(source) {
  const value = clean(source);
  if (!/^https?:\/\//i.test(value)) return value.replace(/^@/, '').replace(/\/+$/, '');
  try { return (new URL(value).pathname.split('/').filter(Boolean).pop() || '').replace(/^@/, ''); } catch { return value; }
}

function renderTemplate(template, values) {
  return String(template || DEFAULT_TEMPLATE).replace(/\{(\w+)\}/g, (_match, key) => values[key] ?? '');
}

class LiveStreamService {
  constructor({ config = {}, fetchImpl = globalThis.fetch } = {}) {
    this.config = config;
    this.fetch = fetchImpl;
    this.kickToken = null;
    this.kickTokenExpiresAt = 0;
    this.twitchToken = null;
    this.twitchTokenExpiresAt = 0;
  }

  async requestJson(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(2000, Number(this.config.timeoutMs) || 12000));
    try {
      const response = await this.fetch(url, {
        ...options, signal: controller.signal,
        headers: { 'user-agent': 'TopluyoProfessionalBot/3.8', accept: 'application/json', ...(options.headers || {}) }
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return await response.json();
    } finally { clearTimeout(timer); }
  }

  async check(watcher) {
    const platform = clean(watcher.platform).toLowerCase();
    if (platform === 'kick') return this.checkKick(watcher);
    if (platform === 'twitch') return this.checkTwitch(watcher);
    if (platform === 'youtube') return this.checkYouTube(watcher);
    throw new Error(`Desteklenmeyen yayın platformu: ${platform}`);
  }

  async kickAccessToken({ force = false } = {}) {
    const kick = this.config.kick || {};
    if (!force && clean(kick.accessToken)) return clean(kick.accessToken);
    if (!force && this.kickToken && Date.now() < this.kickTokenExpiresAt - 60000) return this.kickToken;
    if (!clean(kick.clientId) || !clean(kick.clientSecret)) {
      if (clean(kick.accessToken)) return clean(kick.accessToken);
      throw new Error('Kick için liveStreams.kick.clientId ve clientSecret ayarlanmalı.');
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clean(kick.clientId),
      client_secret: clean(kick.clientSecret)
    });
    const data = await this.requestJson('https://id.kick.com/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });
    this.kickToken = clean(data.access_token);
    if (!this.kickToken) throw new Error('Kick erişim anahtarı üretilemedi.');
    this.kickTokenExpiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
    return this.kickToken;
  }

  async kickApiJson(url) {
    let accessToken = await this.kickAccessToken();
    try {
      return await this.requestJson(url, { headers: { authorization: `Bearer ${accessToken}` } });
    } catch (error) {
      const kick = this.config.kick || {};
      const canRefresh = clean(kick.clientId) && clean(kick.clientSecret);
      if (error.status !== 401 || !canRefresh) throw error;
      this.kickToken = null;
      this.kickTokenExpiresAt = 0;
      accessToken = await this.kickAccessToken({ force: true });
      return this.requestJson(url, { headers: { authorization: `Bearer ${accessToken}` } });
    }
  }

  async checkKick(watcher) {
    const slug = slugFromSource(watcher.source);
    const kick = this.config.kick || {};
    const hasOfficialCredentials = Boolean(
      clean(kick.accessToken) || (clean(kick.clientId) && clean(kick.clientSecret))
    );
    if (hasOfficialCredentials) {
      const channelData = await this.kickApiJson(
        `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(slug)}`
      );
      const channel = channelData.data?.[0];
      const broadcasterId = channel?.broadcaster_user_id || channel?.user_id;
      if (!channel || !broadcasterId) throw new Error(`Kick kanalı bulunamadı: ${slug}`);
      const liveData = await this.kickApiJson(
        `https://api.kick.com/public/v1/livestreams?broadcaster_user_id=${encodeURIComponent(broadcasterId)}`
      );
      const live = liveData.data?.[0];
      return {
        live: Boolean(live), streamId: clean(live?.id || live?.started_at),
        contentId: clean(live?.id || live?.started_at),
        eventType: live ? 'live' : 'offline',
        title: clean(live?.stream_title || channel?.stream_title),
        category: clean(live?.category?.name || channel?.category?.name),
        viewers: Number(live?.viewer_count || 0),
        thumbnail: clean(live?.thumbnail || channel?.thumbnail?.url || channel?.thumbnail),
        profileImage: clean(
          channel?.profile_picture
          || channel?.profile_pic
          || channel?.user?.profile_picture
          || channel?.user?.profile_pic
          || channel?.broadcaster?.profile_picture
          || channel?.banner_picture?.url
          || channel?.banner_picture
        ),
        url: `https://kick.com/${slug}`
      };
    }
    let data;
    try {
      data = await this.requestJson(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`);
    } catch (error) {
      if (/HTTP 403/.test(error.message)) {
        throw new Error('Kick eski API erişimini engelledi. config.json içindeki liveStreams.kick.clientId ve clientSecret alanları doldurulmalı.');
      }
      throw error;
    }
    const live = data.livestream;
    return {
      live: Boolean(live?.is_live ?? live), streamId: clean(live?.id || live?.created_at),
      contentId: clean(live?.id || live?.created_at),
      eventType: Boolean(live?.is_live ?? live) ? 'live' : 'offline',
      title: clean(live?.session_title || live?.title), category: clean(live?.categories?.[0]?.name || live?.category?.name),
      viewers: Number(live?.viewer_count || 0), thumbnail: clean(live?.thumbnail?.url || live?.thumbnail),
      profileImage: clean(
        data?.user?.profile_pic
        || data?.user?.profile_picture
        || data?.profile_picture
        || data?.profile_pic
      ),
      url: `https://kick.com/${slug}`
    };
  }

  async twitchAccessToken() {
    const twitch = this.config.twitch || {};
    if (clean(twitch.accessToken)) return clean(twitch.accessToken);
    if (this.twitchToken && Date.now() < this.twitchTokenExpiresAt - 60000) return this.twitchToken;
    if (!clean(twitch.clientId) || !clean(twitch.clientSecret)) throw new Error('Twitch için liveStreams.twitch.clientId ve clientSecret ayarlanmalı.');
    const query = new URLSearchParams({ client_id: clean(twitch.clientId), client_secret: clean(twitch.clientSecret), grant_type: 'client_credentials' });
    const data = await this.requestJson(`https://id.twitch.tv/oauth2/token?${query}`, { method: 'POST' });
    this.twitchToken = clean(data.access_token);
    this.twitchTokenExpiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
    return this.twitchToken;
  }

  async checkTwitch(watcher) {
    const login = slugFromSource(watcher.source).toLowerCase();
    const token = await this.twitchAccessToken();
    const clientId = clean(this.config.twitch?.clientId);
    if (!clientId) throw new Error('Twitch için liveStreams.twitch.clientId ayarlanmalı.');
    const data = await this.requestJson(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`, {
      headers: { 'client-id': clientId, authorization: `Bearer ${token}` }
    });
    const live = data.data?.[0];
    return {
      live: Boolean(live), streamId: clean(live?.id || live?.started_at), title: clean(live?.title),
      contentId: clean(live?.id || live?.started_at),
      eventType: live ? 'live' : 'offline',
      category: clean(live?.game_name), viewers: Number(live?.viewer_count || 0),
      thumbnail: clean(live?.thumbnail_url).replace('{width}', '1280').replace('{height}', '720'),
      url: `https://www.twitch.tv/${login}`
    };
  }

  async checkYouTube(watcher) {
    const apiKey = clean(this.config.youtube?.apiKey);
    if (!apiKey) throw new Error('YouTube için liveStreams.youtube.apiKey ayarlanmalı.');
    const channelId = clean(watcher.source);
    if (!/^UC[\w-]{20,}$/.test(channelId)) throw new Error('YouTube kaynağı UC ile başlayan kanal ID olmalı.');

    const channelQuery = new URLSearchParams({
      part: 'snippet,contentDetails',
      id: channelId,
      key: apiKey
    });
    const channelData = await this.requestJson(
      `https://www.googleapis.com/youtube/v3/channels?${channelQuery}`
    );
    const channel = channelData.items?.[0];
    if (!channel) throw new Error(`YouTube kanalı bulunamadı: ${channelId}`);

    const profileImage = clean(
      channel.snippet?.thumbnails?.high?.url
      || channel.snippet?.thumbnails?.medium?.url
      || channel.snippet?.thumbnails?.default?.url
    );
    const uploadsPlaylistId = clean(channel.contentDetails?.relatedPlaylists?.uploads);
    if (!uploadsPlaylistId) {
      throw new Error(`YouTube kanalının video listesi alınamadı: ${channelId}`);
    }

    const playlistQuery = new URLSearchParams({
      part: 'snippet,contentDetails',
      playlistId: uploadsPlaylistId,
      maxResults: '10',
      key: apiKey
    });
    const playlistData = await this.requestJson(
      `https://www.googleapis.com/youtube/v3/playlistItems?${playlistQuery}`
    );
    const playlistItems = Array.isArray(playlistData.items) ? playlistData.items : [];
    const videoIds = [...new Set(playlistItems.map((item) => clean(
      item.contentDetails?.videoId || item.snippet?.resourceId?.videoId
    )).filter(Boolean))];

    if (!videoIds.length) {
      return {
        live: false,
        streamId: '',
        contentId: '',
        eventType: 'offline',
        title: '',
        category: '',
        viewers: 0,
        thumbnail: '',
        profileImage,
        channelName: clean(channel.snippet?.title),
        url: `https://www.youtube.com/channel/${channelId}`
      };
    }

    const videosQuery = new URLSearchParams({
      part: 'snippet,liveStreamingDetails',
      id: videoIds.join(','),
      key: apiKey
    });
    const videosData = await this.requestJson(
      `https://www.googleapis.com/youtube/v3/videos?${videosQuery}`
    );
    const videosById = new Map(
      (videosData.items || []).map((video) => [clean(video.id), video])
    );
    const orderedVideos = playlistItems.map((item) => {
      const videoId = clean(item.contentDetails?.videoId || item.snippet?.resourceId?.videoId);
      return { item, videoId, video: videosById.get(videoId) || null };
    }).filter((entry) => entry.videoId);
    const isLiveVideo = ({ video }) => Boolean(
      video?.snippet?.liveBroadcastContent === 'live'
      || (video?.liveStreamingDetails?.actualStartTime && !video?.liveStreamingDetails?.actualEndTime)
    );
    const activeLive = orderedVideos.find(isLiveVideo);
    const selected = activeLive || orderedVideos.find(({ video }) => (
      video?.snippet?.liveBroadcastContent !== 'upcoming'
    ));

    if (!selected) {
      return {
        live: false,
        streamId: '',
        contentId: '',
        eventType: 'offline',
        title: '',
        category: '',
        viewers: 0,
        thumbnail: '',
        profileImage,
        channelName: clean(channel.snippet?.title),
        url: `https://www.youtube.com/channel/${channelId}`
      };
    }

    const live = isLiveVideo(selected);
    const snippet = selected.video?.snippet || selected.item?.snippet || {};
    const details = selected.video?.liveStreamingDetails || {};
    const videoId = selected.videoId;
    return {
      live,
      streamId: videoId,
      contentId: videoId,
      eventType: live ? 'live' : 'video',
      title: clean(snippet.title),
      category: '',
      viewers: Number(details.concurrentViewers || 0),
      thumbnail: clean(
        snippet.thumbnails?.maxres?.url
        || snippet.thumbnails?.high?.url
        || snippet.thumbnails?.medium?.url
        || snippet.thumbnails?.default?.url
      ),
      profileImage,
      channelName: clean(channel.snippet?.title),
      publishedAt: clean(snippet.publishedAt || selected.item?.contentDetails?.videoPublishedAt),
      url: `https://www.youtube.com/watch?v=${videoId}`
    };
  }

  message(watcher, status) {
    const platform = clean(watcher.platform);
    const isVideo = status.eventType === 'video';
    const template = isVideo
      ? watcher.videoTemplate || this.config.defaultVideoTemplate || DEFAULT_VIDEO_TEMPLATE
      : watcher.template || this.config.defaultTemplate || DEFAULT_TEMPLATE;
    return renderTemplate(template, {
      mention: watcher.mention ?? '@millet', name: watcher.name,
      platform: platform ? platform[0].toUpperCase() + platform.slice(1) : '',
      title: status.title || (isVideo ? 'Yeni video yayınlandı!' : 'Canlı yayın başladı!'),
      category: status.category || '',
      viewers: status.viewers || 0,
      url: status.url,
      thumbnail: status.thumbnail || '',
      profile: status.profileImage || watcher.logoUrl || '',
      publishedAt: status.publishedAt || '',
      event: isVideo ? 'video' : 'live'
    }).replace(/\n{3,}/g, '\n\n').trim();
  }
}

module.exports = {
  LiveStreamService,
  DEFAULT_TEMPLATE,
  DEFAULT_VIDEO_TEMPLATE,
  renderTemplate,
  slugFromSource
};
