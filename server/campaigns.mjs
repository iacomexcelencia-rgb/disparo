import { id } from './store.mjs';
import { contactFields, renderTemplate, analyzeTemplate } from './template.mjs';
import { recordMessage, refreshDelivery } from './delivery.mjs';
import { historicalMessageUsage } from './migrations.mjs';

export function createCampaign(store, input) {
  const { data } = store;
  if (!data.accounts.some((account) => account.id === input.accountId))
    throw new Error('Selecione uma conta válida.');
  const contactIds = new Set(input.contactIds);
  const listIds = new Set(input.listIds);
  const selected = data.contacts.filter(
    (contact) =>
      !contact.optedOut &&
      (contactIds.has(contact.id) ||
        contact.listIds.some((list) => listIds.has(list)) ||
        input.allContacts),
  );
  const knownLists = new Map(data.lists.map((list) => [list.id, list]));
  const recipients = selected.map((contact) => ({
    id: id(),
    contactId: contact.id,
    type: 'contact',
    address: contact.phone,
    name: contact.name || contact.phone,
    fields: contactFields(contact),
    status: 'pending',
    listSnapshot: contact.listIds
      .filter((listId) => !listIds.size || listIds.has(listId))
      .map((listId) => knownLists.get(listId))
      .filter(Boolean)
      .map((list) => ({ ...list })),
    listAttribution: 'snapshot',
  }));
  const groups = new Map(input.groups.map((group) => [group.id, group]));
  for (const group of groups.values())
    recipients.push({
      id: id(),
      type: 'group',
      address: group.id,
      name: group.name,
      fields: { nome: group.name, primeiro_nome: group.name, empresa: '', telefone: '' },
      status: 'pending',
    });
  if (!recipients.length) throw new Error('Selecione ao menos um contato ou grupo disponível.');
  if (recipients.length > 20000) throw new Error('Limite de 20.000 destinatários por campanha.');
  for (const recipient of recipients)
    recipient.body = renderTemplate(input.template, recipient.fields);
  if (recipients.some((recipient) => !recipient.body.trim()) && !input.attachmentIds.length)
    throw new Error('A mensagem ficou vazia para um destinatário. Preencha os fallbacks.');
  if (
    input.attachmentIds.some(
      (attachmentId) => !data.attachments.some((attachment) => attachment.id === attachmentId),
    )
  )
    throw new Error('Um anexo não está mais disponível.');
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt).toISOString() : null;
  if (scheduledAt && new Date(scheduledAt).getTime() <= Date.now())
    throw new Error('Escolha uma data de agendamento no futuro.');
  const campaign = {
    id: id(),
    name: input.name,
    accountId: input.accountId,
    template: input.template,
    attachmentIds: input.attachmentIds,
    timing: input.timing,
    recipients,
    status: 'draft',
    createdAt: new Date().toISOString(),
    scheduledAt,
    approvedAt: null,
    nextAt: null,
    warnings: analyzeTemplate(
      input.template,
      recipients.map((recipient) => recipient.fields),
    ),
    audience: {
      allContacts: input.allContacts,
      contactIds: [...input.contactIds],
      listIds: [...input.listIds],
    },
  };
  data.campaigns.unshift(campaign);
  store.save();
  return campaign;
}

// Limits count actual outbound messages (text + each attachment), for each account.
export function budgetAvailableAt(data, campaign, now) {
  const cost =
    (campaign.recipients.find((recipient) => recipient.status === 'pending')?.body ? 1 : 0) +
    campaign.attachmentIds.length;
  const sent = data.campaigns
    .filter((item) => item.accountId === campaign.accountId)
    .flatMap((item) =>
      item.recipients
        .filter((recipient) => recipient.attemptedAt && recipient.status !== 'skipped')
        .map((recipient) => ({
          at: new Date(recipient.attemptedAt).getTime(),
          cost: recipient.messageCost || 1,
        })),
    );
  sent.push(...historicalMessageUsage(data, campaign.accountId));
  let availableAt = now;
  for (const [limit, period] of [
    [campaign.timing.hourlyLimit, 3600000],
    [campaign.timing.dailyLimit, 86400000],
  ]) {
    const recent = sent.filter((entry) => entry.at > now - period).sort((a, b) => a.at - b.at);
    let used = recent.reduce((sum, entry) => sum + entry.cost, 0);
    for (const entry of recent) {
      if (used + cost <= limit) break;
      used -= entry.cost;
      availableAt = Math.max(availableAt, entry.at + period + 10);
    }
  }
  return availableAt;
}

// A completed or paused campaign must not release the account's delivery interval.
// Keep the previous campaign's deadline and also respect a longer incoming interval.
export function accountAvailableAt(data, campaign, now) {
  const account = data.accounts.find((item) => item.id === campaign.accountId);
  const deadline = Date.parse(account?.nextSendAt || '') || 0;
  const finishedAt = Date.parse(account?.lastSendFinishedAt || '') || 0;
  return Math.max(
    now,
    deadline,
    finishedAt ? finishedAt + campaign.timing.intervalSeconds * 1000 : 0,
  );
}

