const { tokenize } = require('../utils/text');
const { sendInteractivePost } = require('../utils/jtmlDelivery');

class CommandRouter {
  constructor({ prefix = '!', permissionManager, adminUserIds = [], replyUnknownCommand = false, logger }) {
    this.prefix = prefix;
    this.permissionManager = permissionManager || {
      has: (userId, required) => required === 'member' || adminUserIds.map(Number).includes(Number(userId)),
      name: (userId) => (adminUserIds.map(Number).includes(Number(userId)) ? 'admin' : 'member'),
      level: (userId) => (adminUserIds.map(Number).includes(Number(userId)) ? 20 : 0),
      isStaff: (userId) => adminUserIds.map(Number).includes(Number(userId))
    };
    this.replyUnknownCommand = replyUnknownCommand;
    this.logger = logger;
    this.commands = new Map();
    this.aliases = new Map();
    this.cooldowns = new Map();
  }

  register(command) {
    if (!command || typeof command.name !== 'string' || typeof command.execute !== 'function') {
      throw new TypeError('Komut name ve execute alanlarını içermelidir.');
    }

    const name = command.name.trim().toLocaleLowerCase('tr-TR');
    if (!name) throw new TypeError('Komut adı boş olamaz.');
    if (this.commands.has(name)) throw new Error(`Komut zaten kayıtlı: ${name}`);

    // Ana komut adları takma adlardan her zaman daha önceliklidir. Önceki bir
    // eklenti aynı kelimeyi alias olarak kaydettiyse alias sessizce kaldırılır;
    // böylece eklenti yükleme sırası botun açılıp açılmamasını etkilemez.
    if (this.aliases.has(name)) {
      const previousCommandName = this.aliases.get(name);
      this.aliases.delete(name);
      const previousCommand = this.commands.get(previousCommandName);
      if (previousCommand) {
        previousCommand.aliases = (previousCommand.aliases || [])
          .filter((alias) => alias.toLocaleLowerCase('tr-TR') !== name);
      }
      this.logger?.warn?.('Komut adı mevcut bir takma adın yerine geçti.', {
        command: name,
        previousCommand: previousCommandName
      });
    }

    const requestedAliases = [...new Set((command.aliases || [])
      .map((alias) => String(alias || '').trim().toLocaleLowerCase('tr-TR'))
      .filter((alias) => alias && alias !== name))];

    const normalized = {
      description: 'Açıklama yok.',
      usage: name,
      aliases: [],
      category: 'Genel',
      requiredPermission: command.adminOnly ? 'admin' : 'member',
      guildOnly: false,
      dmOnly: false,
      hidden: false,
      cooldownMs: 1500,
      ...command,
      name,
      aliases: []
    };

    this.commands.set(name, normalized);
    for (const normalizedAlias of requestedAliases) {
      if (this.commands.has(normalizedAlias)) {
        this.logger?.warn?.('Komut takma adı başka bir ana komutla çakıştığı için atlandı.', {
          command: name,
          alias: normalizedAlias,
          conflict: normalizedAlias
        });
        continue;
      }
      if (this.aliases.has(normalizedAlias)) {
        const conflict = this.aliases.get(normalizedAlias);
        if (conflict !== name) {
          this.logger?.warn?.('Komut takma adı başka bir komut tarafından kullanıldığı için atlandı.', {
            command: name,
            alias: normalizedAlias,
            conflict
          });
        }
        continue;
      }
      this.aliases.set(normalizedAlias, name);
      normalized.aliases.push(normalizedAlias);
    }
    return normalized;
  }

  getCommand(name) {
    const normalized = String(name).toLocaleLowerCase('tr-TR');
    return this.commands.get(normalized) || this.commands.get(this.aliases.get(normalized));
  }

  list({ userId = null, includeHidden = false, includeAdmin = false } = {}) {
    return [...this.commands.values()].filter((command) => {
      if (command.hidden && !includeHidden) return false;
      if (includeAdmin) return true;
      if (userId === null) return command.requiredPermission === 'member';
      return this.permissionManager.has(userId, command.requiredPermission);
    });
  }

  isAdmin(userId) {
    return this.permissionManager.has(userId, 'admin');
  }

  canRun(command, userId) {
    const key = `${command.name}:${userId}`;
    const now = Date.now();
    const availableAt = this.cooldowns.get(key) || 0;
    if (availableAt > now) return { allowed: false, remainingMs: availableAt - now };
    this.cooldowns.set(key, now + Math.max(0, command.cooldownMs || 0));
    return { allowed: true, remainingMs: 0 };
  }

