import { campaignSchema } from '../schemas.mjs';
import { requireItem } from '../http.mjs';
import { createCampaign, updateCampaign, deleteCampaign } from '../campaigns.mjs';
import { campaignSummary } from '../stats.mjs';
import { csvEncode } from '../importer.mjs';
import { z } from 'zod';

const editSchema = campaignSchema.extend({ expectedRevision: z.number().int().min(0) });

export function installCampaignRoutes(api, { store, whatsapp, groupCache }) {
  api.post('/campaigns', (request, response) => {
    const input = campaignSchema.parse(request.body);
    if (
      input.groups.length &&
      input.groups.some(
        (group) => !(groupCache.get(input.accountId) || []).some((known) => known.id === group.id),
      )
    )
      throw new Error('Atualize os grupos da conta antes de selecionar.');
    response.status(201).json(createCampaign(store, input));
  });
  api.get('/campaigns/:id', (request, response) =>
    response.json(requireItem(store.data.campaigns, request.params.id, 'Campanha')),
  );
  api.put('/campaigns/:id', (request, response) => {
    const campaign = requireItem(store.data.campaigns, request.params.id, 'Campanha');
    const input = editSchema.parse(request.body);
    if (
      input.groups.some(
        (group) =>
          !(groupCache.get(input.accountId) || []).some((known) => known.id === group.id) &&
          !(
            campaign.accountId === input.accountId &&
            campaign.recipients.some(
              (recipient) => recipient.type === 'group' && recipient.address === group.id,
            )
          ),
      )
    )
      throw new Error('Atualize os grupos da conta antes de selecionar.');
    response.json(updateCampaign(store, campaign, input, input.expectedRevision));
  });
  api.delete('/campaigns/:id', (request, response) => {
    const campaign = requireItem(store.data.campaigns, request.params.id, 'Campanha');
    deleteCampaign(store, campaign);
    response.json({ ok: true });
  });
  api.post('/campaigns/:id/:action', (request, response) => {
    const campaign = requireItem(store.data.campaigns, request.params.id, 'Campanha');
    if (request.params.action === 'approve') {
      if (campaign.status !== 'draft') throw new Error('Esta campanha já foi aprovada.');
      if (!campaign.scheduledAt && whatsapp.state(campaign.accountId).status !== 'ready')
        throw new Error('Conecte a conta na aba WhatsApp antes de enviar.');
      campaign.approvedAt = new Date().toISOString();
      campaign.status = campaign.scheduledAt ? 'scheduled' : 'running';
    } else if (request.params.action === 'pause') {
      if (!['running', 'scheduled'].includes(campaign.status))
        throw new Error('Esta campanha não está em execução.');
      campaign.status = 'paused';
    } else if (request.params.action === 'resume') {
      if (campaign.status !== 'paused') throw new Error('A campanha não está pausada.');
      if (whatsapp.state(campaign.accountId).status !== 'ready')
        throw new Error('Conecte a conta antes de retomar.');
      campaign.status =
        campaign.scheduledAt && new Date(campaign.scheduledAt).getTime() > Date.now()
          ? 'scheduled'
          : 'running';
    } else if (request.params.action === 'cancel') {
      if (['completed', 'cancelled'].includes(campaign.status))
        throw new Error('A campanha já foi encerrada.');
      campaign.status = 'cancelled';
    } else throw Object.assign(new Error('Ação desconhecida.'), { status: 404 });
    store.save();
    response.json(campaignSummary(campaign));
  });
  api.get('/campaigns/:id/export', (request, response) => {
    const campaign = requireItem(store.data.campaigns, request.params.id, 'Campanha');
    response.setHeader('Content-Disposition', `attachment; filename="campanha-${campaign.id}.csv"`);
    response
      .type('text/csv')
      .send(
        csvEncode([
          [
            'Nome',
            'Telefone ou grupo',
            'Mensagem',
            'Status',
            'Enviado em',
            'Confirmacao',
            'Erro',
            'Respondeu',
            'Primeira resposta em',
            'Ultima resposta em',
            'Quantidade de respostas',
          ],
          ...campaign.recipients.map((recipient) => [
            recipient.name,
            recipient.address,
            recipient.body,
            recipient.status,
            recipient.sentAt,
            recipient.ack,
            recipient.error,
            recipient.reply?.firstAt ? 'Sim' : 'Nao',
            recipient.reply?.firstAt,
            recipient.reply?.lastAt,
            recipient.reply?.count || 0,
          ]),
        ]),
      );
  });
}
