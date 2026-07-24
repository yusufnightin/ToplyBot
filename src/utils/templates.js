function getPath(object, path) {
  return String(path).split('.').reduce((value, key) => (value == null ? undefined : value[key]), object);
}

function renderTemplate(template, variables = {}) {
  return String(template ?? '').replace(/\{([a-zA-Z0-9_.-]+)\}/g, (match, key) => {
    const value = getPath(variables, key);
    return value === undefined || value === null ? match : String(value);
  });
}

function sanitizeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = { renderTemplate, sanitizeXml, getPath };