export class CampaignEngine {
  constructor(store, whatsapp, { now = Date.now } = {}) {
    this.store = store;
    this.whatsapp = whatsapp;
    this.now = now;
    this.busy = new Set();
    this.stopping = false;
    this.tasks = new Set();
  }
  start() {
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref?.();
  }
  tick() {
    if (this.stopping) return;
    const { data } = this.store;
    for (const campaign of data.campaigns.slice().reverse()) {
      if (
        campaign.status === 'scheduled' &&
        new Date(campaign.scheduledAt).getTime() <= this.now()
      ) {
        campaign.status = 'running';
        this.store.save();
      }
      if (campaign.status !== 'running' || this.busy.has(campaign.accountId)) continue;
      if (this.whatsapp.state(campaign.accountId).status !== 'ready') continue;
      if (campaign.nextAt && new Date(campaign.nextAt).getTime() > this.now()) continue;
      const otherActive = data.campaigns.filter(
        (item) =>
          item.accountId === campaign.accountId &&
          item.status === 'running' &&
          item.id !== campaign.id,
      );
      if (otherActive.some((item) => item.createdAt < campaign.createdAt)) continue;
      const task = this.step(campaign)
        .catch((error) => {
          campaign.status = 'paused';
          campaign.error = error.message;
          this.store.save();
        })
        .finally(() => this.tasks.delete(task));
      this.tasks.add(task);
    }
  }
  async step(campaign) {
    this.busy.add(campaign.accountId);
    try {
      const recipient = campaign.recipients.find((item) => item.status === 'pending');
      if (!recipient) {
        campaign.status = 'completed';
        campaign.finishedAt = new Date(this.now()).toISOString();
        this.store.save();
        return;
      }
      if (recipient.contactId) {
        const current = this.store.data.contacts.find(
          (contact) => contact.id === recipient.contactId,
        );
        if (!current || current.optedOut) {
          recipient.status = 'skipped';
          recipient.error = 'Contato removido ou marcado para não receber.';
          this.store.save();
          return;
        }
      }
      const availableAt = Math.max(
        budgetAvailableAt(this.store.data, campaign, this.now()),
        accountAvailableAt(this.store.data, campaign, this.now()),
      );
      if (availableAt > this.now()) {
        campaign.nextAt = new Date(availableAt).toISOString();
        this.store.save();
        return;
      }
      const cost = (recipient.body ? 1 : 0) + campaign.attachmentIds.length;
      if (cost > campaign.timing.hourlyLimit || cost > campaign.timing.dailyLimit)
        throw new Error('O limite de envio é menor que o número de mensagens por destinatário.');
      const attachments = campaign.attachmentIds.map((attachmentId) =>
        this.store.data.attachments.find((item) => item.id === attachmentId),
      );
      recipient.status = 'sending';
      recipient.attemptedAt = new Date(this.now()).toISOString();
      recipient.messageCost = cost;
      recipient.expectedMessages = cost;
      this.store.save();
      // No automatic retry after a potentially transmitted message.
      try {
        const result = await this.whatsapp.send(
          campaign.accountId,
          recipient,
          attachments,
          campaign.timing.typingSeconds,
        );
        recipient.status = result.skipped ? 'skipped' : 'confirming';
        recipient.error = result.reason || null;
        for (const messageId of result.messageIds || [])
          recordMessage(recipient, messageId, result.messageAcks?.[messageId] ?? 0);
      } catch (error) {
        recipient.status = 'uncertain';
        recipient.error = `${error.partial ? 'Entrega parcial. ' : ''}${error.message} Confira a conversa antes de reenviar.`;
        recipient.lastError = recipient.error;
        for (const messageId of error.messageIds || [])
          recordMessage(recipient, messageId, error.messageAcks?.[messageId] ?? 0);
      }
      refreshDelivery(recipient, this.now());
      recipient.finishedAt = new Date(this.now()).toISOString();
      campaign.nextAt = new Date(this.now() + campaign.timing.intervalSeconds * 1000).toISOString();
      const account = this.store.data.accounts.find((item) => item.id === campaign.accountId);
      if (account) {
        account.lastSendFinishedAt = recipient.finishedAt;
        account.nextSendAt = campaign.nextAt;
      }
      if (
        campaign.status === 'running' &&
        !campaign.recipients.some((item) => item.status === 'pending')
      ) {
        campaign.status = 'completed';
        campaign.finishedAt = new Date(this.now()).toISOString();
      }
      this.store.save();
    } finally {
      this.busy.delete(campaign.accountId);
    }
  }
  async close() {
    this.stopping = true;
    clearInterval(this.timer);
    for (const campaign of this.store.data.campaigns)
      if (campaign.status === 'running') campaign.status = 'paused';
    this.store.save();
    let timeout;
    try {
      await Promise.race([
        Promise.allSettled([...this.tasks]),
        new Promise((resolve) => {
          timeout = setTimeout(resolve, 5000);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    for (const campaign of this.store.data.campaigns)
      for (const recipient of campaign.recipients)
        if (recipient.status === 'sending') {
          recipient.status = 'uncertain';
          recipient.finishedAt = new Date(this.now()).toISOString();
          recipient.error =
            'O aplicativo foi fechado durante o envio. Confira a conversa antes de reenviar.';
          const account = this.store.data.accounts.find((item) => item.id === campaign.accountId);
          if (account) {
            account.lastSendFinishedAt = recipient.finishedAt;
            account.nextSendAt = new Date(
              this.now() + campaign.timing.intervalSeconds * 1000,
            ).toISOString();
          }
        }
    this.store.save();
  }
}
