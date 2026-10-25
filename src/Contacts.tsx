import { useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Download,
  Upload,
  Plus,
  Search,
  Users,
  FileSpreadsheet,
  X,
  Pencil,
  Trash2,
  CheckCircle2,
  ArrowRight,
  Tag,
  Ban,
} from 'lucide-react';
import type { Actions } from './App';
import type { Contact, ImportPreview } from './types';
import { api, post, number } from './api';
import { Empty, Modal, SectionTitle, Busy } from './components';

export const countries = [
  ['BR', 'Brasil (+55)'],
  ['PT', 'Portugal (+351)'],
  ['US', 'Estados Unidos (+1)'],
  ['AR', 'Argentina (+54)'],
  ['MX', 'México (+52)'],
  ['GB', 'Reino Unido (+44)'],
  ['ES', 'Espanha (+34)'],
  ['DE', 'Alemanha (+49)'],
  ['FR', 'França (+33)'],
  ['CO', 'Colômbia (+57)'],
  ['CL', 'Chile (+56)'],
];
export function Contacts({ state, busy, perform, toast }: Actions) {
  const [query, setQuery] = useState('');
  const [list, setList] = useState('all');
  const [page, setPage] = useState(0);
  const [editor, setEditor] = useState<Contact | 'new' | null>(null);
  const [newList, setNewList] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleteContact, setDeleteContact] = useState<Contact | null>(null);
  const [deleteList, setDeleteList] = useState(false);
  const filtered = useMemo(
    () =>
      state.contacts.filter(
        (contact) =>
          (list === 'all' || contact.listIds.includes(list)) &&
          `${contact.name} ${contact.phone} ${contact.company}`
            .toLocaleLowerCase('pt-BR')
            .includes(query.toLocaleLowerCase('pt-BR')),
      ),
    [state.contacts, query, list],
  );
  const listName =
    list === 'all'
      ? 'Todos os contatos'
      : state.lists.find((item) => item.id === list)?.name || 'Lista';
  return (
    <>
      <SectionTitle
        eyebrow="SUA BASE, BEM ORGANIZADA"
        title="Contatos e listas"
        description="Pessoas certas, mensagens que fazem sentido."
        action={
          <div className="inline">
            <button className="button" onClick={() => setImporting(true)}>
              <Upload size={17} />
              Importar contatos
            </button>
            <button className="button primary" onClick={() => setEditor('new')}>
              <Plus size={17} />
              Novo contato
            </button>
          </div>
        }
      />
      <div className="contacts-layout">
        <aside className="card list-sidebar">
          <div className="card-heading">
            <h3>Suas listas</h3>
            <button
              className="icon-button"
              aria-label="Criar lista"
              onClick={() => setNewList(true)}
            >
              <Plus size={17} />
            </button>
          </div>
          <button
            className={`list-item ${list === 'all' ? 'active' : ''}`}
            onClick={() => {
              setList('all');
              setPage(0);
            }}
          >
            <Users size={17} />
            <span>Todos os contatos</span>
            <small>{number(state.contacts.length)}</small>
          </button>
          {state.lists.map((item) => (
            <button
              key={item.id}
              className={`list-item ${list === item.id ? 'active' : ''}`}
              onClick={() => {
                setList(item.id);
                setPage(0);
              }}
            >
              <span className="list-color" style={{ background: item.color }} />
              <span>{item.name}</span>
              <small>
                {number(
                  state.contacts.filter((contact) => contact.listIds.includes(item.id)).length,
                )}
              </small>
            </button>
          ))}
          <button className="text-button add-list" onClick={() => setNewList(true)}>
            <Plus size={15} />
            Criar uma lista
          </button>
          <div className="list-help">
            <Tag size={19} />
            <p>
              Um contato pode participar de várias listas. Cada telefone aparece uma única vez na
              base.
            </p>
          </div>
        </aside>
        <section className="card contacts-table">
          <div className="table-toolbar">
            <div>
              <h2>{listName}</h2>
              <p>{number(filtered.length)} contatos</p>
            </div>
            <div className="inline">
              <label className="search">
                <Search size={17} />
                <input
                  aria-label="Buscar contatos"
                  placeholder="Buscar nome, número ou empresa"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(0);
                  }}
                />
              </label>
              <a
                className="icon-button"
                href="/api/contacts/export"
                download
                aria-label="Exportar todos os contatos"
              >
                <Download size={18} />
              </a>
              {list !== 'all' ? (
                <button
                  className="icon-button danger-text"
                  aria-label="Excluir lista"
                  onClick={() => setDeleteList(true)}
                >
                  <Trash2 size={17} />
                </button>
              ) : null}
            </div>
          </div>
          {!filtered.length ? (
            <Empty
              icon={<Users size={27} />}
              title={query ? 'Nenhum contato encontrado' : 'Sua base começa aqui'}
              action={
                !query ? (
                  <button className="button primary" onClick={() => setImporting(true)}>
                    <Upload size={16} />
                    Importar minha base
                  </button>
                ) : undefined
              }
            >
              {query
                ? 'Tente outro nome, telefone ou empresa.'
                : 'Traga seus contatos de uma planilha ou adicione um por vez.'}
            </Empty>
          ) : (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Contato</th>
                      <th>Telefone</th>
                      <th>Empresa</th>
                      <th>Listas</th>
                      <th>
                        <span className="sr-only">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(page * 25, page * 25 + 25).map((contact) => (
                      <tr key={contact.id}>
                        <td>
                          <div className="contact-cell">
                            <span className="avatar contact-avatar">
                              {(contact.name || '?').slice(0, 2).toUpperCase()}
                            </span>
                            <div>
                              <strong>{contact.name || 'Sem nome'}</strong>
                              {contact.optedOut ? (
                                <small className="danger-text">
                                  <Ban size={11} />
                                  Não receber
                                </small>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="mono">{contact.phone}</td>
                        <td>{contact.company || <span className="muted">—</span>}</td>
                        <td>
                          <div className="tags">
                            {contact.listIds.map((listId) => {
                              const item = state.lists.find((candidate) => candidate.id === listId);
                              return item ? (
                                <span className="tag" key={listId}>
                                  <span className="list-color" style={{ background: item.color }} />
                                  {item.name}
                                </span>
                              ) : null;
                            })}
                          </div>
                        </td>
                        <td>
                          <div className="inline">
                            <button
                              className="icon-button"
                              aria-label={`Editar ${contact.name || contact.phone}`}
                              onClick={() => setEditor(contact)}
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label={`Excluir ${contact.name || contact.phone}`}
                              onClick={() => setDeleteContact(contact)}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pagination">
                <span>
                  {page * 25 + 1}–{Math.min(page * 25 + 25, filtered.length)} de{' '}
                  {number(filtered.length)}
                </span>
                <div className="inline">
                  <button
                    className="button small-button"
                    disabled={page === 0}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    Anterior
                  </button>
                  <button
                    className="button small-button"
                    disabled={(page + 1) * 25 >= filtered.length}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Próxima
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
      {editor ? (
        <ContactEditor
          contact={editor === 'new' ? null : editor}
          state={state}
          busy={busy}
          onClose={() => setEditor(null)}
          onSave={(input) =>
            perform(async () => {
              await api(editor === 'new' ? '/contacts' : `/contacts/${editor.id}`, {
                method: editor === 'new' ? 'POST' : 'PUT',
                body: JSON.stringify(input),
              });
              setEditor(null);
              toast('Contato salvo na sua base.');
            })
          }
        />
      ) : null}
      {newList ? (
        <Modal
          title="Uma lista, um contexto"
          subtitle="Organize sua base como você trabalha."
          onClose={() => setNewList(false)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void perform(async () => {
                await post('/lists', { name: form.get('name'), color: form.get('color') });
                setNewList(false);
                toast('Lista criada.');
              });
            }}
          >
            <fieldset disabled={busy}>
              <label>
                Nome da lista
                <input
                  name="name"
                  required
                  maxLength={80}
                  placeholder="Ex.: Clientes, Alunos, Comunidade"
                  autoFocus
                />
              </label>
              <label>
                Cor
                <input type="color" name="color" defaultValue="#16a078" className="color-input" />
              </label>
              <div className="modal-actions">
                <button type="button" className="button" onClick={() => setNewList(false)}>
                  Cancelar
                </button>
                <button className="button primary">{busy ? <Busy /> : 'Criar lista'}</button>
              </div>
            </fieldset>
          </form>
        </Modal>
      ) : null}
      {importing ? (
        <ImportWizard
          state={state}
          busy={busy}
          perform={perform}
          onClose={() => setImporting(false)}
        />
      ) : null}
      {deleteContact ? (
        <Modal title="Excluir contato?" onClose={() => setDeleteContact(null)}>
          <p>
            {deleteContact.name || deleteContact.phone} será removido da base. O histórico de envios
            será preservado.
          </p>
          <div className="modal-actions">
            <button className="button" onClick={() => setDeleteContact(null)}>
              Voltar
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await api(`/contacts/${deleteContact.id}`, { method: 'DELETE' });
                  setDeleteContact(null);
                  setPage(0);
                })
              }
            >
              Excluir contato
            </button>
          </div>
        </Modal>
      ) : null}
      {deleteList ? (
        <Modal title="Excluir esta lista?" onClose={() => setDeleteList(false)}>
          <p>Os contatos continuam na sua base. Apenas a organização “{listName}” será removida.</p>
          <div className="modal-actions">
            <button className="button" onClick={() => setDeleteList(false)}>
              Voltar
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await api(`/lists/${list}`, { method: 'DELETE' });
                  setDeleteList(false);
                  setList('all');
                  setPage(0);
                })
              }
            >
              Excluir lista
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function ContactEditor({
  contact,
  state,
  busy,
  onClose,
  onSave,
}: {
  contact: Contact | null;
  state: Actions['state'];
  busy: boolean;
  onClose: () => void;
  onSave: (value: unknown) => void;
}) {
  const [selectedLists, setSelectedLists] = useState<string[]>(contact?.listIds || []);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({
      name: form.get('name'),
      company: form.get('company'),
      phone: form.get('phone'),
      country: form.get('country'),
      listIds: selectedLists,
      optedOut: form.get('optedOut') === 'on',
      fields: contact?.fields || {},
    });
  };
  return (
    <Modal title={contact ? 'Editar contato' : 'Adicionar à sua base'} onClose={onClose}>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <div className="form-grid">
            <label>
              Nome
              <input
                name="name"
                defaultValue={contact?.name}
                placeholder="Nome do contato"
                maxLength={200}
                autoFocus
              />
            </label>
            <label>
              Empresa
              <input
                name="company"
                defaultValue={contact?.company}
                placeholder="Opcional"
                maxLength={200}
              />
            </label>
          </div>
          <div className="form-grid">
            <label>
              País
              <select name="country" defaultValue={state.settings.country}>
                {countries.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Telefone
              <input
                name="phone"
                required
                defaultValue={contact?.phone}
                placeholder="(11) 99999-9999"
                maxLength={80}
              />
            </label>
          </div>
          <label>Listas</label>
          <div className="checkbox-tags">
            {state.lists.length ? (
              state.lists.map((item) => (
                <label key={item.id} className="check-tag">
                  <input
                    type="checkbox"
                    checked={selectedLists.includes(item.id)}
                    onChange={(event) =>
                      setSelectedLists((previous) =>
                        event.target.checked
                          ? [...previous, item.id]
                          : previous.filter((value) => value !== item.id),
                      )
                    }
                  />
                  {item.name}
                </label>
              ))
            ) : (
              <small className="muted">Você pode criar listas na tela de contatos.</small>
            )}
          </div>
          <label className="check-label">
            <input type="checkbox" name="optedOut" defaultChecked={contact?.optedOut} />
            Não enviar novas mensagens para este contato
          </label>
          <div className="modal-actions">
            <button type="button" className="button" onClick={onClose}>
              Cancelar
            </button>
            <button className="button primary">{busy ? <Busy /> : 'Salvar contato'}</button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}

function ImportWizard({
  state,
  busy,
  perform,
  onClose,
}: Pick<Actions, 'state' | 'busy' | 'perform'> & { onClose: () => void }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState({ phone: '', name: '', company: '' });
  const [country, setCountry] = useState(state.settings.country);
  const [listIds, setListIds] = useState<string[]>([]);
  const [result, setResult] = useState<{
    added: number;
    updated: number;
    invalid: { row: number; value: string }[];
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const loadFile = (file?: File) => {
    if (!file) return;
    void perform(async () => {
      const form = new FormData();
      form.append('file', file);
      const next = await api<ImportPreview>('/imports/preview', { method: 'POST', body: form });
      setPreview(next);
      setMapping(next.mapping);
    });
  };
  return (
    <Modal
      wide
      title={result ? 'Sua base foi atualizada' : 'Importar contatos'}
      subtitle={
        result
          ? 'Números repetidos foram combinados com os contatos existentes.'
          : 'Traga sua planilha. Nós organizamos os números.'
      }
      onClose={onClose}
    >
      {result ? (
        <>
          <div className="import-success">
            <CheckCircle2 size={42} />
            <h3>Pronto para novas conversas.</h3>
            <div className="result-grid">
              <span>
                <strong>{number(result.added)}</strong>adicionados
              </span>
              <span>
                <strong>{number(result.updated)}</strong>atualizados / repetidos
              </span>
              <span>
                <strong>{number(result.invalid.length)}</strong>números inválidos
              </span>
            </div>
          </div>
          {result.invalid.length ? (
            <details className="notice">
              <summary>Conferir números não importados</summary>
              <div className="invalid-list">
                {result.invalid.map((item, index) => (
                  <p key={index}>
                    Linha {item.row}: {item.value || '(vazio)'}
                  </p>
                ))}
              </div>
            </details>
          ) : null}
          <div className="modal-actions">
            <button className="button primary" onClick={onClose}>
              Concluir
              <CheckCircle2 size={17} />
            </button>
          </div>
        </>
      ) : !preview ? (
        <>
          <button
            disabled={busy}
            className="upload-zone"
            onClick={() => fileInput.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (!busy) loadFile(event.dataTransfer.files[0]);
            }}
          >
            <span className="upload-icon">
              <FileSpreadsheet size={32} />
            </span>
            <h3>{busy ? 'Lendo seu arquivo…' : 'Arraste sua planilha para cá'}</h3>
            <p>ou clique para escolher no computador</p>
            <span className="tag">XLSX · CSV · VCF · até 25 MB</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.csv,.vcf,.vcard"
            hidden
            onChange={(event) => loadFile(event.target.files?.[0])}
          />
          <div className="import-tips">
            <strong>O essencial é uma coluna com telefones.</strong>
            <p>
              Nome, empresa e outras colunas podem personalizar suas mensagens. CSV deve estar em
              UTF-8. Para arquivos XLS antigos, salve uma cópia em XLSX.
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="file-chip">
            <FileSpreadsheet size={22} />
            <div>
              <strong>{preview.filename}</strong>
              <small>{number(preview.total)} linhas encontradas</small>
            </div>
            <button
              className="icon-button"
              aria-label="Trocar arquivo"
              onClick={() => setPreview(null)}
            >
              <X size={17} />
            </button>
          </div>
          <fieldset disabled={busy}>
            <div className="form-grid three">
              {(['phone', 'name', 'company'] as const).map((key) => (
                <label key={key}>
                  {key === 'phone'
                    ? 'Coluna de telefone *'
                    : key === 'name'
                      ? 'Coluna de nome'
                      : 'Coluna de empresa'}
                  <select
                    value={mapping[key]}
                    onChange={(event) =>
                      setMapping((previous) => ({ ...previous, [key]: event.target.value }))
                    }
                  >
                    {key !== 'phone' ? <option value="">Não importar</option> : null}
                    {preview.headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="form-grid">
              <label>
                País dos números
                <select value={country} onChange={(event) => setCountry(event.target.value)}>
                  {countries.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Adicionar à lista
                <select
                  value={listIds[0] || ''}
                  onChange={(event) => setListIds(event.target.value ? [event.target.value] : [])}
                >
                  <option value="">Somente na base geral</option>
                  {state.lists.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="table-scroll preview-table">
              <table>
                <thead>
                  <tr>
                    {preview.headers.map((header) => (
                      <th key={header}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 5).map((row, index) => (
                    <tr key={index}>
                      {preview.headers.map((header) => (
                        <td key={header}>{row[header] || '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small-text">
              Prévia das primeiras linhas. Os telefones serão normalizados e os repetidos,
              combinados.
            </p>
            <div className="modal-actions">
              <button className="button" onClick={onClose}>
                Cancelar
              </button>
              <button
                className="button primary"
                disabled={!mapping.phone}
                onClick={() =>
                  void perform(async () =>
                    setResult(
                      await post('/imports/commit', {
                        token: preview.token,
                        mapping,
                        country,
                        listIds,
                      }),
                    ),
                  )
                }
              >
                {busy ? (
                  <Busy />
                ) : (
                  <>
                    Importar {number(preview.total)} contatos
                    <ArrowRight size={17} />
                  </>
                )}
              </button>
            </div>
          </fieldset>
        </>
      )}
    </Modal>
  );
}
