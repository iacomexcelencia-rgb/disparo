import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { startServer } from '../server/index.mjs';
import { createCampaign } from '../server/campaigns.mjs';
import { id, defaultSettings } from '../server/store.mjs';
import { WhatsAppManager } from '../server/whatsapp.mjs';

const root = path.resolve('test-results/workspace-ui');
const directory = path.join(root, 'data');
assert.equal(path.dirname(directory), root);
fs.rmSync(directory, { recursive: true, force: true });
fs.mkdirSync(root, { recursive: true });
const fake = {
  state: () => ({ status: 'ready' }),
  close: async () => {},
  send: async () => {
    throw new Error('UI test must never dispatch WhatsApp.');
  },
};
const service = await startServer({
  port: 0,
  dataDir: directory,
  whatsapp: fake,
  startEngine: false,
});
let browser;
try {
  const data = service.store.data;
  const accountId = id();
  data.accounts.push({ id: accountId, name: 'Comercial · demonstração' });
  const list = { id: id(), name: 'Clientes de outubro', color: '#789866' };
  data.lists.push(list);
  for (let index = 0; index < 500; index++)
    data.contacts.push({
      id: id(),
      name: `Contato de demonstração ${index + 1}`,
      phone: `+55119${String(10000000 + index)}`,
      company: 'Empresa de demonstração',
      fields: {},
      listIds: [list.id],
      optedOut: false,
    });
  const create = (name) =>
    createCampaign(service.store, {
      name,
      accountId,
      template: 'Olá, {{primeiro_nome}}! Temos novidades para sua empresa. Podemos conversar?',
      allContacts: true,
      contactIds: [],
      listIds: [],
      groups: [],
      attachmentIds: [],
      scheduledAt: null,
      timing: defaultSettings,
    });
  const completed = create('Novidades de outubro');
  completed.status = 'completed';
  const at = new Date(Date.now() - 60000).toISOString();
  completed.approvedAt = at;
  completed.finishedAt = at;
  for (let index = 0; index < completed.recipients.length; index++) {
    const recipient = completed.recipients[index];
    Object.assign(recipient, {
      status: 'sent',
      ack: 2,
      attemptedAt: at,
      sentAt: at,
      expectedMessages: 1,
      messageIds: [`true_${index}@c.us_DEMO`],
      messageAcks: { [`true_${index}@c.us_DEMO`]: 2 },
    });
    if (index < 150) {
      recipient.reply = { firstAt: at, lastAt: at, count: 1 };
      data.replyEvents.push({
        accountId,
        messageId: `demo-reply-${index}`,
        campaignId: completed.id,
        recipientId: recipient.id,
        receivedAt: at,
        body: 'Olá! Quero conhecer a novidade, pode me contar.',
        type: 'chat',
        hasMedia: false,
        attribution: 'latest-campaign',
      });
    }
  }
  const scheduled = create('Lembrete da próxima semana');
  scheduled.status = 'scheduled';
  scheduled.scheduledAt = new Date(Date.now() + 86400000).toISOString();
  scheduled.approvedAt = at;
  const paused = create('Convite para a apresentação');
  paused.status = 'paused';
  paused.approvedAt = at;
  service.store.save();
  browser = await puppeteer.launch({
    headless: true,
    executablePath: new WhatsAppManager('.', () => {}).chromePath(),
    args: ['--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1536, height: 1024, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.url().includes('/api/') && response.status() >= 400)
      errors.push(`${response.status()} ${response.url()}`);
  });
  const clickText = async (text, scope = 'body') => {
    await page.waitForFunction(
      (text, scope) =>
        [...document.querySelector(scope).querySelectorAll('button')].some(
          (button) => button.textContent.trim() === text && !button.disabled,
        ),
      {},
      text,
      scope,
    );
    await page.evaluate(
      (text, scope) =>
        [...document.querySelector(scope).querySelectorAll('button')]
          .find((button) => button.textContent.trim() === text)
          .click(),
      text,
      scope,
    );
  };
  const fill = async (selector, value) => {
    const element = await page.waitForSelector(selector);
    await element.click();
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await element.type(value);
  };
  await page.goto(`http://127.0.0.1:${service.port}`, { waitUntil: 'networkidle2' });
  assert.equal(
    await page.$eval('nav', (element) => element.textContent.includes('Atendimento IA')),
    false,
  );
  await clickText('Workspace', 'nav');
  await page.waitForSelector('.ws-card');
  assert.equal(await page.$$eval('.ws-column', (elements) => elements.length), 6);
  await page.screenshot({ path: 'docs/workspace-campanhas.jpg', fullPage: true });
  await page.click(`[aria-label="Abrir campanha ${completed.name}"]`);
  await page.waitForSelector('.ws-detail-hero');
  const hero = await page.$eval('.ws-detail-hero', (element) => element.textContent);
  assert.match(hero, /150/);
  assert.match(hero, /350/);
  assert.match(hero, /30%/);
  await page.screenshot({ path: 'docs/workspace-campanha-detalhes.jpg', fullPage: true });
  await page.click('#ws-tab-recipients');
  await page.select('[aria-label="Filtrar resultados"]', 'replied');
  await page.waitForFunction(() =>
    document.querySelector('.ws-pagination')?.textContent.includes('150 registros'),
  );
  await page.click('#ws-tab-replies');
  await page.waitForSelector('.ws-reply-list article');
  assert.equal(await page.$$eval('.ws-reply-list article', (elements) => elements.length), 60);
  await page.screenshot({ path: 'docs/workspace-respostas.jpg', fullPage: true });
  await page.keyboard.press('Escape');
  await clickText('Por lista');
  await page.click(`[aria-label="Abrir lista ${list.name}"]`);
  await page.waitForSelector('.ws-detail-hero');
  await page.click('#ws-tab-campaigns');
  assert.equal(await page.$$eval('.ws-related-campaigns>button', (elements) => elements.length), 3);
  await page.screenshot({ path: 'docs/workspace-lista-detalhes.jpg', fullPage: true });
  await page.click('#ws-tab-contacts');
  assert.equal(await page.$$eval('.ws-table-wrap tbody tr', (elements) => elements.length), 40);
  await page.keyboard.press('Escape');
  await clickText('Novo workspace');
  await fill('dialog input[name="name"]', 'Minha operação');
  await clickText('Criar workspace', 'dialog');
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Selecionar workspace"]')?.selectedOptions[0]
        ?.textContent === 'Minha operação',
  );
  await page.click('[aria-label="Configurar workspace e colunas"]');
  await fill('.ws-column-editor:first-child form label input', 'Preparação');
  await page.click('.ws-column-editor:first-child form button');
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Mover Preparação para direita"]')?.disabled === false,
  );
  await page.click('[aria-label="Mover Preparação para direita"]');
  await fill('input[placeholder="Ex.: Conferir resultados"]', 'Revisar resultados');
  await clickText('Adicionar', 'dialog');
  await page.waitForFunction(() => document.querySelectorAll('.ws-column-editor').length === 7);
  await page.keyboard.press('Escape');
  await clickText('Por campanha');
  await page.click(`[aria-label="Abrir campanha ${completed.name}"]`);
  await page.waitForSelector('.ws-card-organization select');
  const board = data.workspaces.find((item) => item.name === 'Minha operação');
  const custom = board.columns.find((item) => item.name === 'Revisar resultados');
  await page.select('.ws-card-organization select', custom.id);
  await page.waitForFunction(
    () => document.querySelector('.ws-card-organization select').value !== '',
  );
  await page.keyboard.press('Escape');
  assert.equal(completed.status, 'completed');
  assert.equal(board.placements.campaigns[completed.id].columnId, custom.id);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.ws-column')].some(
      (column) =>
        column.querySelector('h2')?.textContent === 'Revisar resultados' &&
        column.textContent.includes('Novidades de outubro'),
    ),
  );
  const responder = completed.recipients[200];
  fake.onIncoming(accountId, {
    id: 'ui-new-live-event',
    phone: responder.address.replace(/\D/g, ''),
    chatId: `${responder.address.replace(/\D/g, '')}@c.us`,
    body: 'Tenho interesse.',
    timestamp: Math.floor(Date.now() / 1000),
  });
  await page.waitForFunction(() =>
    document.querySelector('.ws-summary')?.textContent.includes('151'),
  );
  await page.reload({ waitUntil: 'networkidle2' });
  await clickText('Workspace', 'nav');
  await page.waitForSelector('.ws-card');
  assert.equal(data.replyEvents.length, 151);
  assert.equal(data.workspaces.length, 2);
  const persisted = JSON.parse(fs.readFileSync(service.store.file, 'utf8'));
  assert.equal(persisted.replyEvents.length, 151);
  assert.equal(persisted.workspaces[1].columns[1].name, 'Preparação');
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        passed: true,
        pages: ['campaigns', 'lists', 'recipients', 'replies', 'contacts', 'settings'],
        responders: 151,
        errors,
        screenshots: 4,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await service.close();
}
