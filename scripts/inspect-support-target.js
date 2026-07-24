const path = require('node:path');
const Logger = require('../src/core/Logger');
const TopluyoClient = require('../src/core/TopluyoClient');
const RoleService = require('../src/services/RoleService');
const ChannelResolverService = require('../src/services/ChannelResolverService');
const { loadConfiguration } = require('../src/config');
const { findObject } = require('../src/utils/api');

const projectRoot = path.resolve(__dirname, '..');
const { config, token } = loadConfiguration(projectRoot);
const logger = new Logger(path.join(projectRoot, 'logs'));
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
const inspectionKeepAlive = setInterval(() => {}, 1000);

(async () => {
  const groupId = Number(config.defaultGroupId);
  const roles = new RoleService({ client, logger });
  const channels = new ChannelResolverService({ client, logger });
  const botUserId = await client.getCurrentUserId({ force: true });
  const [groupResult, roleRows, channelRows, memberResult] = await Promise.all([
    client.getGroup(groupId),
    roles.list(groupId, { force: true }),
    channels.list(groupId, { force: true }),
    client.getMember(groupId, botUserId)
  ]);
  const member = findObject(memberResult, ['member', 'user']) || {};
  const botRoleIds = roles.extractRoleIds(member);
  const botRoles = roleRows.filter((role) => botRoleIds.includes(Number(role.id)));
  const permissionFields = ['power_group', 'power_role', 'power_channel', 'power_post', 'power_member'];
  const hasManagementPower = botRoles.some((role) => permissionFields.every((field) => Number(role.raw?.[field] ?? role[field]) === 1));
  const group = findObject(groupResult, ['group', 'info']) || groupResult;
  console.log(JSON.stringify({
    groupId,
    groupName: group?.name || group?.title || group?.nick || null,
    groupNick: group?.nick || group?.slug || group?.group_nick || null,
    botUserId,
    botRoleIds,
    botRoles: botRoles.map((role) => ({ id: role.id, name: role.name })),
    hasManagementPower,
    roleCount: roleRows.length,
    channelCount: channelRows.length
  }, null, 2));
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => clearInterval(inspectionKeepAlive));
