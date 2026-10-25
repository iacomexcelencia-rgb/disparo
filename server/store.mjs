import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { initializeWorkspace } from './workspace.mjs';
import { archiveRemovedModules } from './migrations.mjs';

export const id = () => randomUUID();
export const defaultSettings = {
  intervalSeconds: 30,
  hourlyLimit: 60,
  dailyLimit: 200,
  typingSeconds: 0,
  country: 'BR',
};
export class Store {
  constructor(directory) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, 'disparo.json');
    this.data = fs.existsSync(this.file)
      ? JSON.parse(fs.readFileSync(this.file, 'utf8'))
      : {
          version: 1,
          contacts: [],
          lists: [],
          accounts: [],
          campaigns: [],
          attachments: [],
          settings: { ...defaultSettings },
        };
    if (this.data.version !== 1)
      throw new Error('Versão de dados incompatível. Preserve a pasta de dados.');
    this.data.settings = { ...defaultSettings, ...this.data.settings };
    archiveRemovedModules(this.data);
    initializeWorkspace(this.data);
    // A crash during an outbound call cannot tell us whether WhatsApp accepted it.
    // Preserve the uncertainty; never automatically resend that recipient.
    for (const campaign of this.data.campaigns) {
      if (campaign.status === 'running') campaign.status = 'paused';
      for (const recipient of campaign.recipients)
        if (recipient.status === 'sending') {
          recipient.status = 'uncertain';
          recipient.finishedAt = new Date().toISOString();
          recipient.error =
            'O aplicativo foi interrompido durante o envio. Confira a conversa antes de tentar novamente.';
        }
      for (const recipient of campaign.recipients)
        if (recipient.status === 'sent' && !(recipient.ack >= 1)) {
          recipient.status = recipient.messageIds?.length ? 'confirming' : 'uncertain';
          recipient.submittedAt ||= recipient.sentAt;
          delete recipient.sentAt;
        }
      // Backfill old installations and preserve account pacing across restarts.
      const account = this.data.accounts.find((item) => item.id === campaign.accountId);
      if (account)
        for (const recipient of campaign.recipients) {
          const finishedAt =
            Date.parse(recipient.finishedAt || recipient.sentAt || recipient.submittedAt || '') ||
            0;
          if (!finishedAt) continue;
          const deadline = finishedAt + campaign.timing.intervalSeconds * 1000;
          if (finishedAt > (Date.parse(account.lastSendFinishedAt || '') || 0))
            account.lastSendFinishedAt = new Date(finishedAt).toISOString();
          if (deadline > (Date.parse(account.nextSendAt || '') || 0))
            account.nextSendAt = new Date(deadline).toISOString();
        }
    }
    this.save();
  }
  save() {
    const temporary = this.file + '.tmp';
    const handle = fs.openSync(temporary, 'w');
    try {
      fs.writeFileSync(handle, JSON.stringify(this.data, null, 2));
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fs.renameSync(temporary, this.file);
    this.onChange?.();
  }
}
