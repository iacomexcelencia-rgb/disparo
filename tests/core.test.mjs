import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { Store, id, defaultSettings } from '../server/store.mjs';
import { renderTemplate, contactFields, analyzeTemplate } from '../server/template.mjs';
import { normalizePhone, parseImport, csvEncode } from '../server/importer.mjs';
import {
  CampaignEngine,
  budgetAvailableAt,
  accountAvailableAt,
  createCampaign,
} from '../server/campaigns.mjs';

function setup(t) {
  const base = path.resolve('test-results');
  fs.mkdirSync(base, { recursive: true });
  const directory = fs.mkdtempSync(path.join(base, 'core-'));
  t.after(() => {
    assert.equal(path.dirname(directory), base);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const store = new Store(directory);
  const accountId = id();
  store.data.accounts.push({ id: accountId, name: 'Conta de teste' });
  const contact = {
    id: id(),
    name: 'Mariana Costa',
    phone: '+5511912345678',
    company: 'Estúdio',
    fields: {},
    listIds: [],
    optedOut: false,
  };
  store.data.contacts.push(contact);
  store.save();
  return { store, accountId, contact, directory };
}
const input = (accountId) => ({
  name: 'Teste',
  accountId,
  template: 'Olá {{primeiro_nome|pessoa}}',
  contactIds: [],
  listIds: [],
  groups: [],
  attachmentIds: [],
  allContacts: true,
  scheduledAt: null,
  timing: { ...defaultSettings },
});
test('template resolves fallbacks and variations without treating variable fallback as spintext', () => {
  assert.equal(
    renderTemplate(
      '{Oi|Olá}, {{nome|pessoa}}: {{empresa|sua empresa}}.',
      { nome: '', empresa: 'Acme' },
      () => 0.99,
    ),
    'Olá, pessoa: Acme.',
  );
  assert.equal(
    renderTemplate('{{constructor|seguro}}', {}, () => 0),
    'seguro',
  );
  assert.equal(renderTemplate('{{nome}}', { nome: '{A|B}' }), '{A|B}');
  assert.deepEqual(analyzeTemplate('{{nome}} {{empresa|negócio}}', [{ nome: '' }]), ['nome']);
  assert.equal(
    contactFields({ name: 'Ana Silva', phone: '+5511912345678', company: '', fields: {} })
      .primeiro_nome,
    'Ana',
  );
});
test('phones normalize nationally and internationally and reject invalid input', () => {
  assert.equal(normalizePhone('(11) 91234-5678'), '+5511912345678');
  assert.equal(normalizePhone('+1 202 555 0123'), '+12025550123');
  assert.equal(normalizePhone('1234'), null);
});
test('CSV and vCard parsers preserve data, duplicated columns, and multiple phone entries', async () => {
  const csv = await parseImport(
    Buffer.from('Nome;Telefone;Empresa;Nome\r\n"Ana; Silva";11912345678;Loja;Outro'),
    'base.csv',
  );
  assert.equal(csv.mapping.phone, 'Telefone');
  assert.equal(csv.rows[0].Nome, 'Ana; Silva');
  assert.equal(csv.rows[0]['Nome (2)'], 'Outro');
  const vcard = await parseImport(
    Buffer.from(
      'BEGIN:VCARD\nVERSION:3.0\nFN:Ana Silva\nTEL;CELL:+5511912345678\nTEL;WORK:+5511987654321\nORG:Loja\nEND:VCARD',
    ),
    'base.vcf',
  );
  assert.equal(vcard.rows.length, 2);
  assert.equal(vcard.rows[1].empresa, 'Loja');
  assert.match(csvEncode([['=1+1', '+5511912345678', 'texto "citado"']]), /'\=1\+1/);
});
test('XLSX parser reads a real workbook and identifies phone column', async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Base');
  sheet.addRow(['Nome', 'Telefone']);
  sheet.addRow(['Ana', '11912345678']);
  const parsed = await parseImport(Buffer.from(await book.xlsx.writeBuffer()), 'base.xlsx');
  assert.equal(parsed.rows[0].Nome, 'Ana');
  assert.equal(parsed.mapping.phone, 'Telefone');
});
test('campaign snapshot deduplicates overlapping lists and stays equal to the preview', (t) => {
  const { store, accountId, contact } = setup(t);
  const listId = id();
  contact.listIds = [listId];
  const campaign = createCampaign(store, {
    ...input(accountId),
    contactIds: [contact.id],
    listIds: [listId],
  });
  assert.equal(campaign.recipients.length, 1);
  assert.equal(campaign.recipients[0].body, 'Olá Mariana');
  contact.name = 'Outro nome';
  assert.equal(campaign.recipients[0].body, 'Olá Mariana');
  assert.equal(campaign.status, 'draft');
});
test('same-account campaigns share a rolling message budget and attachments cost messages', () => {
  const now = Date.now();
  const accountId = id();
  const campaign = {
    accountId,
    timing: { hourlyLimit: 2, dailyLimit: 10 },
    attachmentIds: [id()],
    recipients: [{ body: 'oi', status: 'pending' }],
  };
  const data = {
    campaigns: [
      {
        accountId,
        recipients: [
          { status: 'sent', attemptedAt: new Date(now - 1000).toISOString(), messageCost: 1 },
        ],
      },
    ],
  };
  assert.ok(budgetAvailableAt(data, campaign, now) > now);
  data.campaigns[0].accountId = id();
  assert.equal(budgetAvailableAt(data, campaign, now), now);
});
test('engine sends a recipient only once across concurrent ticks, preserving message body', async (t) => {
  const { store, accountId } = setup(t);
  const campaign = createCampaign(store, input(accountId));
  campaign.status = 'running';
  let sends = 0;
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const fake = {
    state: () => ({ status: 'ready' }),
    send: async (_account, recipient) => {
      sends++;
      assert.equal(recipient.body, 'Olá Mariana');
      await waiting;
      return { messageIds: ['test-message'], messageAcks: { 'test-message': 1 } };
    },
  };
  const engine = new CampaignEngine(store, fake);
  engine.tick();
  engine.tick();
  assert.equal(sends, 1);
  release();
  await Promise.all([...engine.tasks]);
  engine.tick();
  assert.equal(campaign.recipients[0].status, 'sent');
  assert.equal(campaign.status, 'completed');
  assert.equal(sends, 1);
});
test('uncertain delivery is persisted and the next contact proceeds after the account interval without retry', async (t) => {
  const { store, accountId, contact, directory } = setup(t);
  let now = Date.now();
  const sends = [];
  store.data.contacts.push({ ...contact, id: id(), name: 'Bruno', phone: '+5521987654321' });
  const attachmentId = id();
  store.data.attachments.push({ id: attachmentId });
  const campaign = createCampaign(store, { ...input(accountId), attachmentIds: [attachmentId] });
  campaign.status = 'running';
  const fake = {
    state: () => ({ status: 'ready' }),
    send: async (_account, recipient) => {
      sends.push(recipient.id);
      if (sends.length === 1)
        throw Object.assign(new Error('Falha após transmitir o texto'), {
          partial: true,
          messageIds: ['partial-message'],
        });
      return {
        messageIds: ['next-message', 'next-attachment'],
        messageAcks: { 'next-message': 1, 'next-attachment': 1 },
      };
    },
  };
  const engine = new CampaignEngine(store, fake, { now: () => now });
  engine.tick();
  await Promise.all([...engine.tasks]);
  const [uncertain, next] = campaign.recipients;
  assert.equal(campaign.status, 'running');
  assert.equal(uncertain.status, 'uncertain');
  assert.equal(next.status, 'pending');
  assert.match(uncertain.error, /Entrega parcial.*Falha após transmitir o texto/);
  assert.deepEqual(uncertain.messageIds, ['partial-message']);
  assert.equal(uncertain.finishedAt, new Date(now).toISOString());
  const persisted = JSON.parse(fs.readFileSync(path.join(directory, 'disparo.json'), 'utf8'));
  assert.equal(persisted.campaigns[0].recipients[0].status, 'uncertain');
  assert.equal(persisted.campaigns[0].status, 'running');
  now += 29999;
  engine.tick();
  await Promise.all([...engine.tasks]);
  assert.equal(sends.length, 1);
  now += 1;
  engine.tick();
  await Promise.all([...engine.tasks]);
  assert.deepEqual(sends, [uncertain.id, next.id]);
  assert.equal(next.status, 'sent');
  assert.equal(campaign.status, 'completed');
  now += 60000;
  engine.tick();
  await Promise.all([...engine.tasks]);
  assert.equal(sends.length, 2);
  const restored = new Store(directory);
  assert.equal(restored.data.campaigns[0].recipients[0].status, 'uncertain');
  assert.equal(restored.data.campaigns[0].status, 'completed');
});

test('disconnection after an uncertain delivery waits for reconnection without retrying that contact', async (t) => {
  const { store, accountId, contact } = setup(t);
  let now = Date.now();
  let ready = true;
  const sends = [];
  store.data.contacts.push({ ...contact, id: id(), name: 'Bruno', phone: '+5521987654321' });
  const campaign = createCampaign(store, input(accountId));
  campaign.status = 'running';
  const engine = new CampaignEngine(
    store,
    {
      state: () => ({ status: ready ? 'ready' : 'disconnected' }),
      send: async (_account, recipient) => {
        sends.push(recipient.id);
        if (sends.length === 1) {
          ready = false;
          throw new Error('Conexão perdida');
        }
        return { messageIds: ['next-message'] };
      },
    },
    { now: () => now },
  );
  engine.tick();
  await Promise.all([...engine.tasks]);
  now += 60000;
  engine.tick();
  await Promise.all([...engine.tasks]);
  assert.equal(sends.length, 1);
  assert.equal(campaign.status, 'running');
  ready = true;
  engine.tick();
  await Promise.all([...engine.tasks]);
  assert.deepEqual(
    sends,
    campaign.recipients.map((recipient) => recipient.id),
  );
  assert.equal(campaign.status, 'completed');
  assert.equal(campaign.recipients[0].status, 'uncertain');
});

test('an uncertain last delivery completes the campaign and preserves a manual pause during sending', async (t) => {
  const { store, accountId } = setup(t);
  const campaign = createCampaign(store, input(accountId));
  campaign.status = 'running';
  const engine = new CampaignEngine(store, {
    state: () => ({ status: 'ready' }),
    send: async () => {
      throw new Error('Resultado desconhecido');
    },
  });
  engine.tick();
  await Promise.all([...engine.tasks]);
  assert.equal(campaign.status, 'completed');
  assert.equal(campaign.recipients[0].status, 'uncertain');
  const paused = createCampaign(store, input(accountId));
  paused.status = 'running';
  store.data.accounts[0].nextSendAt = null;
  store.data.accounts[0].lastSendFinishedAt = null;
  // Apply the pause to the campaign currently being sent.
  engine.whatsapp.send = async () => {
    paused.status = 'paused';
    throw new Error('Resultado desconhecido');
  };
  engine.tick();
  await Promise.all([...engine.tasks]);
  assert.equal(paused.status, 'paused');
  assert.equal(paused.recipients[0].status, 'uncertain');
});
test('restart marks in-flight deliveries uncertain and never resumes a running campaign implicitly', (t) => {
  const { store, accountId, directory } = setup(t);
  const campaign = createCampaign(store, input(accountId));
  campaign.status = 'running';
  campaign.recipients[0].status = 'sending';
  store.save();
  const restored = new Store(directory);
  assert.equal(restored.data.campaigns[0].status, 'paused');
  assert.equal(restored.data.campaigns[0].recipients[0].status, 'uncertain');
});
test('scheduled campaigns wait until due and disconnected accounts wait for connection', async (t) => {
  const { store, accountId } = setup(t);
  let now = Date.now();
  const campaign = createCampaign(store, {
    ...input(accountId),
    scheduledAt: new Date(now + 10000).toISOString(),
  });
  campaign.status = 'scheduled';
  let ready = false;
  let sends = 0;
  const engine = new CampaignEngine(
    store,
    {
      state: () => ({ status: ready ? 'ready' : 'disconnected' }),
      send: async () => {
        sends++;
        return { messageIds: ['x'] };
      },
    },
    { now: () => now },
  );
  engine.tick();
  assert.equal(campaign.status, 'scheduled');
  now += 10001;
  engine.tick();
  assert.equal(campaign.status, 'running');
  assert.equal(sends, 0);
  ready = true;
  engine.tick();
  await Promise.all([...engine.tasks]);
  assert.equal(sends, 1);
});
test('a contact excluded after approval is skipped before the next delivery', async (t) => {
  const { store, accountId, contact } = setup(t);
  const campaign = createCampaign(store, input(accountId));
  campaign.status = 'running';
  contact.optedOut = true;
  const engine = new CampaignEngine(store, {
    state: () => ({ status: 'ready' }),
    send: async () => {
      throw new Error('Não deveria enviar');
    },
  });
  engine.tick();
  await Promise.all([...engine.tasks]);
  assert.equal(campaign.recipients[0].status, 'skipped');
});

test('account interval crosses completed campaigns and does not block a different account', async (t) => {
  const { store, accountId } = setup(t);
  let now = Date.now();
  const sends = [];
  const first = createCampaign(store, {
    ...input(accountId),
    timing: { ...defaultSettings, intervalSeconds: 60 },
  });
  const next = createCampaign(store, {
    ...input(accountId),
    timing: { ...defaultSettings, intervalSeconds: 3 },
  });
  first.status = 'running';
  next.status = 'running';
  const engine = new CampaignEngine(
    store,
    {
      state: () => ({ status: 'ready' }),
      send: async (account) => {
        sends.push(account);
        return { messageIds: ['x'] };
      },
    },
    { now: () => now },
  );
  engine.tick();
  await Promise.all([...engine.tasks]);
  assert.equal(first.status, 'completed');
  assert.equal(sends.length, 1);
  now += 59000;
  engine.tick();
  await Promise.all([...engine.tasks]);
  assert.equal(sends.length, 1);
  assert.ok(Date.parse(next.nextAt) > now);
  const otherAccount = id();
  store.data.accounts.push({ id: otherAccount });
  const independent = createCampaign(store, input(otherAccount));
  independent.status = 'running';
  engine.tick();
  await Promise.all([...engine.tasks]);
  assert.deepEqual(sends, [accountId, otherAccount]);
  now += 1000;
  engine.tick();
  await Promise.all([...engine.tasks]);
  assert.deepEqual(sends, [accountId, otherAccount, accountId]);
});

test('incoming campaign with a longer interval cannot shorten account pacing and survives restart', async (t) => {
  const { store, accountId, directory } = setup(t);
  const now = Date.now();
  const first = createCampaign(store, {
    ...input(accountId),
    timing: { ...defaultSettings, intervalSeconds: 3 },
  });
  first.status = 'running';
  const engine = new CampaignEngine(
    store,
    { state: () => ({ status: 'ready' }), send: async () => ({ messageIds: ['x'] }) },
    { now: () => now },
  );
  engine.tick();
  await Promise.all([...engine.tasks]);
  const next = createCampaign(store, {
    ...input(accountId),
    timing: { ...defaultSettings, intervalSeconds: 30 },
  });
  assert.equal(accountAvailableAt(store.data, next, now + 3000), now + 30000);
  const restored = new Store(directory);
  assert.equal(accountAvailableAt(restored.data, next, now + 3000), now + 30000);
  delete restored.data.accounts[0].lastSendFinishedAt;
  delete restored.data.accounts[0].nextSendAt;
  restored.save();
  const migrated = new Store(directory);
  assert.equal(accountAvailableAt(migrated.data, next, now + 3000), now + 30000);
});

test('old sent records without a server confirmation become awaiting confirmation while keeping account pacing', (t) => {
  const { store, accountId, directory } = setup(t);
  const now = Date.now();
  const campaign = createCampaign(store, input(accountId));
  campaign.status = 'completed';
  Object.assign(campaign.recipients[0], {
    status: 'sent',
    sentAt: new Date(now).toISOString(),
    messageIds: ['old-message'],
    ack: 0,
  });
  store.save();
  const restored = new Store(directory);
  const recipient = restored.data.campaigns[0].recipients[0];
  assert.equal(recipient.status, 'confirming');
  assert.equal(recipient.sentAt, undefined);
  assert.equal(recipient.submittedAt, new Date(now).toISOString());
  assert.equal(accountAvailableAt(restored.data, campaign, now + 1000), now + 30000);
});
