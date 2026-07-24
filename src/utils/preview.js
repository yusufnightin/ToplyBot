function safePreview(value, maxLength = 900) {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return String(text).replace(/\s+/g, ' ').slice(0, Math.max(50, maxLength));
  } catch {
    return String(value).replace(/\s+/g, ' ').slice(0, Math.max(50, maxLength));
  }
}

module.exports = { safePreview };
