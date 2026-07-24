const HTML_ENTITY_MAP = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'"
};

function decodeHtml(value) {
  return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39);/gi, (match, entity) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith('#x')) {
      const code = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (normalized.startsWith('#')) {
      const code = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return HTML_ENTITY_MAP[normalized] ?? match;
  });
}

function stripTags(value) {
  return decodeHtml(String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function parseAttributes(source) {
  const attributes = {};
  const pattern = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(String(source ?? ''))) !== null) {
    const key = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? true;
    attributes[key] = value === true ? true : decodeHtml(value);
  }
  return attributes;
}

function parseSingleHtmlForm(html) {
  const source = String(html ?? '').trim();
  const forms = [...source.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)];
  if (forms.length !== 1) {
    return { form: null, submit: '', formCount: forms.length };
  }

  const body = forms[0][1];
  const form = {};
  let submit = '';

  for (const input of body.matchAll(/<input\b([^>]*)>/gi)) {
    const attrs = parseAttributes(input[1]);
    const name = attrs.name;
    if (!name || attrs.disabled === true) continue;
    const type = String(attrs.type || 'text').toLowerCase();
    if (['submit', 'button', 'reset', 'file'].includes(type)) continue;
    if (['checkbox', 'radio'].includes(type) && attrs.checked !== true) continue;
    form[name] = attrs.value === true || attrs.value === undefined ? '' : String(attrs.value);
  }

  for (const textarea of body.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const attrs = parseAttributes(textarea[1]);
    if (!attrs.name || attrs.disabled === true) continue;
    form[attrs.name] = stripTags(textarea[2]);
  }

  for (const select of body.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const attrs = parseAttributes(select[1]);
    if (!attrs.name || attrs.disabled === true) continue;
    const options = [...select[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)];
    const selected = options.find((option) => parseAttributes(option[1]).selected === true) || options[0];
    if (!selected) continue;
    const optionAttrs = parseAttributes(selected[1]);
    form[attrs.name] = optionAttrs.value === undefined || optionAttrs.value === true
      ? stripTags(selected[2])
      : String(optionAttrs.value);
  }

  for (const button of body.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    const attrs = parseAttributes(button[1]);
    const type = String(attrs.type || 'submit').toLowerCase();
    if (attrs.disabled === true || type !== 'submit') continue;
    if (attrs.name) {
      form[attrs.name] = attrs.value === undefined || attrs.value === true
        ? stripTags(button[2])
        : String(attrs.value);
    }
    submit = stripTags(button[2]);
    break;
  }

  return { form, submit, formCount: 1 };
}


function countNativeJtmlTypes(node, counters = { bumoteCount: 0, inputCount: 0 }) {
  if (!node || typeof node !== 'object') return counters;
  if (Array.isArray(node)) {
    for (const item of node) countNativeJtmlTypes(item, counters);
    return counters;
  }
  if (node.type === 'bumote') counters.bumoteCount += 1;
  if (node.type === 'input') counters.inputCount += 1;
  if (Array.isArray(node.children)) countNativeJtmlTypes(node.children, counters);
  return counters;
}

function parseNativeJtmlMarkup(value) {
  const source = String(value ?? '').trim();
  const nodes = [];
  let cursor = 0;

  while (cursor < source.length) {
    const start = source.indexOf('~{', cursor);
    if (start < 0) break;

    let index = start + 2;
    let depth = 1;
    let inString = false;
    let escaped = false;

    while (index < source.length && depth > 0) {
      const char = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
      }
      index += 1;
    }

    if (depth !== 0) break;
    const block = source.slice(start + 1, index);
    const parsed = tryParseJson(block);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) nodes.push(parsed);
    cursor = index;
  }

  const counters = countNativeJtmlTypes(nodes);
  return {
    nodes,
    blockCount: nodes.length,
    bumoteCount: counters.bumoteCount,
    inputCount: counters.inputCount
  };
}

