const path = require('node:path');
const Logger = require('./core/Logger');
const JsonStore = require('./core/JsonStore');
const TopluyoClient = require('./core/TopluyoClient');
const CommandRouter = require('./core/CommandRouter');
const PluginManager = require('./core/PluginManager');
const PermissionManager = require('./core/PermissionManager');
const GroupResolver = require('./core/GroupResolver');
const GroupSettingsService = require('./services/GroupSettingsService');
const RoleService = require('./services/RoleService');
const AuditService = require('./services/AuditService');
const WarningService = require('./services/WarningService');
const CardService = require('./services/CardService');
const SchedulerService = require('./services/SchedulerService');
const InteractionService = require('./services/InteractionService');
const CommandMenuService = require('./services/CommandMenuService');
const MenuSettingsService = require('./services/MenuSettingsService');
const ChannelResolverService = require('./services/ChannelResolverService');
const SupportTemplateService = require('./services/SupportTemplateService');
const WelcomeService = require('./services/WelcomeService');
const ProvisioningService = require('./services/ProvisioningService');
const BackupService = require('./services/BackupService');
const SystemHealthService = require('./services/SystemHealthService');
const ApiManagementService = require('./services/ApiManagementService');
const ProgressService = require('./services/ProgressService');
const LevelingService = require('./services/LevelingService');
const { loadConfiguration } = require('./config');

const projectRoot = path.resolve(__dirname, '..');
const logger = new Logger(path.join(projectRoot, 'logs'));

