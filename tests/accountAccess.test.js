const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const jwt = require('jsonwebtoken');
async function authorize(account, site) {
  const filename = path.resolve(__dirname, '../middleware/auth.js');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, console, process,
    require(name) { if (name === '../models/User') return { findById() { return { async lean() { return account; } }; } }; return require(name.startsWith('.') ? path.resolve(path.dirname(filename), name) : name); } });
  const token = jwt.sign({ id: '123', auth_version: 1 }, process.env.JWT_SECRET || 'byd_lead_centre_secret_2026');
  const result = {};
  const res = { status(code) { result.status = code; return this; }, json(body) { return body; } };
  const req = { headers: { authorization: `Bearer ${token}`, ...(site ? { 'x-site': site } : {}) }, query: {}, body: {}, method: 'GET' };
  await module.exports.authenticate(req, res, () => { result.accepted = true; });
  return { ...result, req };
}
const account = () => ({ _id: '123', name: 'Staff', email: 'staff@example.com', active: true, auth_version: 1,
  platform_access: ['lead_centre'], allowed_sites: ['BYD Fairfield', 'BYD Nunawading'], site: 'BYD Fairfield', all_sites: false });
test('Lead Centre checks live platform grants and revoked sessions', async () => {
  assert.equal((await authorize({ ...account(), platform_access: ['crm'] })).status, 403);
  assert.equal((await authorize({ ...account(), auth_version: 2 })).status, 401);
  assert.equal((await authorize({ ...account(), active: false })).status, 401);
  assert.equal((await authorize(null)).status, 401);
});
test('Lead Centre scopes requests to assigned sites and rejects unassigned sites', async () => {
  const result = await authorize(account(), 'Nunawading');
  assert.equal(result.accepted, true);
  assert.equal(result.req.query.dealer, 'BYD Nunawading');
  assert.equal((await authorize(account(), 'Denza Melbourne')).status, 403);
});
test('direct lead record access is checked independently of the selected list filter', async () => {
  const { guardResourceSite } = require('../services/accountAccess');
  const req = { user: account(), originalUrl: '/api/leads/000000000000000000000001' };
  const db = { collection() { return { async findOne() { return { dealer: 'Denza Melbourne' }; } }; } };
  await assert.rejects(guardResourceSite(req, db), { statusCode: 404 });
});
