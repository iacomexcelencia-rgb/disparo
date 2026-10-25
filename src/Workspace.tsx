import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Columns3,
  ListFilter,
  MessageSquare,
  Plus,
  Search,
  Send,
  Settings2,
  Users,
} from 'lucide-react';
import type { Actions } from './App';
import type { WorkspaceBoard, WorkspacePayload, WorkspaceView } from './types';
import { api, date, number, post } from './api';
import { Busy, Empty, Modal, SectionTitle } from './components';
import { BoardColumn } from './workspace/BoardColumn';
import { BoardSettings } from './workspace/BoardSettings';
import { DispatchDetails } from './workspace/DispatchDetails';
import { cardColumn, rate, type Card } from './workspace/model';
import './workspace.css';

export function Workspace(props: Actions) {
  const { state, busy, perform, toast } = props;
  const [boardId, setBoardId] = useState(state.workspaces[0]?.id || '');
  const board = state.workspaces.find((item) => item.id === boardId) || state.workspaces[0];
  const [view, setView] = useState<WorkspaceView>('campaigns');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [payload, setPayload] = useState<WorkspacePayload | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<{ id: string; view: WorkspaceView } | null>(null);
  const [settings, setSettings] = useState(false);
  const [adding, setAdding] = useState(false);
  const drag = useRef<string | null>(null);
  const boardElement = useRef<HTMLDivElement>(null);
  const focusedBoard = useRef('');
  useEffect(() => {
    let active = true;
    void api<WorkspacePayload>('/workspace')
      .then((value) => {
        if (active) {
          setPayload(value);
          setError('');
        }
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [state]);
  const cards: Card[] = payload?.[view] || [];
  const columns = useMemo(() => {
    const grouped = new Map((board?.columns || []).map((column) => [column.id, [] as Card[]]));
    if (board)
      for (const card of cards)
        if (card.name.toLocaleLowerCase().includes(deferredQuery.toLocaleLowerCase()))
          grouped.get(cardColumn(board, view, card).id)?.push(card);
    return grouped;
  }, [board, cards, view, deferredQuery]);
  useEffect(() => {
    const key = `${board?.id}:${view}`;
    if (!board || !payload || focusedBoard.current === key || !boardElement.current) return;
    const index = board.columns.findIndex((column) => (columns.get(column.id)?.length || 0) > 0);
    const element = boardElement.current.children[index] as HTMLElement | undefined;
    if (element) {
      boardElement.current.scrollLeft = element.offsetLeft - boardElement.current.offsetLeft;
      focusedBoard.current = key;
    }
  }, [board, view, payload, columns]);
  const totals = useMemo(
    () =>
      (payload?.campaigns || []).reduce(
        (sum, item) => ({
          sent: sum.sent + item.stats.sent,
          responded: sum.responded + item.stats.responded,
          eligible: sum.eligible + item.stats.responseEligible,
          pending: sum.pending + item.stats.pending,
        }),
        { sent: 0, responded: 0, eligible: 0, pending: 0 },
      ),
    [payload],
  );
  const move = (id: string, columnId: string) => {
    if (!board) return;
    void perform(async () => {
      await post(`/workspaces/${board.id}/move`, { view, entityId: id, columnId });
      toast('Card organizado. O status real do envio foi preservado.');
    });
  };
  return (
    <>
      <SectionTitle
        eyebrow="CADA DISPARO, À VISTA"
        title="Workspace"
        description="Organize seus envios. Veja o que chegou e quem respondeu."
        action={
          <button className="button" onClick={() => setAdding(true)}>
            <Plus size={16} />
            Novo workspace
          </button>
        }
      />
      <div className="ws-summary">
        <div>
          <span>
            <CheckCheck size={16} />
            Envios confirmados
          </span>
          <strong>{number(totals.sent)}</strong>
          <small>Por destinatário e campanha</small>
        </div>
        <div>
          <span>
            <MessageSquare size={16} />
            Responderam
          </span>
          <strong>{number(totals.responded)}</strong>
          <small>Uma pessoa por campanha</small>
        </div>
        <div>
          <span>
            <Send size={16} />
            Taxa de resposta
          </span>
          <strong>{rate(totals.eligible ? (totals.responded / totals.eligible) * 100 : 0)}</strong>
          <small>Entre os contatos alcançados</small>
        </div>
        <div>
          <span>
            <ListFilter size={16} />
            Ainda na fila
          </span>
          <strong>{number(totals.pending)}</strong>
          <small>Aguardando a vez de enviar</small>
        </div>
      </div>
      <div className="ws-toolbar">
        <div className="inline">
          <label className="ws-board-label">
            <Columns3 size={18} />
            <span className="sr-only">Workspace</span>
            <select
              aria-label="Selecionar workspace"
              value={board?.id || ''}
              onChange={(event) => setBoardId(event.target.value)}
            >
              {state.workspaces.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="icon-button"
            aria-label="Configurar workspace e colunas"
            onClick={() => setSettings(true)}
          >
            <Settings2 size={18} />
          </button>
        </div>
        <div className="ws-view-switch" role="group" aria-label="Visualização do workspace">
          <button
            className={view === 'campaigns' ? 'selected' : ''}
            aria-pressed={view === 'campaigns'}
            onClick={() => setView('campaigns')}
          >
            <Send size={15} />
            Por campanha
          </button>
          <button
            className={view === 'lists' ? 'selected' : ''}
            aria-pressed={view === 'lists'}
            onClick={() => setView('lists')}
          >
            <Users size={15} />
            Por lista
          </button>
        </div>
        <label className="search ws-search">
          <Search size={16} />
          <input
            aria-label="Buscar cards"
            placeholder={view === 'lists' ? 'Buscar uma lista…' : 'Buscar uma campanha…'}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      {error ? (
        <p role="alert" className="notice">
          {error}
        </p>
      ) : null}
      <div className="ws-board-controls">
        <span>{board?.columns.length || 0} colunas · os cards acompanham os status dos envios</span>
        <div>
          <button
            className="icon-button"
            aria-label="Ver colunas anteriores"
            onClick={() => boardElement.current?.scrollBy({ left: -600, behavior: 'smooth' })}
          >
            <ChevronLeft size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="Ver próximas colunas"
            onClick={() => boardElement.current?.scrollBy({ left: 600, behavior: 'smooth' })}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
      {!payload ? (
        <Busy>Carregando os envios…</Busy>
      ) : board ? (
        <div
          ref={boardElement}
          className="ws-board"
          aria-label={`Kanban ${view === 'campaigns' ? 'por campanha' : 'por lista'}`}
        >
          {board.columns.map((column) => (
            <BoardColumn
              key={column.id}
              column={column}
              cards={columns.get(column.id) || []}
              view={view}
              board={board}
              state={state}
              busy={busy}
              onOpen={(card) => setSelected({ id: card.id, view })}
              onDrag={(id) => {
                drag.current = id;
              }}
              onDrop={() => {
                if (drag.current) move(drag.current, column.id);
                drag.current = null;
              }}
            />
          ))}
        </div>
      ) : (
        <Empty title="Crie seu workspace" />
      )}
      <div className="ws-explanation">
        <MessageSquare size={17} />
        <div>
          <strong>Respostas reais. Sem atendimento automático.</strong>
          <p>
            O registro começa em {date(state.replyTrackingSince)} e acompanha as mensagens recebidas
            enquanto o aplicativo está conectado. Respostas citadas vão para a campanha original; as
            demais vão para a campanha mais recente daquele contato na mesma conta. “Sem resposta”
            significa sem resposta registrada até agora.
          </p>
          <details>
            <summary>Como interpretar os resultados</summary>
            <p>
              A taxa considera contatos com envio confirmado ou uma resposta registrada. Contatos
              ainda na fila, falhas e envios incertos sem resposta não entram nessa base; grupos não
              entram na taxa. Responder não confirma a entrega de todos os anexos. Por lista, os
              totais somam participações nas campanhas e uma pessoa pode aparecer em mais de uma.
              Uma resposta pertence a apenas uma campanha. O status da lista prioriza Em andamento,
              Pausada, Agendada, Rascunho, Concluída e Cancelada, nessa ordem. Renomear uma coluna
              preserva seus status; mover um card organiza o quadro sem iniciar ou concluir
              campanhas.
            </p>
          </details>
        </div>
      </div>
      {selected ? (
        <DispatchDetails
          key={`${selected.view}:${selected.id}`}
          {...props}
          entityId={selected.id}
          kind={selected.view}
          board={board}
          onClose={() => setSelected(null)}
          onCampaign={(id) => setSelected({ id, view: 'campaigns' })}
        />
      ) : null}
      {settings && board ? (
        <BoardSettings {...props} board={board} onClose={() => setSettings(false)} />
      ) : null}
      {adding ? (
        <Modal
          title="Novo workspace"
          subtitle="As mesmas campanhas, com sua própria organização."
          onClose={() => setAdding(false)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const name = new FormData(event.currentTarget).get('name');
              void perform(async () => {
                const next = await post<WorkspaceBoard>('/workspaces', { name });
                setBoardId(next.id);
                setAdding(false);
              });
            }}
          >
            <label>
              Nome do workspace
              <input
                name="name"
                maxLength={100}
                required
                autoFocus
                placeholder="Ex.: Operação de outubro"
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="button" onClick={() => setAdding(false)}>
                Voltar
              </button>
              <button className="button primary" disabled={busy}>
                Criar workspace
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
