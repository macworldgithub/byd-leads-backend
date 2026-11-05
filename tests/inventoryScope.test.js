const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { inventoryScope, inventorySiteRegex } = require('../services/inventoryScope');

const vehicles = [
  { _id: 'n1', location: 'BYD Nunawading', model: 'NWD model', status: 'Available', platform: 'virtualyard' },
  { _id: 'n2', location: 'Warehouse', orderYard: 'NWD', model: 'NWD model', status: 'Delivered', platform: 'shirley' },
  { _id: 'c1', location: 'BYD Caroline Springs', model: 'CS model', status: 'Available', platform: 'autogate' },
  { _id: 'm1', location: 'BYD Melbourne City', model: 'BYD model', status: 'Available', platform: 'autogate' },
  { _id: 'd1', location: 'Denza Melbourne', model: 'Denza model', status: 'In Transit', platform: 'dealer_studio' },
  { _id: 'unknown', location: 'Warehouse', model: 'Unknown model', status: 'Available', platform: 'manual' },
];
const valueAt = (doc, field) => field.split('.').reduce((value, key) => value?.[key], doc);
function matches(doc, filter) {
  return Object.entries(filter).every(([field, condition]) => {
    if (field === '$and') return condition.every(part => matches(doc, part));
    if (field === '$or') return condition.some(part => matches(doc, part));
    const value = valueAt(doc, field);
    if (condition?.test) return condition.test(value || '');
    if (condition?.$regex) return new RegExp(condition.$regex, condition.$options).test(value || '');
    if (condition?.$in) return condition.$in.includes(value);
    if (condition?.$gt !== undefined) return value > condition.$gt;
    return value === condition;
  });
}

function fixture() {
  const handlers = {};
  const router = { get(name, handler) { handlers[name] = handler; }, post() {}, put() {} };
  const model = {
    find(filter) {
      let rows = vehicles.filter(doc => matches(doc, filter));
      return { sort() { return this; }, skip(n) { rows = rows.slice(n); return this; },
        limit(n) { rows = rows.slice(0, n); return this; }, async lean() { return rows; } };
    },
    async countDocuments(filter) { return vehicles.filter(doc => matches(doc, filter)).length; },
    async distinct(field, filter) { return [...new Set(vehicles.filter(doc => matches(doc, filter)).map(doc => valueAt(doc, field)).filter(Boolean))]; },
    collection: { aggregate(pipeline) {
      const rows = vehicles.filter(doc => matches(doc, pipeline[0].$match));
      const raw = Object.fromEntries(Object.entries(pipeline[1].$facet).map(([key, stages]) => {
        const count = rows.filter(doc => stages.every(stage => !stage.$match || matches(doc, stage.$match))).length;
        return [key, count ? [{ count }] : []];
      }));
      return { async toArray() { return [raw]; } };
    } },
  };
  const filename = path.resolve(__dirname, '../routes/inventory.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: { exports: {} }, console,
    require(name) {
      if (name === 'express') return { Router: () => router };
      if (name === '../models/Inventory') return model;
      return require(path.resolve(path.dirname(filename), name));
    },
  }, { filename });
  return async (route, user, query = {}) => {
    const result = { status: 200 };
    await handlers[route]({ user, query }, {
      setHeader() {}, status(code) { result.status = code; return this; },
      json(body) { result.body = JSON.parse(JSON.stringify(body)); return this; },
    });
    return result;
  };
}

test('inventory site aliases preserve exact yard and brand boundaries', () => {
  assert.ok(inventorySiteRegex('BYD Nunawading').test('NWD'));
  assert.ok(!inventorySiteRegex('BYD Nunawading').test('BYD Caroline Springs'));
  assert.ok(inventorySiteRegex('BYD Melbourne City').test('CBD'));
  assert.ok(!inventorySiteRegex('BYD Melbourne').test('Denza Melbourne'));
  assert.ok(!inventorySiteRegex('Denza Melbourne').test('BYD Melbourne City'));
  assert.ok(!inventorySiteRegex('BYD Caroline Springs').test('Caroline Springs Other Yard'));
});

test('inventory requires a site or an explicit all-sites grant', () => {
  assert.throws(() => inventoryScope(), { statusCode: 401 });
  assert.throws(() => inventoryScope({ role: 'agent' }), { statusCode: 403 });
  assert.throws(() => inventoryScope({ site: 'All Sites' }), { statusCode: 403 });
  assert.equal(inventoryScope({ site: 'BYD Nunawading' }).site, 'BYD Nunawading');
  assert.equal(inventoryScope({ all_sites: true }).site, '');
});

test('rows, pagination totals and cached stats cannot escape the authenticated site', async () => {
  const request = fixture();
  const global = await request('/', { all_sites: true });
  assert.equal(global.body.stats.total, 6);
  const user = { locked_site: 'BYD Nunawading' };
  const first = await request('/', user, { location: 'All Sites', limit: 1 });
  const second = await request('/', user, { page: 2, limit: 1 });
  assert.equal(first.body.total, 2);
  assert.equal(first.body.totalPages, 2);
  assert.equal(first.body.stats.total, 2);
  assert.equal(first.body.stats.delivered, 1);
  assert.deepEqual(first.body.data.map(doc => doc._id), ['n1']);
  assert.deepEqual(second.body.data.map(doc => doc._id), ['n2']);
  const other = await request('/', { locked_site: 'BYD Caroline Springs' });
  assert.equal(other.body.stats.total, 1);
  assert.deepEqual(other.body.data.map(doc => doc._id), ['c1']);
  const forged = await request('/', user, { location: 'BYD Caroline Springs', q: 'CS model' });
  assert.equal(forged.body.total, 0);
  assert.deepEqual(forged.body.data, []);
  const stats = await request('/stats', user);
  assert.equal(stats.body.total, 2);
});

test('cached filter options are isolated by site, including empty inventories', async () => {
  const request = fixture();
  await request('/filters', { all_sites: true });
  const nwd = await request('/filters', { locked_site: 'BYD Nunawading' });
  assert.deepEqual(nwd.body.locations, ['BYD Nunawading']);
  assert.deepEqual(nwd.body.models, ['NWD model']);
  assert.deepEqual(nwd.body.statuses, ['Available', 'Delivered']);
  assert.ok(!nwd.body.platforms.includes('dealer_studio'));
  const denza = await request('/filters', { locked_site: 'Denza Melbourne' });
  assert.deepEqual(denza.body.models, ['Denza model']);
  const empty = await request('/', { locked_site: 'BYD Wodonga' });
  assert.equal(empty.body.total, 0);
  assert.equal(empty.body.stats.total, 0);
  const denied = await request('/', { role: 'agent' });
  assert.equal(denied.status, 403);
});
