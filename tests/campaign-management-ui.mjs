import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { startServer } from '../server/index.mjs';
import { createCampaign } from '../server/campaigns.mjs';
import { id, defaultSettings } from '../server/store.mjs';
import { WhatsAppManager } from '../server/whatsapp.mjs';

const root = path.resolve('test-results');
fs.mkdirSync(root, { recursive: true });
const directory = fs.mkdtempSync(path.join(root, 'campaign-ui-'));
let browser;
const service = await startServer({
  port: 0,
  dataDir: directory,
  startEngine: false,
  whatsapp: {
    state: () => ({ status: 'ready' }),
    close: async () => {},
    send: async () => {
      throw new Error('UI test cannot send messages');
    },
  },
});
try {
  const accountId = id(),
    listId = id();
  service.store.data.accounts.push({ id: accountId, name: 'Conta de teste' });
  service.store.data.lists.push({ id: listId, name: 'Base de teste', color: '#123456' });
  for (const [index, name] of ['Ana', 'Bruno'].entries())
    service.store.data.contacts.push({
      id: id(),
      name,
      phone: `+551191234567${index}`,
      company: '',
      fields: {},
      listIds: [listId],
      optedOut: false,
    });
  const campaign = createCampaign(service.store, {
    name: 'Campanha editável',
    accountId,
    template: 'Olá, {{nome}}',
    allContacts: false,
    listIds: [listId],
    contactIds: [],
    groups: [],
    attachmentIds: [],
    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    timing: defaultSettings,
  });
  campaign.status = 'scheduled';
  campaign.approvedAt = new Date().toISOString();
  service.store.save();
  browser = await puppeteer.launch({
    headless: true,
    executablePath: new WhatsAppManager('.', () => {}).chromePath(),
  });
  const page = await browser.newPage();
  await page.emulateTimezone('America/Sao_Paulo');
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const clickText = async (text, scope = 'body') => {
    await page.waitForFunction(
      (text, scope) =>
        [...document.querySelectorAll(`${scope} button`)].some(
          (button) =>
            (scope === 'nav'
              ? button.textContent.trim().startsWith(text)
              : button.textContent.trim() === text) && !button.disabled,
        ),
      {},
      text,
      scope,
    );
    await page.evaluate(
      (text, scope) =>
        [...document.querySelectorAll(`${scope} button`)]
          .find((button) =>
            scope === 'nav'
              ? button.textContent.trim().startsWith(text)
              : button.textContent.trim() === text,
          )
          .click(),
      text,
      scope,
    );
  };
  const fill = async (selector, text) => {
    const field = await page.waitForSelector(selector);
    await field.click();
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await field.type(text);
  };
  await page.goto(`http://127.0.0.1:${service.port}`, { waitUntil: 'networkidle2' });
  await clickText('Campanhas', 'nav');
  await page.click('.campaign-name');
  await clickText('Editar campanha', 'dialog');
  await page.waitForSelector('dialog .composer-layout');
  assert.equal(await page.$eval('dialog textarea', (element) => element.value), campaign.template);
  assert.equal(
    await page.$$eval('dialog .audience-option input:checked', (elements) => elements.length),
    2,
  );
  const localDate = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(new Date(campaign.scheduledAt))
    .replace(' ', 'T');
  assert.equal(
    await page.$eval('dialog input[type="datetime-local"]', (element) => element.value),
    localDate,
  );
  await fill('dialog input[maxlength="120"]', 'Campanha atualizada');
  await fill('dialog textarea', 'Mensagem revisada para {{nome}}');
  await page.click('dialog .audience-option input');
  // Confirm editing stays usable in the small modal and on a phone.
  await page.setViewport({ width: 390, height: 844 });
  assert.equal(
    await page.$eval('dialog', (element) => element.scrollWidth <= element.clientWidth + 1),
    true,
  );
  await page.screenshot({ path: path.join(root, 'campaign-edit-mobile.png') });
  await page.setViewport({ width: 1440, height: 1000 });
  await page.screenshot({ path: path.join(root, 'campaign-edit.png') });
  await clickText('Salvar alterações', 'dialog');
  await page.waitForSelector('dialog .ws-detail');
  await page.waitForFunction(
    () => document.querySelector('dialog .modal-head h2')?.textContent === 'Campanha atualizada',
  );
  assert.equal(campaign.status, 'scheduled');
  assert.equal(campaign.recipients.length, 1);
  assert.equal(campaign.recipients[0].body, 'Mensagem revisada para Bruno');
  await page.click('dialog [aria-label="Fechar janela"]');
  await page.reload({ waitUntil: 'networkidle2' });
  await clickText('Workspace', 'nav');
  await page.click('[aria-label="Abrir campanha Campanha atualizada"]');
  await clickText('Editar campanha', 'dialog');
  await page.waitForSelector('dialog textarea');
  assert.equal(
    await page.$eval('dialog textarea', (element) => element.value),
    'Mensagem revisada para {{nome}}',
  );
  await clickText('Voltar aos detalhes', 'dialog');
  await clickText('Excluir campanha', 'dialog');
  await clickText('Manter campanha', 'dialog');
  assert.equal(service.store.data.campaigns.length, 1);
  await clickText('Excluir campanha', 'dialog');
  await clickText('Confirmar exclusão', 'dialog');
  await page.waitForFunction(() => !document.querySelector('dialog'));
  assert.equal(service.store.data.campaigns.length, 0);
  assert.equal(service.store.data.contacts.length, 2);
  await page.reload({ waitUntil: 'networkidle2' });
  await clickText('Campanhas', 'nav');
  assert.equal(await page.$('.campaign-name'), null);
  assert.deepEqual(errors, []);
  console.log(
    'UI: edição no modal, destinatários, fuso horário, mobile, persistência e exclusão pelo Workspace OK. Nenhuma mensagem enviada.',
  );
} finally {
  await browser?.close();
  await service.close();
  assert.equal(path.dirname(directory), root);
  fs.rmSync(directory, { recursive: true, force: true });
}
