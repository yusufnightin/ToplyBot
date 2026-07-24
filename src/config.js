const fs = require('node:fs');
const path = require('node:path');

const REMOVED_PLUGIN_IDS = new Set(['economy', 'invites']);

const MANAGEMENT_PLUGIN_ALLOWLIST = new Set([
  'core',
  'settings',
  'roles',
  'welcome',
  'moderation',
  'registration',
  'support',
  'customCommands',
  'automation',
  'statistics',
  'interactions',
  'embeds',
  'admin',
  'apiManagement',
  'system',
  'leveling',
  'liveStreams'
]);

function applyPluginProfile(config) {
  const profile = String(config.pluginProfile || 'management').trim().toLowerCase();
  if (!['management', 'custom'].includes(profile)) {
    throw new Error('config.json içindeki pluginProfile yalnızca "management" veya "custom" olabilir.');
  }

  config.pluginProfile = profile;
  config.plugins = [...new Set(config.plugins
    .map((name) => String(name).trim())
    .filter((name) => name && !REMOVED_PLUGIN_IDS.has(name)))];
  if (profile === 'management') {
    config.plugins = config.plugins.filter((name) => MANAGEMENT_PLUGIN_ALLOWLIST.has(name));
  }

  if (profile === 'management') {
    // Eski config.json dosyalarında liste eksik olsa bile temel yönetim ve karşılama
    // akışları her zaman yüklenir. Profil yalnızca eğlence eklentilerini filtreler.
    const required = ['core', 'settings', 'welcome', 'apiManagement', 'system', 'leveling', 'liveStreams'];
    config.plugins = [...required, ...config.plugins.filter((name) => !required.includes(name))];
  } else if (!config.plugins.includes('core')) {
    config.plugins.unshift('core');
  }
  return config;
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`${label} okunamadı (${filePath}): ${error.message}`);
  }
}

function ensureIdArray(config, key) {
  if (!Array.isArray(config[key])) throw new Error(`config.json içindeki ${key} alanı dizi olmalıdır.`);
  config[key] = [...new Set(config[key].map(Number).filter(Number.isInteger))];
}

