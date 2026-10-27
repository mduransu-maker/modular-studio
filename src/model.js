const COLORS = Object.freeze(['sand', 'forest', 'charcoal', 'clay', 'chalk']);
const BAY_TYPES = Object.freeze(['wall', 'window', 'door']);
const FACADES = Object.freeze(['front', 'rear']);
const CONFIG_KEYS = Object.freeze([
  'version', 'length', 'modules', 'color', 'front', 'rear', 'insulation',
  'deck', 'partition', 'furniture',
]);
const MAX_IMPORT_BYTES = 100_000;

export const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  length: 6,
  modules: 2,
  color: 'forest',
  front: Object.freeze(['window', 'door', 'window', 'wall']),
  rear: Object.freeze(['window', 'wall', 'window', 'wall']),
  insulation: 'standard',
  deck: true,
  partition: false,
  furniture: true,
});

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function allowed(value, values, fallback) {
  return values.includes(value) ? value : fallback;
}

function booleanOr(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

/** Return a fresh, bounded configuration with exactly one entrance door. */
export function normalizeConfig(input = {}) {
  const source = isRecord(input) ? input : {};
  const length = allowed(source.length, [6, 9], DEFAULT_CONFIG.length);
  const bays = length / 1.5;
  const config = {
    version: 1,
    length,
    modules: allowed(source.modules, [1, 2, 3], DEFAULT_CONFIG.modules),
    color: allowed(source.color, COLORS, DEFAULT_CONFIG.color),
    front: [],
    rear: [],
    insulation: allowed(source.insulation, ['standard', 'plus'], DEFAULT_CONFIG.insulation),
    deck: booleanOr(source.deck, DEFAULT_CONFIG.deck),
    partition: booleanOr(source.partition, DEFAULT_CONFIG.partition),
    furniture: booleanOr(source.furniture, DEFAULT_CONFIG.furniture),
  };

  for (const facade of FACADES) {
    const sourceBays = Array.isArray(source[facade]) ? source[facade] : DEFAULT_CONFIG[facade];
    config[facade] = Array.from({ length: bays }, (_, index) =>
      allowed(sourceBays[index], BAY_TYPES, DEFAULT_CONFIG[facade][index] ?? 'wall'));
  }

  let foundDoor = false;
  for (const facade of FACADES) {
    config[facade] = config[facade].map((type) => {
      if (type !== 'door') return type;
      if (foundDoor) return 'wall';
      foundDoor = true;
      return 'door';
    });
  }
  if (!foundDoor) config.front[1] = 'door';
  return config;
}

/** Move the entrance by choosing a door in another bay; do not remove it. */
export function setBay(input, facade, index, type) {
  const config = normalizeConfig(input);
  if (!FACADES.includes(facade)
      || !Number.isInteger(index)
      || index < 0
      || index >= config.front.length
      || !BAY_TYPES.includes(type)) {
    return { config, notice: 'Choose a valid bay and panel type.' };
  }
  if (config[facade][index] === 'door' && type !== 'door') {
    return { config, notice: 'Keep one entrance. Place a door in another bay to move it.' };
  }
  if (type === 'door') {
    for (const side of FACADES) {
      config[side] = config[side].map((panel) => panel === 'door' ? 'wall' : panel);
    }
  }
  config[facade][index] = type;
  return { config, notice: '' };
}

/** Keep retained panels when changing length, adding plain wall bays as needed. */
export function resizeConfig(input, length) {
  const config = normalizeConfig(input);
  const nextLength = allowed(length, [6, 9], config.length);
  const bays = nextLength / 1.5;
  return normalizeConfig({
    ...config,
    length: nextLength,
    front: Array.from({ length: bays }, (_, index) => config.front[index] ?? 'wall'),
    rear: Array.from({ length: bays }, (_, index) => config.rear[index] ?? 'wall'),
  });
}

export function dimensions(input) {
  const config = normalizeConfig(input);
  const width = config.modules * 3;
  return {
    length: config.length,
    width,
    height: 2.8,
    area: config.length * width,
    bays: config.length / 1.5,
    moduleWidth: 3,
  };
}

/** All monetary values are integer euro cents from a fictional demo catalog. */
export function quote(input) {
  const config = normalizeConfig(input);
  const size = dimensions(config);
  const panels = [...config.front, ...config.rear];
  const items = [];
  const add = (id, label, quantity, unit, unitPrice) => {
    if (quantity > 0) {
      items.push({ id, label, quantity, unit, unitPrice, total: Math.round(quantity * unitPrice) });
    }
  };

  add('modules', `${config.length} m room module`, config.modules, 'module', { 6: 1_280_000, 9: 1_760_000 }[config.length]);
  add('connections', 'Module connection', config.modules - 1, 'connection', 185_000);
  add('windows', 'Glazed window bay', panels.filter((type) => type === 'window').length, 'bay', 85_000);
  add('entrance', 'Entrance door', panels.filter((type) => type === 'door').length, 'door', 145_000);
  add('finish', `${config.color[0].toUpperCase()}${config.color.slice(1)} exterior finish`, 1, 'finish', 0);
  if (config.insulation === 'plus') add('insulation', 'Enhanced insulation package', size.area, 'm²', 8_500);
  if (config.deck) add('deck', '1.5 m front deck', config.length * 1.5, 'm²', 28_000);
  if (config.partition) add('partition', 'Interior partition', size.width, 'm', 55_000);
  if (config.furniture) add('furniture', 'Furniture package', config.modules, 'module', 165_000);

  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const vat = Math.round(subtotal * 19 / 100);
  return {
    items,
    subtotal,
    vatRate: 0.19,
    vat,
    total: subtotal + vat,
    disclaimer: 'Illustrative demo prices only. Fictional modular rooms, not a quotation or engineering specification. Delivery, installation, foundations and permits are excluded.',
  };
}

export function serializeConfig(input) {
  return JSON.stringify(normalizeConfig(input), null, 2);
}

/** Imported files must be complete v1 exports, never arbitrary partial JSON. */
export function parseConfig(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) {
    throw new Error('Choose a Modular Studio JSON file smaller than 100 kB.');
  }
  let input;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const keys = isRecord(input) ? Object.keys(input) : [];
  const validStructure = isRecord(input)
    && keys.length === CONFIG_KEYS.length
    && keys.every((key) => CONFIG_KEYS.includes(key))
    && input.version === 1
    && [6, 9].includes(input.length)
    && [1, 2, 3].includes(input.modules)
    && COLORS.includes(input.color)
    && ['standard', 'plus'].includes(input.insulation)
    && ['deck', 'partition', 'furniture'].every((key) => typeof input[key] === 'boolean')
    && FACADES.every((facade) => Array.isArray(input[facade])
      && input[facade].length === input.length / 1.5
      && input[facade].every((type) => BAY_TYPES.includes(type)));
  if (!validStructure) {
    throw new Error('This is not a supported Modular Studio v1 configuration. Export a configuration from this app first.');
  }
  return normalizeConfig(input);
}

export function describeConfig(input) {
  const config = normalizeConfig(input);
  const size = dimensions(config);
  return `${size.length} × ${size.width} m · ${size.area} m² · ${config.modules} ${config.modules === 1 ? 'module' : 'modules'}`;
}

export function formatMoney(cents, locale = 'en-GB') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format((Number.isFinite(cents) ? cents : 0) / 100);
}

export const PRESETS = Object.freeze([
  Object.freeze({ id: 'studio', label: 'Solo · 18 m²', config: Object.freeze({
    ...DEFAULT_CONFIG,
    modules: 1,
    color: 'clay',
    deck: false,
  }) }),
  Object.freeze({ id: 'office', label: 'Team · 36 m²', config: DEFAULT_CONFIG }),
  Object.freeze({ id: 'hub', label: 'Hub · 54 m²', config: Object.freeze({
    ...DEFAULT_CONFIG,
    modules: 3,
    color: 'sand',
    partition: true,
  }) }),
]);
