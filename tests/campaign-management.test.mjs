import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../server/index.mjs';
import { budgetAvailableAt } from '../server/campaigns.mjs';
import { id, defaultSettings } from '../server/store.mjs';

test('campaign edit/delete API preserves schedule, validates atomically, fences stale edits and keeps account budgets', async (t) => {
  const root = path.resolve('test-results');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'campaign-management-'));
  let release;
  let sends = 0;
  const fake = {
    state: () => ({ status: 'ready' }),
    close: async () => {},
    send: async () => {
      sends++;
      await new Promise((resolve) => {
        release = resolve;
      });
      return { messageIds: ['fake-test-message'], messageAcks: { 'fake-test-message': 1 } };
    },
  };
  const service = await startServer({
    port: 0,
    dataDir: directory,
    whatsapp: fake,
    startEngine: false,
  });
  t.after(async () => {
    release?.();
    await service.close();
    assert.equal(path.dirname(directory), root);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const request = async (route, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${service.port}/api${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Disparo': '1' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  const accountId = id(),
    listId = id(),
    attachmentId = id();
  const contacts = ['Ana', 'Bruno'].map((name, index) => ({
    id: id(),
    name,
    phone: `+551191234567${index}`,
    company: '',
    fields: {},
    listIds: [listId],
    optedOut: false,
  }));
  service.store.data.accounts.push({ id: accountId, name: 'Test account' });
  service.store.data.contacts.push(...contacts);
  service.store.data.lists.push({ id: listId, name: 'Test list', color: '#334455' });
  service.store.data.attachments.push({
    id: attachmentId,
    name: 'test.png',
    mimetype: 'image/png',
    size: 1,
  });
  const input = {
    name: 'Agendada',
    accountId,
    template: 'Olá {{primeiro_nome}}',
    listIds: [listId],
    attachmentIds: [attachmentId],
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    timing: { ...defaultSettings, hourlyLimit: 2, dailyLimit: 2 },
  };
  const created = await request('/campaigns', 'POST', input);
  assert.equal(created.status, 201);
  const campaignId = created.data.id;
  const route = `/campaigns/${campaignId}`;
  await request(`${route}/approve`, 'POST', {});
  const before = (await request(route)).data;
  const changed = {
    ...input,
    name: 'Agendada revisada',
    template: 'Tudo bem, {{nome}}?',
    listIds: [],
    contactIds: [contacts[1].id],
    timing: { ...input.timing, intervalSeconds: 90 },
    scheduledAt: new Date(Date.now() + 172800000).toISOString(),
    expectedRevision: 0,
  };
  const edited = await request(route, 'PUT', changed);
  assert.equal(edited.status, 200);
  assert.equal(edited.data.id, campaignId);
  assert.equal(edited.data.createdAt, before.createdAt);
  assert.equal(edited.data.approvedAt, before.approvedAt);
  assert.equal(edited.data.status, 'scheduled');
  assert.equal(edited.data.scheduledAt, changed.scheduledAt);
  assert.equal(edited.data.recipients.length, 1);
  assert.equal(edited.data.recipients[0].body, 'Tudo bem, Bruno?');
  assert.deepEqual(edited.data.attachmentIds, [attachmentId]);
  assert.equal(edited.data.timing.intervalSeconds, 90);
  assert.equal(edited.data.revision, 1);
  assert.equal(sends, 0);
  assert.equal((await request(route, 'PUT', changed)).status, 409);
  for (const invalid of [
    { contactIds: [] },
    { template: '', attachmentIds: [] },
    { attachmentIds: [id()] },
    { scheduledAt: new Date(Date.now() - 10000).toISOString() },
    { scheduledAt: null },
  ]) {
    assert.equal(
      (await request(route, 'PUT', { ...changed, expectedRevision: 1, ...invalid })).status,
      400,
    );
    assert.deepEqual((await request(route)).data, edited.data);
  }
  // Paused campaigns stay paused when the schedule is removed; nothing starts from saving.
  await request(`${route}/pause`, 'POST', {});
  assert.equal(
    (await request(route, 'PUT', { ...changed, expectedRevision: 1, scheduledAt: null })).data
      .status,
    'paused',
  );
  await request(`${route}/resume`, 'POST', {});
  const task = service.engine.step(service.store.data.campaigns[0]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sends, 1);
  assert.equal((await request(route, 'DELETE')).status, 409);
  assert.equal((await request(route, 'PUT', { ...changed, expectedRevision: 2 })).status, 409);
  await request(`${route}/pause`, 'POST', {});
  release();
  await task;
  const sent = service.store.data.campaigns[0];
  const next = await request('/campaigns', 'POST', {
    ...input,
    name: 'Próxima',
    attachmentIds: [],
    scheduledAt: null,
  });
  const nextCampaign = service.store.data.campaigns.find(
    (campaign) => campaign.id === next.data.id,
  );
  const now = Date.now();
  const budgetBefore = budgetAvailableAt(service.store.data, nextCampaign, now);
  assert.ok(budgetBefore > now);
  const accountBefore = structuredClone(service.store.data.accounts[0]);
  const board = service.store.data.workspaces[0];
  board.placements.campaigns[campaignId] = { columnId: board.columns[0].id, status: sent.status };
  service.store.data.replyEvents.push({ campaignId, accountId, messageId: 'test-reply' });
  assert.equal((await request(route, 'DELETE')).status, 200);
  assert.equal((await request(route)).status, 404);
  assert.equal((await request(`/workspace/campaigns/${campaignId}`)).status, 404);
  assert.equal(budgetAvailableAt(service.store.data, nextCampaign, now), budgetBefore);
  assert.deepEqual(service.store.data.accounts[0], accountBefore);
  assert.equal(service.store.data.replyEvents.length, 0);
  assert.equal(board.placements.campaigns[campaignId], undefined);
  assert.equal(service.store.data.contacts.length, 2);
  assert.equal(service.store.data.attachments.length, 1);
  const saved = JSON.parse(fs.readFileSync(path.join(directory, 'disparo.json'), 'utf8'));
  assert.equal(saved.campaigns.length, 1);
  assert.equal(saved.campaigns[0].id, next.data.id);
  assert.equal(saved.messageUsage.length, 1);
  assert.equal(saved.messageUsage[0].cost, 2);
  assert.equal('body' in saved.messageUsage[0], false);
  assert.equal((await request(route, 'DELETE')).status, 404);
});

test('group-only edits can reuse a saved group without reconnecting; another account cannot inherit it', async (t) => {
  const root = path.resolve('test-results');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'group-edit-'));
  const fake = {
    state: () => ({ status: 'disconnected' }),
    close: async () => {},
    groups: async () => [{ id: '123456789@g.us', name: 'Grupo teste' }],
  };
  const service = await startServer({
    port: 0,
    dataDir: directory,
    whatsapp: fake,
    startEngine: false,
  });
  t.after(async () => {
    await service.close();
    assert.equal(path.dirname(directory), root);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const request = async (route, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${service.port}/api${route}`, {
      method,
      headers: { 'X-Disparo': '1', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  const a = id(),
    b = id();
  service.store.data.accounts.push({ id: a, name: 'A' }, { id: b, name: 'B' });
  await request(`/accounts/${a}/groups`);
  const input = {
    name: 'Grupo',
    accountId: a,
    template: 'Olá',
    groups: fake.groups && (await fake.groups()),
    timing: defaultSettings,
  };
  const created = await request('/campaigns', 'POST', input);
  assert.equal(created.status, 201);
  assert.equal(
    (
      await request(`/campaigns/${created.data.id}`, 'PUT', {
        ...input,
        expectedRevision: 0,
        template: 'Atualizada',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request(`/campaigns/${created.data.id}`, 'PUT', {
        ...input,
        accountId: b,
        expectedRevision: 1,
      })
    ).status,
    400,
  );
});
