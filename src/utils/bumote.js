function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const VALID_STYLES = new Set(['primary', 'secondary', 'success', 'warning', 'danger', 'ghost']);
const STYLE_BACKGROUNDS = {
  primary: '#7c5cff',
  secondary: '#2b3442',
  success: '#176b52',
  warning: '#6b4f1d',
  danger: '#63313b',
  ghost: '#202735'
};

const SURFACES = {
  root: '#0f1118',
  header: '#171921',
  panel: '#171d26',
  soft: '#1d2430',
  note: '#151922',
  card: '#202633',
  inset: '#161d28'
};

function normalizeStyle(value) {
  const style = String(value || 'primary').toLowerCase();
  return VALID_STYLES.has(style) ? style : 'primary';
}

function cleanAttribute(value, maxLength = 256) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLength);
}

/** Topluyo MarkTop/JTML blok biçimi: ~{"type":"..."} */
function serializeJtml(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    throw new TypeError('JTML kök düğümü bir nesne olmalıdır.');
  }
  return `~${JSON.stringify(node)}`;
}

function createButtonNode({
  name = 'action_id',
  value,
  label,
  style = 'primary',
  disabled = false,
  title = '',
  expand = true
}) {
  if (disabled) {
    return {
      type: 'box',
      ui: 'muted',
      text: cleanAttribute(label, 300),
      background: STYLE_BACKGROUNDS.secondary
    };
  }

  const normalizedStyle = normalizeStyle(style);
  const node = {
    type: 'bumote',
    name: cleanAttribute(name, 64),
    value: cleanAttribute(value, 256),
    text: cleanAttribute(label, 300),
    background: STYLE_BACKGROUNDS[normalizedStyle]
  };
  if (expand) node.ui = 'space';
  if (title) node.title = cleanAttribute(title, 500);
  return node;
}

function createTextNode(text, {
  type = 'box',
  ui = 'muted',
  background = '',
  color = '',
  size = null
} = {}) {
  const node = {
    type: cleanAttribute(type || 'box', 32),
    text: cleanAttribute(text, 1200)
  };
  if (ui) node.ui = cleanAttribute(ui, 96);
  if (background) node.background = cleanAttribute(background, 64);
  if (color) node.color = cleanAttribute(color, 64);
  if (size !== null && size !== undefined) node.size = Number(size);
  return node;
}

function createPanelNode(children, { background = SURFACES.panel, gap = 0.45, ui = 'flex-y' } = {}) {
  return {
    type: 'box',
    ui,
    gap,
    background,
    children: (children || []).filter(Boolean)
  };
}

function renderProgressBar(percent, width = 18) {
  const normalized = Math.max(0, Math.min(100, Number(percent) || 0));
  const size = Math.max(8, Math.min(30, Number(width) || 18));
  const filled = Math.round((normalized / 100) * size);
  return `${'█'.repeat(filled)}${'░'.repeat(size - filled)}  %${Math.round(normalized)}`;
}

function createProgressNode({
  percent = 0,
  title = 'İşlem sürüyor',
  status = '',
  detail = '',
  tone = 'primary'
} = {}) {
  const normalizedTone = normalizeStyle(tone);
  return createPanelNode([
    createTextNode(`⚡ ${title}`, { ui: 'muted', size: 1.08, color: '#f8fafc' }),
    createTextNode(renderProgressBar(percent), {
      ui: 'space',
      background: STYLE_BACKGROUNDS[normalizedTone],
      color: '#f8fafc'
    }),
    status ? createTextNode(status, { ui: 'muted', color: '#cbd5e1' }) : null,
    detail ? createTextNode(detail, { ui: 'muted', color: '#94a3b8', background: SURFACES.inset }) : null
  ], { background: SURFACES.card, gap: 0.32 });
}

function buildJtmlButton(options) {
  return serializeJtml(createButtonNode(options || {}));
}

function buildButtonBumote(actions = []) {
  const children = actions
    .filter((action) => !action.disabled)
    .map((action) => createButtonNode({
      name: 'action_id',
      value: action.id,
      label: action.label,
      style: action.style || 'primary',
      title: action.title || ''
    }));

  return serializeJtml(createPanelNode(children, { ui: 'flex-y', gap: 0.5 }));
}

