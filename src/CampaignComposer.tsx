import { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Send,
  Users,
  Paperclip,
  X,
  Plus,
  Search,
  Eye,
  ChevronRight,
  MessageSquare,
  FileText,
  CheckCheck,
  CalendarClock,
  Smartphone,
  AlertCircle,
} from 'lucide-react';
import type { Actions } from './App';
import type { Attachment, Campaign, CampaignDetail, Contact, Group, Timing } from './types';
import { api, post, date, number } from './api';
import { Busy, Modal, SectionTitle } from './components';
import { LiveReview } from './LiveReview';

const defaultText =
  'Olá, {{primeiro_nome|tudo bem}}! 👋\n\nTenho uma novidade para compartilhar com você.\n\nPodemos conversar?';
function previewText(template: string, contact?: Contact, group?: Group) {
  const fields: Record<string, string> = {
    ...contact?.fields,
    nome: contact?.name || group?.name || '',
    primeiro_nome: contact?.name.split(/\s+/)[0] || group?.name || '',
    empresa: contact?.company || '',
    telefone: contact?.phone || '',
  };
  return template.replace(
    /\{\{\s*([^{}|]+?)(?:\|([^{}]*))?\s*\}\}|\{([^{}]*\|[^{}]*)\}/g,
    (_, key, fallback, choices) =>
      key !== undefined
        ? Object.hasOwn(fields, key.trim()) && fields[key.trim()]
          ? fields[key.trim()]
          : (fallback || '').trim()
        : choices.split('|')[0],
  );
}
export function Composer({
  state,
  busy,
  perform,
  toast,
  duplicate,
  editing,
  onBack,
  onDone,
}: Actions & {
  duplicate?: Campaign;
  editing?: CampaignDetail;
  onBack: () => void;
  onDone: () => void;
}) {
  const initial = editing || duplicate;
  const savedGroups =
    editing?.recipients
      .filter((recipient) => recipient.type === 'group')
      .map((recipient) => ({ id: recipient.address, name: recipient.name })) || [];
  const [name, setName] = useState(editing?.name || (duplicate ? `${duplicate.name} — cópia` : ''));
  const [accountId, setAccountId] = useState(
    initial?.accountId ||
      state.accounts.find((account) => account.status === 'ready')?.id ||
      state.accounts[0]?.id ||
      '',
  );
  const [template, setTemplate] = useState(initial?.template ?? defaultText);
  const mixed = Boolean(
    editing && savedGroups.length && editing.recipients.some((recipient) => recipient.contactId),
  );
  const [audience, setAudience] = useState(
    editing ? (mixed ? 'mixed' : savedGroups.length ? 'groups' : 'contacts') : 'lists',
  );
  const [listIds, setListIds] = useState<string[]>(editing?.audience?.listIds || []);
  // Start from the exact saved recipients so reopening an edit never expands a list silently.
  const [contactIds, setContactIds] = useState<string[]>(
    editing?.recipients.flatMap((recipient) =>
      recipient.contactId ? [recipient.contactId] : [],
    ) || [],
  );
  const [groups, setGroups] = useState<Group[]>(savedGroups);
  const [groupIds, setGroupIds] = useState<string[]>(savedGroups.map((group) => group.id));
  const [query, setQuery] = useState('');
  const [attachmentIds, setAttachmentIds] = useState<string[]>(initial?.attachmentIds || []);
  const [localAttachments, setLocalAttachments] = useState<Attachment[]>([]);
  const [timing, setTiming] = useState<Timing>(initial?.timing || state.settings);
  const [scheduled, setScheduled] = useState(Boolean(editing?.scheduledAt));
  const [scheduledAt, setScheduledAt] = useState(() => {
    if (!editing?.scheduledAt) return '';
    const date = new Date(editing.scheduledAt);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [review, setReview] = useState<CampaignDetail | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = useMemo(
    () =>
      state.contacts.filter(
        (contact) =>
          !contact.optedOut &&
          (audience === 'all' ||
            (audience === 'lists' && contact.listIds.some((list) => listIds.includes(list))) ||
            (['contacts', 'mixed'].includes(audience) && contactIds.includes(contact.id))),
      ),
    [state.contacts, audience, listIds, contactIds],
  );
  const selectedGroups = useMemo(
    () =>
      ['groups', 'mixed'].includes(audience)
        ? groups.filter((group) => groupIds.includes(group.id))
        : [],
    [audience, groups, groupIds],
  );
  const reviewFields = useMemo(
    () => [
      ...selected.map((contact) => ({
        ...contact.fields,
        nome: contact.name,
        primeiro_nome: contact.name.split(/\s+/)[0] || '',
        empresa: contact.company,
        telefone: contact.phone,
      })),
      ...selectedGroups.map((group) => ({
        nome: group.name,
        primeiro_nome: group.name,
        empresa: '',
        telefone: '',
      })),
    ],
    [selected, selectedGroups],
  );
  const total = selected.length + selectedGroups.length;
  const account = state.accounts.find((item) => item.id === accountId);
  const attachments = attachmentIds
    .map((attachmentId) =>
      [...state.attachments, ...localAttachments].find(
        (attachment) => attachment.id === attachmentId,
      ),
    )
    .filter(Boolean) as Attachment[];
  const insert = (value: string) => {
    const textarea = inputRef.current;
    const start = textarea?.selectionStart ?? template.length;
    const end = textarea?.selectionEnd ?? start;
    setTemplate((previous) => previous.slice(0, start) + value + previous.slice(end));
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + value.length, start + value.length);
    });
  };
  const save = async (showReview: boolean) => {
    if (scheduled && !scheduledAt) throw new Error('Selecione a data e o horário de envio.');
    const payload = {
      name: name.trim() || `Campanha de ${new Intl.DateTimeFormat('pt-BR').format(new Date())}`,
      accountId,
      template,
      allContacts: audience === 'all',
      listIds: audience === 'lists' ? listIds : [],
      contactIds: ['contacts', 'mixed'].includes(audience) ? contactIds : [],
      groups: selectedGroups,
      attachmentIds,
      timing,
      scheduledAt: scheduled ? new Date(scheduledAt).toISOString() : null,
    };
    if (editing) {
      await api(`/campaigns/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...payload, expectedRevision: editing.revision || 0 }),
      });
      toast('Alterações salvas. O status da campanha foi mantido.');
      onDone();
      return;
    }
    const draft = await post<CampaignDetail>('/campaigns', payload);
    if (showReview) setReview(draft);
    else {
      toast('Rascunho salvo. Nenhuma mensagem foi enviada.');
      onDone();
    }
  };
  const customFields = [
    ...new Set(state.contacts.flatMap((contact) => Object.keys(contact.fields || {}))),
  ]
    .filter((key) => !['nome', 'primeiro_nome', 'empresa', 'telefone'].includes(key))
    .slice(0, 30);
  return (
    <>
      <button className="text-button back-button" onClick={onBack}>
        <ArrowLeft size={16} />
        {editing ? 'Voltar aos detalhes' : 'Todas as campanhas'}
      </button>
      <SectionTitle
        eyebrow={editing ? 'AJUSTAR CAMPANHA' : 'UMA NOVA CONVERSA'}
        title={
          editing
            ? 'Editar campanha'
            : duplicate
              ? 'Criar a partir de uma campanha'
              : 'Nova campanha'
        }
        description={
          editing
            ? 'Revise os destinatários, a mensagem e o horário antes de salvar.'
            : 'Escreva sua mensagem. Escolha sua base. Faça acontecer.'
        }
      />
      <div className="composer-layout">
        <div className="composer-form">
          <fieldset disabled={busy}>
            <section className="card form-card">
              <div className="form-section-heading">
                <span className="section-number">01</span>
                <div>
                  <h2>O começo da conversa</h2>
                  <p>Dê um nome à campanha e escolha a conta de envio.</p>
                </div>
              </div>
              <div className="form-grid">
                <label>
                  Nome da campanha
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={120}
                    placeholder="Ex.: Novidades de outubro"
                  />
                </label>
                <label>
                  Enviar com
                  <select
                    value={accountId}
                    onChange={(event) => {
                      setAccountId(event.target.value);
                      setGroups([]);
                      setGroupIds([]);
                    }}
                  >
                    <option value="">Selecione uma conta</option>
                    {state.accounts.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.name} {item.status === 'ready' ? '· conectado' : '· desconectado'}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {!state.accounts.length ? (
                <p className="inline muted small-text">
                  <Smartphone size={15} />
                  Adicione uma conta na aba WhatsApp para criar campanhas.
                </p>
              ) : null}
            </section>
            <section className="card form-card">
              <div className="form-section-heading">
                <span className="section-number">02</span>
                <div>
                  <h2>Com quem você quer falar?</h2>
                  <p>Os contatos repetidos são combinados automaticamente.</p>
                </div>
                <span className="count-pill">{number(total)} selecionados</span>
              </div>
              <div className="segmented" role="group" aria-label="Selecionar destinatários">
                {[
                  ['lists', 'Por lista'],
                  ['contacts', 'Escolher contatos'],
                  ['all', 'Toda a base'],
                  ['groups', 'Grupos'],
                  ...(mixed ? [['mixed', 'Contatos e grupos']] : []),
                ].map(([value, label]) => (
                  <button
                    type="button"
                    className={audience === value ? 'selected' : ''}
                    key={value}
                    onClick={() => {
                      setAudience(value);
                      setPreviewIndex(0);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {audience === 'all' ? (
                <div className="audience-summary">
                  <Users size={22} />
                  <div>
                    <strong>{number(selected.length)} contatos da sua base</strong>
                    <p>Cada pessoa recebe uma mensagem na própria conversa.</p>
                  </div>
                </div>
              ) : null}
              {audience === 'lists' ? (
                <div className="audience-list">
                  {state.lists.length ? (
                    state.lists.map((item) => (
                      <label className="audience-option" key={item.id}>
                        <input
                          type="checkbox"
                          checked={listIds.includes(item.id)}
                          onChange={(event) =>
                            setListIds((previous) =>
                              event.target.checked
                                ? [...previous, item.id]
                                : previous.filter((value) => value !== item.id),
                            )
                          }
                        />
                        <span className="list-color" style={{ background: item.color }} />
                        <strong>{item.name}</strong>
                        <small>
                          {
                            state.contacts.filter(
                              (contact) => contact.listIds.includes(item.id) && !contact.optedOut,
                            ).length
                          }{' '}
                          contatos
                        </small>
                      </label>
                    ))
                  ) : (
                    <p className="inline muted">
                      <Users size={18} />
                      Crie listas em Contatos ou use “Toda a base”.
                    </p>
                  )}
                </div>
              ) : null}
              {['contacts', 'mixed'].includes(audience) ? (
                <>
                  <label className="search">
                    <Search size={17} />
                    <input
                      placeholder="Buscar na base"
                      aria-label="Buscar destinatários"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                  <div className="audience-list scroll-list">
                    {state.contacts
                      .filter(
                        (contact) =>
                          !contact.optedOut &&
                          `${contact.name} ${contact.phone}`
                            .toLowerCase()
                            .includes(query.toLowerCase()),
                      )
                      .map((contact) => (
                        <label className="audience-option" key={contact.id}>
                          <input
                            type="checkbox"
                            checked={contactIds.includes(contact.id)}
                            onChange={(event) =>
                              setContactIds((previous) =>
                                event.target.checked
                                  ? [...previous, contact.id]
                                  : previous.filter((value) => value !== contact.id),
                              )
                            }
                          />
                          <strong>{contact.name || 'Sem nome'}</strong>
                          <small>{contact.phone}</small>
                        </label>
                      ))}
                  </div>
                </>
              ) : null}
              {['groups', 'mixed'].includes(audience) ? (
                <>
                  <div className="inline spread">
                    <p className="small-text muted">Grupos disponíveis na conta selecionada.</p>
                    <button
                      type="button"
                      className="button small-button"
                      disabled={account?.status !== 'ready'}
                      onClick={() =>
                        void perform(async () => {
                          const available = await api<Group[]>(`/accounts/${accountId}/groups`);
                          setGroups(available);
                          setGroupIds((previous) =>
                            previous.filter((id) => available.some((group) => group.id === id)),
                          );
                        })
                      }
                    >
                      Carregar grupos
                    </button>
                  </div>
                  <div className="audience-list scroll-list">
                    {groups.map((group) => (
                      <label className="audience-option" key={group.id}>
                        <input
                          type="checkbox"
                          checked={groupIds.includes(group.id)}
                          onChange={(event) =>
                            setGroupIds((previous) =>
                              event.target.checked
                                ? [...previous, group.id]
                                : previous.filter((value) => value !== group.id),
                            )
                          }
                        />
                        <strong>{group.name}</strong>
                      </label>
                    ))}
                  </div>
                </>
              ) : null}
            </section>
            <section className="card form-card">
              <div className="form-section-heading">
                <span className="section-number">03</span>
                <div>
                  <h2>O que você quer dizer?</h2>
                  <p>Uma mensagem com o nome e o contexto de cada pessoa.</p>
                </div>
              </div>
              <div className="variable-toolbar">
                <span>Personalizar:</span>
                {[
                  ['primeiro_nome', 'Primeiro nome'],
                  ['nome', 'Nome completo'],
                  ['empresa', 'Empresa'],
                ].map(([key, label]) => (
                  <button
                    className="variable-tag"
                    key={key}
                    type="button"
                    onClick={() => insert(`{{${key}|}}`)}
                  >
                    <Plus size={12} />
                    {label}
                  </button>
                ))}
                {customFields.length ? (
                  <select
                    className="custom-field-select"
                    aria-label="Inserir campo importado"
                    value=""
                    onChange={(event) => {
                      if (event.target.value) insert(`{{${event.target.value}|}}`);
                    }}
                  >
                    <option value="">Outros campos…</option>
                    {customFields.map((field) => (
                      <option key={field}>{field}</option>
                    ))}
                  </select>
                ) : null}
              </div>
              <label className="sr-only" htmlFor="message-template">
                Mensagem
              </label>
              <textarea
                id="message-template"
                ref={inputRef}
                className="message-input"
                rows={9}
                value={template}
                maxLength={10000}
                onChange={(event) => setTemplate(event.target.value)}
              />
              <div className="message-toolbar">
                <button
                  type="button"
                  className="text-button"
                  disabled={attachmentIds.length >= 5}
                  onClick={() => fileRef.current?.click()}
                >
                  <Paperclip size={16} />
                  Adicionar anexo
                </button>
                <span>{template.length}/10.000</span>
              </div>
              <input
                ref={fileRef}
                type="file"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file)
                    void perform(async () => {
                      const form = new FormData();
                      form.append('file', file);
                      const item = await api<Attachment>('/attachments', {
                        method: 'POST',
                        body: form,
                      });
                      setLocalAttachments((previous) => [...previous, item]);
                      setAttachmentIds((previous) => [...previous, item.id]);
                    });
                  event.currentTarget.value = '';
                }}
              />
              {attachments.length ? (
                <div className="attachment-list">
                  {attachments.map((item) => (
                    <div className="attachment-chip" key={item.id}>
                      <FileText size={16} />
                      <span>{item.name}</span>
                      <small>{(item.size / 1024 / 1024).toFixed(1)} MB</small>
                      <button
                        type="button"
                        aria-label={`Remover anexo ${item.name}`}
                        className="icon-button"
                        onClick={() =>
                          setAttachmentIds((previous) =>
                            previous.filter((value) => value !== item.id),
                          )
                        }
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <details className="template-help">
                <summary>Como usar campos e variações</summary>
                <p>
                  <code>{'{{primeiro_nome|tudo bem}}'}</code> usa o primeiro nome; se estiver vazio,
                  usa “tudo bem”. <code>{'{Olá|Oi|Bom dia}'}</code> escolhe uma das saudações. A
                  versão definitiva aparece na revisão.
                </p>
              </details>
              <LiveReview
                template={template}
                recipientFields={reviewFields}
                attachmentCount={attachments.length}
              />
            </section>
            <section className="card form-card">
              <div className="form-section-heading">
                <span className="section-number">04</span>
                <div>
                  <h2>Seu ritmo de envio</h2>
                  <p>A fila continua enquanto o aplicativo estiver aberto.</p>
                </div>
              </div>
              <div className="form-grid three">
                <label>
                  Intervalo da conta (segundos)
                  <input
                    type="number"
                    min={3}
                    max={86400}
                    value={timing.intervalSeconds}
                    onChange={(event) =>
                      setTiming((previous) => ({
                        ...previous,
                        intervalSeconds: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  Mensagens por hora
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={timing.hourlyLimit}
                    onChange={(event) =>
                      setTiming((previous) => ({
                        ...previous,
                        hourlyLimit: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  Mensagens por dia
                  <input
                    type="number"
                    min={1}
                    max={100000}
                    value={timing.dailyLimit}
                    onChange={(event) =>
                      setTiming((previous) => ({
                        ...previous,
                        dailyLimit: Number(event.target.value),
                      }))
                    }
                  />
                </label>
              </div>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={scheduled}
                  disabled={editing?.status === 'scheduled'}
                  onChange={(event) => setScheduled(event.target.checked)}
                />
                <CalendarClock size={17} />
                Agendar para depois
              </label>
              {scheduled ? (
                <label>
                  Data e hora neste computador
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(event) => setScheduledAt(event.target.value)}
                  />
                </label>
              ) : null}
              <p className="small-text muted">
                Os limites contam texto e cada anexo. Agendamentos precisam do computador ligado e
                do aplicativo aberto.
              </p>
            </section>
            <div className="composer-actions">
              {editing ? (
                <button
                  className="button primary"
                  disabled={
                    !total || !accountId || (!template.trim() && !attachments.length) || busy
                  }
                  onClick={() => void perform(() => save(false))}
                >
                  {busy ? <Busy /> : 'Salvar alterações'}
                </button>
              ) : (
                <>
                  <button
                    className="button"
                    disabled={!total || !accountId || busy}
                    onClick={() => void perform(() => save(false))}
                  >
                    Salvar rascunho
                  </button>
                  <button
                    className="button primary"
                    disabled={
                      !total || !accountId || (!template.trim() && !attachments.length) || busy
                    }
                    onClick={() => void perform(() => save(true))}
                  >
                    {busy ? (
                      <Busy />
                    ) : (
                      <>
                        Revisar e enviar
                        <ArrowRight size={17} />
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </fieldset>
        </div>
        <aside className="preview-column">
          <div className="preview-heading">
            <Eye size={17} />
            <strong>Uma conversa de verdade</strong>
          </div>
          <div className="whatsapp-preview">
            <div className="chat-header">
              <ArrowLeft size={17} />
              <span className="chat-avatar">
                {(selected[previewIndex]?.name || selectedGroups[previewIndex]?.name || 'C').slice(
                  0,
                  1,
                )}
              </span>
              <div>
                <strong>
                  {selected[previewIndex]?.name ||
                    selectedGroups[previewIndex]?.name ||
                    'Seu contato'}
                </strong>
                <small>Prévia da mensagem</small>
              </div>
              <span>⋮</span>
            </div>
            <div className="chat-body">
              <span className="chat-date">HOJE</span>
              <div className="chat-message">
                {previewText(template, selected[previewIndex], selectedGroups[previewIndex]) ||
                  'Sua mensagem aparece aqui…'}
                <span className="chat-time">
                  Agora
                  <CheckCheck size={14} />
                </span>
              </div>
              {attachments.map((item) => (
                <div className="chat-attachment" key={item.id}>
                  <FileText size={24} />
                  <span>{item.name}</span>
                </div>
              ))}
            </div>
            <div className="chat-input">
              <span>Mensagem</span>
              <span className="chat-send">
                <Send size={16} />
              </span>
            </div>
          </div>
          {total > 0 ? (
            <div className="preview-navigation">
              <span>
                Contato {Math.min(previewIndex + 1, total)} de {total}
              </span>
              <button
                className="icon-button"
                aria-label="Ver próximo destinatário"
                onClick={() => setPreviewIndex((previous) => (previous + 1) % total)}
              >
                <ChevronRight size={19} />
              </button>
            </div>
          ) : (
            <p className="small-text muted center">
              Selecione seus destinatários para personalizar a prévia.
            </p>
          )}
          <div className="card preview-summary">
            <h3>Resumo da campanha</h3>
            <div>
              <span>Destinatários</span>
              <strong>{number(total)}</strong>
            </div>
            <div>
              <span>Conta</span>
              <strong>{account?.name || 'Não selecionada'}</strong>
            </div>
            <div>
              <span>Intervalo</span>
              <strong>{timing.intervalSeconds}s</strong>
            </div>
            <div>
              <span>Envio</span>
              <strong>{scheduled ? 'Agendado' : 'Após confirmar'}</strong>
            </div>
          </div>
          <p className="preview-footnote">
            <MessageSquare size={15} />A prévia usa a primeira variação do texto. Na revisão, você
            vê a mensagem exata de cada contato.
          </p>
        </aside>
      </div>
      {review ? (
        <Review
          campaign={review}
          state={state}
          busy={busy}
          onClose={() => {
            setReview(null);
            toast('O rascunho está salvo em Campanhas.');
            onDone();
          }}
          onApprove={() =>
            void perform(async () => {
              await post(`/campaigns/${review.id}/approve`);
              setReview(null);
              toast(
                review.scheduledAt
                  ? 'Campanha agendada.'
                  : 'Campanha iniciada. Acompanhe os envios.',
              );
              onDone();
            })
          }
        />
      ) : null}
    </>
  );
}

export function Review({
  campaign,
  state,
  busy,
  onClose,
  onApprove,
}: {
  campaign: CampaignDetail;
  state: Actions['state'];
  busy: boolean;
  onClose: () => void;
  onApprove: () => void;
}) {
  const [index, setIndex] = useState(0);
  const account = state.accounts.find((item) => item.id === campaign.accountId);
  const count = campaign.recipients.length;
  return (
    <Modal
      wide
      title="Confira sua campanha"
      subtitle="Este é o texto exato que cada destinatário vai receber."
      onClose={onClose}
    >
      <div className="review-stats">
        <div>
          <small>Campanha</small>
          <strong>{campaign.name}</strong>
        </div>
        <div>
          <small>Destinatários</small>
          <strong>{number(count)}</strong>
        </div>
        <div>
          <small>Enviar com</small>
          <strong>{account?.name}</strong>
        </div>
        <div>
          <small>Quando</small>
          <strong>{campaign.scheduledAt ? date(campaign.scheduledAt) : 'Agora'}</strong>
        </div>
      </div>
      {campaign.warnings?.length ? (
        <div className="notice">
          <AlertCircle size={17} />
          Campos sem fallback em alguns contatos: {campaign.warnings.join(', ')}. Confira as
          mensagens antes de enviar.
        </div>
      ) : null}
      <label>
        Conferir mensagem de
        <select value={index} onChange={(event) => setIndex(Number(event.target.value))}>
          {campaign.recipients.map((recipient, itemIndex) => (
            <option value={itemIndex} key={recipient.id}>
              {recipient.name} · {recipient.address}
            </option>
          ))}
        </select>
      </label>
      <div className="review-message">{campaign.recipients[index]?.body || '(Somente anexos)'}</div>
      {campaign.attachmentIds.length ? (
        <p className="small-text">
          Anexos:{' '}
          {campaign.attachmentIds
            .map((attachmentId) => state.attachments.find((item) => item.id === attachmentId)?.name)
            .join(', ')}
        </p>
      ) : null}
      <p className="small-text muted">
        Intervalo de {campaign.timing.intervalSeconds}s · {campaign.timing.hourlyLimit}{' '}
        mensagens/hora · {campaign.timing.dailyLimit} mensagens em 24h. Os limites e o intervalo
        também valem na troca de campanhas da mesma conta.
      </p>
      {account?.status !== 'ready' && !campaign.scheduledAt ? (
        <p className="notice">Conecte a conta na aba WhatsApp. O rascunho já está salvo.</p>
      ) : null}
      <div className="modal-actions">
        <button className="button" onClick={onClose}>
          Manter como rascunho
        </button>
        <button
          className="button primary"
          disabled={busy || (!campaign.scheduledAt && account?.status !== 'ready')}
          onClick={onApprove}
        >
          {busy ? (
            <Busy />
          ) : (
            <>
              <Send size={17} />
              {campaign.scheduledAt
                ? 'Confirmar agendamento'
                : `Enviar para ${number(count)} destinatários`}
            </>
          )}
        </button>
      </div>
    </Modal>
  );
}
