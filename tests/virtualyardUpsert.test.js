const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { buildPlan } = require('../seed/upsert-both');
const snapshot = '2026-10-11T13:36:33.083Z';
const item = { leadId: 'external-1', customer: { fullName: 'Updated Customer', phone: '0400000000' }, vehicle: { raw: 'BYD ATTO 3', vehicleId: 'stock-1', model: 'ATTO 3', yard: 'BYD Caroline Springs' }, stage: 'in_contact', scrapedAt: snapshot };
const empty = () => ({ leads: [], appointments: [], inventories: [] });
const payload = (leads = [item], testDrives = []) => ({ scrapedAt: snapshot, leads, testDrives });
function apply(stored, plans) {
  return Object.fromEntries(Object.keys(stored).map(collection => {
    const result = stored[collection].map(doc => ({ ...doc }));
    for (const { updateOne: op } of plans[collection].operations) {
      if (op.update.$setOnInsert) result.push(op.update.$setOnInsert);
      else Object.assign(result.find(doc => String(doc._id) === String(op.filter._id)), op.update.$set);
    }
    return [collection, result];
  }));
}

test('new records have stable IDs and a second import has no operations', () => {
  const first = buildPlan(payload(), empty());
  assert.equal(first.leads.inserted, 1);
  assert.equal(first.inventories.inserted, 1);
  const second = buildPlan(payload(), apply(empty(), first));
  assert.equal(second.leads.operations.length, 0);
  assert.equal(second.inventories.operations.length, 0);
});

test('updates preserve Mongo IDs, staff notes, consent and manual SMS control', () => {
  const stored = empty();
  stored.leads.push({ _id: new mongoose.Types.ObjectId(), platform: 'virtualyard', leadId: item.leadId, virtualyardId: item.leadId, name: 'Old Name', notes: 'Staff note', do_not_contact: true, tag: 'Opted Out', status: 'opted out', stage: 'OPTED OUT', control: 'Human', updatedAt: new Date(snapshot) });
  const plan = buildPlan(payload(), stored);
  const patch = plan.leads.operations[0].updateOne;
  assert.equal(String(patch.filter._id), String(stored.leads[0]._id));
  assert.equal(patch.update.$set.name, 'Updated Customer');
  assert.equal(patch.update.$set.notes, undefined);
  assert.equal(patch.update.$set.do_not_contact, undefined);
  assert.equal(patch.update.$set.status, undefined);
  assert.equal(patch.update.$set.control, undefined);
});

test('duplicate existing identities are refreshed without inserting more duplicates', () => {
  const stored = empty();
  stored.leads = [1, 2].map(() => ({ _id: new mongoose.Types.ObjectId(), platform: 'virtualyard', leadId: item.leadId, name: 'Old Name' }));
  const plan = buildPlan(payload(), stored);
  assert.equal(plan.leads.updated, 2);
  assert.equal(plan.leads.inserted, 0);
});

test('a legacy Virtual Yard alias is not assigned a canonical leadId already owned by another record', () => {
  const stored = empty();
  stored.leads = [
    { _id: new mongoose.Types.ObjectId(), platform: 'virtualyard', virtualyardId: item.leadId, name: 'Legacy Record' },
    { _id: new mongoose.Types.ObjectId(), platform: 'virtualyard', virtualyardId: item.leadId, leadId: item.leadId, name: 'Canonical Record' },
  ];
  const plan = buildPlan(payload(), stored);
  assert.equal(plan.leads.updated, 2);
  assert.equal(plan.leads.inserted, 0);
  assert.equal(plan.leads.operations[0].updateOne.update.$set.leadId, undefined);
  assert.equal(plan.leads.operations[1].updateOne.update.$set.leadId, undefined);
});

test('non-Virtual Yard records remain outside the update plan', () => {
  const stored = empty();
  const unrelated = { _id: new mongoose.Types.ObjectId(), platform: 'manual', leadId: item.leadId, name: 'Manual Record' };
  stored.leads.push(unrelated);
  const plan = buildPlan(payload(), stored);
  assert.equal(plan.leads.updated, 0);
  assert.equal(plan.leads.inserted, 1);
  assert.equal(stored.leads[0].name, 'Manual Record');
});

test('unmatched test drives are retained and booked manually without duplicate reruns', () => {
  const source = payload([], [{ _id: 'drive-1', leadId: 'missing-lead', customer: { fullName: 'Test Customer' }, location: 'BYD Melbourne City', testDriveDate: '2026-10-15T10:00:00Z', scrapedAt: snapshot }]);
  const plan = buildPlan(source, empty());
  assert.equal(plan.leads.inserted, 1);
  assert.equal(plan.appointments.inserted, 1);
  assert.equal(plan.appointments.operations[0].updateOne.update.$setOnInsert.bookedBy, 'Manual');
  const second = buildPlan(source, apply(empty(), plan));
  assert.equal(second.leads.operations.length, 0);
  assert.equal(second.appointments.operations.length, 0);
});
