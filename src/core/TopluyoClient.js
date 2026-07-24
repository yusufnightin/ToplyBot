const { EventEmitter } = require('node:events');
const WebSocket = require('ws');
const ApiBatchQueue = require('./ApiBatchQueue');
const { parseTopluyoFrame } = require('../utils/topluyoProtocol');
const { extractCreatedEntityId } = require('../utils/api');
const { assertApiSuccess } = require('../utils/apiResult');

const DEFAULT_WEBSOCKET_URL = 'wss://topluyo.com/!bot';
const DEFAULT_ORIGIN = 'https://topluyo.com';

const { isCloudflareManagedChallenge } = require('../utils/cloudflare');

class TopluyoClient extends EventEmitter {
  constructor({
    token,
    logger,
    websocketUrl = DEFAULT_WEBSOCKET_URL,
    apiBaseUrl = 'https://topluyo.com/',
    websocketOrigin = DEFAULT_ORIGIN,
    websocketUserAgent = `TopluyoBOTJS/1.5.0 topluyo-professional-bot/3.6.0 Node/${process.versions.node}`,
    handshakeTimeoutMs = 15000,
    websocketHeaders = {},
    api = {}
  }) {
    super();
    // Eklentiler aynı istemcinin message olayını dinler. Bu sabit fan-out bir sızıntı değildir;
    // varsayılan 10 sınırı yerine, anormal dinleyici artışını hâlâ görünür tutan güvenli bir eşik kullanılır.
    this.setMaxListeners(32);
    if (typeof token !== 'string' || token.trim().length < 10) {
      throw new TypeError('Geçerli bir Topluyo bot tokenı gerekiyor.');
    }

    this.token = token.trim();
    this.logger = logger;
    this.websocketUrl = websocketUrl;
    this.websocketOrigin = websocketOrigin;
    this.websocketUserAgent = websocketUserAgent;
    this.handshakeTimeoutMs = Math.max(5000, Number(handshakeTimeoutMs) || 15000);
    this.websocketHeaders = websocketHeaders && typeof websocketHeaders === 'object'
      ? { ...websocketHeaders }
      : {};
    this.apiQueue = new ApiBatchQueue({ token: this.token, baseUrl: apiBaseUrl, logger, ...(api || {}) });
    this.socket = null;
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.manualClose = false;
    this.authFailed = false;
    this.lastHandshakeRejection = null;
    this.cloudflareChallengeBlocked = false;
    this.userId = null;
    this.userIdPromise = null;
  }

  buildWebSocketOptions() {
    const headers = {
      'User-Agent': this.websocketUserAgent,
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      ...this.websocketHeaders
    };

    return {
      followRedirects: true,
      handshakeTimeout: this.handshakeTimeoutMs,
      origin: this.websocketOrigin,
      perMessageDeflate: false,
      headers
    };
  }