  async handle(message, app) {
    const supportedActions = new Set(['post/add', 'post/mention', 'message/send']);
    if (!supportedActions.has(message?.action) || typeof message.message !== 'string') return false;

    const content = message.message.trim();
    if (!content.startsWith(this.prefix)) return false;

    const tokens = tokenize(content.slice(this.prefix.length).trim());
    const commandName = tokens.shift()?.toLocaleLowerCase('tr-TR');
    if (!commandName) return false;

    const command = this.getCommand(commandName);
    const context = this.createContext(message, tokens, app);

    if (!command) {
      if (this.replyUnknownCommand) await context.reply(`Bilinmeyen komut: ${this.prefix}${commandName}`);
      return true;
    }

    if (!this.permissionManager.has(message.user_id, command.requiredPermission)) {
      await context.reply(`Bu komut için ${command.requiredPermission} yetkisi gerekiyor.`);
      return true;
    }

    if (command.guildOnly && context.groupId === null) {
      await context.reply('Bu komut yalnızca bir Topluyo grubunda kullanılabilir. Kanal-grup eşlemesini config.json içinde tanımlayın.');
      return true;
    }

    if (command.dmOnly && context.channelId !== undefined && context.channelId !== null) {
      await context.reply('Bu komut yalnızca özel mesajda kullanılabilir.');
      return true;
    }

    const cooldown = this.canRun(command, message.user_id);
    if (!cooldown.allowed) {
      await context.reply(`Bu komutu tekrar kullanmak için ${Math.ceil(cooldown.remainingMs / 1000)} saniye bekle.`);
      return true;
    }

    const progress = app.services.progress?.createController?.({
      channelId: context.channelId,
      command,
      userId: context.userId,
      updateHook: message.interaction?.progressHook || null
    }) || null;
    context.progress = progress;
    const trackProgress = Boolean(progress && app.services.progress.shouldTrack(command, message));

    try {
      if (trackProgress) {
        await progress.start({ percent: 6, status: 'Komut hazırlanıyor…' });
        await progress.update(18, 'Yetki ve sunucu bağlamı doğrulandı.');
      }
      await command.execute(context);
      if (trackProgress) await progress.complete('Komut başarıyla tamamlandı.');
    } catch (error) {
      if (trackProgress) await progress.fail(error);
      const errorId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      this.logger?.error(`Komut çalıştırılırken hata oluştu: ${command.name}`, {
        errorId,
        message: error.message,
        stack: error.stack,
        groupId: context.groupId,
        channelId: context.channelId,
        userId: context.userId,
        args: context.args
      });
      const ownerDetail = this.permissionManager.has(message.user_id, 'owner')
        ? `\nHata: ${String(error.message || error).slice(0, 500)}`
        : '';
      await context.reply(`Komut çalıştırılırken hata oluştu. Hata kodu: ${errorId}${ownerDetail}`);
    }
    return true;
  }

  createContext(message, args, app) {
    const groupId = app.groupResolver?.resolve(message) ?? message.group_id ?? null;
    const reply = async (text, code = '') => {
      if (message.channel_id !== undefined && message.channel_id !== null) {
        return app.client.sendPost(message.channel_id, text, code);
      }
      return app.client.sendDirectMessage(message.user_id, text);
    };

    const replyJtml = async (text, jtmlCode, code = '') => {
      if (message.channel_id === undefined || message.channel_id === null) {
        await app.client.sendDirectMessage(message.user_id, text);
        return { postId: null, attached: false, delivery: 'direct-message' };
      }
      return sendInteractivePost({
        client: app.client,
        channelId: message.channel_id,
        text,
        jtmlCode,
        code,
        attach: app.config.interactions?.attachBumote !== false,
        logger: app.logger,
        context: 'Komut yanıtı JTML'
      });
    };

    return {
      app,
      client: app.client,
      router: this,
      config: app.config,
      logger: app.logger,
      stores: app.stores,
      services: app.services,
      message,
      args,
      userId: Number(message.user_id),
      channelId: message.channel_id,
      groupId,
      permission: this.permissionManager.name(message.user_id),
      permissionLevel: this.permissionManager.level(message.user_id),
      isAdmin: this.permissionManager.has(message.user_id, 'admin'),
      isModerator: this.permissionManager.has(message.user_id, 'moderator'),
      reply,
      replyJtml
    };
  }
}

module.exports = CommandRouter;
