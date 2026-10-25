import { randomUUID } from 'node:crypto';
import { recipientStats } from './stats.mjs';

const defaults = [
  ['draft', 'Rascunho / sem campanha', '#87968a'],
  ['scheduled', 'Agendada', '#b493d2'],
  ['running', 'Em andamento', '#dda64c'],
  ['paused', 'Pausada', '#db9362'],
  ['completed', 'Concluída', '#589e7b'],
  ['cancelled', 'Cancelada', '#c77b80'],
];
export const makeWorkspace = (name = 'Workspace principal') => ({
  id: randomUUID(),
  name,
  createdAt: new Date().toISOString(),
  columns: defaults.map(([status, name, color]) => ({
    id: randomUUID(),
    name,
    color,
    statuses: [status],
  })),
  placements: { campaigns: {}, lists: {} },
});

export function initializeWorkspace(data) {
  if (!Array.isArray(data.workspaces)) data.workspaces = [makeWorkspace()];
  data.replyEvents ||= [];
  data.replyTrackingSince ||= new Date().toISOString();
  const contacts = new Map(data.contacts.map((contact) => [contact.id, contact]));
  const lists = new Map(data.lists.map((list) => [list.id, list]));
  for (const campaign of data.campaigns)
    for (const recipient of campaign.recipients) {
      // A one-time best-effort snapshot for releases that did not store audience membership.
      if (!Array.isArray(recipient.listSnapshot)) {
        recipient.listSnapshot = (contacts.get(recipient.contactId)?.listIds || [])
          .map((id) => lists.get(id))
          .filter(Boolean)
          .map((list) => ({ ...list }));
        recipient.listAttribution = 'migration';
      }
    }
}

const statusPriority = ['running', 'paused', 'scheduled', 'draft', 'completed', 'cancelled'];
export function workspaceData(data) {
  const buckets = new Map(data.lists.map((list) => [list.id, { campaigns: [], recipients: [] }]));
  const campaigns = data.campaigns.map((campaign) => {
    const { recipients, ...rest } = campaign;
    const listRecipients = new Map();
    for (const recipient of recipients)
      for (const list of recipient.listSnapshot || []) {
        if (!buckets.has(list.id)) continue;
        if (!listRecipients.has(list.id)) listRecipients.set(list.id, []);
        listRecipients.get(list.id).push(recipient);
      }
    const stats = recipientStats(recipients);
    for (const [listId, members] of listRecipients) {
      const bucket = buckets.get(listId);
      bucket.recipients.push(...members);
      bucket.campaigns.push({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        scheduledAt: campaign.scheduledAt,
        createdAt: campaign.createdAt,
        accountId: campaign.accountId,
        stats: recipientStats(members),
      });
    }
    return {
      ...rest,
      stats,
      total: recipients.length,
      listNames: [
        ...new Set(
          recipients.flatMap((item) => (item.listSnapshot || []).map((list) => list.name)),
        ),
      ],
    };
  });
  const contactCounts = new Map();
  for (const contact of data.contacts)
    for (const listId of contact.listIds)
      contactCounts.set(listId, (contactCounts.get(listId) || 0) + 1);
  const lists = data.lists.map((list) => {
    const { campaigns, recipients } = buckets.get(list.id);
    const statusCounts = {};
    for (const campaign of campaigns)
      statusCounts[campaign.status] = (statusCounts[campaign.status] || 0) + 1;
    const status = statusPriority.find((status) => statusCounts[status]) || 'draft';
    return {
      ...list,
      status,
      statusCounts,
      campaigns,
      stats: recipientStats(recipients),
      contactCount: contactCounts.get(list.id) || 0,
      uniqueContacts: new Set(recipients.map((item) => item.contactId || item.address)).size,
      uniqueResponders: new Set(
        recipients
          .filter((item) => item.reply?.firstAt)
          .map((item) => item.contactId || item.address),
      ).size,
    };
  });
  return { campaigns, lists, trackingSince: data.replyTrackingSince };
}
