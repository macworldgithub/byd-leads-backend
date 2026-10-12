const test = require('node:test');
const assert = require('node:assert/strict');
const { getThreads } = require('../services/threadHistory');

test('combined history keeps Denza client and BYD lead identities at their own sites', async () => {
  const phone = '+61499918523';
  const records = {
    conversations: [
      { _id: 'byd-thread', leadId: 'byd-lead', phone, dealer: 'BYD Melbourne', messages: [{ id: 'a', sender: 'agent', text: 'BYD', createdAt: '2026-10-12T09:00:00Z' }] },
      { _id: 'denza-thread', leadId: null, phone, dealer: 'Denza Melbourne', messages: [{ id: 'b', sender: 'user', text: 'Denza', createdAt: '2026-10-12T10:00:00Z' }] },
    ],
    leads: [{ _id: 'byd-lead', phone, dealer: 'BYD Melbourne' }],
    clients: [{ id: 'denza-client', phone, site: 'Denza Melbourne' }],
    messages: [],
  };
  const db = { collection: name => ({ find: () => ({ toArray: async () => records[name] }) }) };
  const [thread] = await getThreads(db, db, { role: 'super_admin' });
  assert.equal(thread.dealer, 'Denza Melbourne');
  assert.equal(thread.leadId, null);
  assert.equal(thread.client_id, 'denza-client');
  assert.equal(thread.msgCount, 2);
  const [locked] = await getThreads(db, db, { role: 'sales_manager', locked_site: 'BYD Melbourne' });
  assert.equal(locked.leadId, 'byd-lead');
  assert.equal(locked.msgCount, 1);
});