async function main() {
  const { config, token } = loadConfiguration(projectRoot);
  const oneShotSupportAction = process.env.TOPLYBOT_SUPPORT_REBUILD || '';
  const oneShotSupportRebuild = ['TAM SIFIRLA', 'KURULUMU TAMAMLA'].includes(oneShotSupportAction);
  const client = new TopluyoClient({
    token,
    logger,
    websocketUrl: config.connection.websocketUrl,
    websocketOrigin: config.connection.websocketOrigin,
    websocketUserAgent: config.connection.websocketUserAgent,
    handshakeTimeoutMs: config.connection.handshakeTimeoutMs,
    websocketHeaders: config.connection.websocketHeaders,
    api: config.api
  });
  const permissionManager = new PermissionManager(config);
  const groupResolver = new GroupResolver(config);
  const router = new CommandRouter({
    prefix: config.prefix,
    permissionManager,
    replyUnknownCommand: Boolean(config.features.replyUnknownCommand),
    logger
  });

  const stores = {
    tickets: new JsonStore(path.join(projectRoot, 'data', 'tickets.json'), []),
    transfers: new JsonStore(path.join(projectRoot, 'data', 'transfers.json'), []),
    settings: new JsonStore(path.join(projectRoot, 'data', 'group-settings.json'), {}),
    warnings: new JsonStore(path.join(projectRoot, 'data', 'warnings.json'), {}),
    levels: new JsonStore(path.join(projectRoot, 'data', 'levels.json'), {}),
    registrations: new JsonStore(path.join(projectRoot, 'data', 'registrations.json'), []),
    sanctions: new JsonStore(path.join(projectRoot, 'data', 'sanctions.json'), []),
    audit: new JsonStore(path.join(projectRoot, 'data', 'audit.json'), []),
    bans: new JsonStore(path.join(projectRoot, 'data', 'bans.json'), []),
    tempRoles: new JsonStore(path.join(projectRoot, 'data', 'temporary-roles.json'), []),
    giveaways: new JsonStore(path.join(projectRoot, 'data', 'giveaways.json'), []),
    polls: new JsonStore(path.join(projectRoot, 'data', 'polls.json'), []),
    rolePanels: new JsonStore(path.join(projectRoot, 'data', 'role-panels.json'), []),
    ticketPanels: new JsonStore(path.join(projectRoot, 'data', 'ticket-panels.json'), []),
    customCommands: new JsonStore(path.join(projectRoot, 'data', 'custom-commands.json'), {}),
    automations: new JsonStore(path.join(projectRoot, 'data', 'automations.json'), []),
    webhooks: new JsonStore(path.join(projectRoot, 'data', 'webhooks.json'), []),
    feeds: new JsonStore(path.join(projectRoot, 'data', 'social-feeds.json'), []),
    liveStreams: new JsonStore(path.join(projectRoot, 'data', 'live-streams.json'), []),
    statistics: new JsonStore(path.join(projectRoot, 'data', 'statistics.json'), []),
    embeds: new JsonStore(path.join(projectRoot, 'data', 'embeds.json'), {}),
    interactions: new JsonStore(path.join(projectRoot, 'data', 'interactions.json'), []),
    commandMenus: new JsonStore(path.join(projectRoot, 'data', 'command-menus.json'), []),
    backups: new JsonStore(path.join(projectRoot, 'data', 'backups.json'), []),
    templateInstallations: new JsonStore(path.join(projectRoot, 'data', 'template-installations.json'), {}),
    maintenanceState: new JsonStore(path.join(projectRoot, 'data', 'maintenance-state.json'), {})
  };

  const app = {
    projectRoot,
    config,
    logger,
    client,
    router,
    stores,
    permissionManager,
    groupResolver,
    services: {}
  };

  app.services.settings = new GroupSettingsService({ store: stores.settings, config });
  app.services.scheduler = new SchedulerService({ logger });
  app.services.cards = new CardService({ projectRoot, config, logger });
  await app.services.cards.start();
  app.services.roles = new RoleService({ client, logger });
  app.services.warnings = new WarningService({ store: stores.warnings });
  app.services.audit = new AuditService({
    store: stores.audit,
    settings: app.services.settings,
    client,
    logger
  });

  app.services.interactions = new InteractionService({ store: stores.interactions, app });
  app.services.channels = new ChannelResolverService({ client, logger });
  app.services.menuSettings = new MenuSettingsService({ app });
  app.services.welcome = new WelcomeService({ app });
  app.services.provisioning = new ProvisioningService({ app });
  app.services.backups = new BackupService({ app, maxPerGroup: config.maintenance?.maxBackupsPerGroup || 20 });
  app.services.supportTemplate = new SupportTemplateService({ app });
  app.services.systemHealth = new SystemHealthService({ app });
  app.services.apiManagement = new ApiManagementService({ app });
  app.services.progress = new ProgressService({ app });
  app.services.leveling = new LevelingService({ app });
  app.services.commandMenu = new CommandMenuService({ store: stores.commandMenus, app });

  const pluginManager = new PluginManager({
    app,
    pluginDirectory: path.join(__dirname, 'plugins')
  });
  app.plugins = pluginManager;
  if (!oneShotSupportRebuild) pluginManager.load(config.plugins);

  client.on('message', (message) => {
    router.handle(message, app).catch((error) => {
      logger.error('Gelen mesaj komut yönlendiricisinde işlenemedi.', error);
    });
  });

  client.on('connected', () => {
    if (oneShotSupportRebuild) {
      logger.ready('🧨 Destek sunucusu tam yeniden kurulumu başlatıldı.');
      queueMicrotask(async () => {
        const groupId = Number(config.defaultGroupId);
        const ownerUserId = Number(config.supportTemplate?.ownerUserId || config.ownerUserIds?.[0]);
        try {
          const result = oneShotSupportAction === 'KURULUMU TAMAMLA'
            ? await app.services.supportTemplate.resumeRebuild({
              groupId,
              userId: ownerUserId,
              confirmation: oneShotSupportAction
            })
            : await app.services.supportTemplate.rebuild({
              groupId,
              userId: ownerUserId,
              confirmation: oneShotSupportAction
            });
          const summary = [
            '✅ Destek sunucusu tam yeniden kuruldu.',
            `${Object.keys(result.channels).length} kanal • ${Object.keys(result.roles).length} rol`,
            `${result.levelRewards?.created?.length || 0} SVG seviye rozeti`,
            `Silinen: ${result.rebuild?.deletedChannels || 0} kanal • ${result.rebuild?.deletedRoles || 0} rol`,
            result.verification?.ok ? 'Doğrulama başarılı.' : `Uyarılar: ${(result.verification?.issues || []).join(' • ')}`
          ].join('\n');
          await client.sendPost(result.channels.commands, summary).catch(() => {});
          await client.sendDirectMessage(ownerUserId, summary).catch(() => {});
          logger.ready(summary.replace(/\n/g, ' • '));
          await shutdown('ONE_SHOT_SUPPORT_REBUILD', 0);
        } catch (error) {
          logger.error('Destek sunucusu tam yeniden kurulamadı.', error);
          await client.sendDirectMessage(ownerUserId, `⚠️ Destek sunucusu yeniden kurulamadı: ${error.message}`).catch(() => {});
          await shutdown('ONE_SHOT_SUPPORT_REBUILD_FAILED', 1);
        }
      });
      return;
    }
    logger.ready('✅ ToplyBot aktif ve kullanıma hazır!');
    // İlk komutta bekleme yaşanmaması için bilinen sunucuların sık kullanılan kaynaklarını arka planda ısıt.
    queueMicrotask(async () => {
      try {
        const storedGroupIds = await app.services.settings.listGroupIds();
        const groupIds = [...new Set([config.defaultGroupId, ...storedGroupIds].map(Number).filter((id) => Number.isInteger(id) && id > 0))];
        for (const groupId of groupIds) {
          Promise.allSettled([
            app.services.channels.prime(groupId),
            app.services.roles.list(groupId),
            client.getGroup(groupId)
          ]).then(() => logger.info('Sunucu hızlı önbelleği hazırlandı.', { groupId }));
        }
      } catch (error) {
        logger.warn('Başlangıç önbelleği hazırlanamadı.', { message: error.message });
      }
    });
  });
  client.on('auth_problem', () => logger.error('Bot başlatılamadı: token geçersiz.'));
  client.on('handshake_rejected', (detail) => {
    logger.error('WebSocket handshake reddedildi. `npm run diagnose` komutunu çalıştırın.', detail);
  });
  client.on('error', () => {});

  const shutdown = async (signal, exitCode = 0) => {
    logger.info(`Kapatma sinyali alındı: ${signal}`);
    try {
      app.services.scheduler.close();
      await app.services.cards.close();
      await client.disconnect();
    } finally {
      process.exit(exitCode);
    }
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  client.connect();
}

main().catch((error) => {
  logger.error('Bot başlatılamadı.', error);
  process.exitCode = 1;
});
