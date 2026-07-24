const WRAPPER_KEYS = new Set([
  'data', 'result', 'response', 'payload', 'value', 'body',
  'ok', 'success', 'status', 'status_code', 'code', 'message', 'error', 'errors'
]);

const ENTITY_HINT_KEYS = new Set([
  'id', 'channel_id', 'channelId', 'role_id', 'roleId', 'user_id', 'userId',
  'group_id', 'groupId', 'post_id', 'postId', 'nick', 'name', 'title', 'text', 'type'
]);

function parseMaybeJson(value, maxDepth = 3) {
  let current = value;
  for (let depth = 0; depth < maxDepth && typeof current === 'string'; depth += 1) {
    const text = current.trim();
    if (!text || (!text.startsWith('{') && !text.startsWith('[') && !text.startsWith('"'))) break;
    try {
      current = JSON.parse(text);
    } catch {
      break;
    }
  }
  return current;
}

function looksLikeWrapper(object, key) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return false;
  const keys = Object.keys(object);
  if (!Object.prototype.hasOwnProperty.call(object, key)) return false;
  if (keys.length === 1) return true;

  // Kanal nesnelerinde `data` gerçek bir kanal alanıdır. id/nick/title gibi
  // varlık alanları varsa nesneyi API zarfı sanıp `data` içine inmeyiz.
  if (keys.some((item) => ENTITY_HINT_KEYS.has(item))) return false;
  return keys.every((item) => WRAPPER_KEYS.has(item) || /^meta(?:data)?$/i.test(item));
}

function unwrapApiResult(value) {
  let current = parseMaybeJson(value);
  const visited = new Set();

  while (current && typeof current === 'object' && !Array.isArray(current) && !visited.has(current)) {
    visited.add(current);
    let unwrapped = false;
    for (const key of ['data', 'result', 'response', 'payload', 'value', 'body']) {
      if (!looksLikeWrapper(current, key)) continue;
      current = parseMaybeJson(current[key]);
      unwrapped = true;
      break;
    }
    if (!unwrapped) break;
  }
  return parseMaybeJson(current);
}

function findArray(value, preferredKeys = []) {
  const root = unwrapApiResult(value);
  if (Array.isArray(root)) return root.map(parseMaybeJson);
  if (!root || typeof root !== 'object') return [];

  for (const key of preferredKeys) {
    const candidate = unwrapApiResult(root[key]);
    if (Array.isArray(candidate)) return candidate.map(parseMaybeJson);
    if (candidate && typeof candidate === 'object') {
      const numeric = Object.entries(candidate)
        .filter(([entryKey]) => /^\d+$/.test(entryKey))
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([, item]) => parseMaybeJson(item));
      if (numeric.length) return numeric;
    }
  }

  const arrayValue = Object.values(root)
    .map((item) => unwrapApiResult(item))
    .find(Array.isArray);
  if (arrayValue) return arrayValue.map(parseMaybeJson);

  const numericEntries = Object.entries(root)
    .filter(([key]) => /^\d+$/.test(key))
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, item]) => parseMaybeJson(item));
  return numericEntries.length > 0 ? numericEntries : [];
}

function findObject(value, preferredKeys = []) {
  const root = unwrapApiResult(value);
  if (!root || typeof root !== 'object' || Array.isArray(root)) return null;

  for (const key of preferredKeys) {
    const candidate = unwrapApiResult(root[key]);
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) return candidate;
  }
  return root;
}

function toIdArray(value) {
  const parsed = parseMaybeJson(value);
  if (Array.isArray(parsed)) {
    return [...new Set(parsed.map((item) => {
      if (item && typeof item === 'object') return Number(item.id ?? item.role_id ?? item.roleId);
      return Number(item);
    }).filter(Number.isInteger))];
  }

  if (typeof parsed === 'string') {
    return [...new Set(parsed.split(',').map((item) => Number(item.trim())).filter(Number.isInteger))];
  }

  if (Number.isInteger(Number(parsed))) return [Number(parsed)];
  return [];
}