function loadConfiguration(projectRoot) {
  const configPath = path.join(projectRoot, 'config.json');
  const tokenPath = path.join(projectRoot, '.token.json');

  if (!fs.existsSync(configPath)) throw new Error('config.json bulunamadı. config.example.json dosyasını kopyalayın.');
  if (!fs.existsSync(tokenPath)) throw new Error('.token.json bulunamadı. .token.json.example dosyasını kopyalayın.');

  const config = readJson(configPath, 'Yapılandırma');
  const token = readJson(tokenPath, 'Token');
  if (typeof token !== 'string' || token.trim().length < 10) {
    throw new Error('.token.json yalnızca token metnini içeren geçerli bir JSON string olmalıdır.');
  }

  const merged = {
    prefix: '!',
    pluginProfile: 'management',
    ownerUserIds: [],
    adminUserIds: [],
    moderatorUserIds: [],
    defaultGroupId: null,
    channelGroups: {},
    plugins: ['core'],
    channels: {},
    serverDefaults: {},
    connection: {
      websocketUrl: 'wss://topluyo.com/!bot',
      websocketOrigin: 'https://topluyo.com',
      websocketUserAgent: `TopluyoBOTJS/1.5.0 topluyo-professional-bot/3.7.0 Node/${process.versions.node}`,
      handshakeTimeoutMs: 15000,
      websocketHeaders: {}
    },
    features: {},
    interactions: { autoGenerateBumote: true, attachBumote: true },
    supportTemplate: { ownerUserId: null, levelRoleAssetDirectory: '', operationDelayMs: 180 },
    maintenance: { maxBackupsPerGroup: 20 },
    api: {
      flushIntervalMs: 35,
      maxBatchSize: 40,
      maxConcurrentBatches: 1,
      timeoutMs: 15000,
      retryAttempts: 2,
      retryBaseDelayMs: 250,
      rateLimitRetryAttempts: 6,
      rateLimitBaseDelayMs: 2000,
      rateLimitMaxDelayMs: 30000,
      cacheTtlMs: 5000,
      maxCacheEntries: 1000,
      maxQueuedRequests: 2000
    },
    progress: {
      enabled: true,
      menuOnly: false,
      updateThrottleMs: 350,
      longCommands: []
    },
    liveStreams: {
      defaultMention: '@millet',
      defaultPollMinutes: 3,
      defaultTemplate: '{mention}\n🔴 {name} şu anda {platform} üzerinde canlı!\n{title}\n👉 {url}',
      defaultVideoTemplate: '{mention}\n▶️ {name} yeni bir video paylaştı!\n{title}\n👉 {url}',
      timeoutMs: 12000,
      kick: { clientId: '', clientSecret: '', accessToken: '' },
      twitch: { clientId: '', clientSecret: '', accessToken: '' },
      youtube: { apiKey: '' }
    },
    commandMenu: {
      enabled: true,
      openOnBarePrefix: true,
      ownerOnly: true,
      sessionMinutes: 10,
      commandsPerPage: 7,
      settingsPerPage: 8,
      showQuickRun: true,
      showTextSummary: true,
      accentColor: '#ff83c8'
    },
    ...config
  };

  if (!Array.isArray(merged.plugins) || merged.plugins.length === 0) {
    throw new Error('config.json içindeki plugins alanı boş olmayan bir dizi olmalıdır.');
  }
  applyPluginProfile(merged);
  if (merged.plugins.includes('embeds') && !merged.plugins.includes('interactions')) {
    merged.plugins.splice(merged.plugins.indexOf('embeds'), 0, 'interactions');
  }
  merged.interactions = { autoGenerateBumote: true, attachBumote: true, ...(merged.interactions || {}) };
  merged.supportTemplate = {
    ownerUserId: null,
    levelRoleAssetDirectory: '',
    operationDelayMs: 180,
    ...(merged.supportTemplate || {})
  };
  merged.api = {
    flushIntervalMs: 35, maxBatchSize: 40, maxConcurrentBatches: 1, timeoutMs: 15000,
    retryAttempts: 2, retryBaseDelayMs: 250,
    rateLimitRetryAttempts: 6, rateLimitBaseDelayMs: 2000, rateLimitMaxDelayMs: 30000,
    cacheTtlMs: 5000,
    maxCacheEntries: 1000, maxQueuedRequests: 2000, ...(merged.api || {})
  };
  merged.progress = {
    enabled: true,
    menuOnly: false,
    updateThrottleMs: 350,
    longCommands: [],
    ...(merged.progress || {})
  };
  merged.liveStreams = {
    defaultMention: '@millet',
    defaultPollMinutes: 3,
    defaultTemplate: '{mention}\n🔴 {name} şu anda {platform} üzerinde canlı!\n{title}\n👉 {url}',
    defaultVideoTemplate: '{mention}\n▶️ {name} yeni bir video paylaştı!\n{title}\n👉 {url}',
    timeoutMs: 12000,
    ...(merged.liveStreams || {}),
    kick: { clientId: '', clientSecret: '', accessToken: '', ...(merged.liveStreams?.kick || {}) },
    twitch: { clientId: '', clientSecret: '', accessToken: '', ...(merged.liveStreams?.twitch || {}) },
    youtube: { apiKey: '', ...(merged.liveStreams?.youtube || {}) }
  };
  if (merged.supportTemplate.ownerUserId !== null && merged.supportTemplate.ownerUserId !== '') {
    const templateOwnerId = Number(merged.supportTemplate.ownerUserId);
    if (!Number.isInteger(templateOwnerId) || templateOwnerId <= 0) {
      throw new Error('config.json içindeki supportTemplate.ownerUserId geçerli bir kullanıcı ID olmalıdır.');
    }
    merged.supportTemplate.ownerUserId = templateOwnerId;
  }
  merged.commandMenu = {
    enabled: true,
    openOnBarePrefix: true,
    ownerOnly: true,
    sessionMinutes: 10,
    commandsPerPage: 7,
    settingsPerPage: 8,
    showQuickRun: true,
    showTextSummary: true,
    accentColor: '#ff83c8',
    ...(merged.commandMenu || {})
  };
  if (merged.commandMenu.enabled && !merged.plugins.includes('interactions')) {
    const coreIndex = merged.plugins.indexOf('core');
    merged.plugins.splice(coreIndex >= 0 ? coreIndex + 1 : 0, 0, 'interactions');
  }
  ensureIdArray(merged, 'ownerUserIds');
  ensureIdArray(merged, 'adminUserIds');
  ensureIdArray(merged, 'moderatorUserIds');
  if (!merged.connection || typeof merged.connection !== 'object' || Array.isArray(merged.connection)) {
    throw new Error('config.json içindeki connection alanı nesne olmalıdır.');
  }
  merged.connection = {
    websocketUrl: 'wss://topluyo.com/!bot',
    websocketOrigin: 'https://topluyo.com',
    websocketUserAgent: `TopluyoBOTJS/1.5.0 topluyo-professional-bot/3.7.0 Node/${process.versions.node}`,
    handshakeTimeoutMs: 15000,
    websocketHeaders: {},
    ...merged.connection
  };

  if (!merged.channelGroups || typeof merged.channelGroups !== 'object' || Array.isArray(merged.channelGroups)) {
    throw new Error('config.json içindeki channelGroups alanı nesne olmalıdır.');
  }

  return { config: merged, token: token.trim() };
}

module.exports = { MANAGEMENT_PLUGIN_ALLOWLIST, applyPluginProfile, loadConfiguration };
