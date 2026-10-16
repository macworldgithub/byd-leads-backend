const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { siteRegex, siteConditions } = require('../services/staffDirectory');

test('site aliases match exactly without merging BYD and Denza Melbourne', () => {
  assert.ok(siteRegex('Doncaster').test('BYD Doncaster'));
  assert.ok(siteRegex('BYD Melbourne City VIC').test('Melbourne'));
  assert.ok(!siteRegex('BYD Melbourne').test('Denza Melbourne'));
  assert.ok(!siteRegex('BYD Doncaster').test('BYD Nunawading'));
});

test('staff search cannot override the authenticated user site lock', async () => {
  let handler, query, payload;
  const db = { collection() { return { find() { return { async toArray() { return []; } }; } }; } };
  const chain = { select() { return this; }, sort() { return this; }, async lean() { return []; } };
  const userModel = { db, find(filter) { query = filter; return chain; } };
  const router = { get(_path, _auth, callback) { handler = callback; } };
  const filename = path.resolve(__dirname, '../routes/staff.js');
  const moduleFixture = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: moduleFixture, console,
    require(name) {
      if (name === 'express') return { Router: () => router };
      if (name.includes('models/')) return userModel;
      if (name.includes('middleware/auth')) return { authenticate() {} };
      if (name.includes('staffDirectory')) return { siteConditions };
      throw new Error(`Unexpected dependency ${name}`);
    },
  }, { filename });
  await handler({ user: { role: 'agent', locked_site: 'BYD Nunawading' }, query: { site: 'BYD Doncaster', q: 'Sales' } }, {
    json(value) { payload = value; },
  });
  const scope = query.$and[0].$or[0].locked_site;
  assert.ok(scope.test('Nunawading'));
  assert.ok(!scope.test('BYD Doncaster'));
  assert.equal(query.$and[1].$or[0].name.$regex, 'Sales');
  assert.equal(payload.userScope.hasFullAccess, false);
});
