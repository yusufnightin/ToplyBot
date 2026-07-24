const { parseMaybeJson } = require('./api');

function explicitApiError(value, depth = 0, seen = new Set()) {
  const node = parseMaybeJson(value);
  if (depth > 6 || node === null || node === undefined) return null;

  if (node === false) return 'API false sonucu döndürdü.';

  if (typeof node === 'string') {
    const text = node.trim();
    if (/^(?:error|failed|failure|unauthorized|forbidden)\b/i.test(text)) return text;
    return null;
  }
  if (typeof node !== 'object' || seen.has(node)) return null;
  seen.add(node);

  if (node.success === false || node.ok === false) {
    return String(node.error || node.message || node.status || 'API işlemi başarısız oldu.');
  }

  const statusCode = Number(node.status_code ?? node.statusCode ?? node.http_code ?? node.httpCode);
  if (Number.isInteger(statusCode) && statusCode >= 400) {
    return String(node.error || node.message || `API durum kodu ${statusCode}`);
  }

  const status = String(node.status ?? '').trim().toLowerCase();
  if (['error', 'failed', 'failure', 'unauthorized', 'forbidden'].includes(status)) {
    return String(node.error || node.message || status);
  }

  if (node.error !== undefined && node.error !== null && node.error !== false && node.error !== '') {
    if (typeof node.error === 'string') return node.error;
    if (Array.isArray(node.error) && node.error.length) return node.error.map(String).join(', ');
    if (typeof node.error === 'object' && Object.keys(node.error).length) {
      return String(node.error.message || node.error.text || JSON.stringify(node.error));
    }
    if (node.error === true) return String(node.message || 'API hata döndürdü.');
  }

  if (Array.isArray(node.errors) && node.errors.length) {
    return node.errors.map((item) => (typeof item === 'string' ? item : item?.message || JSON.stringify(item))).join(', ');
  }

  for (const key of ['data', 'result', 'response', 'payload', 'body']) {
    if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
    const nested = explicitApiError(node[key], depth + 1, seen);
    if (nested) return nested;
  }
  return null;
}

function assertApiSuccess(value, context = 'Topluyo API işlemi') {
  const message = explicitApiError(value);
  if (message) {
    const error = new Error(`${context} başarısız: ${message}`);
    error.apiResult = value;
    throw error;
  }
  return value;
}

module.exports = { assertApiSuccess, explicitApiError };
