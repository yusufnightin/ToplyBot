const test = require('node:test');
const assert = require('node:assert/strict');
const liveStreamsPlugin = require('../src/plugins/liveStreams');

class MemoryStore {
  constructor(value) { this.value = structuredClone(value); }
  async read() { return structuredClone(this.value); }
  async update(mutator) {
    const next = await mutator(this.value);
    if (next !== undefined) this.value = next;
    return structuredClone(this.value);
  }
}

function createApp(watcher, { cards = null } = {}) {
  let scheduledJob;
  const sent = [];
  const app = {
    config: { liveStreams: {} },
    stores: { liveStreams: new MemoryStore([watcher]) },
    services: {
      scheduler: {
        register(_name, job) { scheduledJob = job; }
      },
      ...(cards ? { cards } : {})
    },
    client: {
      async sendPost(channelId, text) {
        sent.push({ channelId, text });
        return { success: true };
      }
    },
    router: { register() {} },
    logger: { error() {} }
  };
  liveStreamsPlugin.setup(app);
  return { app, sent, scheduledJob: () => scheduledJob };
}

test('Kick ilk zamanlayıcı kontrolünde kanal canlıysa bir kez duyuru gönderir', async () => {
  const now = Date.now();
  const { app, sent, scheduledJob } = createApp({
    id: 1,
    active: true,
    platform: 'kick',
    source: 'ornek',
    channelId: '44',
    name: 'Örnek',
    pollMinutes: 3,
    isLive: false,
    lastLiveId: null,
    lastAnnouncedId: null,
    hasSuccessfulCheck: false,
    nextCheckAt: null
  });
  app.services.liveStreams.check = async () => ({
    live: true,
    streamId: 'ilk-yayin',
    title: 'Zaten devam eden yayın',
    url: 'https://kick.com/ornek'
  });

  await scheduledJob()(now);

  const [saved] = await app.stores.liveStreams.read();
  assert.equal(saved.isLive, true);
  assert.equal(saved.hasSuccessfulCheck, true);
  assert.equal(saved.lastAnnouncedId, 'ilk-yayin');
  assert.equal(saved.lastError, null);
  assert.equal(saved.announcementCount, 1);
  assert.equal(sent.length, 1);
});

test('ilk durum tespitinden sonraki çevrimdışı-canlı geçişinde duyuru gönderir', async () => {
  const { app, sent } = createApp({
    id: 1,
    active: true,
    platform: 'kick',
    source: 'ornek',
    channelId: '44',
    name: 'Örnek',
    pollMinutes: 3,
    isLive: true,
    lastLiveId: 'ilk-yayin',
    lastAnnouncedId: 'ilk-yayin',
    hasSuccessfulCheck: true,
    lastCheckedAt: new Date().toISOString()
  });

  app.services.liveStreams.check = async () => ({
    live: false,
    streamId: '',
    title: '',
    url: 'https://kick.com/ornek'
  });
  let watcher = (await app.stores.liveStreams.read())[0];
  await app.services.liveStreams.checkWatcher(watcher, { now: Date.now() });

  app.services.liveStreams.check = async () => ({
    live: true,
    streamId: 'yeni-yayin',
    title: 'Yeni yayın',
    url: 'https://kick.com/ornek'
  });
  watcher = (await app.stores.liveStreams.read())[0];
  const result = await app.services.liveStreams.checkWatcher(watcher, { now: Date.now() + 1000 });

  assert.equal(result.announced, true);
  assert.equal(sent.length, 1);
  assert.equal((await app.stores.liveStreams.read())[0].lastAnnouncedId, 'yeni-yayin');
});

test('Kick duyurusuna platform bannerı ve yayıncı logosu eklenir', async () => {
  let cardOptions;
  const { app, sent } = createApp({
    id: 1,
    active: true,
    platform: 'kick',
    source: 'ornek',
    channelId: '44',
    name: 'Örnek',
    pollMinutes: 3,
    isLive: false,
    lastAnnouncedId: 'eski-yayin',
    lastSeenContentId: 'eski-yayin',
    hasSuccessfulCheck: true
  }, {
    cards: {
      async createLiveAnnouncementCard(options) {
        cardOptions = options;
        return { url: 'https://cards.example/live-kick.png', jtml: null };
      }
    }
  });
  app.services.liveStreams.check = async () => ({
    live: true,
    eventType: 'live',
    streamId: 'yeni-yayin',
    contentId: 'yeni-yayin',
    title: 'Yeni yayın',
    profileImage: 'https://files.kick.com/avatar.png',
    url: 'https://kick.com/ornek'
  });

  const watcher = (await app.stores.liveStreams.read())[0];
  const result = await app.services.liveStreams.checkWatcher(watcher, { now: Date.now() });

  assert.equal(result.announced, true);
  assert.equal(cardOptions.platform, 'kick');
  assert.equal(cardOptions.eventType, 'live');
  assert.equal(cardOptions.avatarUrl, 'https://files.kick.com/avatar.png');
  assert.equal(cardOptions.targetUrl, 'https://kick.com/ornek');
  assert.match(sent[0].text, /https:\/\/cards\.example\/live-kick\.png/);
  assert.doesNotMatch(sent[0].text, /!\[Yayın bannerı\]/);
});

