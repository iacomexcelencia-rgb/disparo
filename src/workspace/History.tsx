import { useDeferredValue, useMemo, useState } from 'react';
import { MessageSquare, Search } from 'lucide-react';
import type { DispatchDetail, Recipient, WorkspaceView } from '../types';
import { date, deliveryStatus, number } from '../api';
import { Badge, Empty } from '../components';

export function ContactHistory({ detail }: { detail: DispatchDetail }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const deferred = useDeferredValue(query);
  const contacts = useMemo(
    () =>
      (detail.contacts || []).filter((contact) =>
        `${contact.name} ${contact.phone} ${contact.company}`
          .toLocaleLowerCase()
          .includes(deferred.toLocaleLowerCase()),
      ),
    [detail.contacts, deferred],
  );
  const last = Math.max(0, Math.ceil(contacts.length / 40) - 1);
  const current = Math.min(page, last);
  return (
    <>
      <label className="search ws-history-tools">
        <Search size={15} />
        <input
          aria-label="Buscar contatos da lista"
          placeholder="Nome, telefone ou empresa"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
        />
      </label>
      <div className="ws-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Contato</th>
              <th>Telefone</th>
              <th>Empresa</th>
              <th>Novos envios</th>
            </tr>
          </thead>
          <tbody>
            {contacts.slice(current * 40, (current + 1) * 40).map((contact) => (
              <tr key={contact.id}>
                <td>
                  <strong>{contact.name || 'Sem nome'}</strong>
                  {Object.keys(contact.fields).length ? (
                    <details>
                      <summary>Informações importadas</summary>
                      {Object.entries(contact.fields).map(([key, value]) => (
                        <small key={key}>
                          {key}: {value || '—'}
                        </small>
                      ))}
                    </details>
                  ) : null}
                </td>
                <td>{contact.phone}</td>
                <td>{contact.company || '—'}</td>
                <td>{contact.optedOut ? 'Desativados' : 'Ativados'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!contacts.length ? <Empty title="Nenhum contato neste filtro" /> : null}
      </div>
      <div className="ws-pagination">
        <span>
          {number(contacts.length)} contatos · página {current + 1} de {last + 1}
        </span>
        <div>
          <button
            className="button small-button"
            disabled={!current}
            onClick={() => setPage(current - 1)}
          >
            Anterior
          </button>
          <button
            className="button small-button"
            disabled={current >= last}
            onClick={() => setPage(current + 1)}
          >
            Próxima
          </button>
        </div>
      </div>
    </>
  );
}

export function RecipientHistory({
  detail,
  kind,
}: {
  detail: DispatchDetail;
  kind: WorkspaceView;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const deferred = useDeferredValue(query);
  const matches = useMemo(
    () =>
      detail.recipients.filter(
        (item) =>
          `${item.name} ${item.address} ${item.campaignName || ''}`
            .toLocaleLowerCase()
            .includes(deferred.toLocaleLowerCase()) &&
          (filter === 'all' ||
            (filter === 'replied' && Boolean(item.reply?.firstAt)) ||
            (filter === 'no-reply' &&
              item.type === 'contact' &&
              item.status === 'sent' &&
              !item.reply?.firstAt) ||
            (filter === 'failed' && ['failed', 'skipped'].includes(item.status)) ||
            item.status === filter),
      ),
    [detail.recipients, deferred, filter],
  );
  const last = Math.max(0, Math.ceil(matches.length / 40) - 1);
  const current = Math.min(page, last);
  return (
    <>
      <div className="ws-history-tools">
        <label className="search">
          <Search size={15} />
          <input
            aria-label="Buscar destinatários no histórico"
            placeholder="Nome, telefone ou campanha"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <label>
          <span className="sr-only">Filtrar resultados</span>
          <select
            aria-label="Filtrar resultados"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setPage(0);
            }}
          >
            {[
              ['all', 'Todos os resultados'],
              ['replied', 'Responderam'],
              ['no-reply', 'Sem resposta registrada'],
              ['pending', 'Na fila'],
              ['confirming', 'Aguardando confirmação'],
              ['uncertain', 'Conferir envio'],
              ['failed', 'Não enviados'],
            ].map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="ws-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Destinatário / envio</th>
              <th>Entrega</th>
              <th>Resposta</th>
              <th>Registro</th>
            </tr>
          </thead>
          <tbody>
            {matches.slice(current * 40, (current + 1) * 40).map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.name}</strong>
                  <small>{item.address}</small>
                  {kind === 'lists' ? <small>{item.campaignName}</small> : null}
                  <details>
                    <summary>Mensagem e detalhes</summary>
                    <pre>{item.body || 'Somente anexos'}</pre>
                    <small>
                      Partes esperadas: {item.expectedMessages || '—'} · identificadas:{' '}
                      {item.messageIds?.length || 0}
                    </small>
                    {item.error ? <p className="ws-recipient-error">{item.error}</p> : null}
                    {item.messageIds?.map((id) => (
                      <code key={id}>
                        {id} · confirmação {item.messageAcks?.[id] ?? 0}
                      </code>
                    ))}
                  </details>
                </td>
                <td>
                  <Badge status={deliveryStatus(item)} />
                </td>
                <td>
                  {item.reply ? (
                    <>
                      <span className="ws-replied">
                        <MessageSquare size={13} />
                        Respondeu
                      </span>
                      <small>{date(item.reply.firstAt)}</small>
                      <small>{item.reply.count} mensagens recebidas</small>
                    </>
                  ) : (
                    <span className="muted">
                      {item.status === 'sent' ? 'Sem resposta registrada' : '—'}
                    </span>
                  )}
                </td>
                <td>
                  <small>{date(item.sentAt || item.attemptedAt)}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!matches.length ? <Empty title="Nenhum registro neste filtro" /> : null}
      </div>
      <div className="ws-pagination">
        <span>
          {number(matches.length)} registros · página {current + 1} de {last + 1}
        </span>
        <div>
          <button
            className="button small-button"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            Anterior
          </button>
          <button
            className="button small-button"
            disabled={current >= last}
            onClick={() => setPage(current + 1)}
          >
            Próxima
          </button>
        </div>
      </div>
    </>
  );
}

export function ReplyHistory({ detail }: { detail: DispatchDetail }) {
  const [limit, setLimit] = useState(60);
  const recipients = useMemo(
    () => new Map<string, Recipient>(detail.recipients.map((item) => [item.id, item])),
    [detail.recipients],
  );
  const replies = useMemo(
    () => detail.replies.slice().sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
    [detail.replies],
  );
  return replies.length ? (
    <>
      <div className="ws-reply-list">
        {replies.slice(0, limit).map((reply) => (
          <article key={`${reply.accountId}:${reply.messageId}`}>
            <header>
              <span className="ws-card-icon">
                <MessageSquare size={16} />
              </span>
              <div>
                <strong>{recipients.get(reply.recipientId)?.name || 'Contato'}</strong>
                <small>
                  {date(reply.receivedAt)} ·{' '}
                  {reply.attribution === 'quoted'
                    ? 'Resposta à mensagem original'
                    : 'Campanha mais recente'}
                </small>
              </div>
            </header>
            <p>
              {reply.body ||
                (reply.hasMedia
                  ? 'Mídia recebida. Abra o WhatsApp para visualizar o arquivo.'
                  : 'Mensagem sem texto.')}
            </p>
            {reply.hasMedia && reply.body ? (
              <small>Inclui mídia; consulte o arquivo no WhatsApp.</small>
            ) : null}
          </article>
        ))}
      </div>
      {replies.length > limit ? (
        <button className="button" onClick={() => setLimit((value) => value + 60)}>
          Carregar mais respostas
        </button>
      ) : null}
    </>
  ) : (
    <Empty icon={<MessageSquare size={25} />} title="As próximas respostas aparecem aqui">
      O registro acompanha o WhatsApp conectado.
      <br />
      Você continua atendendo pelo próprio WhatsApp.
    </Empty>
  );
}
