import { useState, type CSSProperties } from 'react';
import { GripVertical, Send, Users } from 'lucide-react';
import type { Actions } from '../App';
import type { WorkspaceBoard, WorkspaceColumn, WorkspaceView } from '../types';
import { date, number } from '../api';
import { Badge } from '../components';
import { rate, shortStatus, type Card } from './model';

export function BoardColumn({
  column,
  cards,
  view,
  board,
  state,
  busy,
  onOpen,
  onDrag,
  onDrop,
}: {
  column: WorkspaceColumn;
  cards: Card[];
  view: WorkspaceView;
  board: WorkspaceBoard;
  state: Actions['state'];
  busy: boolean;
  onOpen: (card: Card) => void;
  onDrag: (id: string | null) => void;
  onDrop: () => void;
}) {
  const [limit, setLimit] = useState(80);
  const [over, setOver] = useState(false);
  return (
    <section
      className={`ws-column ${over ? 'drag-over' : ''}`}
      style={{ '--column-color': column.color } as CSSProperties}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        onDrop();
      }}
    >
      <header>
        <span className="ws-column-dot" />
        <h2>{column.name}</h2>
        <span className="ws-column-count">{cards.length}</span>
      </header>
      <div className="ws-column-scope">
        {column.statuses.length
          ? column.statuses.map(shortStatus).join(' · ')
          : 'Organização personalizada'}
      </div>
      <div className="ws-cards">
        {cards.slice(0, limit).map((card) => {
          const manual = board.placements[view][card.id]?.status === card.status;
          return (
            <button
              key={card.id}
              className="ws-card"
              disabled={busy}
              draggable={!busy}
              onDragStart={(event) => {
                event.dataTransfer.setData('text/plain', card.id);
                onDrag(card.id);
              }}
              onDragEnd={() => onDrag(null)}
              onClick={() => onOpen(card)}
              aria-label={`Abrir ${view === 'campaigns' ? 'campanha' : 'lista'} ${card.name}`}
            >
              <div className="ws-card-top">
                <span className="ws-card-icon">
                  {view === 'campaigns' ? <Send size={17} /> : <Users size={17} />}
                </span>
                <GripVertical size={15} />
              </div>
              <h3>{card.name}</h3>
              <p className="ws-card-subtitle">
                {view === 'campaigns'
                  ? state.accounts.find((account) => account.id === card.accountId)?.name ||
                    'Conta removida'
                  : `${number(card.contactCount || 0)} contatos · ${card.campaigns?.length || 0} campanhas`}
              </p>
              <div className="ws-card-status">
                <Badge status={card.status} />
                {manual ? <small>Posição manual</small> : null}
              </div>
              {view === 'lists' && Object.keys(card.statusCounts || {}).length > 1 ? (
                <p className="ws-status-mix">
                  {Object.entries(card.statusCounts || {})
                    .map(([status, count]) => `${count} ${shortStatus(status).toLowerCase()}`)
                    .join(' · ')}
                </p>
              ) : null}
              <div className="ws-card-progress">
                <span
                  style={{
                    width: `${card.stats.total ? (card.stats.processed / card.stats.total) * 100 : 0}%`,
                  }}
                />
              </div>
              <div className="ws-card-numbers">
                <div>
                  <strong>{number(card.stats.sent)}</strong>
                  <small>Enviados</small>
                </div>
                <div>
                  <strong>{number(card.stats.responded)}</strong>
                  <small>Responderam</small>
                </div>
                <div className={card.stats.failed ? 'has-failures' : ''}>
                  <strong>{number(card.stats.failed)}</strong>
                  <small>Não enviados</small>
                </div>
              </div>
              <footer>
                {card.stats.uncertain ? (
                  <span>{card.stats.uncertain} para conferir</span>
                ) : card.stats.total ? (
                  <span>{rate(card.stats.responseRate)} de resposta</span>
                ) : (
                  <span>Ainda sem envios</span>
                )}
                {card.scheduledAt && card.status === 'scheduled' ? (
                  <span>{date(card.scheduledAt)}</span>
                ) : (
                  <span>
                    {number(card.stats.total)}{' '}
                    {view === 'lists' ? 'participações' : 'destinatários'}
                  </span>
                )}
              </footer>
            </button>
          );
        })}
        {!cards.length ? (
          <div className="ws-column-empty">
            Nenhum {view === 'campaigns' ? 'envio' : 'grupo de contatos'} por aqui.
          </div>
        ) : null}
        {cards.length > limit ? (
          <button className="text-button" onClick={() => setLimit((value) => value + 80)}>
            Mostrar mais {Math.min(80, cards.length - limit)}
          </button>
        ) : null}
      </div>
    </section>
  );
}