test('YouTube yeni videosu bir kez duyurulur, aynı video tekrarlanmaz', async () => {
  const { app, sent } = createApp({
    id: 2,
    active: true,
    platform: 'youtube',
    source: 'UC1234567890123456789012',
    channelId: '44',
    name: 'Video Kanalı',
    pollMinutes: 3,
    isLive: false,
    lastAnnouncedId: 'eski-video',
    lastSeenContentId: 'eski-video',
    hasSuccessfulCheck: true
  });
  app.services.liveStreams.check = async () => ({
    live: false,
    eventType: 'video',
    streamId: 'yeni-video',
    contentId: 'yeni-video',
    title: 'Yeni video',
    url: 'https://www.youtube.com/watch?v=yeni-video'
  });

  let watcher = (await app.stores.liveStreams.read())[0];
  const first = await app.services.liveStreams.checkWatcher(watcher, { now: Date.now() });
  watcher = (await app.stores.liveStreams.read())[0];
  const second = await app.services.liveStreams.checkWatcher(watcher, { now: Date.now() + 1000 });

  assert.equal(first.announced, true);
  assert.equal(second.announced, false);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /yeni bir video paylaştı/i);
  assert.equal((await app.stores.liveStreams.read())[0].lastSeenContentId, 'yeni-video');
});

test('YouTube ilk görülen eski videoyu başlangıç kabul eder ve duyurmaz', async () => {
  const { app, sent } = createApp({
    id: 3,
    active: true,
    platform: 'youtube',
    source: 'UC1234567890123456789012',
    channelId: '44',
    name: 'Video Kanalı',
    pollMinutes: 3,
    isLive: false,
    lastAnnouncedId: null,
    lastSeenContentId: null,
    hasSuccessfulCheck: false
  });
  app.services.liveStreams.check = async () => ({
    live: false,
    eventType: 'video',
    streamId: 'mevcut-video',
    contentId: 'mevcut-video',
    title: 'Mevcut video',
    url: 'https://www.youtube.com/watch?v=mevcut-video'
  });

  const watcher = (await app.stores.liveStreams.read())[0];
  const result = await app.services.liveStreams.checkWatcher(watcher, { now: Date.now() });

  assert.equal(result.announced, false);
  assert.equal(result.baseline, true);
  assert.equal(sent.length, 0);
  assert.equal((await app.stores.liveStreams.read())[0].lastSeenContentId, 'mevcut-video');
});

test('elle YouTube kontrolü yeni videoyu tüketmez, zamanlayıcı yine duyurur', async () => {
  const { app, sent } = createApp({
    id: 4,
    active: true,
    platform: 'youtube',
    source: 'UC1234567890123456789012',
    channelId: '44',
    name: 'Video Kanalı',
    pollMinutes: 3,
    isLive: false,
    lastAnnouncedId: 'eski-video',
    lastSeenContentId: 'eski-video',
    hasSuccessfulCheck: true
  });
  app.services.liveStreams.check = async () => ({
    live: false,
    eventType: 'video',
    streamId: 'yeni-video',
    contentId: 'yeni-video',
    title: 'Yeni video',
    url: 'https://www.youtube.com/watch?v=yeni-video'
  });

  let watcher = (await app.stores.liveStreams.read())[0];
  const manual = await app.services.liveStreams.checkWatcher(watcher, {
    announce: false,
    now: Date.now()
  });
  watcher = (await app.stores.liveStreams.read())[0];
  const scheduled = await app.services.liveStreams.checkWatcher(watcher, {
    announce: true,
    now: Date.now() + 1000
  });

  assert.equal(manual.announced, false);
  assert.equal(scheduled.announced, true);
  assert.equal(sent.length, 1);
});
