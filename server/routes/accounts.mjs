import { id } from '../store.mjs';
import { accountSchema } from '../schemas.mjs';
import { requireItem } from '../http.mjs';

export function installAccountRoutes(api, { store, whatsapp, engine, groupCache }) {
  api.post('/accounts', (request, response) => {
    const account = {
      id: id(),
      ...accountSchema.parse(request.body),
      createdAt: new Date().toISOString(),
    };
    store.data.accounts.push(account);
    store.save();
    response.status(201).json(account);
  });
  api.post('/accounts/:id/connect', (request, response) => {
    const account = requireItem(store.data.accounts, request.params.id, 'Conta');
    void whatsapp.connect(account.id);
    response.json({ ok: true });
  });
  api.post('/accounts/:id/disconnect', async (request, response) => {
    const account = requireItem(store.data.accounts, request.params.id, 'Conta');
    if (engine.busy.has(account.id)) throw new Error('Aguarde o envio atual antes de desconectar.');
    for (const campaign of store.data.campaigns)
      if (campaign.accountId === account.id && campaign.status === 'running')
        campaign.status = 'paused';
    store.save();
    await whatsapp.disconnect(account.id, true);
    response.json({ ok: true });
  });
  api.get('/accounts/:id/groups', async (request, response) => {
    requireItem(store.data.accounts, request.params.id, 'Conta');
    const groups = await whatsapp.groups(request.params.id);
    groupCache.set(request.params.id, groups);
    response.json(groups);
  });
}
