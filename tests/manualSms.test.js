const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');

const site = 'BYD Nunawading';
const conversationId = '6ac7dd9b3f815fbb351e16ca';
const leadId = '6ac7dd9b3f815fbb351e16d0';

function load(relative, mocks) {
  const filename = path.resolve(__dirname, '..', relative);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, console, process, Date,
    require(name) { return Object.hasOwn(mocks, name) ? mocks[name] : require(name); },
  }, { filename });
  return module.exports;
}

async function fixture(run) {
  let sends = [];
  let conversation = null;
  const lead = { _id: leadId, name: 'Test Customer', phone: '+61400000000', dealer: site };
  const Conversation = {
    async findById() { return conversation; },
    async findOne() { return conversation; },
    find() { return { async sort() { return conversation ? [conversation] : []; } }; },
    async create(data) { conversation = { _id: conversationId, ...data, async save() {} }; return conversation; },
    async updateOne(filter, update) {
      if (update.$push) conversation.messages.push(update.$push.messages);
      if (update.$set) Object.assign(conversation, update.$set);
      return { modifiedCount: 1 };
    },
    async findByIdAndUpdate(id, fields) { Object.assign(conversation, fields); return conversation; },
  };
  const mobileMessage = {
    normalizeAustralianPhone: () => lead.phone,
    async sendSms(options) { sends.push(options); return { messageId: `sent-${sends.length}` }; },
  };
  const mocks = {
    '../models/Conversation': Conversation,
    '../models/Lead': { async findById() { return lead; }, async findOne() { return lead; }, async find() { return [lead]; }, async create(data) { return { ...lead, ...data }; }, async findByIdAndUpdate() {} },
    '../services/mobileMessage': mobileMessage,
    '../middleware/auth': { authenticate(req, res, next) { if (req.headers.authorization !== 'Bearer human') return res.sendStatus(401); req.user = { id: 'staff-1', name: 'Staff', site, role: 'sales_manager' }; next(); } },
    '../services/threadHistory': { async getThreads() { return []; }, allowedSite: () => true, phoneKey: x => x, siteKey: x => x },
    '../services/messageDb': { async deliveryDb() { return { collection() { return { find() { return { async toArray() { return []; } }; } }; } }; } },
    '../services/smsEvent': { phoneRegex: x => x, inboundId: body => body.message_id, receivedAt: () => new Date(), inboundSite: () => site },
    mongoose: { connection: { db: {} } },
  };
  const app = express();
  app.use(express.json());
  app.use('/conversations', load('routes/conversations.js', mocks));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  async function request(route, body, auth = true) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/conversations${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer human' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  try { await run({ request, sends, getConversation: () => conversation, setConversation: value => { conversation = value; } }); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('opening a prospect never sends SMS, even with a legacy sendSms query', async () => fixture(async ({ request, sends, getConversation }) => {
  const response = await request(`/by-lead/${leadId}?sendSms=true`);
  assert.equal(response.status, 200);
  assert.equal(sends.length, 0);
  assert.equal(getConversation().control, 'Human');
  assert.equal(getConversation().messages.length, 0);
}));

test('creating a conversation ignores legacy AI control and defaults to no SMS', async () => fixture(async ({ request, sends, getConversation }) => {
  const response = await request('/', { prospectName: 'Test Customer', phone: '0400000000', dealer: site, control: 'AI active' });
  assert.equal(response.status, 201);
  assert.equal(sends.length, 0);
  assert.equal(getConversation().control, 'Human');
}));

test('an opening SMS requires explicitly composed text and a boolean send action', async () => fixture(async ({ request, sends }) => {
  const blank = await request('/', { prospectName: 'Test Customer', phone: '0400000000', dealer: site, sendSms: true });
  assert.equal(blank.status, 400);
  assert.equal(sends.length, 0);
  await request('/', { prospectName: 'Test Customer', phone: '0400000000', dealer: site, sendSms: 'false', initialMessage: 'Do not send' });
  assert.equal(sends.length, 0);
  const sent = await request('/', { prospectName: 'Test Customer', phone: '0400000000', dealer: site, sendSms: true, initialMessage: 'Hi, this is the sales team.' });
  assert.equal(sent.status, 201);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].requestedBy, 'staff-1');
  assert.match(sends[0].message, /Hi, this is the sales team.*Reply STOP/);
}));

test('customer inbound SMS cannot trigger an outbound reply on a legacy AI thread', async () => fixture(async ({ request, sends, setConversation, getConversation }) => {
  setConversation({ _id: conversationId, phone: '+61400000000', dealer: site, control: 'AI active', messages: [] });
  const response = await request('/inbound', { from: '+61400000000', message: 'Yes, book a test drive', message_id: 'inbound-1' }, false);
  assert.equal(response.status, 200);
  assert.equal(sends.length, 0);
  assert.equal(getConversation().control, 'Human');
  assert.equal(getConversation().messages.length, 1);
  assert.equal(getConversation().messages[0].sender, 'user');
}));

test('AI resume and customer simulations are retired, manual replies still send', async () => fixture(async ({ request, sends, setConversation }) => {
  setConversation({ _id: conversationId, phone: '+61400000000', dealer: site, control: 'AI active', messages: [] });
  assert.equal((await request(`/${conversationId}/toggle-control`, { action: 'resume' })).status, 400);
  assert.equal((await request(`/${conversationId}/simulate`, { text: 'Test drive' })).status, 410);
  assert.equal(sends.length, 0);
  assert.equal((await request(`/${conversationId}/agent-reply`, { text: 'We can arrange a test drive.' })).status, 200);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].requestedBy, 'staff-1');
}));

test('SMS gateway rejects a send without staff identity before contacting the provider', async () => {
  const gateway = load('services/mobileMessage.js', { '../models/Setting': {} });
  await assert.rejects(gateway.sendSms({ to: '0400000000', message: 'Unattended' }), /manually by an authenticated staff member/);
});

test('CSV import does not send SMS even when a legacy client requests it', async () => {
  const created = [];
  let sends = 0;
  const app = express();
  app.use(express.json());
  const router = load('routes/leads.js', {
    '../models/Lead': { async find() { return []; }, async create(data) { created.push(data); return { _id: leadId, ...data }; } },
    '../models/Conversation': { async create() { throw new Error('Import must not create outbound messages'); } },
    '../models/AuditTrail': { async create() {} },
    '../services/mobileMessage': { async sendSms() { sends++; } },
  });
  const handler = router.stack.find(layer => layer.route?.path === '/import-csv').route.stack[0].handle;
  const result = {};
  const res = { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } };
  await handler({ body: { sendSms: true, leads: [{ name: 'Test Customer', phone: '0400000000', dealer: site }] } }, res);
  assert.equal(result.body.imported, 1);
  assert.equal(sends, 0);
  assert.equal(created[0].stage, 'NEW ENQUIRIES');
  assert.equal(created[0].control, 'Human');
});