function createInputNode({
  name = 'value',
  value = '',
  placeholder = '',
  label = '',
  description = '',
  maxLength = 1800
} = {}) {
  const input = {
    type: 'input',
    ui: 'space',
    name: cleanAttribute(name, 64),
    placeholder: cleanAttribute(placeholder, 240),
    maxlength: Math.max(1, Math.min(10000, Number(maxLength) || 1800)),
    background: SURFACES.soft
  };
  const normalizedValue = cleanAttribute(value, input.maxlength);
  if (normalizedValue) {
    input.text = normalizedValue;
    input.value = normalizedValue;
  }

  const children = [];
  if (label) children.push(createTextNode(label, { ui: 'muted', size: 1.02, color: '#f8fafc' }));
  if (description) children.push(createTextNode(description, { ui: 'muted', color: '#94a3b8' }));
  children.push(input);
  return createPanelNode(children, { background: SURFACES.card, gap: 0.3 });
}

function createSearchNode({
  value = '',
  placeholder = 'Komut ara...',
  actionValue = 'search',
  name = 'query',
  buttonLabel = '🔎 Ara',
  buttonStyle = 'primary',
  maxLength = 80
} = {}) {
  const normalizedMaxLength = Math.max(1, Math.min(10000, Number(maxLength) || 80));
  const normalizedValue = cleanAttribute(value, normalizedMaxLength);
  const input = {
    type: 'input',
    ui: 'space',
    name: cleanAttribute(name, 64),
    placeholder: cleanAttribute(placeholder, 120),
    maxlength: normalizedMaxLength,
    background: SURFACES.soft
  };
  if (normalizedValue) {
    input.text = normalizedValue;
    input.value = normalizedValue;
  }

  return createPanelNode([
    {
      type: 'flex-x',
      gap: 0.45,
      children: [
        input,
        createButtonNode({
          name: 'menu_action',
          value: actionValue,
          label: buttonLabel,
          style: buttonStyle,
          expand: false
        })
      ]
    }
  ], { background: SURFACES.panel, gap: 0.25 });
}

function buildSearchForm(options = {}) {
  return serializeJtml(createSearchNode(options));
}

function chunk(items, size) {
  const rows = [];
  for (let index = 0; index < items.length; index += size) rows.push(items.slice(index, index + size));
  return rows;
}

function createButtonGrid(buttons, { defaultStyle = 'primary', columns = 1, background = SURFACES.panel } = {}) {
  const nodes = (buttons || []).map((button) => {
    if (button.title) {
      return createPanelNode([
        createTextNode(button.label, {
          ui: 'muted',
          color: '#f8fafc',
          size: 1.02
        }),
        createTextNode(button.title, {
          ui: 'muted',
          color: '#94a3b8',
          background: SURFACES.inset
        }),
        button.disabled ? null : createButtonNode({
          name: 'menu_action',
          value: button.value,
          label: button.actionLabel || 'Aç →',
          style: button.style || defaultStyle,
          expand: true
        })
      ], { background: SURFACES.card, gap: 0.28 });
    }
    return createButtonNode({
      name: 'menu_action',
      value: button.value,
      label: button.label,
      style: button.style || defaultStyle,
      disabled: Boolean(button.disabled),
      expand: true
    });
  });
  if (!nodes.length) return null;

  const columnCount = Math.max(1, Math.min(3, Number(columns) || 1));
  const rows = chunk(nodes, columnCount).map((items) => {
    const children = items.map((node) => ({
      type: 'box',
      ui: 'space',
      children: [node]
    }));
    while (columnCount > 1 && children.length < columnCount) {
      children.push({ type: 'box', ui: 'space', text: '', background });
    }
    return {
      type: columnCount > 1 ? 'flex-x' : 'flex-y',
      ui: columnCount > 1 ? 'flex-x' : 'flex-y',
      gap: 0.34,
      children
    };
  });
  return createPanelNode(rows, { background, gap: 0.34 });
}

function createNavigationGroup(buttons) {
  const nodes = (buttons || []).map((button) => createButtonNode({
    name: 'menu_action',
    value: button.value,
    label: button.label,
    style: button.style || 'secondary',
    disabled: Boolean(button.disabled),
    title: button.title || '',
    expand: true
  }));
  if (!nodes.length) return null;
  const rows = chunk(nodes, 3).map((nodesInRow) => {
    const children = nodesInRow.map((node) => ({
      type: 'box',
      ui: 'space',
      children: [node]
    }));
    while (children.length < 3) {
      children.push({ type: 'box', ui: 'space', text: '', background: SURFACES.panel });
    }
    return {
      type: 'flex-x',
      ui: 'flex-x',
      gap: 0.3,
      children
    };
  });
  return createPanelNode(rows, { background: SURFACES.panel, gap: 0.3 });
}

