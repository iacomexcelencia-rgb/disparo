import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Store } from './store.mjs';
import { WhatsAppManager } from './whatsapp.mjs';
import { CampaignEngine } from './campaigns.mjs';
import { recordMessage, refreshDelivery } from './delivery.mjs';
import { acquireInstance } from './instance.mjs';
import { installWorkspaceRoutes } from './routes/workspaces.mjs';
import { campaignSummary } from './stats.mjs';
import { timingSchema } from './schemas.mjs';
import { z } from 'zod';
import { localRequest, errorResponse } from './http.mjs';
import { installAccountRoutes } from './routes/accounts.mjs';
import { installContactRoutes } from './routes/contacts.mjs';
import { installAttachmentRoutes } from './routes/attachments.mjs';
import { installCampaignRoutes } from './routes/campaigns.mjs';
import { ReplyTracker } from './replies.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

export async function startServer({
  port = Number(process.env.PORT || 4317),
  dataDir = process.env.DISPARO_DATA_DIR || path.join(root, '.data'),
  whatsapp: suppliedWhatsApp,
  startEngine = true,
} = {}) {
  const instance = acquireInstance(dataDir);
  let store;
  try {
    store = new Store(dataDir);
  } catch (error) {
    instance.release();
    throw error;
  }
  const events = new Set();
  const notify = () => {
    for (const response of events) response.write('event: change\ndata: {}\n\n');
  };
  store.onChange = notify;
  const whatsapp = suppliedWhatsApp || new WhatsAppManager(dataDir, notify);
  const engine = new CampaignEngine(store, whatsapp);
  const replies = new ReplyTracker(store);
  const resolvedMessage = (accountId, message) => {
    const account = store.data.accounts.find((item) => item.id === accountId);
    return {
      ...message,
      phone:
        account?.phoneAliases?.[message.phone] ||
        account?.phoneAliases?.[message.chatId] ||
        message.phone,
    };
  };
  whatsapp.onIncoming = (accountId, message) =>
    replies.receive(accountId, resolvedMessage(accountId, message));
  whatsapp.onAddressResolved = (accountId, phone, aliases) => {
    const account = store.data.accounts.find((item) => item.id === accountId);
    if (!account) return;
    account.phoneAliases ||= {};
    let changed = false;
    for (const alias of aliases)
      if (typeof alias === 'string' && /^\d+@(c\.us|lid)$/.test(alias)) {
        for (const key of [alias, ...(alias.endsWith('@c.us') ? [alias.split('@')[0]] : [])])
          if (account.phoneAliases[key] !== phone) {
            account.phoneAliases[key] = phone;
            changed = true;
          }
      }
    if (changed) store.save();
  };
  const groupCache = new Map();
  const app = express();
  app.disable('x-powered-by');
  app.use(localRequest);
  app.use(express.json({ limit: '2mb' }));
  const api = express.Router();
  api.get('/health', (_, response) => response.json({ ok: true, version }));
  api.get('/state', (_, response) =>
    response.json({
      contacts: store.data.contacts,
      lists: store.data.lists,
      accounts: store.data.accounts.map(({ phoneAliases: _, ...account }) => ({
        ...account,
        ...whatsapp.state(account.id),
      })),
      campaigns: store.data.campaigns.map(campaignSummary),
      attachments: store.data.attachments.map(({ path: _, ...attachment }) => attachment),
      settings: store.data.settings,
      workspaces: store.data.workspaces,
      replyTrackingSince: store.data.replyTrackingSince,
      system: { dataDir, platform: os.platform(), version },
    }),
  );
  api.get('/events', (request, response) => {
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();
    response.write('event: change\ndata: {}\n\n');
    events.add(response);
    const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 20000);
    request.on('close', () => {
      clearInterval(heartbeat);
      events.delete(response);
    });
  });
  api.put('/settings', (request, response) => {
    store.data.settings = {
      ...timingSchema.parse(request.body),
      country: z
        .enum(['BR', 'US', 'PT', 'AR', 'MX', 'GB', 'ES', 'DE', 'FR', 'CO', 'CL'])
        .parse(request.body.country),
    };
    store.save();
    response.json(store.data.settings);
  });
  installAccountRoutes(api, { store, whatsapp, engine, groupCache });
  installContactRoutes(api, { store });
  installAttachmentRoutes(api, { store, dataDir });
  installCampaignRoutes(api, { store, whatsapp, groupCache });
  whatsapp.onMessage = (accountId, recipientId, { messageId, ack }) => {
    for (const campaign of store.data.campaigns)
      if (campaign.accountId === accountId) {
        const recipient = campaign.recipients.find((item) => item.id === recipientId);
        if (recipient) {
          recordMessage(recipient, messageId, ack);
          refreshDelivery(recipient);
          store.save();
          return;
        }
      }
  };
  whatsapp.onAck = (accountId, messageId, ack) => {
    if (!messageId) return;
    for (const campaign of store.data.campaigns)
      if (campaign.accountId === accountId)
        for (const recipient of campaign.recipients)
          if (recipient.messageIds?.includes(messageId)) {
            recordMessage(recipient, messageId, ack);
            refreshDelivery(recipient);
            store.save();
            return;
          }
  };
  installWorkspaceRoutes(api, store);
  app.use('/api', api);
  app.use('/api', (_, response) =>
    response.status(404).json({ error: 'Operação não encontrada.' }),
  );
  app.use(express.static(path.join(root, 'dist')));
  app.get('/', (_, response) => response.sendFile(path.join(root, 'dist/index.html')));
  app.use(errorResponse);
  let server;
  try {
    server = await new Promise((resolve, reject) => {
      const listener = app.listen(port, '127.0.0.1', () => resolve(listener));
      listener.on('error', reject);
    });
  } catch (error) {
    instance.release();
    throw error;
  }
  instance.setPort(server.address().port);
  if (startEngine) engine.start();
  if (!suppliedWhatsApp)
    for (const account of store.data.accounts) {
      if (fs.existsSync(path.join(dataDir, 'sessions', `session-${account.id}`)))
        void whatsapp.connect(account.id);
    }
  return {
    port: server.address().port,
    app,
    store,
    engine,
    replies,
    whatsapp,
    async close() {
      try {
        await engine.close();
        await whatsapp.close();
        for (const response of events) response.end();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      } finally {
        instance.release();
      }
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const service = await startServer();
  console.log(`Disparo disponível em http://127.0.0.1:${service.port}`);
  let closing = false;
  const close = () => {
    if (!closing) {
      closing = true;
      service.close().then(() => process.exit(0));
    }
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}
