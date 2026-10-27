import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG, PRESETS, normalizeConfig, setBay, resizeConfig, dimensions,
  quote, serializeConfig, parseConfig, describeConfig, formatMoney,
} from '../src/model.js';

function doorCount(config) {
  return [...config.front, ...config.rear].filter((type) => type === 'door').length;
}

test('normalization gives bounded safe defaults without mutating source data', () => {
  const source = {
    version: 99, length: 12, modules: 100, color: 'customer-secret', deck: 'false',
    front: Array(1000).fill('door'), rear: ['bad', 'door'], unknown: 'removed',
  };
  const original = JSON.stringify(source);
  const config = normalizeConfig(source);
  assert.equal(config.version, 1);
  assert.equal(config.length, 6);
  assert.equal(config.modules, 2);
  assert.equal(config.color, 'forest');
  assert.equal(config.deck, true);
  assert.equal(config.front.length, 4);
  assert.equal(config.rear.length, 4);
  assert.equal(doorCount(config), 1);
  assert.equal(Object.hasOwn(config, 'unknown'), false);
  assert.equal(JSON.stringify(source), original);
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
});

test('one entrance is reconciled deterministically or inserted when absent', () => {
  const allDoors = normalizeConfig({ length: 9, front: Array(6).fill('door'), rear: Array(6).fill('door') });
  assert.equal(allDoors.front[0], 'door');
  assert.equal(doorCount(allDoors), 1);
  const noDoors = normalizeConfig({ front: Array(4).fill('wall'), rear: Array(4).fill('window') });
  assert.equal(noDoors.front[1], 'door');
  assert.equal(doorCount(noDoors), 1);
});

test('moving the door is immutable and removes the old entrance', () => {
  const source = normalizeConfig();
  const before = serializeConfig(source);
  const result = setBay(source, 'rear', 3, 'door');
  assert.equal(result.config.front[1], 'wall');
  assert.equal(result.config.rear[3], 'door');
  assert.equal(doorCount(result.config), 1);
  assert.equal(result.notice, '');
  assert.equal(serializeConfig(source), before);
  assert.notEqual(result.config.front, source.front);
});

test('cannot delete the entrance or write an invalid bay', () => {
  const source = normalizeConfig();
  for (const [facade, index, type] of [['front', 1, 'wall'], ['front', 1, 'window'], ['rear', 12, 'door'], ['roof', 0, 'window'], ['front', -1, 'door'], ['front', 0, 'skylight']]) {
    const result = setBay(source, facade, index, type);
    assert.deepEqual(result.config, source);
    assert.ok(result.notice.length > 0);
  }
});

test('resizing preserves retained bays, adds walls and restores a lost entrance', () => {
  const source = normalizeConfig();
  const expanded = resizeConfig(source, 9);
  assert.deepEqual(expanded.front, ['window', 'door', 'window', 'wall', 'wall', 'wall']);
  assert.deepEqual(expanded.rear, ['window', 'wall', 'window', 'wall', 'wall', 'wall']);
  const moved = setBay(expanded, 'rear', 5, 'door').config;
  const shrunk = resizeConfig(moved, 6);
  assert.equal(shrunk.front.length, 4);
  assert.equal(shrunk.front[1], 'door');
  assert.equal(doorCount(shrunk), 1);
  assert.deepEqual(source, DEFAULT_CONFIG);
  assert.deepEqual(resizeConfig(source, 40), source);
});

test('geometry tracks modules and length in physical units', () => {
  assert.deepEqual(dimensions(DEFAULT_CONFIG), {
    length: 6, width: 6, height: 2.8, area: 36, bays: 4, moduleWidth: 3,
  });
  assert.deepEqual(dimensions({ length: 9, modules: 3 }), {
    length: 9, width: 9, height: 2.8, area: 81, bays: 6, moduleWidth: 3,
  });
});