function tryParseJson(value) {
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function tryParseQuery(value) {
  const source = String(value ?? '').trim().replace(/^\?/, '');
  if (!source || !source.includes('=')) return null;
  try {
    const params = new URLSearchParams(source);
    const form = {};
    for (const [key, fieldValue] of params.entries()) {
      form[key] = fieldValue;
    }
    return Object.keys(form).length ? { form, submit: '' } : null;
  } catch {
    return null;
  }
}

function stripOuterQuotes(value) {
  const source = String(value ?? '').trim();
  if (source.length >= 2 && source.startsWith('"') && source.endsWith('"')) {
    return source.slice(1, -1);
  }
  return source;
}

function repairMalformedMessageFrame(text) {
  const source = String(text ?? '').trim();
  const keyMatch = /"message"\s*:\s*/.exec(source);
  if (!keyMatch) return null;

  const valueStart = keyMatch.index + keyMatch[0].length;
  const tailPattern = /,\s*"(?:group_id|channel_id|post_id|user_id|transfer_id)"\s*:/g;
  const candidates = [];
  tailPattern.lastIndex = valueStart;
  let match;
  while ((match = tailPattern.exec(source)) !== null) candidates.push(match.index);

  for (let index = 0; index < candidates.length; index += 1) {
    const tailIndex = candidates[index];
    const rawMessage = stripOuterQuotes(source.slice(valueStart, tailIndex));
    const repaired = `${source.slice(0, valueStart)}${JSON.stringify(rawMessage)}${source.slice(tailIndex)}`;
    const parsed = tryParseJson(repaired);
    if (parsed && typeof parsed === 'object') {
      return { value: parsed, rawMessage, repaired: true };
    }
  }

  return null;
}

function normalizeBumoteMessage(event) {
  if (!event || event.action !== 'post/bumote') return { value: event, format: 'json' };
  if (event.message && typeof event.message === 'object' && !Array.isArray(event.message)) {
    return { value: event, format: event.message.form ? 'form-object' : 'object' };
  }

  const raw = String(event.message ?? '').trim();
  const candidates = [raw];
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded !== raw) candidates.push(decoded);
  } catch {}

  for (const candidate of candidates) {
    const nested = tryParseJson(candidate);
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      event.message = nested.form || nested.submit !== undefined
        ? nested
        : { form: nested, submit: '' };
      event.protocol = { ...(event.protocol || {}), messageFormat: 'nested-json' };
      return { value: event, format: 'nested-json' };
    }
  }

  if (raw.includes('~{')) {
    const parsedJtml = parseNativeJtmlMarkup(raw);
    if (parsedJtml.blockCount > 0) {
      event.message = { form: null, submit: '', jtml: raw };
      event.protocol = {
        ...(event.protocol || {}),
        messageFormat: 'native-jtml-markup',
        attachmentEcho: true,
        jtmlBlockCount: parsedJtml.blockCount,
        bumoteCount: parsedJtml.bumoteCount,
        inputCount: parsedJtml.inputCount
      };
      return { value: event, format: 'native-jtml-markup' };
    }
  }

  if (/<form\b/i.test(raw)) {
    const parsedForm = parseSingleHtmlForm(raw);
    if (parsedForm.form) {
      event.message = { form: parsedForm.form, submit: parsedForm.submit, raw };
      event.protocol = { ...(event.protocol || {}), messageFormat: 'single-form-html', formCount: 1 };
      return { value: event, format: 'single-form-html' };
    }

    event.message = { form: null, submit: '', jtml: raw };
    event.protocol = {
      ...(event.protocol || {}),
      messageFormat: 'bumote-markup',
      formCount: parsedForm.formCount,
      attachmentEcho: true
    };
    return { value: event, format: 'bumote-markup' };
  }

  for (const candidate of candidates) {
    const query = tryParseQuery(candidate);
    if (query) {
      event.message = query;
      event.protocol = { ...(event.protocol || {}), messageFormat: 'query-string' };
      return { value: event, format: 'query-string' };
    }
  }

  event.message = { form: null, submit: '', raw };
  event.protocol = { ...(event.protocol || {}), messageFormat: 'raw-string' };
  return { value: event, format: 'raw-string' };
}

function parseTopluyoFrame(rawData) {
  const text = Buffer.isBuffer(rawData) ? rawData.toString('utf8') : String(rawData ?? '');
  let value = tryParseJson(text);
  let repaired = false;

  if (value === null) {
    const repairedFrame = repairMalformedMessageFrame(text);
    if (repairedFrame) {
      value = repairedFrame.value;
      repaired = true;
      value.protocol = { ...(value.protocol || {}), repairedMalformedJson: true };
    } else {
      return { value: text, text, repaired: false, format: 'unparsed' };
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const normalized = normalizeBumoteMessage(value);
    return { value: normalized.value, text, repaired, format: normalized.format };
  }

  return { value, text, repaired, format: 'json' };
}

module.exports = {
  decodeHtml,
  parseAttributes,
  parseNativeJtmlMarkup,
  parseSingleHtmlForm,
  parseTopluyoFrame,
  repairMalformedMessageFrame
};