function extractCreatedPostId(value) {
  const visited = new Set();
  const preferredKeys = ['post_id', 'postId', 'id'];
  const containerKeys = ['post', 'data', 'result', 'response', 'payload', 'item'];

  function asId(candidate) {
    if (typeof candidate === 'number') return Number.isInteger(candidate) && candidate > 0 ? candidate : null;
    if (typeof candidate !== 'string') return null;
    const text = candidate.trim();
    if (/^\d+$/.test(text)) {
      const id = Number(text);
      return Number.isInteger(id) && id > 0 ? id : null;
    }
    const match = text.match(/(?:post[_\s-]*id|post)\s*[:=#-]?\s*(\d+)/i);
    return match ? Number(match[1]) : null;
  }

  function walk(input, depth = 0) {
    const node = parseMaybeJson(input);
    if (depth > 8 || node === null || node === undefined) return null;
    const scalarId = asId(node);
    if (scalarId) return scalarId;
    if (typeof node !== 'object' || visited.has(node)) return null;
    visited.add(node);

    for (const key of preferredKeys) {
      if (Object.prototype.hasOwnProperty.call(node, key)) {
        const id = asId(node[key]);
        if (id) return id;
      }
    }
    for (const key of containerKeys) {
      if (Object.prototype.hasOwnProperty.call(node, key)) {
        const id = walk(node[key], depth + 1);
        if (id) return id;
      }
    }
    for (const child of Array.isArray(node) ? node : Object.values(node)) {
      const id = walk(child, depth + 1);
      if (id) return id;
    }
    return null;
  }

  return walk(value);
}

function extractCreatedEntityId(value, preferredKeys = []) {
  const keys = [...new Set([
    ...preferredKeys,
    'id', 'channel_id', 'channelId', 'channelID', 'cid',
    'role_id', 'roleId', 'roleID', 'rid',
    'post_id', 'postId', 'postID',
    'user_id', 'userId', 'group_id', 'groupId',
    'insert_id', 'insertId', 'created_id', 'createdId', 'new_id', 'newId'
  ])];
  const visited = new Set();
  const keyPattern = keys.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

  function scalarId(candidate) {
    if (typeof candidate === 'number') {
      return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : null;
    }
    if (typeof candidate !== 'string') return null;
    const text = candidate.trim();
    if (/^\d+$/.test(text)) {
      const number = Number(text);
      return Number.isSafeInteger(number) && number > 0 ? number : null;
    }

    // Bazı Topluyo uçları yalnızca açıklama veya URL benzeri bir metin döndürüyor.
    const labelled = text.match(new RegExp(`(?:${keyPattern}|kimlik|kanal|rol|post)\\s*[:=#-]?\\s*(\\d+)`, 'i'));
    if (labelled) return Number(labelled[1]);
    const url = text.match(/\/(?:channel|role|post|channels?|roles?|posts?)\/(\d+)(?:\b|\/|$)/i);
    if (url) return Number(url[1]);
    return null;
  }

  function walk(input, depth = 0) {
    const node = parseMaybeJson(input, 5);
    if (depth > 10 || node === null || node === undefined) return null;
    const scalar = scalarId(node);
    if (scalar) return scalar;
    if (typeof node !== 'object' || visited.has(node)) return null;
    visited.add(node);

    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      const id = scalarId(node[key]);
      if (id) return id;
    }

    // Önce varlık taşıma ihtimali yüksek kapsayıcıları tara.
    for (const key of ['channel', 'role', 'post', 'item', 'entity', 'created', 'data', 'result', 'response', 'payload', 'body']) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      const id = walk(node[key], depth + 1);
      if (id) return id;
    }

    for (const child of Array.isArray(node) ? node : Object.values(node)) {
      const id = walk(child, depth + 1);
      if (id) return id;
    }
    return null;
  }

  return walk(value);
}

module.exports = {
  extractCreatedEntityId,
  extractCreatedPostId,
  findArray,
  findObject,
  parseMaybeJson,
  toIdArray,
  unwrapApiResult
};
