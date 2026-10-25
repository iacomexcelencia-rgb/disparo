import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store, id, defaultSettings } from '../server/store.mjs';
import { createCampaign } from '../server/campaigns.mjs';
import { ReplyTracker } from '../server/replies.mjs';
import { workspaceData } from '../server/workspace.mjs';
import { recipientStats } from '../server/stats.mjs';
import { startServer } from '../server/index.mjs';

function fixture(t) {
  const root = path.resolve('test-results');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'workspace-'));
  const resources = [];
  t.after(async () => {
    for (const resource of resources) await resource.close();
    assert.equal(path.dirname(directory), root);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const store = new Store(directory);
  const accountId = id();
  const list = { id: id(), name: 'Clientes', color: '#789866' };
  const contact = {
    id: id(),
    name: 'Ana',
    phone: '+5511912345678',
    company: 'Loja',
    listIds: [list.id],
    fields: {},
    optedOut: false,
  };
  store.data.accounts.push({ id: accountId, name: 'Conta de teste' });
  store.data.lists.push(list);
  store.data.contacts.push(contact);
  const now = Date.now();
  const campaign = (ago = 10000) => {
    const campaign = createCampaign(store, {
      accountId,
      name: `Campanha ${ago}`,
      template: 'Olá {{nome}}',
      contactIds: [],
      listIds: [list.id],
      allContacts: false,
      groups: [],
      attachmentIds: [],
      scheduledAt: null,
      timing: defaultSettings,
    });
    campaign.status = 'completed';
    campaign.approvedAt = new Date(now - ago - 1000).toISOString();
    campaign.createdAt = new Date(now - ago - 2000).toISOString();
    Object.assign(campaign.recipients[0], {
      status: 'sent',
      ack: 2,
      attemptedAt: new Date(now - ago).toISOString(),
      sentAt: new Date(now - ago).toISOString(),
      messageIds: [`true_5511912345678@c.us_${campaign.id}`],
      messageAcks: { [`true_5511912345678@c.us_${campaign.id}`]: 2 },
    });
    return campaign;
  };
  const incoming = (messageId = 'incoming', values = {}) => ({
    id: messageId,
    phone: '5511912345678',
    chatId: '5511912345678@c.us',
    body: 'Quero saber mais',
    timestamp: Math.floor(now / 1000),
    ...values,
  });
  return { store, accountId, list, contact, directory, campaign, incoming, now, resources };
}

test('500 confirmed recipients and 150 responders leave exactly 350 without a recorded response', () => {
  const recipients = Array.from({ length: 500 }, (_, index) => ({
    id: String(index),
    type: 'contact',
    status: 'sent',
    ack: 2,
    messageAcks: { text: 2, image: 2 },
    ...(index < 150 ? { reply: { firstAt: '2026-10-24T12:00:00Z', count: 3 } } : {}),
  }));
  recipients.push(
    { type: 'contact', status: 'pending' },
    { type: 'contact', status: 'uncertain' },
    { type: 'contact', status: 'failed' },
  );
  const stats = recipientStats(recipients);
  assert.equal(stats.sent, 500);
  assert.equal(stats.responded, 150);
  assert.equal(stats.noReply, 350);
  assert.equal(stats.responseRate, 30);
  assert.equal(stats.responseEligible, 500);
  assert.equal(stats.replies, 450);
  assert.equal(stats.messagesConfirmed, 1000);
});

test('responses attribute to the latest attempted campaign in the same account; quoted messages select the original', (t) => {
  const f = fixture(t);
  const old = f.campaign(20000);
  const latest = f.campaign(10000);
  const tracker = new ReplyTracker(f.store);
  assert.equal(tracker.receive(f.accountId, f.incoming()).campaignId, latest.id);
  assert.equal(old.recipients[0].reply, undefined);
  assert.equal(latest.recipients[0].reply.count, 1);
  assert.equal(
    tracker.receive(f.accountId, f.incoming('quoted', { quotedStanzaId: old.id })).campaignId,
    old.id,
  );
  assert.equal(old.recipients[0].reply.count, 1);
  assert.equal(
    tracker.receive(
      f.accountId,
      f.incoming('unknown-quote', { quotedStanzaId: 'not-in-this-campaign' }),
    ),
    null,
  );
  assert.equal(tracker.receive(id(), f.incoming('another-account')), null);
  assert.equal(
    tracker.receive(f.accountId, f.incoming('wrong-person', { phone: '5511987654321' })),
    null,
  );
});

test('deduplication survives restart, counts one responder and preserves every distinct incoming message', (t) => {
  const f = fixture(t);
  const campaign = f.campaign();
  const tracker = new ReplyTracker(f.store);
  tracker.receive(f.accountId, f.incoming('one'));
  tracker.receive(f.accountId, f.incoming('one'));
  tracker.receive(f.accountId, f.incoming('two', { body: '', media: true, type: 'image' }));
  assert.equal(f.store.data.replyEvents.length, 2);
  assert.equal(campaign.recipients[0].reply.count, 2);
  assert.equal(recipientStats(campaign.recipients).responded, 1);
  const restarted = new Store(f.directory);
  const second = new ReplyTracker(restarted);
  assert.equal(second.receive(f.accountId, f.incoming('two')), null);
  assert.equal(restarted.data.replyEvents.length, 2);
  assert.equal(restarted.data.campaigns[0].recipients[0].reply.count, 2);
});

test('pending, skipped, drafts, own messages, groups and old or malformed events do not create response successes', (t) => {
  const f = fixture(t);
  const campaign = f.campaign();
  const tracker = new ReplyTracker(f.store);
  for (const status of ['pending', 'skipped', 'failed']) {
    campaign.recipients[0].status = status;
    assert.equal(tracker.receive(f.accountId, f.incoming(status)), null);
  }
  campaign.recipients[0].status = 'sent';
  for (const values of [
    { fromMe: true },
    { broadcast: true },
    { isStatus: true },
    { chatId: '123@g.us' },
    { timestamp: NaN },
    { timestamp: (f.now + 600000) / 1000 },
    { timestamp: (f.now - 30000) / 1000 },
  ])
    assert.equal(tracker.receive(f.accountId, f.incoming(id(), values)), null);
  campaign.approvedAt = null;
  assert.equal(tracker.receive(f.accountId, f.incoming('draft')), null);
  assert.equal(f.store.data.replyEvents.length, 0);
});

test('a reply during an uncertain multipart send records interaction without claiming delivery of attachments', (t) => {
  const f = fixture(t);
  const campaign = f.campaign();
  Object.assign(campaign.recipients[0], {
    status: 'uncertain',
    ack: 0,
    expectedMessages: 2,
    messageAcks: {},
  });
  new ReplyTracker(f.store).receive(f.accountId, f.incoming());
  assert.equal(campaign.recipients[0].status, 'uncertain');
  const stats = recipientStats(campaign.recipients);
  assert.equal(stats.responded, 1);
  assert.equal(stats.sent, 0);
  assert.equal(stats.delivered, 0);
  assert.equal(stats.uncertain, 1);
  assert.equal(stats.responseRate, 100);
});

test('a quick reply in the same second as the send is recorded despite timestamp precision', (t) => {
  const f = fixture(t);
  const campaign = f.campaign();
  campaign.recipients[0].attemptedAt = new Date(
    Math.floor(f.now / 1000) * 1000 + 250,
  ).toISOString();
  assert.ok(new ReplyTracker(f.store).receive(f.accountId, f.incoming()));
});

test('list totals use immutable participation snapshots, keep mixed statuses and distinguish people from participations', (t) => {
  const f = fixture(t);
  const old = f.campaign(20000);
  const latest = f.campaign(10000);
  latest.status = 'running';
  new ReplyTracker(f.store).receive(f.accountId, f.incoming());
  f.contact.listIds = [];
  f.list.name = 'Clientes renomeados';
  const result = workspaceData(f.store.data).lists[0];
  assert.equal(result.status, 'running');
  assert.equal(result.campaigns.length, 2);
  assert.equal(result.stats.total, 2);
  assert.equal(result.stats.responded, 1);
  assert.equal(result.stats.noReply, 1);
  assert.equal(result.uniqueContacts, 1);
  assert.equal(result.uniqueResponders, 1);
  assert.equal(result.contactCount, 0);
  assert.deepEqual(result.statusCounts, { running: 1, completed: 1 });
  assert.equal(old.recipients[0].listSnapshot[0].name, 'Clientes');
});

test('new installations omit attendance; migration archives the old modules once without deleting their content', (t) => {
  const f = fixture(t);
  assert.equal(f.store.data.ai, undefined);
  assert.equal(f.store.data.funnels, undefined);
  const old = {
    ai: { enabled: true },
    offers: [{ id: 'old-offer' }],
    calendar: { timezone: 'America/Sao_Paulo' },
    appointments: [{ id: 'old-event' }],
    conversations: [{ messages: [{ status: 'queued', body: 'Do not send' }] }],
    funnels: [{ id: 'old-board' }],
    opportunities: [{ notes: ['keep'] }],
  };
  Object.assign(f.store.data, old);
  f.store.save();
  const migrated = new Store(f.directory);
  for (const key of Object.keys(old)) {
    assert.equal(migrated.data[key], undefined);
    assert.deepEqual(migrated.data.legacyModules[key], old[key]);
  }
  const boardId = migrated.data.workspaces[0].id;
  const reopened = new Store(f.directory);
  assert.equal(reopened.data.workspaces[0].id, boardId);
  assert.deepEqual(reopened.data.legacyModules, migrated.data.legacyModules);
});

test('workspace API persists independent layouts, renames/reorders/deletes columns and never mutates actual dispatch statuses', async (t) => {
  const f = fixture(t);
  const campaign = f.campaign();
  f.store.save();
  const fake = {
    state: () => ({ status: 'ready' }),
    close: async () => {},
    send: async () => {
      throw new Error('This test must not send WhatsApp.');
    },
  };
  const service = await startServer({
    port: 0,
    dataDir: f.directory,
    whatsapp: fake,
    startEngine: false,
  });
  f.resources.push(service);
  const base = `http://127.0.0.1:${service.port}/api`;
  const request = async (url, body, method = 'POST') => {
    const result = await fetch(base + url, {
      method,
      headers: { 'X-Disparo': '1', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: result.status, data: await result.json() };
  };
  const board = service.store.data.workspaces[0];
  const custom = (
    await request(`/workspaces/${board.id}/columns`, {
      name: 'Minha conferência',
      color: '#123456',
    })
  ).data;
  assert.equal(
    (
      await request(`/workspaces/${board.id}/move`, {
        view: 'campaigns',
        entityId: campaign.id,
        columnId: custom.id,
      })
    ).status,
    200,
  );
  assert.equal(service.store.data.campaigns[0].status, 'completed');
  assert.equal(
    (
      await request(
        `/workspaces/${board.id}/columns/${custom.id}`,
        { name: 'Conferência final', color: '#123456' },
        'PUT',
      )
    ).status,
    200,
  );
  const order = board.columns.map((item) => item.id).reverse();
  assert.equal(
    (await request(`/workspaces/${board.id}/columns/order`, { columnIds: order }, 'PUT')).status,
    200,
  );
  assert.deepEqual(
    board.columns.map((item) => item.id),
    order,
  );
  const next = (await request('/workspaces', { name: 'Outra operação' })).data;
  assert.equal(next.placements.campaigns[campaign.id], undefined);
  const completed = board.columns.find((item) => item.statuses.includes('completed'));
  assert.equal(
    (
      await request(
        `/workspaces/${board.id}/columns/${completed.id}`,
        { moveToColumnId: custom.id },
        'DELETE',
      )
    ).status,
    200,
  );
  assert.ok(board.columns.find((item) => item.id === custom.id).statuses.includes('completed'));
  assert.equal(
    (
      await request(
        `/workspaces/${board.id}/columns/${custom.id}`,
        { moveToColumnId: custom.id },
        'DELETE',
      )
    ).status,
    400,
  );
  const current = await request('/state', undefined, 'GET');
  assert.equal(current.data.workspaces.length, 2);
  assert.equal(current.data.ai, undefined);
  assert.equal(current.data.funnels, undefined);
  for (const endpoint of [
    '/assistant',
    '/assistant/calendar',
    '/assistant/credentials/groq',
    '/funnels',
  ])
    assert.equal((await request(endpoint, undefined, 'GET')).status, 404);
  assert.equal(service.assistant, undefined);
  fake.onIncoming(f.accountId, f.incoming('api-response'));
  service.store.data.accounts[0].phoneAliases = { '123456789012345@lid': '5511912345678' };
  fake.onIncoming(
    f.accountId,
    f.incoming('lid-response', { phone: undefined, chatId: '123456789012345@lid' }),
  );
  const detail = (await request(`/workspace/campaigns/${campaign.id}`, undefined, 'GET')).data;
  assert.equal(detail.stats.responded, 1);
  assert.equal(detail.replies[0].body, 'Quero saber mais');
  const listDetail = (await request(`/workspace/lists/${f.list.id}`, undefined, 'GET')).data;
  assert.equal(listDetail.stats.responded, 1);
  assert.equal(listDetail.recipients.length, 1);
  const csv = await fetch(`${base}/campaigns/${campaign.id}/export`).then((response) =>
    response.text(),
  );
  assert.match(csv, /Respondeu/);
  assert.match(csv, /Sim/);
  const persisted = JSON.parse(fs.readFileSync(service.store.file, 'utf8'));
  assert.equal(persisted.replyEvents.length, 2);
  assert.equal(persisted.workspaces[0].placements.campaigns[campaign.id].columnId, custom.id);
});