  connect() {
    if (this.socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(this.socket.readyState)) {
      return;
    }

    this.manualClose = false;
    this.clearReconnectTimer();
    this.lastHandshakeRejection = null;
    this.cloudflareChallengeBlocked = false;

    const socket = new WebSocket(this.websocketUrl, this.buildWebSocketOptions());
    this.socket = socket;

    socket.once('unexpected-response', (_request, response) => {
      const chunks = [];
      let totalLength = 0;
      const maxBodyLength = 4096;

      response.on('data', (chunk) => {
        if (totalLength >= maxBodyLength) return;
        const remaining = maxBodyLength - totalLength;
        const part = Buffer.from(chunk).subarray(0, remaining);
        chunks.push(part);
        totalLength += part.length;
      });

      response.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf8').trim();
        const rejection = {
          statusCode: response.statusCode || 0,
          statusMessage: response.statusMessage || '',
          server: response.headers.server || '',
          cfRay: response.headers['cf-ray'] || '',
          location: response.headers.location || '',
          body: responseBody.slice(0, maxBodyLength)
        };

        this.lastHandshakeRejection = rejection;
        const managedChallenge = isCloudflareManagedChallenge(rejection);
        this.cloudflareChallengeBlocked = managedChallenge;

        const logDetails = {
          statusCode: rejection.statusCode,
          statusMessage: rejection.statusMessage,
          server: rejection.server,
          cfRay: rejection.cfRay,
          location: rejection.location,
          managedChallenge,
          bodyPreview: responseBody.slice(0, 600).replace(/\s+/g, ' ')
        };
        this.logger?.error('Topluyo WebSocket yükseltmesi sunucu tarafından reddedildi.', logDetails);

        if (managedChallenge) {
          this.logger?.error(
            'Cloudflare Managed Challenge, WebSocket bot bağlantısını engelliyor. Bu durum istemci kodundan veya bottan gelen tokendan kaynaklanmaz. Topluyo yöneticisinin /!bot yolunu challenge/bot korumasından hariç tutması gerekir.',
            { cfRay: rejection.cfRay }
          );
        } else if ([401, 403].includes(rejection.statusCode)) {
          this.logger?.warn(
            'Bu hata token gönderilmeden önce oluştu. Origin/User-Agent, VPN/proxy, IP/WAF veya Topluyo WebSocket servisi kontrol edilmelidir.',
            { statusCode: rejection.statusCode, cfRay: rejection.cfRay }
          );
        }

        this.emit('handshake_rejected', { ...rejection, managedChallenge });
      });
    });

    socket.on('open', () => {
      this.lastHandshakeRejection = null;
      this.logger?.info('Topluyo WebSocket bağlantısı açıldı.');
      socket.send(this.token);
      this.startPing();
      this.emit('open');
    });

    socket.on('message', (rawData) => this.handleIncoming(rawData));

    socket.on('close', (code, reasonBuffer) => {
      this.stopPing();
      const reason = reasonBuffer?.toString?.() || '';
      this.logger?.warn('Topluyo WebSocket bağlantısı kapandı.', { code, reason });
      this.emit('close', { code, reason });

      if (!this.manualClose && !this.authFailed && !this.cloudflareChallengeBlocked) {
        this.scheduleReconnect();
      } else if (this.cloudflareChallengeBlocked) {
        this.logger?.warn('Cloudflare challenge devam ettiği için otomatik yeniden bağlantı durduruldu. `npm run diagnose` çıktısındaki CF-Ray bilgisini Topluyo desteğine iletin.');
        this.emit('connection_blocked', {
          type: 'cloudflare_managed_challenge',
          cfRay: this.lastHandshakeRejection?.cfRay || ''
        });
      }
    });

    socket.on('error', (error) => {
      this.logger?.error('Topluyo WebSocket hatası.', error);
      this.emit('error', error);
    });
  }

  handleIncoming(rawData) {
    const parsed = parseTopluyoFrame(rawData);
    const { text } = parsed;
    const message = parsed.value;

    if (message === 'AUTH_PROBLEM') {
      this.authFailed = true;
      this.logger?.error('Topluyo tokenı reddedildi. Cihazlarım bölümünden yeni bot tokenı oluşturun.');
      this.emit('auth_problem');
      return;
    }

    if (message === 'CONNECTED') {
      this.authFailed = false;
      this.reconnectAttempts = 0;
      this.logger?.info('Topluyo bot kimlik doğrulaması başarılı.');
      this.getCurrentUserId().catch((error) => {
        this.logger?.warn('Bot hesabının kullanıcı ID bilgisi başlangıçta alınamadı.', { message: error.message });
      });
      this.emit('connected');
      return;
    }

    if (!message || typeof message !== 'object') {
      this.logger?.warn('Bilinmeyen WebSocket mesajı alındı.', { text: text.slice(0, 1200) });
      this.emit('unknown', message);
      return;
    }

    if (parsed.repaired) {
      this.logger?.info('Topluyo WebSocket çerçevesindeki bozuk JSON güvenli biçimde onarıldı.', {
        action: message.action || '',
        format: parsed.format,
        postId: message.post_id || null
      });
    }

    if (message.action === 'post/bumote' && message.protocol?.attachmentEcho) {
      // Eski /post/bumote çağrılarının sunucu yankısıdır; kullanıcı etkileşimi değildir.
      // Native JTML artık doğrudan post.text içinde gönderildiğinden konsolu kirletme.
      this.emit('bumote_attachment', message);
      return;
    }

    this.emit('message', message);
    if (typeof message.action === 'string') {
      this.emit(`action:${message.action}`, message);
    }
  }

  scheduleReconnect() {
    this.clearReconnectTimer();
    this.reconnectAttempts += 1;

    const statusCode = this.lastHandshakeRejection?.statusCode || 0;
    const isHandshakeAccessDenied = statusCode === 401 || statusCode === 403;
    const exponential = Math.min(30000, 1000 * (2 ** Math.min(this.reconnectAttempts - 1, 5)));
    const baseDelay = isHandshakeAccessDenied ? Math.max(30000, exponential) : exponential;
    const delay = baseDelay + Math.floor(Math.random() * 1000);

    this.logger?.info('Topluyo bağlantısı yeniden denenecek.', {
      delayMs: delay,
      attempt: this.reconnectAttempts,
      handshakeStatus: statusCode || undefined
    });
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
    this.reconnectTimer.unref?.();
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.ping();
      }
    }, 30000);
    this.pingTimer.unref?.();
  }

  stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  api(api, data = {}, options = {}) {
    return this.apiQueue.request(api, data, options);
  }

  apiMetrics() {
    return this.apiQueue.getMetrics();
  }

  clearApiCache() {
    return this.apiQueue.clearCache();
  }

  async getCurrentUserId({ force = false } = {}) {
    if (!force && Number.isInteger(this.userId) && this.userId > 0) return this.userId;
    if (!force && this.userIdPromise) return this.userIdPromise;

    this.userIdPromise = this.api('/!api/user/id', {})
      .then((result) => {
        assertApiSuccess(result, 'Bot kullanıcı ID sorgusu');
        const id = extractCreatedEntityId(result, ['user_id', 'userId', 'id']);
        if (!Number.isInteger(id) || id <= 0) {
          throw new Error(`Bot kullanıcı ID değeri API cevabından çıkarılamadı: ${JSON.stringify(result).slice(0, 300)}`);
        }
        this.userId = id;
        this.logger?.info('Topluyo bot kullanıcı ID bilgisi alındı.', { userId: id });
        return id;
      })
      .finally(() => { this.userIdPromise = null; });

    return this.userIdPromise;
  }

  setChannelOptions(channelId, options = {}) {
    const id = Number(channelId);
    if (!Number.isInteger(id) || id <= 0) {
      return Promise.reject(new TypeError('Geçerli kanal ID gerekli.'));
    }
    return this.api('/!api/channel/options/set', { channel_id: id, ...options }, { priority: 'critical', flushImmediately: true });
  }

  async grantChannelAccess(channelId, userId, { read = true, write = true, control = false } = {}) {
    const id = Number(userId);
    if (!Number.isInteger(id) || id <= 0) throw new TypeError('Geçerli kullanıcı ID gerekli.');

    // Yetkileri ayrı çağrılarla ve yazma yetkisi önce olacak şekilde gönderiyoruz.
    // Böylece backend tek işlem alanı işlese veya okuma yetkisi zaten mevcut olsa bile
    // botun mesaj göndermesi için kritik olan write-plus işlemi kaybolmaz.
    const operations = [];
    if (write) operations.push(['write', { add_write_plus_user_id: id }]);
    if (read) operations.push(['read', { add_read_plus_user_id: id }]);
    if (control) operations.push(['control', { add_control_plus_user_id: id }]);
    if (!operations.length) return { channelId: Number(channelId), userId: id, operations: [] };

    const settled = [];
    for (const [permission, options] of operations) {
      const result = await this.setChannelOptions(channelId, options);
      try {
        assertApiSuccess(result, `Kanal ${permission} erişimi güncelleme`);
        settled.push({ permission, status: 'updated', result });
      } catch (error) {
        // Aynı kullanıcı daha önce plus listesine eklenmişse Topluyo bazı sürümlerde
        // hata/uyarı döndürebilir. Bu durum erişimin zaten var olduğu anlamına gelir.
        if (/(?:already|exists?|mevcut|zaten|ekli|duplicate)/i.test(error.message)) {
          settled.push({ permission, status: 'already-present', result });
          continue;
        }
        throw error;
      }
    }

    return { channelId: Number(channelId), userId: id, operations: settled };
  }

  sendPost(channelId, text, code = '') {
    const id = Number(channelId);
    if (!Number.isInteger(id) || id <= 0) {
      return Promise.reject(new TypeError('Geçerli kanal ID gerekli.'));
    }
    return this.api('/!api/post/add', { channel_id: id, text: String(text), code }, { priority: 'critical', flushImmediately: true });
  }

  attachBumote(postId, code) {
    if (!Number.isInteger(Number(postId))) {
      return Promise.reject(new TypeError('Geçerli post ID gerekli.'));
    }
    if (typeof code !== 'string' || !code.trim()) {
      return Promise.reject(new TypeError('Bumote kodu gerekli.'));
    }
    return this.api('/!api/post/bumote', { post_id: Number(postId), code: code.trim() }, { priority: 'critical', flushImmediately: true });
  }

  updatePost(postId, text) {
    if (!Number.isInteger(Number(postId))) {
      return Promise.reject(new TypeError('Geçerli post ID gerekli.'));
    }
    return this.api('/!api/post/set', { post_id: Number(postId), text: String(text) }, { priority: 'critical', flushImmediately: true });
  }

  getPost(postId) {
    if (!Number.isInteger(Number(postId))) {
      return Promise.reject(new TypeError('Geçerli post ID gerekli.'));
    }
    return this.api('/!api/post/get', { post_id: Number(postId) }, { cacheTtlMs: 2000 });
  }

  sendDirectMessage(userId, message) {
    if (!Number.isInteger(Number(userId))) {
      return Promise.reject(new TypeError('Geçerli kullanıcı ID gerekli.'));
    }
    return this.api('/!api/message/send', { user_id: Number(userId), message: String(message) }, { priority: 'critical', flushImmediately: true });
  }

  listRoles(groupId, options = {}) {
    return this.api('/!api/role/list', { group_id: groupId }, { cacheTtlMs: 10000, ...options });
  }

  getMember(groupId, userId) {
    return this.api('/!api/member/get', { group_id: groupId, user_id: Number(userId) }, { cacheTtlMs: 3000 });
  }

  setMemberRoles(groupId, userId, roleIds) {
    const normalized = [...new Set(roleIds.map(Number).filter(Number.isInteger))];
    return this.api('/!api/member/role/set', {
      group_id: groupId,
      user_id: Number(userId),
      role_ids: normalized.join(',')
    }, { priority: 'critical', flushImmediately: true });
  }

  kickMember(groupId, userId) {
    return this.api('/!api/member/kick', { group_id: groupId, user_id: Number(userId) }, { priority: 'critical', flushImmediately: true });
  }

  deletePost(postId) {
    return this.api('/!api/post/del', { post_id: Number(postId) }, { priority: 'critical', flushImmediately: true });
  }

  getGroup(groupId) {
    return this.api('/!api/group/get', { id: Number(groupId) }, { cacheTtlMs: 10000 });
  }

  getGroupByNick(groupNick) {
    const nick = String(groupNick || '').trim();
    if (!nick) return Promise.reject(new TypeError('Geçerli bir sunucu kısa adı gerekli.'));
    return this.api('/!api/group/get', { nick }, { cacheTtlMs: 10000 });
  }

  joinGroup(groupId) {
    const id = Number(groupId);
    if (!Number.isInteger(id) || id <= 0) {
      return Promise.reject(new TypeError('Geçerli bir sunucu ID gerekli.'));
    }
    return this.api('/!api/group/join', { group_id: id }, {
      priority: 'critical',
      flushImmediately: true
    });
  }

  getUser(userId) {
    return this.api('/!api/user/info', { id: Number(userId) }, { cacheTtlMs: 10000 });
  }

  listMembers(groupId) {
    return this.api('/!api/member/list', { group_id: Number(groupId) }, { cacheTtlMs: 5000 });
  }

  listOnline(groupId) {
    return this.api('/!api/group/online', { group_id: Number(groupId) }, { cacheTtlMs: 2500 });
  }

  listChannels(groupId, options = {}) {
    return this.api('/!api/channel/list', { group_id: Number(groupId) }, { cacheTtlMs: 10000, ...options });
  }

  getChannel(channelId) {
    return this.api('/!api/channel/get', { channel_id: Number(channelId) }, { cacheTtlMs: 5000 });
  }

  getChannelByNick(dataOrGroupNick, channelNick = null) {
    const data = dataOrGroupNick && typeof dataOrGroupNick === 'object'
      ? { ...dataOrGroupNick }
      : { group_nick: String(dataOrGroupNick || ''), channel_nick: String(channelNick || '') };
    return this.api('/!api/channel/show/info', data, { cacheTtlMs: 5000 });
  }

  sortChannels(groupId, channelIds) {
    const ids = Array.isArray(channelIds) ? channelIds : String(channelIds || '').split(',');
    const normalized = [...new Set(ids.map(Number).filter(Number.isInteger))];
    return this.api('/!api/channel/sort', {
      group_id: Number(groupId),
      channel_ids: normalized.join(',')
    }, { priority: 'high', flushImmediately: true });
  }

  createChannel(data) {
    return this.api('/!api/channel/add', data, { priority: 'high', flushImmediately: true });
  }

  deleteChannel(channelId) {
    return this.api('/!api/channel/del', { channel_id: Number(channelId) }, { priority: 'critical', flushImmediately: true });
  }

  createRole(data) {
    return this.api('/!api/role/add', data, { priority: 'high', flushImmediately: true });
  }

  deleteRole(roleId) {
    return this.api('/!api/role/del', { role_id: Number(roleId) }, { priority: 'critical', flushImmediately: true });
  }

  updateRole(data) {
    return this.api('/!api/role/set', data, { priority: 'high', flushImmediately: true });
  }

  sortRoles(groupId, roleIds) {
    const ids = Array.isArray(roleIds) ? roleIds : String(roleIds || '').split(',');
    const normalized = [...new Set(ids.map(Number).filter(Number.isInteger))];
    return this.api('/!api/role/sort', {
      group_id: Number(groupId),
      role_ids: normalized.join(',')
    }, { priority: 'high', flushImmediately: true });
  }

  listPosts(channelId, { after = 0, before = 999999999 } = {}) {
    return this.api('/!api/post/list', { channel_id: channelId, after, before }, { cacheTtlMs: 2000 });
  }

  getGroupFounder(groupId) {
    return this.api('/!api/group/founder', { group_id: Number(groupId) });
  }

  setGroupHome(groupId, home) {
    return this.api('/!api/group/set/home', { group_id: Number(groupId), home: String(home) }, { priority: 'high', flushImmediately: true });
  }

  setGroupPermissions(groupId, permissions = {}) {
    return this.api('/!api/group/set/permissions', { group_id: Number(groupId), ...permissions }, { priority: 'high', flushImmediately: true });
  }

  setGroupProfile(groupId, profile = {}) {
    return this.api('/!api/group/set/profile', { group_id: Number(groupId), ...profile }, { priority: 'high', flushImmediately: true });
  }

  setGroupSocials(groupId, socials = {}) {
    return this.api('/!api/group/set/socials', { group_id: Number(groupId), ...socials }, { priority: 'high', flushImmediately: true });
  }

  listJoinRequests(groupId) {
    return this.api('/!api/group/joinlist', { group_id: Number(groupId) }, { cacheTtlMs: 2000 });
  }

  acceptJoinRequest(groupId, userId) {
    return this.api('/!api/member/waiter/accept', { group_id: Number(groupId), user_id: Number(userId) }, { priority: 'critical', flushImmediately: true });
  }

  rejectJoinRequest(groupId, userId) {
    return this.api('/!api/member/waiter/reject', { group_id: Number(groupId), user_id: Number(userId) }, { priority: 'critical', flushImmediately: true });
  }

  getChannelDetail(channelId) {
    return this.api('/!api/channel/detail', { channel_id: Number(channelId) }, { cacheTtlMs: 5000 });
  }

  updateChannel(data) {
    return this.api('/!api/channel/set', data, { priority: 'high', flushImmediately: true });
  }

  getRole(roleId) {
    return this.api('/!api/role/get', { role_id: Number(roleId) }, { cacheTtlMs: 5000 });
  }

  getGroupPower(groupId, userId) {
    return this.api('/!api/permission/power', { group_id: Number(groupId), user_id: Number(userId) }, { cacheTtlMs: 3000 });
  }

  getChannelPower(channelId, userId) {
    return this.api('/!api/permission/channel', { channel_id: Number(channelId), user_id: Number(userId) }, { cacheTtlMs: 3000 });
  }

  listBadges(groupId) {
    return this.api('/!api/badge/list', { group_id: Number(groupId) }, { cacheTtlMs: 10000 });
  }

  createBadge(data) {
    return this.api('/!api/badge/add', data, { priority: 'high', flushImmediately: true });
  }

  giveBadge(badgeId, userId) {
    return this.api('/!api/badge/give', { badge_id: Number(badgeId), user_id: Number(userId) }, { priority: 'high', flushImmediately: true });
  }

  listCrews(groupId) {
    return this.api('/!api/crew/list', { group_id: Number(groupId) }, { cacheTtlMs: 10000 });
  }

  createCrew(data) {
    return this.api('/!api/crew/add', data, { priority: 'high', flushImmediately: true });
  }

  updateCrew(data) {
    return this.api('/!api/crew/set', data, { priority: 'high', flushImmediately: true });
  }

  deleteCrew(crewId) {
    return this.api('/!api/crew/del', { crew_id: Number(crewId) }, { priority: 'critical', flushImmediately: true });
  }

  sortCrews(groupId, crewIds) {
    const ids = Array.isArray(crewIds) ? crewIds : String(crewIds || '').split(',');
    return this.api('/!api/crew/sort', { group_id: Number(groupId), crew_ids: [...new Set(ids.map(Number).filter(Number.isInteger))].join(',') }, { priority: 'high', flushImmediately: true });
  }

  listTeams(groupId) {
    return this.api('/!api/team/list', { group_id: Number(groupId) }, { cacheTtlMs: 10000 });
  }

  getServerTime() {
    return this.api('/!api/test/time', {}, { cacheTtlMs: 0, bypassCache: true, flushImmediately: true });
  }

  getRemoteIp() {
    return this.api('/!api/test/ip', {}, { cacheTtlMs: 30000 });
  }

  listUsers(userIds) {
    const normalized = [...new Set((Array.isArray(userIds) ? userIds : String(userIds || '').split(',')).map(Number).filter(Number.isInteger))].slice(0, 100);
    return this.api('/!api/user/list', { user_ids: normalized.join(',') }, { cacheTtlMs: 5000 });
  }

  blockUser(userId) {
    return this.api('/!api/user/block', { user_id: Number(userId) }, { priority: 'critical', flushImmediately: true });
  }

  unblockUser(userId) {
    return this.api('/!api/user/unblock', { user_id: Number(userId) }, { priority: 'critical', flushImmediately: true });
  }

  async disconnect() {
    this.manualClose = true;
    this.clearReconnectTimer();
    this.stopPing();
    await this.apiQueue.close({ drain: true });

    if (this.socket && this.socket.readyState < WebSocket.CLOSING) {
      this.socket.close(1000, 'Bot kapatıldı');
    }
  }
}

module.exports = TopluyoClient;
module.exports.isCloudflareManagedChallenge = isCloudflareManagedChallenge;
