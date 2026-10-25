import { useEffect, useState, type CSSProperties } from 'react';
import { Download, Send, Pencil, Trash2 } from 'lucide-react';
import { Composer } from '../CampaignComposer';
import type { Actions } from '../App';
import type {
  Campaign,
  CampaignDetail,
  DispatchDetail,
  WorkspaceBoard,
  WorkspaceView,
} from '../types';
import { api, date, number, post } from '../api';
import { Badge, Busy, Empty, Modal } from '../components';
import { rate } from './model';
import { ContactHistory, RecipientHistory, ReplyHistory } from './History';

export function DispatchDetails({
  entityId,
  kind,
  board,
  onClose,
  onCampaign,
  onDuplicate,
  onReview,
  ...props
}: Actions & {
  entityId: string;
  kind: WorkspaceView;
  board?: WorkspaceBoard;
  onClose: () => void;
  onCampaign?: (id: string) => void;
  onDuplicate?: (campaign: Campaign) => void;
  onReview?: (campaign: CampaignDetail) => void;
}) {
  const { state, busy, perform } = props;
  const [detail, setDetail] = useState<DispatchDetail | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState<CampaignDetail | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    let active = true;
    void api<DispatchDetail>(`/workspace/${kind}/${entityId}`)
      .then((value) => {
        if (active) {
          setDetail(value);
          setError('');
        }
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [entityId, kind, state]);
  const placement = board?.placements[kind][entityId];
  const editable =
    detail &&
    ['draft', 'scheduled', 'paused'].includes(detail.status) &&
    detail.recipients.every(
      (recipient) => recipient.status === 'pending' && !recipient.attemptedAt,
    );
  const tabs = [
    ['overview', 'Resumo'],
    ...(kind === 'lists'
      ? [
          ['campaigns', 'Campanhas'],
          ['contacts', 'Contatos'],
        ]
      : []),
    ['recipients', 'Destinatários'],
    ['replies', 'Respostas'],
  ];
  return (
    <Modal
      wide
      title={editing ? 'Editar campanha' : detail?.name || 'Detalhes do envio'}
      subtitle={
        kind === 'lists'
          ? 'A lista, suas campanhas e cada resultado.'
          : 'Da mensagem enviada à resposta recebida.'
      }
      onClose={busy ? () => {} : onClose}
    >
      {editing ? (
        <Composer
          {...props}
          editing={editing}
          onBack={() => setEditing(null)}
          onDone={() => setEditing(null)}
        />
      ) : (
        <>
          {error ? (
            <p role="alert" className="notice">
              {error}
            </p>
          ) : null}
          {!detail ? (
            <Busy>Carregando os registros…</Busy>
          ) : (
            <div className="ws-detail">
              <div className="ws-detail-head">
                <div>
                  <Badge status={detail.status} />
                  <p>
                    {kind === 'campaigns'
                      ? `${state.accounts.find((account) => account.id === detail.accountId)?.name || 'Conta removida'} · criada em ${date(detail.createdAt)}`
                      : `${number(detail.contactCount || 0)} contatos atuais · ${detail.campaigns?.length || 0} campanhas`}
                  </p>
                </div>
                <div className="inline">
                  {kind === 'campaigns' ? (
                    <>
                      <button
                        className="button small-button"
                        disabled={busy || !editable}
                        title={
                          editable
                            ? 'Alterar mensagem, destinatários e agendamento'
                            : 'A edição fica disponível antes do primeiro envio, em rascunhos, campanhas agendadas ou pausadas.'
                        }
                        onClick={() =>
                          void perform(async () => {
                            setConfirmDelete(false);
                            setEditing(await api<CampaignDetail>(`/campaigns/${entityId}`));
                          })
                        }
                      >
                        <Pencil size={15} /> Editar campanha
                      </button>
                      <button
                        className="button small-button danger"
                        disabled={busy}
                        onClick={() => setConfirmDelete(true)}
                      >
                        <Trash2 size={15} /> Excluir campanha
                      </button>
                    </>
                  ) : null}
                  {kind === 'campaigns' ? (
                    <a
                      className="button small-button"
                      download
                      href={`/api/campaigns/${entityId}/export`}
                    >
                      <Download size={15} />
                      Relatório CSV
                    </a>
                  ) : null}
                  {kind === 'campaigns' && onDuplicate ? (
                    <button
                      className="button small-button"
                      onClick={() => {
                        const campaign = state.campaigns.find((item) => item.id === entityId);
                        if (campaign) onDuplicate(campaign);
                      }}
                    >
                      Usar este texto
                    </button>
                  ) : null}
                </div>
              </div>
              {kind === 'campaigns' && confirmDelete ? (
                <div className="notice" role="alert">
                  <strong>Excluir “{detail.name}”?</strong>
                  <p>
                    A campanha, seus resultados e respostas registradas serão removidos dos
                    relatórios. As mensagens já enviadas no WhatsApp e os contatos da base
                    permanecem. Esta ação não pode ser desfeita.
                  </p>
                  <div className="inline">
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => setConfirmDelete(false)}
                    >
                      Manter campanha
                    </button>
                    <button
                      className="button danger"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await api(`/campaigns/${entityId}`, { method: 'DELETE' });
                          props.toast('Campanha excluída.');
                          onClose();
                        })
                      }
                    >
                      Confirmar exclusão
                    </button>
                  </div>
                </div>
              ) : null}
              {kind === 'campaigns' && !editable ? (
                <p className="small-text muted">
                  Para editar, a campanha precisa estar em rascunho, agendada ou pausada e ainda não
                  ter iniciado nenhum envio.
                </p>
              ) : null}
              <div className="ws-detail-hero">
                <div>
                  <span>O resultado das suas conversas</span>
                  <h3>
                    {number(detail.stats.responded)}{' '}
                    <small>
                      {detail.stats.responded === 1
                        ? 'resposta de contato'
                        : 'contatos responderam'}
                    </small>
                  </h3>
                  <p>
                    {number(detail.stats.noReply)} sem resposta registrada ·{' '}
                    {number(detail.stats.responseEligible)} contatos alcançados
                  </p>
                </div>
                <div
                  className="ws-response-ring"
                  style={
                    { '--response-angle': `${detail.stats.responseRate * 3.6}deg` } as CSSProperties
                  }
                >
                  <div>
                    <strong>{rate(detail.stats.responseRate)}</strong>
                    <small>de resposta</small>
                  </div>
                </div>
              </div>
              <div
                className="ws-detail-tabs"
                role="tablist"
                aria-label="Informações do card"
                onKeyDown={(event) => {
                  const index = tabs.findIndex(([value]) => value === tab);
                  const next =
                    event.key === 'ArrowRight'
                      ? (index + 1) % tabs.length
                      : event.key === 'ArrowLeft'
                        ? (index + tabs.length - 1) % tabs.length
                        : event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? tabs.length - 1
                            : -1;
                  if (next >= 0) {
                    event.preventDefault();
                    setTab(tabs[next][0]);
                    event.currentTarget
                      .querySelectorAll<HTMLButtonElement>('[role="tab"]')
                      [next]?.focus();
                  }
                }}
              >
                {tabs.map(([value, label]) => (
                  <button
                    role="tab"
                    tabIndex={tab === value ? 0 : -1}
                    aria-selected={tab === value}
                    aria-controls="ws-detail-panel"
                    id={`ws-tab-${value}`}
                    className={tab === value ? 'selected' : ''}
                    key={value}
                    onClick={() => setTab(value)}
                  >
                    {label}
                    {value === 'replies' ? <small>{detail.stats.replies}</small> : null}
                  </button>
                ))}
              </div>
              <div role="tabpanel" id="ws-detail-panel" aria-labelledby={`ws-tab-${tab}`}>
                {tab === 'overview' ? (
                  <>
                    <div className="ws-detail-metrics">
                      {(
                        [
                          ['sent', 'Envios confirmados'],
                          ['delivered', 'Entregues'],
                          ['read', 'Lidos'],
                          ['pending', 'Na fila'],
                          ['sending', 'Enviando agora'],
                          ['confirming', 'Aguardando confirmação'],
                          ['failed', 'Não enviados'],
                          ['uncertain', 'Conferir envio'],
                        ] as const
                      ).map(([key, label]) => (
                        <div key={key}>
                          <strong>{number(detail.stats[key])}</strong>
                          <span>{label}</span>
                        </div>
                      ))}
                    </div>
                    <p className="ws-metric-note">
                      Os números contam destinatários por campanha; entregues e lidos fazem parte
                      dos envios confirmados. {number(detail.stats.messagesConfirmed)} mensagens
                      individuais (textos e anexos) tiveram confirmação do servidor.{' '}
                      {kind === 'lists'
                        ? `${detail.uniqueResponders || 0} pessoas únicas responderam entre ${detail.uniqueContacts || 0} pessoas selecionadas. Uma pessoa pode participar de várias campanhas.`
                        : ''}
                    </p>
                    {kind === 'campaigns' ? (
                      <>
                        <div className="ws-info-grid">
                          <Info label="Agendada para" value={date(detail.scheduledAt)} />
                          <Info label="Aprovada em" value={date(detail.approvedAt)} />
                          <Info label="Concluída em" value={date(detail.finishedAt)} />
                          <Info
                            label="Próximo envio"
                            value={
                              ['running', 'scheduled'].includes(detail.status)
                                ? date(detail.nextAt || detail.scheduledAt)
                                : '—'
                            }
                          />
                          <Info
                            label="Intervalo da conta"
                            value={`${detail.timing?.intervalSeconds}s`}
                          />
                          <Info
                            label="Limites da conta"
                            value={`${detail.timing?.hourlyLimit}/hora · ${detail.timing?.dailyLimit}/24h`}
                          />
                        </div>
                        {detail.error ? <p className="notice">{detail.error}</p> : null}
                        <h3 className="ws-subheading">Mensagem da campanha</h3>
                        <pre className="ws-message-template">
                          {detail.template || 'Campanha somente com anexos.'}
                        </pre>
                        <div className="ws-attachments">
                          {detail.attachmentIds?.map((id) => {
                            const attachment = state.attachments.find((item) => item.id === id);
                            return attachment ? (
                              <a
                                key={id}
                                className="ws-attachment"
                                download
                                href={`/api/attachments/${id}/download`}
                              >
                                <Download size={16} />
                                <span>
                                  {attachment.name}
                                  <small>
                                    {(attachment.size / 1024).toFixed(0)} KB · {attachment.mimetype}
                                  </small>
                                </span>
                              </a>
                            ) : (
                              <span key={id}>Anexo indisponível</span>
                            );
                          })}
                        </div>
                        <h3 className="ws-subheading">Listas presentes no envio</h3>
                        <p className="small-text muted">
                          {[
                            ...new Set(
                              detail.recipients.flatMap((item) =>
                                (item.listSnapshot || []).map((list) => list.name),
                              ),
                            ),
                          ].join(' · ') || 'Seleção individual, toda a base sem listas ou grupos.'}
                        </p>
                        {detail.recipients.some((item) => item.listAttribution === 'migration') ? (
                          <p className="ws-metric-note">
                            Campanha anterior ao Workspace: a associação às listas foi recuperada da
                            base existente na atualização.
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <div className="ws-info-grid">
                        <Info
                          label="Pessoas na lista hoje"
                          value={number(detail.contactCount || 0)}
                        />
                        <Info
                          label="Pessoas únicas selecionadas"
                          value={number(detail.uniqueContacts || 0)}
                        />
                        <Info
                          label="Pessoas únicas que responderam"
                          value={number(detail.uniqueResponders || 0)}
                        />
                        <Info
                          label="Participações nas campanhas"
                          value={number(detail.stats.total)}
                        />
                      </div>
                    )}
                    {board ? (
                      <div className="ws-card-organization">
                        <label>
                          Organizar card em
                          <select
                            value={placement?.status === detail.status ? placement.columnId : ''}
                            disabled={busy}
                            onChange={(event) => {
                              const columnId = event.target.value || null;
                              void perform(async () => {
                                await post(`/workspaces/${board.id}/move`, {
                                  view: kind,
                                  entityId,
                                  columnId,
                                });
                              });
                            }}
                          >
                            <option value="">Automático pelo status real</option>
                            {board.columns.map((column) => (
                              <option key={column.id} value={column.id}>
                                {column.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <p>
                          Mover um card não altera os envios. Quando o status real mudar, ele volta
                          a acompanhar a coluna correspondente.
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : null}
                {tab === 'campaigns' ? (
                  <div className="ws-related-campaigns">
                    {detail.campaigns?.length ? (
                      detail.campaigns.map((campaign) => (
                        <button
                          key={campaign.id}
                          onClick={() => {
                            onCampaign?.(campaign.id);
                          }}
                        >
                          <span className="ws-card-icon">
                            <Send size={17} />
                          </span>
                          <div>
                            <strong>{campaign.name}</strong>
                            <small>
                              {campaign.stats.sent} envios confirmados · {campaign.stats.responded}{' '}
                              responderam nesta lista
                            </small>
                          </div>
                          <Badge status={campaign.status} />
                        </button>
                      ))
                    ) : (
                      <Empty title="Esta lista ainda não participou de campanhas" />
                    )}
                  </div>
                ) : null}
                {tab === 'contacts' ? <ContactHistory detail={detail} /> : null}
                {tab === 'recipients' ? (
                  <RecipientHistory key={`${kind}:${entityId}`} detail={detail} kind={kind} />
                ) : null}
                {tab === 'replies' ? <ReplyHistory detail={detail} /> : null}
              </div>
              {kind === 'campaigns' && !['completed', 'cancelled'].includes(detail.status) ? (
                <div className="modal-actions">
                  {detail.status === 'draft' && onReview ? (
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () =>
                          onReview(await api<CampaignDetail>(`/campaigns/${entityId}`)),
                        )
                      }
                    >
                      Revisar e enviar
                    </button>
                  ) : null}
                  {['running', 'scheduled', 'paused'].includes(detail.status) ? (
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await post(
                            `/campaigns/${entityId}/${detail.status === 'paused' ? 'resume' : 'pause'}`,
                          );
                        })
                      }
                    >
                      {detail.status === 'paused' ? 'Retomar campanha' : 'Pausar campanha'}
                    </button>
                  ) : null}
                  <button
                    className="button danger"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await post(`/campaigns/${entityId}/cancel`);
                      })
                    }
                  >
                    Cancelar campanha
                  </button>
                </div>
              ) : null}
              <p className="ws-detail-footnote">
                As respostas são observadas no WhatsApp conectado; o aplicativo não responde
                automaticamente. Uma resposta comprova interação com o contato, sem substituir os
                recibos de entrega dos textos e anexos.
              </p>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