function buildCommandMenuBumote({
  header = [],
  navigation = [],
  sections = [],
  commands = [],
  search = null,
  inputs = [],
  progress = null,
  footerActions = [],
  footerNote = '',
  sectionColumns = 2,
  commandColumns = 1
} = {}) {
  const children = [];

  const headerNodes = [];
  for (const item of header || []) {
    if (typeof item === 'string') headerNodes.push(createTextNode(item));
    else if (item && typeof item === 'object') headerNodes.push(createTextNode(item.text || '', item));
  }
  if (headerNodes.length) children.push(createPanelNode(headerNodes, { background: SURFACES.header, gap: 0.3 }));

  const navigationGroup = createNavigationGroup(navigation);
  if (navigationGroup) children.push(navigationGroup);

  if (search) children.push(createSearchNode(search));
  for (const input of inputs || []) children.push(createInputNode(input));
  if (progress) children.push(createProgressNode(progress));

  const sectionsGroup = createButtonGrid(sections, {
    defaultStyle: 'primary',
    columns: sectionColumns,
    background: SURFACES.panel
  });
  if (sectionsGroup) children.push(sectionsGroup);

  const commandsGroup = createButtonGrid(commands, {
    defaultStyle: 'ghost',
    columns: commandColumns,
    background: SURFACES.panel
  });
  if (commandsGroup) children.push(commandsGroup);

  const footerGroup = createNavigationGroup(footerActions);
  if (footerGroup) children.push(footerGroup);

  if (footerNote) {
    children.push(createPanelNode([
      createTextNode(footerNote, { type: 'box', ui: 'muted' })
    ], { background: SURFACES.note, gap: 0.2 }));
  }

  // İlk kutu esneyerek ürün imzasını panelin sağ altına iter.
  children.push({
    type: 'flex-x',
    gap: 0.2,
    background: SURFACES.root,
    children: [
      { type: 'box', ui: 'space', text: '' },
      { type: 'box', ui: 'muted', text: 'ToplyBot ♥ Topluyo', color: '#ff83c8', size: 0.82 }
    ]
  });

  return serializeJtml({
    type: 'box',
    ui: 'flex-y',
    gap: 0.45,
    background: SURFACES.root,
    children
  });
}

function createHelpCenterCard({
  icon = '•',
  text = 'Menü',
  description = '',
  value = 'home'
} = {}) {
  const openButton = createButtonNode({
    name: 'menu_action',
    value,
    label: 'Git →',
    style: 'primary'
  });
  openButton.background = '#7c5cff';

  return createPanelNode([
    {
      type: 'flex-x',
      gap: 0.4,
      children: [
        createTextNode(icon, {
          ui: 'muted',
          background: '#161d28',
          color: '#a78bfa',
          size: 1.35
        }),
        createTextNode(text, {
          ui: 'space',
          color: '#f8fafc',
          size: 1.04
        })
      ]
    },
    createTextNode(description, {
      ui: 'muted',
      color: '#abb1be'
    }),
    openButton
  ], {
    background: '#202633',
    gap: 0.34
  });
}

function createHelpCenterQuickAction({
  icon = '⚡',
  text = 'Hızlı İşlem',
  value = 'home'
} = {}) {
  return createButtonNode({
    name: 'menu_action',
    value,
    label: `${icon}  ${text}  ›`,
    style: 'secondary'
  });
}

/**
 * JTML Studio'daki "SEÇENEK 1 — SADE ANA PANEL" tasarımının native
 * Topluyo karşılığı. Studio'nun yalnızca önizlemede kullandığı _card,
 * _quick ve _nav düğümleri gerçek input/bumote öğelerine çevrilir.
 */
