import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { makeWorkspace, workspaceData } from '../workspace.mjs';
import { recipientStats } from '../stats.mjs';
import { requireItem } from '../http.mjs';

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(100);
const columnSchema = z.object({
  name,
  color: z
    .string()
    .regex(/^#[a-f0-9]{6}$/i)
    .default('#87968a'),
});
export function installWorkspaceRoutes(api, store) {
  const board = (request) =>
    requireItem(store.data.workspaces, request.params.workspaceId, 'Workspace');
  api.get('/workspace', (_, response) => response.json(workspaceData(store.data)));
  api.get('/workspace/lists/:id', (request, response) => {
    const list = requireItem(workspaceData(store.data).lists, request.params.id, 'Lista');
    const recipients = [];
    for (const campaign of store.data.campaigns)
      for (const recipient of campaign.recipients)
        if (recipient.listSnapshot?.some((item) => item.id === list.id))
          recipients.push({ ...recipient, campaignId: campaign.id, campaignName: campaign.name });
    const recipientIds = new Set(recipients.map((item) => item.id));
    response.json({
      ...list,
      contacts: store.data.contacts.filter((contact) => contact.listIds.includes(list.id)),
      recipients,
      replies: store.data.replyEvents.filter((event) => recipientIds.has(event.recipientId)),
    });
  });
  api.get('/workspace/campaigns/:id', (request, response) => {
    const campaign = requireItem(store.data.campaigns, request.params.id, 'Campanha');
    response.json({
      ...campaign,
      stats: recipientStats(campaign.recipients),
      replies: store.data.replyEvents.filter((event) => event.campaignId === campaign.id),
    });
  });
  api.post('/workspaces', (request, response) => {
    if (store.data.workspaces.length >= 20) throw new Error('Limite de 20 workspaces.');
    const workspace = makeWorkspace(z.object({ name }).parse(request.body).name);
    store.data.workspaces.push(workspace);
    store.save();
    response.status(201).json(workspace);
  });
  api.put('/workspaces/:workspaceId', (request, response) => {
    Object.assign(board(request), z.object({ name }).parse(request.body));
    store.save();
    response.json(board(request));
  });
  api.delete('/workspaces/:workspaceId', (request, response) => {
    const workspace = board(request);
    if (store.data.workspaces.length === 1) throw new Error('Mantenha ao menos um workspace.');
    if (request.body.name !== workspace.name)
      throw new Error('Digite o nome do workspace para confirmar.');
    store.data.workspaces = store.data.workspaces.filter((item) => item.id !== workspace.id);
    store.save();
    response.json({ ok: true });
  });
  api.post('/workspaces/:workspaceId/columns', (request, response) => {
    const workspace = board(request);
    if (workspace.columns.length >= 30) throw new Error('Limite de 30 colunas.');
    const column = { id: randomUUID(), ...columnSchema.parse(request.body), statuses: [] };
    workspace.columns.push(column);
    store.save();
    response.status(201).json(column);
  });
  api.put('/workspaces/:workspaceId/columns/order', (request, response) => {
    const workspace = board(request);
    const ids = z.array(uuid).parse(request.body.columnIds);
    if (ids.length !== workspace.columns.length || new Set(ids).size !== ids.length)
      throw new Error('Inclua cada coluna uma vez.');
    workspace.columns = ids.map((id) => requireItem(workspace.columns, id, 'Coluna'));
    store.save();
    response.json(workspace);
  });
  api.put('/workspaces/:workspaceId/columns/:columnId', (request, response) => {
    const workspace = board(request);
    const column = requireItem(workspace.columns, request.params.columnId, 'Coluna');
    Object.assign(column, columnSchema.parse(request.body));
    store.save();
    response.json(column);
  });
  api.delete('/workspaces/:workspaceId/columns/:columnId', (request, response) => {
    const workspace = board(request);
    const column = requireItem(workspace.columns, request.params.columnId, 'Coluna');
    if (workspace.columns.length === 1) throw new Error('Mantenha ao menos uma coluna.');
    const target = requireItem(
      workspace.columns,
      uuid.parse(request.body.moveToColumnId),
      'Coluna de destino',
    );
    if (target.id === column.id) throw new Error('Selecione outra coluna de destino.');
    target.statuses = [...new Set([...target.statuses, ...column.statuses])];
    for (const placements of Object.values(workspace.placements))
      for (const placement of Object.values(placements))
        if (placement.columnId === column.id) placement.columnId = target.id;
    workspace.columns = workspace.columns.filter((item) => item.id !== column.id);
    store.save();
    response.json(workspace);
  });
  api.post('/workspaces/:workspaceId/move', (request, response) => {
    const workspace = board(request);
    const input = z
      .object({ view: z.enum(['campaigns', 'lists']), entityId: uuid, columnId: uuid.nullable() })
      .parse(request.body);
    const card = requireItem(workspaceData(store.data)[input.view], input.entityId, 'Card');
    if (input.columnId) {
      requireItem(workspace.columns, input.columnId, 'Coluna');
      workspace.placements[input.view][card.id] = { columnId: input.columnId, status: card.status };
    } else delete workspace.placements[input.view][card.id];
    store.save();
    response.json({ ok: true });
  });
}
