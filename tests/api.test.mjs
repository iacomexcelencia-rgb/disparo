import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../server/index.mjs';

test('local API: contacts, import, exact review, approval, simulation, export and persistence', async (t) => {
  const testRoot = path.resolve('test-results');
  fs.mkdirSync(testRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(testRoot, 'api-'));
  let ready = false;
  const sends = [];
  const fake = {
    state: () => ({ status: ready ? 'ready' : 'disconnected' }),
    connect: async () => {
      ready = true;
    },
    close: async () => {},
    disconnect: async () => {
      ready = false;
    },
    groups: async () => [{ id: '123456789@g.us', name: 'Grupo de teste' }],
    send: async (accountId, recipient) => {
      sends.push(recipient.body);
      const messageId = `fake-${sends.length}`;
      fake.onMessage(accountId, recipient.id, { messageId, ack: 0 });
      fake.onAck(accountId, messageId, 1);
      assert.equal(recipient.status, 'sending');
      return { messageIds: [messageId] };
    },
  };
  const service = await startServer({
    port: 0,
    dataDir: directory,
    whatsapp: fake,
    startEngine: false,
  });
  t.after(async () => {
    await service.close();
    assert.equal(path.dirname(directory), testRoot);
    fs.rmSync(directory, { force: true, recursive: true });
  });
  const base = `http://127.0.0.1:${service.port}/api`;
  const req = async (url, body, method = 'POST') => {
    const response = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Disparo': '1' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  const account = await req('/accounts', { name: 'Minha conta' });
  assert.equal(account.status, 201);
  const list = await req('/lists', { name: 'Clientes' });
  assert.equal(list.status, 201);
  const contact = await req('/contacts', {
    name: 'Ana Silva',
    phone: '11912345678',
    company: 'Loja',
    listIds: [list.data.id],
  });
  assert.equal(contact.status, 201);
  const duplicate = await req('/contacts', { name: 'Outro', phone: '+5511912345678' });
  assert.equal(duplicate.status, 400);
  const form = new FormData();
  form.append(
    'file',
    new Blob(
      [
        'Nome;Telefone;Empresa\nAna Silva;11912345678;Loja\nBruno;21987654321;Mercado\nInválido;abc;Teste',
      ],
      { type: 'text/csv' },
    ),
    'base.csv',
  );
  const previewResponse = await fetch(base + '/imports/preview', {
    method: 'POST',
    headers: { 'X-Disparo': '1' },
    body: form,
  });
  const preview = await previewResponse.json();
  assert.equal(preview.total, 3);
  const committed = await req('/imports/commit', {
    token: preview.token,
    mapping: preview.mapping,
    country: 'BR',
    listIds: [list.data.id],
  });
  assert.equal(committed.data.added, 1);
  assert.equal(committed.data.updated, 1);
  assert.equal(committed.data.invalid.length, 1);
  const campaign = await req('/campaigns', {
    name: 'Teste',
    accountId: account.data.id,
    template: 'Olá {{primeiro_nome}} da {{empresa|sua empresa}}',
    listIds: [list.data.id],
    timing: { intervalSeconds: 3, hourlyLimit: 60, dailyLimit: 200, typingSeconds: 0 },
  });
  assert.equal(campaign.status, 201);
  assert.equal(campaign.data.recipients.length, 2);
  assert.equal(sends.length, 0);
  assert.equal(campaign.data.recipients[0].body, 'Olá Ana da Loja');
  assert.equal((await req(`/campaigns/${campaign.data.id}/approve`, {})).status, 400);
  await req(`/accounts/${account.data.id}/connect`, {});
  assert.equal((await req(`/campaigns/${campaign.data.id}/approve`, {})).status, 200);
  assert.equal((await req(`/campaigns/${campaign.data.id}/approve`, {})).status, 400);
  service.engine.tick();
  await Promise.all([...service.engine.tasks]);
  assert.equal(sends.length, 1);
  const sentRecipient = service.store.data.campaigns[0].recipients[0];
  assert.equal(sentRecipient.status, 'sent');
  assert.equal(sentRecipient.ack, 1);
  sentRecipient.messageIds.push('fake-attachment');
  fake.onAck(account.data.id, 'fake-1', 3);
  assert.equal(sentRecipient.ack, 0);
  fake.onAck(account.data.id, 'fake-attachment', 2);
  assert.equal(sentRecipient.ack, 2);
  assert.equal((await req(`/campaigns/${campaign.data.id}/pause`, {})).status, 200);
  service.engine.tick();
  assert.equal(sends.length, 1);
  const report = await fetch(base + `/campaigns/${campaign.data.id}/export`);
  assert.equal(report.status, 200);
  assert.match(await report.text(), /Olá Ana da Loja/);
  const persisted = JSON.parse(fs.readFileSync(path.join(directory, 'disparo.json'), 'utf8'));
  assert.equal(persisted.contacts.length, 2);
  assert.equal(persisted.campaigns[0].recipients[0].status, 'sent');
  const forbidden = await fetch(base + '/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"name":"Outra"}',
  });
  assert.equal(forbidden.status, 403);
  const external = await fetch(base + '/state', { headers: { Origin: 'https://evil.example' } });
  assert.equal(external.status, 403);
  const exportContacts = await fetch(base + '/contacts/export');
  assert.match(await exportContacts.text(), /Ana Silva/);
  await assert.rejects(startServer({ port: 0, dataDir: directory, whatsapp: fake }), {
    code: 'INSTANCE_RUNNING',
  });
});

