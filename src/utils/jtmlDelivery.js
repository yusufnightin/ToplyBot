const { extractCreatedPostId } = require('./api');
const { composeJtmlPost } = require('./bumote');

function hasJtml(value) {
  return typeof value === 'string' && value.trim().startsWith('~{');
}

async function attachInteractiveMarkup({ client, postId, jtmlCode, logger = null, context = 'JTML' }) {
  if (!hasJtml(jtmlCode)) return false;
  if (!Number.isInteger(Number(postId))) return false;
  if (typeof client.attachBumote !== 'function') {
    throw new TypeError('TopluyoClient.attachBumote metodu bulunamadı.');
  }

  await client.attachBumote(Number(postId), jtmlCode.trim());
  logger?.info?.(`${context} etkileşimleri posta bağlandı.`, { postId: Number(postId) });
  return true;
}

async function sendInteractivePost({
  client,
  channelId,
  text = '',
  jtmlCode = '',
  code = '',
  attach = true,
  logger = null,
  context = 'JTML'
}) {
  const interactive = hasJtml(jtmlCode);
  const postText = interactive ? composeJtmlPost(text, jtmlCode) : String(text ?? '');
  const result = await client.sendPost(channelId, postText, code);
  const postId = extractCreatedPostId(result);
  let attached = false;

  if (interactive && attach && Number.isInteger(postId)) {
    attached = await attachInteractiveMarkup({ client, postId, jtmlCode, logger, context });
  }

  return {
    result,
    postId,
    attached,
    interactive,
    delivery: interactive
      ? (attached ? 'post-text+post-bumote' : 'post-text')
      : 'plain-text'
  };
}

async function updateInteractivePost({
  client,
  postId,
  text = '',
  jtmlCode = '',
  attach = true,
  logger = null,
  context = 'JTML'
}) {
  const interactive = hasJtml(jtmlCode);
  const postText = interactive ? composeJtmlPost(text, jtmlCode) : String(text ?? '');
  const result = await client.updatePost(postId, postText);
  let attached = false;

  if (interactive && attach) {
    attached = await attachInteractiveMarkup({ client, postId, jtmlCode, logger, context });
  }

  return {
    result,
    postId: Number(postId),
    attached,
    interactive,
    delivery: interactive
      ? (attached ? 'post-text+post-bumote' : 'post-text')
      : 'plain-text'
  };
}

module.exports = {
  attachInteractiveMarkup,
  hasJtml,
  sendInteractivePost,
  updateInteractivePost
};
