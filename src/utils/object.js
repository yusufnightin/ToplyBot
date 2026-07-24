function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isPlainObject(base)) return structuredClone(override);
  const output = structuredClone(base);
  if (!isPlainObject(override)) return output;

  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = deepMerge(output[key], value);
    } else {
      output[key] = structuredClone(value);
    }
  }
  return output;
}

function getPath(object, path, fallback) {
  const keys = Array.isArray(path) ? path : String(path).split('.').filter(Boolean);
  let current = object;
  for (const key of keys) {
    if (!isPlainObject(current) && !Array.isArray(current)) return fallback;
    if (!Object.prototype.hasOwnProperty.call(current, key)) return fallback;
    current = current[key];
  }
  return current;
}

function setPath(object, path, value) {
  const keys = Array.isArray(path) ? path : String(path).split('.').filter(Boolean);
  if (keys.length === 0) throw new TypeError('Ayar yolu boş olamaz.');
  let current = object;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    if (!isPlainObject(current[key])) current[key] = {};
    current = current[key];
  }
  current[keys.at(-1)] = value;
  return object;
}

module.exports = { deepMerge, getPath, isPlainObject, setPath };