test('negative acknowledgements persist in history and CSV without pausing subsequent contacts or reopening a completed campaign', async (t) => {
  const testRoot = path.resolve('test-results');
  fs.mkdirSync(testRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(testRoot, 'ack-'));
  let now = Date.now();
  const sends = [];
  const fake = {
    state: () => ({ status: 'ready' }),
    close: async () => {},
    send: async (_account, recipient) => {
      sends.push(recipient.id);
      return { messageIds: [`message-${sends.length}`] };
    },
  };
  const service = await startServer({
    port: 0,
    dataDir: directory,
    whatsapp: fake,
    startEngine: false,
  });
  service.engine.now = () => now;
  t.after(async () => {
    await service.close();
    assert.equal(path.dirname(directory), testRoot);
    fs.rmSync(directory, { force: true, recursive: true });
  });
  const base = `http://127.0.0.1:${service.port}/api`;
  const post = async (url, body) => {
    const response = await fetch(base + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Disparo': '1' },
      body: JSON.stringify(body),
    });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  };
  const account = await post('/accounts', { name: 'Conta simulada' });
  await post('/contacts', { name: 'Ana', phone: '11912345678' });
  await post('/contacts', { name: 'Bruno', phone: '21987654321' });
  const draft = await post('/campaigns', {
    name: 'Confirmações simuladas',
    accountId: account.id,
    template: 'Olá {{primeiro_nome}}',
    allContacts: true,
    timing: { intervalSeconds: 30, hourlyLimit: 60, dailyLimit: 200, typingSeconds: 0 },
  });
  await post(`/campaigns/${draft.id}/approve`, {});
  const campaign = service.store.data.campaigns[0];
  service.engine.tick();
  await Promise.all([...service.engine.tasks]);
  fake.onAck(account.id, 'message-1', -1);
  assert.equal(campaign.status, 'running');
  assert.equal(campaign.recipients[0].status, 'failed');
  assert.match(campaign.recipients[0].error, /WhatsApp informou falha/);
  const refreshed = await (await fetch(base + `/campaigns/${draft.id}`)).json();
  assert.equal(refreshed.recipients[0].status, 'failed');
  assert.equal(refreshed.status, 'running');
  now += 30000;
  service.engine.tick();
  await Promise.all([...service.engine.tasks]);
  assert.equal(sends.length, 2);
  assert.equal(campaign.status, 'completed');
  fake.onAck(account.id, 'message-2', -1);
  assert.equal(campaign.status, 'completed');
  assert.equal(campaign.recipients[1].status, 'failed');
  now += 60000;
  service.engine.tick();
  await Promise.all([...service.engine.tasks]);
  assert.equal(sends.length, 2);
  const persisted = JSON.parse(fs.readFileSync(path.join(directory, 'disparo.json'), 'utf8'));
  assert.ok(
    persisted.campaigns[0].recipients.every(
      (recipient) => recipient.status === 'failed' && recipient.ack === -1,
    ),
  );
  const report = await (await fetch(base + `/campaigns/${draft.id}/export`)).text();
  assert.match(report, /failed/);
  assert.match(report, /WhatsApp informou falha/);
});
