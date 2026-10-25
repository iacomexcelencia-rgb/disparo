import { useState } from 'react';
import { Send, Plus, Play, Pause, ChevronRight } from 'lucide-react';
import type { Actions } from './App';
import type { Campaign, CampaignDetail } from './types';
import { api, post, date } from './api';
import { Badge, Empty, SectionTitle } from './components';
import { DispatchDetails } from './workspace/DispatchDetails';
import { Review } from './CampaignComposer';
export { Composer } from './CampaignComposer';

export function Campaigns({
  state,
  busy,
  perform,
  toast,
  refresh,
  onNew,
  onDuplicate,
}: Actions & { onNew: () => void; onDuplicate: (campaign: Campaign) => void }) {
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [review, setReview] = useState<CampaignDetail | null>(null);
  const action = (campaign: Campaign, command: string) =>
    void perform(async () => {
      await post(`/campaigns/${campaign.id}/${command}`);
      toast(
        command === 'pause'
          ? 'Campanha pausada. Um envio já iniciado pode terminar.'
          : command === 'cancel'
            ? 'Campanha cancelada.'
            : 'Campanha retomada.',
      );
    });
  const filtered = state.campaigns.filter(
    (campaign) => filter === 'all' || campaign.status === filter,
  );
  return (
    <>
      <SectionTitle
        eyebrow="CADA ENVIO, UMA CONVERSA"
        title="Suas campanhas"
        description="Do rascunho ao último envio, acompanhe tudo por aqui."
        action={
          <button className="button primary" onClick={onNew}>
            <Plus size={17} />
            Nova campanha
          </button>
        }
      />
      <div className="tabs">
        {[
          ['all', 'Todas'],
          ['running', 'Em andamento'],
          ['scheduled', 'Agendadas'],
          ['draft', 'Rascunhos'],
          ['completed', 'Concluídas'],
          ['paused', 'Pausadas'],
        ].map(([value, label]) => (
          <button
            className={filter === value ? 'selected' : ''}
            key={value}
            onClick={() => setFilter(value)}
          >
            {label}
            <small>
              {
                state.campaigns.filter((campaign) => value === 'all' || campaign.status === value)
                  .length
              }
            </small>
          </button>
        ))}
      </div>
      <section className="card">
        {filtered.length ? (
          <div className="table-scroll">
            <table className="campaign-table">
              <thead>
                <tr>
                  <th>Campanha</th>
                  <th>Status</th>
                  <th>Progresso</th>
                  <th>Respostas</th>
                  <th>Criada em</th>
                  <th>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((campaign) => {
                  const sent = campaign.counts.sent || 0;
                  const processed =
                    campaign.total -
                    (campaign.counts.pending || 0) -
                    (campaign.counts.sending || 0);
                  return (
                    <tr key={campaign.id}>
                      <td>
                        <button
                          className="campaign-name"
                          onClick={() => {
                            setSelectedId(campaign.id);
                          }}
                        >
                          <span className="campaign-icon">
                            <Send size={17} />
                          </span>
                          <span>
                            <strong>{campaign.name}</strong>
                            <small>
                              {
                                state.accounts.find((account) => account.id === campaign.accountId)
                                  ?.name
                              }{' '}
                              · {campaign.total} destinatários
                            </small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <Badge status={campaign.status} />
                        {campaign.scheduledAt && campaign.status === 'scheduled' ? (
                          <small className="cell-note">{date(campaign.scheduledAt)}</small>
                        ) : null}
                      </td>
                      <td>
                        <div className="progress-cell">
                          <div className="progress-bar">
                            <span style={{ width: `${(processed / campaign.total) * 100}%` }} />
                          </div>
                          <small>
                            {sent} enviadas / {campaign.total}
                          </small>
                        </div>
                      </td>
                      <td>
                        <strong className="ws-replied">
                          {campaign.stats?.responded || 0} responderam
                        </strong>
                        <small className="cell-note">
                          {campaign.stats?.noReply || 0} sem resposta registrada
                        </small>
                      </td>
                      <td className="small-text">{date(campaign.createdAt)}</td>
                      <td>
                        <div className="inline">
                          {['running', 'scheduled'].includes(campaign.status) ? (
                            <button
                              className="icon-button"
                              aria-label={`Pausar ${campaign.name}`}
                              disabled={busy}
                              onClick={() => action(campaign, 'pause')}
                            >
                              <Pause size={17} />
                            </button>
                          ) : campaign.status === 'paused' ? (
                            <button
                              className="icon-button"
                              aria-label={`Retomar ${campaign.name}`}
                              disabled={busy}
                              onClick={() => action(campaign, 'resume')}
                            >
                              <Play size={17} />
                            </button>
                          ) : campaign.status === 'draft' ? (
                            <button
                              className="icon-button"
                              aria-label={`Revisar ${campaign.name}`}
                              disabled={busy}
                              onClick={() =>
                                void perform(async () =>
                                  setReview(await api<CampaignDetail>(`/campaigns/${campaign.id}`)),
                                )
                              }
                            >
                              <Play size={17} />
                            </button>
                          ) : null}
                          <button
                            className="icon-button"
                            aria-label={`Detalhes de ${campaign.name}`}
                            onClick={() => {
                              setSelectedId(campaign.id);
                            }}
                          >
                            <ChevronRight size={18} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={<Send size={27} />}
            title={
              filter === 'all'
                ? 'Sua próxima campanha começa aqui'
                : 'Nenhuma campanha neste status'
            }
            action={
              <button className="button primary" onClick={onNew}>
                <Plus size={16} />
                Criar campanha
              </button>
            }
          >
            Traga sua mensagem e selecione as pessoas
            <br />
            com quem você quer conversar.
          </Empty>
        )}
      </section>
      {selectedId ? (
        <DispatchDetails
          key={selectedId}
          state={state}
          busy={busy}
          perform={perform}
          toast={toast}
          refresh={refresh}
          entityId={selectedId}
          kind="campaigns"
          onClose={() => setSelectedId('')}
          onDuplicate={(campaign) => {
            onDuplicate(campaign);
            setSelectedId('');
          }}
          onReview={(campaign) => {
            setSelectedId('');
            setReview(campaign);
          }}
        />
      ) : null}
      {review ? (
        <Review
          campaign={review}
          state={state}
          busy={busy}
          onClose={() => setReview(null)}
          onApprove={() =>
            void perform(async () => {
              await post(`/campaigns/${review.id}/approve`);
              setReview(null);
              toast('Campanha confirmada.');
            })
          }
        />
      ) : null}
    </>
  );
}
