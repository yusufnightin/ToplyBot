const { extractCreatedPostId } = require('../utils/api');
const { buildCommandMenuBumote, composeJtmlPost } = require('../utils/bumote');

const DEFAULT_LONG_COMMANDS = new Set([
  'destekşablon', 'sistemonar', 'sistemkontrol', 'yedek', 'hizlandir',
  'apionbellek', 'apistres', 'sunucuozet', 'bekleyentoplu', 'kanalkopyala',
  'rolkopyala', 'kanalsırala', 'rolsırala', 'destekkur', 'welcometamir',
  'seviyerozetpaket', 'seviyesenkron'
]);

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

class ProgressController {
  constructor({ service, channelId, command, userId, updateHook = null }) {
    this.service = service;
    this.channelId = channelId;
    this.command = command;
    this.userId = Number(userId);
    this.updateHook = typeof updateHook === 'function' ? updateHook : null;
    this.postId = null;
    this.unupdatable = false;
    this.started = false;
    this.finished = false;
    this.lastUpdateAt = 0;
    this.pendingTimer = null;
    this.pendingSnapshot = null;
    this.snapshot = {
      percent: 0,
      title: `${service.iconFor(command)} ${command.name}`,
      status: 'Hazırlanıyor…',
      detail: '',
      tone: 'primary'
    };
  }

  async start({ percent = 5, status = 'İşlem sıraya alındı.', detail = '' } = {}) {
    if (this.started) return this;
    this.started = true;
    await this.update(percent, status, detail, { force: true });
    return this;
  }

  async update(percent, status = '', detail = '', { force = false, tone = null } = {}) {
    if (this.finished && clampPercent(percent) < 100) return this;
    this.snapshot = {
      ...this.snapshot,
      percent: clampPercent(percent),
      status: String(status || this.snapshot.status || ''),
      detail: String(detail || ''),
      tone: tone || this.snapshot.tone || 'primary'
    };

    const now = Date.now();
    const throttleMs = this.service.config().updateThrottleMs;
    if (!force && now - this.lastUpdateAt < throttleMs) {
      this.pendingSnapshot = { ...this.snapshot };
      if (!this.pendingTimer) {
        this.pendingTimer = setTimeout(() => {
          this.pendingTimer = null;
          const snapshot = this.pendingSnapshot;
          this.pendingSnapshot = null;
          if (snapshot) this.publish(snapshot).catch((error) => {
            this.service.logger?.warn?.('İlerleme göstergesi güncellenemedi.', { message: error.message });
          });
        }, Math.max(10, throttleMs - (now - this.lastUpdateAt)));
        this.pendingTimer.unref?.();
      }
      return this;
    }
    await this.publish(this.snapshot);
    return this;
  }

  async publish(snapshot) {
    this.lastUpdateAt = Date.now();
    if (this.updateHook) {
      await this.updateHook({ ...snapshot });
      return;
    }
    if (this.channelId === undefined || this.channelId === null || this.unupdatable) return;
    const jtml = this.service.render(snapshot, this.command);
    const text = composeJtmlPost('', jtml);
    if (!Number.isInteger(this.postId)) {
      const result = await this.service.client.sendPost(this.channelId, text);
      this.postId = extractCreatedPostId(result);
      if (!Number.isInteger(this.postId)) {
        this.unupdatable = true;
        this.service.logger?.warn?.('İlerleme post ID değeri alınamadığı için canlı güncelleme kapatıldı.', {
          command: this.command.name,
          channelId: this.channelId
        });
      }
      return;
    }
    await this.service.client.updatePost(this.postId, text);
  }

  async complete(status = 'İşlem başarıyla tamamlandı.', detail = '') {
    this.finished = true;
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
    this.pendingSnapshot = null;
    await this.update(100, status, detail, { force: true, tone: 'success' });
    return this;
  }

  async fail(error) {
    this.finished = true;
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
    this.pendingSnapshot = null;
    const detail = String(error?.message || error || 'Bilinmeyen hata').slice(0, 300);
    await this.update(100, 'İşlem tamamlanamadı.', detail, { force: true, tone: 'danger' }).catch(() => {});
    return this;
  }
}

class ProgressService {
  constructor({ app }) {
    this.app = app;
    this.client = app.client;
    this.logger = app.logger;
  }

  config() {
    const custom = this.app.config.progress || {};
    return {
      enabled: custom.enabled !== false,
      menuOnly: Boolean(custom.menuOnly),
      updateThrottleMs: Math.max(150, Number(custom.updateThrottleMs) || 350),
      longCommands: new Set([
        ...DEFAULT_LONG_COMMANDS,
        ...(Array.isArray(custom.longCommands) ? custom.longCommands.map((item) => String(item).toLocaleLowerCase('tr-TR')) : [])
      ])
    };
  }

  iconFor(command) {
    if (command.category === 'Moderasyon') return '🛡️';
    if (command.category === 'Yönetim') return '⚙️';
    if (command.category === 'Ticket') return '🎫';
    if (command.category === 'Seviye') return '⭐';
    if (command.category === 'Rozet') return '🏅';
    return '⏳';
  }

  shouldTrack(command, message = {}) {
    const config = this.config();
    if (!config.enabled || command.progress === false) return false;
    if (command.progress === true || command.longRunning === true) return true;
    if (config.menuOnly && !message.interaction) return false;
    return config.longCommands.has(String(command.name).toLocaleLowerCase('tr-TR'));
  }

  createController({ channelId, command, userId, updateHook = null }) {
    return new ProgressController({ service: this, channelId, command, userId, updateHook });
  }

  render(snapshot, command) {
    return buildCommandMenuBumote({
      header: [
        { text: '⚡ ToplyBot İşlem Merkezi', ui: 'muted', size: 1.12 },
        { text: `${this.iconFor(command)} ${command.name} çalıştırılıyor`, ui: 'muted' }
      ],
      progress: snapshot,
      footerNote: 'Bu kart aynı mesaj üzerinde güncellenir; işlem bitene kadar komutu tekrar çalıştırma.'
    });
  }
}

module.exports = ProgressService;
module.exports.ProgressController = ProgressController;
module.exports.clampPercent = clampPercent;