function buildHelpCenterBumote({
  notice = '',
  cards = [],
  quickActions = []
} = {}) {
  const normalizedCards = (cards || []).slice(0, 6);
  const searchButton = createButtonNode({
    name: 'menu_action',
    value: 'launcher:run',
    label: 'Ara',
    style: 'primary',
    expand: false
  });
  searchButton.background = '#7c5cff';
  const cardRows = chunk(normalizedCards, 3).map((row) => ({
    type: 'flex-x',
    ui: 'flex-x',
    gap: 0.6,
    children: row.map((card) => ({
      type: 'box',
      ui: 'space',
      children: [createHelpCenterCard(card)]
    }))
  }));

  return serializeJtml({
    type: 'box',
    ui: 'flex-y',
    gap: 0.7,
    background: '#0f1118',
    children: [
      {
        type: 'box',
        ui: 'flex-y',
        gap: 0.24,
        background: '#171921',
        children: [
          createTextNode('SEÇENEK 1 — SADE ANA PANEL', {
            ui: 'muted',
            color: '#a78bfa',
            size: 0.86
          }),
          createTextNode('ToplyBot Yardım Merkezi', {
            ui: 'muted',
            color: '#ffffff',
            size: 1.42
          })
        ]
      },
      {
        type: 'box',
        ui: 'flex-y',
        gap: 0.18,
        background: '#171e29',
        children: [
          createTextNode('● Bot Durumu: Çevrimiçi', {
            ui: 'muted',
            color: '#39df79',
            size: 1.02
          }),
          createTextNode('Tüm özelliklere hızlıca ulaşmak için aşağıdaki kategorilerden birini seç.', {
            ui: 'muted',
            color: '#aeb3bf'
          }),
          notice ? createTextNode(notice, {
            ui: 'muted',
            color: '#fbbf24'
          }) : null
        ].filter(Boolean)
      },
      {
        type: 'flex-x',
        ui: 'flex-x',
        gap: 0.7,
        children: [
          {
            type: 'box',
            ui: 'space',
            children: [
              {
                type: 'box',
                ui: 'flex-y',
                gap: 0.7,
                background: '#151922',
                children: [
                  {
                    type: 'box',
                    ui: 'flex-x',
                    gap: 0.45,
                    background: '#191d27',
                    children: [
                      createTextNode('⌕', {
                        ui: 'muted',
                        color: '#a78bfa',
                        size: 1.3
                      }),
                      {
                        type: 'input',
                        ui: 'space',
                        name: 'launcher_query',
                        placeholder: 'Ne yapmak istiyorsun?',
                        maxlength: 80,
                        background: '#191d27'
                      },
                      searchButton
                    ]
                  },
                  {
                    type: 'box',
                    ui: 'flex-y',
                    gap: 0.6,
                    background: '#151922',
                    children: cardRows
                  }
                ]
              }
            ]
          },
          {
            type: 'box',
            ui: 'flex-y',
            gap: 0.6,
            background: '#191d27',
            children: [
              {
                type: 'flex-x',
                ui: 'flex-x',
                gap: 0.35,
                children: [
                  createTextNode('Hızlı İşlemler', {
                    ui: 'space',
                    color: '#ffffff',
                    size: 1.08
                  }),
                  createTextNode('⚡', {
                    ui: 'muted',
                    color: '#a78bfa'
                  })
                ]
              },
              ...(quickActions || []).slice(0, 3).map(createHelpCenterQuickAction)
            ]
          }
        ]
      },
      {
        type: 'flex-x',
        ui: 'flex-x',
        gap: 0.6,
        background: '#171e29',
        children: [
          createButtonNode({
            name: 'menu_action',
            value: 'home',
            label: '⌂  Ana Sayfa',
            style: 'secondary'
          }),
          createButtonNode({
            name: 'menu_action',
            value: 'back',
            label: '←  Geri',
            style: 'secondary'
          }),
          createButtonNode({
            name: 'menu_action',
            value: 'close',
            label: '×  Kapat',
            style: 'danger'
          })
        ]
      },
      {
        type: 'box',
        ui: 'flex-y',
        gap: 0.18,
        background: '#171921',
        children: [
          createTextNode('ToplyBot ♥ Topluyo', {
            ui: 'muted',
            color: '#ff83c8',
            size: 0.92
          }),
          createTextNode('Destek Sunucusu Yakında', {
            ui: 'muted',
            color: '#8f96a5'
          })
        ]
      }
    ]
  });
}

