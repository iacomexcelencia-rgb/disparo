import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { Actions } from '../App';
import type { WorkspaceBoard, WorkspaceColumn } from '../types';
import { api, post } from '../api';
import { Modal } from '../components';
import { shortStatus } from './model';

export function BoardSettings({
  board,
  busy,
  perform,
  toast,
  onClose,
}: Actions & { board: WorkspaceBoard; onClose: () => void }) {
  const [name, setName] = useState(board.name);
  const [newColumn, setNewColumn] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const reorder = (index: number, delta: number) =>
    void perform(async () => {
      const ids = board.columns.map((column) => column.id);
      [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
      await api(`/workspaces/${board.id}/columns/order`, {
        method: 'PUT',
        body: JSON.stringify({ columnIds: ids }),
      });
    });
  return (
    <Modal
      wide
      title="Seu workspace, do seu jeito"
      subtitle="A organização muda. Os registros reais dos envios permanecem."
      onClose={onClose}
    >
      <form
        className="ws-config-name"
        onSubmit={(event) => {
          event.preventDefault();
          void perform(async () => {
            await api(`/workspaces/${board.id}`, { method: 'PUT', body: JSON.stringify({ name }) });
            toast('Workspace renomeado.');
          });
        }}
      >
        <label>
          Nome do workspace
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            required
          />
        </label>
        <button className="button" disabled={busy}>
          Salvar nome
        </button>
      </form>
      <h3 className="ws-subheading">Colunas do quadro</h3>
      <p className="small-text muted">
        As colunas acompanham os status vinculados. Ao excluir uma coluna, escolha onde reunir seus
        cards e status.
      </p>
      <div className="ws-column-editors">
        {board.columns.map((column, index) => (
          <ColumnEditor
            key={column.id}
            column={column}
            board={board}
            busy={busy}
            perform={perform}
            index={index}
            reorder={reorder}
          />
        ))}
      </div>
      <form
        className="ws-config-name"
        onSubmit={(event) => {
          event.preventDefault();
          void perform(async () => {
            await post(`/workspaces/${board.id}/columns`, { name: newColumn });
            setNewColumn('');
          });
        }}
      >
        <label>
          Nova coluna personalizada
          <input
            placeholder="Ex.: Conferir resultados"
            value={newColumn}
            onChange={(event) => setNewColumn(event.target.value)}
            maxLength={100}
            required
          />
        </label>
        <button className="button" disabled={busy}>
          <Plus size={15} />
          Adicionar
        </button>
      </form>
      <details className="ws-delete">
        <summary>Excluir este workspace</summary>
        <p>As campanhas, listas e respostas continuam salvas. Mantenha ao menos um workspace.</p>
        <label>
          Digite “{board.name}”
          <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        </label>
        <button
          className="button danger"
          disabled={busy || confirmation !== board.name}
          onClick={() =>
            void perform(async () => {
              await api(`/workspaces/${board.id}`, {
                method: 'DELETE',
                body: JSON.stringify({ name: confirmation }),
              });
              onClose();
            })
          }
        >
          <Trash2 size={15} />
          Excluir workspace
        </button>
      </details>
    </Modal>
  );
}

function ColumnEditor({
  column,
  board,
  busy,
  perform,
  index,
  reorder,
}: {
  column: WorkspaceColumn;
  board: WorkspaceBoard;
  busy: boolean;
  perform: Actions['perform'];
  index: number;
  reorder: (index: number, delta: number) => void;
}) {
  const [name, setName] = useState(column.name);
  const [color, setColor] = useState(column.color);
  const [deleting, setDeleting] = useState(false);
  const [target, setTarget] = useState('');
  return (
    <div className="ws-column-editor">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void perform(async () => {
            await api(`/workspaces/${board.id}/columns/${column.id}`, {
              method: 'PUT',
              body: JSON.stringify({ name, color }),
            });
          });
        }}
      >
        <input
          aria-label={`Cor de ${column.name}`}
          type="color"
          value={color}
          onChange={(event) => setColor(event.target.value)}
        />
        <label>
          <span className="sr-only">Nome da coluna {column.name}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={100}
          />
        </label>
        <button className="button small-button" disabled={busy}>
          Salvar
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label={`Mover ${column.name} para esquerda`}
          disabled={busy || index === 0}
          onClick={() => reorder(index, -1)}
        >
          <ArrowUp size={16} />
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label={`Mover ${column.name} para direita`}
          disabled={busy || index === board.columns.length - 1}
          onClick={() => reorder(index, 1)}
        >
          <ArrowDown size={16} />
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label={`Excluir coluna ${column.name}`}
          disabled={busy || board.columns.length === 1}
          onClick={() => setDeleting((value) => !value)}
        >
          <Trash2 size={15} />
        </button>
      </form>
      <small>
        {column.statuses.length
          ? column.statuses.map(shortStatus).join(' · ')
          : 'Organização manual'}
      </small>
      {deleting ? (
        <div className="ws-delete-column">
          <label>
            Reunir os cards e status em
            <select value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="">Selecione outra coluna</option>
              {board.columns
                .filter((item) => item.id !== column.id)
                .map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
          <button
            className="button danger small-button"
            disabled={busy || !target}
            onClick={() =>
              void perform(async () => {
                await api(`/workspaces/${board.id}/columns/${column.id}`, {
                  method: 'DELETE',
                  body: JSON.stringify({ moveToColumnId: target }),
                });
              })
            }
          >
            Confirmar exclusão
          </button>
        </div>
      ) : null}
    </div>
  );
}
