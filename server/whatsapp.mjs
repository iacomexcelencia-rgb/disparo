import path from 'node:path';
import fs from 'node:fs';
import QRCode from 'qrcode';
import { sendTrackedMessage } from './outbound.mjs';

export class WhatsAppManager {
  constructor(directory, onChange) {
    this.directory = directory;
    this.onChange = onChange;
    this.sessions = new Map();
  }
  state(accountId) {
    const session = this.sessions.get(accountId);
    return session
      ? {
          status: session.status,
          qr: session.qr,
          phone: session.phone,
          error: session.error,
          progress: session.progress,
        }
      : { status: 'disconnected' };
  }
  async connect(accountId) {
    const previous = this.sessions.get(accountId);
    if (previous && ['connecting', 'qr', 'authenticated', 'ready'].includes(previous.status))
      return;
    if (previous?.client) await previous.client.destroy().catch(() => {});
    const session = { status: 'connecting', qr: null, error: null, phone: null, client: null };
    this.sessions.set(accountId, session);
    this.onChange();
    try {
      // Lazy import: opening contacts and reports never starts Chromium.
      const { default: WA } = await import('whatsapp-web.js');
      const executablePath = this.chromePath();
      const client = new WA.Client({
        authStrategy: new WA.LocalAuth({
          clientId: accountId,
          dataPath: path.join(this.directory, 'sessions'),
        }),
        webVersionCache: { type: 'local', path: path.join(this.directory, 'web-cache') },
        puppeteer: {
          headless: true,
          ...(executablePath ? { executablePath } : {}),
          args: ['--disable-dev-shm-usage'],
          timeout: 60000,
        },
        authTimeoutMs: 120000,
      });
      session.client = client;
      client.on('qr', async (qr) => {
        const image = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
        if (this.sessions.get(accountId) !== session) return;
        session.qr = image;
        session.status = 'qr';
        this.onChange();
      });
      client.on('authenticated', () => {
        session.qr = null;
        session.status = 'authenticated';
        this.onChange();
      });
      client.on('loading_screen', (percent, message) => {
        session.progress = `${percent}% · ${message}`;
        this.onChange();
      });
      client.on('ready', () => {
        session.status = 'ready';
        session.qr = null;
        session.phone = client.info?.wid?.user || null;
        session.error = null;
        this.onChange();
      });
      client.on('auth_failure', (message) => {
        session.status = 'error';
        session.error = String(message);
        this.onChange();
      });
      client.on('disconnected', (reason) => {
        session.status = 'disconnected';
        session.qr = null;
        session.error = String(reason);
        this.onChange();
      });
      client.on('message_ack', (message, ack) =>
        this.onAck?.(accountId, message.id?._serialized, ack),
      );
      const incoming = async (message) => {
        const chatId = message.from;
        if (!chatId || !/@(c\.us|lid)$/.test(chatId) || message.isStatus || message.broadcast)
          return;
        try {
          let phone;
          if (chatId.endsWith('@c.us')) phone = chatId.split('@')[0];
          else if (client.getContactLidAndPhone) {
            try {
              const aliases = await client.getContactLidAndPhone([chatId]);
              phone = aliases.find((item) => item.pn)?.pn?.split('@')[0];
            } catch {
              /* The server can still resolve a previously persisted LID alias. */
            }
          }
          if (!phone && !chatId.endsWith('@lid')) return;
          if (this.sessions.get(accountId) !== session) return;
          const record = {
            id: message.id?._serialized,
            chatId,
            phone,
            body: message.body || '',
            media: message.hasMedia,
            type: message.type,
            timestamp: message.timestamp,
            quotedStanzaId: message.rawData?.quotedStanzaID || null,
          };
          this.onIncoming?.(accountId, record);
        } catch {
          /* A missing LID mapping must never route a message to another contact. */
        }
      };
      client.on('message', (message) => {
        if (!message.fromMe) void incoming(message);
      });
      await client.initialize();
    } catch (error) {
      session.status = 'error';
      session.error = error.message;
      session.qr = null;
      this.onChange();
    }
  }
  chromePath() {
    const candidates = [
      process.env.DISPARO_CHROME_PATH,
      process.env.PROGRAMFILES &&
        path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
      process.env['PROGRAMFILES(X86)'] &&
        path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
      process.env.LOCALAPPDATA &&
        path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    ];
    return candidates.find((candidate) => candidate && fs.existsSync(candidate));
  }
  client(accountId) {
    const session = this.sessions.get(accountId);
    if (session?.status !== 'ready')
      throw new Error('Conecte esta conta do WhatsApp antes de continuar.');
    return session.client;
  }
  async groups(accountId) {
    return (await this.client(accountId).getChats())
      .filter((chat) => chat.isGroup && !chat.isReadOnly)
      .map((chat) => ({ id: chat.id._serialized, name: chat.name }));
  }
  async send(accountId, recipient, attachments, typingSeconds) {
    let timeout;
    try {
      return await Promise.race([
        this.dispatch(accountId, recipient, attachments, typingSeconds),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(Object.assign(new Error('O envio excedeu 90 segundos.'), { timedOut: true })),
            90000,
          );
        }),
      ]);
    } catch (error) {
      if (error.timedOut) await this.disconnect(accountId);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  async dispatch(accountId, recipient, attachments, typingSeconds) {
    const client = this.client(accountId);
    let chatId = recipient.address;
    if (recipient.type === 'contact') {
      const registered = await client.getNumberId(recipient.address.replace(/\D/g, ''));
      if (!registered) return { skipped: true, reason: 'Número não encontrado no WhatsApp.' };
      chatId = registered._serialized;
    }
    const aliases = [chatId];
    if (recipient.type === 'contact' && client.getContactLidAndPhone) {
      try {
        for (const item of await client.getContactLidAndPhone([chatId]))
          aliases.push(item.lid, item.pn);
      } catch {
        /* Exact returned IDs still work if alias lookup is unavailable. */
      }
    }
    if (recipient.type === 'contact')
      this.onAddressResolved?.(
        accountId,
        recipient.address.replace(/\D/g, ''),
        aliases.filter(Boolean),
      );
    const { default: WA } = await import('whatsapp-web.js');
    // Read every attachment before sending anything to avoid avoidable partial deliveries.
    const media = attachments.map((attachment) => {
      const item = WA.MessageMedia.fromFilePath(attachment.path);
      item.filename = attachment.name;
      return item;
    });
    if (typingSeconds > 0) {
      const chat = await client.getChatById(chatId);
      await chat.sendStateTyping();
      await new Promise((resolve) => setTimeout(resolve, Math.min(typingSeconds, 5) * 1000));
      await chat.clearState();
    }
    const ids = [];
    const messageAcks = {};
    const failures = [];
    const sendPart = async (content) => {
      const record = await sendTrackedMessage(client, chatId, content, {
        aliases: aliases.filter(Boolean),
        usedIds: ids,
        onMessage: (record) => {
          ids.push(record.messageId);
          messageAcks[record.messageId] = record.ack;
          this.onMessage?.(accountId, recipient.id, record);
        },
      });
      if (record.ack < 0) throw new Error('O WhatsApp informou falha no envio.');
    };
    const parts = [
      ...(recipient.body ? [{ content: recipient.body, label: 'Texto' }] : []),
      ...media.map((content, index) => ({
        content,
        label: `Anexo ${index + 1} (${attachments[index].name})`,
      })),
    ];
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      // A timeout/disconnect must not leave a background dispatch sending the
      // remaining files after the account has already moved to another session.
      if (
        this.sessions.get(accountId)?.client !== client ||
        this.sessions.get(accountId)?.status !== 'ready'
      ) {
        for (const remaining of parts.slice(index))
          failures.push({
            part: remaining.label,
            error: 'Não enviado: a conexão foi interrompida antes desta parte.',
          });
        break;
      }
      try {
        await sendPart(part.content);
      } catch (error) {
        // Each selected part is a separate intended message. An uncertain text
        // must not discard its attachments, and no part is retried here.
        failures.push({ part: part.label, error: error.message });
      }
    }
    if (failures.length) {
      const error = new Error(failures.map((item) => `${item.part}: ${item.error}`).join(' · '));
      error.partial = ids.length > 0;
      error.messageIds = ids;
      error.messageAcks = messageAcks;
      error.partErrors = failures;
      throw error;
    }
    return { messageIds: ids, messageAcks };
  }
  async disconnect(accountId, logout = false) {
    const session = this.sessions.get(accountId);
    if (!session) return;
    if (session.client) {
      if (logout && session.status === 'ready') await session.client.logout();
      let timer;
      try {
        await Promise.race([
          session.client.destroy().catch(() => {}),
          new Promise((resolve) => {
            timer = setTimeout(() => {
              session.client.pupBrowser?.process()?.kill();
              resolve();
            }, 5000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    this.sessions.delete(accountId);
    this.onChange();
  }
  async close() {
    await Promise.allSettled(
      [...this.sessions.keys()].map((accountId) => this.disconnect(accountId)),
    );
  }
}