test('default quote matches transparent integer-cent catalog arithmetic', () => {
  const result = quote(DEFAULT_CONFIG);
  const expectedNet = 2 * 1_280_000 + 185_000 + 4 * 85_000 + 145_000 + 9 * 28_000 + 2 * 165_000;
  assert.equal(result.subtotal, expectedNet);
  assert.equal(result.vat, Math.round(expectedNet * 19 / 100));
  assert.equal(result.total, result.subtotal + result.vat);
  assert.equal(result.items.reduce((sum, item) => sum + item.total, 0), result.subtotal);
  assert.equal(result.items.find((item) => item.id === 'finish').total, 0);
  assert.match(result.disclaimer, /Illustrative demo prices/);
  assert.match(result.disclaimer, /excluded/);
  assert.equal(result.vatRate, 0.19);
});

test('optional packages, 9 m deck and connection counts price without fractional cents', () => {
  const config = normalizeConfig({ ...DEFAULT_CONFIG, length: 9, modules: 3, insulation: 'plus', partition: true });
  const result = quote(config);
  const items = Object.fromEntries(result.items.map((item) => [item.id, item]));
  assert.equal(items.modules.total, 3 * 1_760_000);
  assert.equal(items.connections.total, 2 * 185_000);
  assert.equal(items.insulation.total, 81 * 8_500);
  assert.equal(items.deck.quantity, 13.5);
  assert.equal(items.deck.total, 378_000);
  assert.equal(items.partition.total, 9 * 55_000);
  for (const item of result.items) {
    assert.ok(Number.isInteger(item.total));
    assert.ok(Number.isInteger(item.unitPrice));
  }
  const simple = quote({ ...DEFAULT_CONFIG, modules: 1, deck: false, furniture: false });
  assert.equal(simple.items.some((item) => ['connections', 'deck', 'furniture', 'partition', 'insulation'].includes(item.id)), false);
});

test('serializing and importing all presets is stable and normalizes extra doors', () => {
  for (const preset of PRESETS) {
    const config = parseConfig(serializeConfig(preset.config));
    assert.deepEqual(config, normalizeConfig(preset.config));
    assert.equal(doorCount(config), 1);
    assert.equal(serializeConfig(config), serializeConfig(preset.config));
  }
  const multiple = { ...DEFAULT_CONFIG, front: ['door', 'door', 'wall', 'wall'] };
  assert.equal(doorCount(parseConfig(JSON.stringify(multiple))), 1);
});

test('import rejects malformed, unrelated, oversized and unsupported payloads', () => {
  const valid = JSON.parse(serializeConfig(DEFAULT_CONFIG));
  const samples = [
    '', '{', 'null', '[]', '{"hello":"world"}',
    JSON.stringify({ ...valid, version: 2 }),
    JSON.stringify({ ...valid, modules: 4 }),
    JSON.stringify({ ...valid, length: 7 }),
    JSON.stringify({ ...valid, front: ['door'] }),
    JSON.stringify({ ...valid, rear: Array(100).fill('wall') }),
    JSON.stringify({ ...valid, color: 'unknown' }),
    JSON.stringify({ ...valid, deck: 'true' }),
    JSON.stringify({ ...valid, furniture: null }),
    JSON.stringify({ ...valid, insulation: 'extreme' }),
    JSON.stringify({ ...valid, front: ['door', 'window', 'wall', {}] }),
    JSON.stringify({ ...valid, extra: true }),
    ' '.repeat(100_001),
  ];
  for (const sample of samples) assert.throws(() => parseConfig(sample));
  assert.throws(() => parseConfig(valid));
  assert.throws(() => parseConfig('"' + '🧱'.repeat(26_000) + '"'), /100 kB/);
});

test('import rejects prototype pollution keys without changing global prototypes', () => {
  const valid = serializeConfig(DEFAULT_CONFIG);
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const polluted = valid.replace('{', `{ "${key}": {"polluted":true},`);
    assert.throws(() => parseConfig(polluted), /not a supported/);
  }
  assert.equal({}.polluted, undefined);
});

test('summary and currency output are useful without leaking raw config data', () => {
  assert.equal(describeConfig(DEFAULT_CONFIG), '6 × 6 m · 36 m² · 2 modules');
  assert.equal(describeConfig({ modules: 1 }), '6 × 3 m · 18 m² · 1 module');
  assert.equal(formatMoney(1_234_500), '€12,345.00');
  assert.equal(formatMoney(4_536_280), '€45,362.80');
  assert.match(formatMoney(1_234_500, 'de-DE'), /12\.345/);
});
