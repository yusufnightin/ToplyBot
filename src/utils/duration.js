const UNIT_MS = Object.freeze({
  ms: 1,
  s: 1000,
  sn: 1000,
  sec: 1000,
  m: 60_000,
  dk: 60_000,
  min: 60_000,
  h: 3_600_000,
  sa: 3_600_000,
  d: 86_400_000,
  g: 86_400_000,
  w: 604_800_000,
  hf: 604_800_000
});

function parseDuration(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const result = Math.floor(value);
    return result >= min && result <= max ? result : null;
  }

  const input = String(value || '').trim().toLocaleLowerCase('tr-TR');
  if (!input) return null;
  if (/^\d+$/.test(input)) {
    const numeric = Number(input);
    return numeric >= min && numeric <= max ? numeric : null;
  }

  const pattern = /(\d+(?:\.\d+)?)\s*(ms|sn|sec|dk|min|sa|hf|s|m|h|d|g|w)/g;
  let total = 0;
  let matchedLength = 0;
  let match;
  while ((match = pattern.exec(input)) !== null) {
    total += Number(match[1]) * UNIT_MS[match[2]];
    matchedLength += match[0].replace(/\s+/g, '').length;
  }
  if (!total || matchedLength !== input.replace(/\s+/g, '').length) return null;
  const result = Math.floor(total);
  return result >= min && result <= max ? result : null;
}

function formatDuration(milliseconds) {
  let remaining = Math.max(0, Math.floor(Number(milliseconds) || 0));
  const parts = [];
  for (const [label, size] of [['gün', 86_400_000], ['saat', 3_600_000], ['dk', 60_000], ['sn', 1000]]) {
    const count = Math.floor(remaining / size);
    if (count > 0) {
      parts.push(`${count} ${label}`);
      remaining %= size;
    }
    if (parts.length >= 2) break;
  }
  return parts.join(' ') || '0 sn';
}

module.exports = { parseDuration, formatDuration };