function buildCommandCatalogBumote({
  title = 'Komutlar',
  description = '',
  navigation = [],
  commands = [],
  searchPlaceholder = 'Bu kategoride komut ara...'
} = {}) {
  const commandCards = (commands || []).map((command) => {
    const actionNodes = (command.actions || []).map((action) => createButtonNode({
      name: 'menu_action',
      value: action.value,
      label: action.label,
      style: action.style || 'primary',
      expand: true
    }));
    return createPanelNode([
      {
        type: 'flex-x',
        gap: 0.35,
        children: [
          createTextNode(command.icon || '⌘', {
            ui: 'muted',
            background: '#161d28',
            color: '#a78bfa',
            size: 1.15
          }),
          createTextNode(command.title || 'Komut', {
            ui: 'space',
            color: '#f8fafc',
            size: 1.02
          })
        ]
      },
      createTextNode(command.description || 'Açıklama bulunmuyor.', {
        ui: 'muted',
        color: '#abb1be'
      }),
      createTextNode(`Kullanım: ${command.usage || command.title || ''}`, {
        ui: 'muted',
        background: '#161d28',
        color: '#c4b5fd'
      }),
      actionNodes.length > 1
        ? { type: 'flex-x', ui: 'flex-x', gap: 0.3, children: actionNodes }
        : actionNodes[0]
    ].filter(Boolean), {
      background: '#202633',
      gap: 0.3
    });
  });

  // Her kart "space" kutusuyla sarılır; böylece farklı metin uzunlukları
  // üçlü satırdaki kolon genişliklerini değiştirmez.
  const rows = chunk(commandCards, 3).map((cards) => {
    const columns = cards.map((card) => ({
      type: 'box',
      ui: 'space',
      children: [card]
    }));
    // Eksik son satırda mevcut kartların tam genişliğe uzamasını önler.
    while (columns.length < 3) {
      columns.push({
        type: 'box',
        ui: 'space',
        text: '',
        background: '#151922'
      });
    }
    return {
      type: 'flex-x',
      ui: 'flex-x',
      gap: 0.45,
      children: columns
    };
  });

  return serializeJtml({
    type: 'box',
    ui: 'flex-y',
    gap: 0.5,
    background: SURFACES.root,
    children: [
      createPanelNode([
        createTextNode(title, { ui: 'muted', color: '#ffffff', size: 1.2 }),
        description ? createTextNode(description, { ui: 'muted', color: '#abb1be' }) : null
      ], { background: SURFACES.header, gap: 0.2 }),
      createNavigationGroup(navigation),
      createSearchNode({ placeholder: searchPlaceholder }),
      createPanelNode(rows, { background: '#151922', gap: 0.45 }),
      {
        type: 'flex-x',
        gap: 0.2,
        background: SURFACES.root,
        children: [
          { type: 'box', ui: 'space', text: '' },
          { type: 'box', ui: 'muted', text: 'ToplyBot ♥ Topluyo', color: '#ff83c8', size: 0.82 }
        ]
      }
    ].filter(Boolean)
  });
}

function buildClosedMenuBumote(label = '🔒 Menü kapatıldı') {
  return serializeJtml(createPanelNode([
    createTextNode(label, { ui: 'muted', size: 1.05 })
  ], { background: SURFACES.header, gap: 0.2 }));
}

/** Post metnindeki mevcut native JTML bloklarını kaldırır. */
function stripNativeJtmlBlocks(value) {
  const input = String(value ?? '');
  let output = '';
  let cursor = 0;

  while (cursor < input.length) {
    const start = input.indexOf('~{', cursor);
    if (start === -1) {
      output += input.slice(cursor);
      break;
    }

    output += input.slice(cursor, start);
    let index = start + 2;
    let depth = 1;
    let quote = '';
    let escaped = false;

    while (index < input.length && depth > 0) {
      const char = input[index];
      if (escaped) escaped = false;
      else if (quote) {
        if (char === '\\') escaped = true;
        else if (char === quote) quote = '';
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      index += 1;
    }

    if (depth > 0) {
      output += input.slice(start);
      break;
    }
    cursor = index;
  }

  return output.replace(/\n{3,}/g, '\n\n').trim();
}

/** Görünen metin ile native JTML'yi aynı post.text alanında birleştirir. */
function composeJtmlPost(text, jtmlCode) {
  const plainText = stripNativeJtmlBlocks(text);
  const markup = String(jtmlCode ?? '').trim();
  if (!markup) return plainText;
  if (!markup.startsWith('~{')) throw new TypeError('Native JTML kodu ~{ ile başlamalıdır.');
  return [plainText, markup].filter(Boolean).join('\n\n');
}

module.exports = {
  buildButtonBumote,
  buildClosedMenuBumote,
  buildCommandMenuBumote,
  buildCommandCatalogBumote,
  buildHelpCenterBumote,
  buildJtmlButton,
  buildSearchForm,
  createButtonNode,
  createInputNode,
  createProgressNode,
  createSearchNode,
  createTextNode,
  renderProgressBar,
  escapeHtml,
  serializeJtml,
  composeJtmlPost,
  stripNativeJtmlBlocks
};
