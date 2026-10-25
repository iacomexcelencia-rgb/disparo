import { useState, type FormEvent } from 'react';
import {
  Smartphone,
  Plus,
  QrCode,
  RefreshCw,
  LogOut,
  CheckCircle2,
  ShieldCheck,
  FolderLock,
  Clock3,
  Save,
  Monitor,
  ExternalLink,
} from 'lucide-react';
import type { Actions } from './App';
import type { Account, Settings } from './types';
import { api, post } from './api';
import { Badge, Busy, Empty, Modal, SectionTitle } from './components';
import { countries } from './Contacts';

export function Connections({ state, busy, perform, toast }: Actions) {
  const [adding, setAdding] = useState(false);
  const [disconnect, setDisconnect] = useState<Account | null>(null);
  const connect = (accountId: string) =>
    void perform(async () => {
      await post(`/accounts/${accountId}/connect`);
      toast('Abrindo a conexão. Aguarde o QR code aparecer.');
    });
  return (
    <>
      <SectionTitle
        eyebrow="A ORIGEM DAS SUAS CONVERSAS"
        title="Seu WhatsApp, conectado"
        description="Leia o QR code uma vez. Suas conversas continuam na sua conta."
        action={
          <button className="button primary" onClick={() => setAdding(true)}>
            <Plus size={17} />
            Adicionar conta
          </button>
        }
      />
      <div className="connection-layout">
        <section>
          {!state.accounts.length ? (
            <div className="card">
              <Empty
                icon={<Smartphone size={30} />}
                title="Conecte sua primeira conta"
                action={
                  <button className="button primary" onClick={() => setAdding(true)}>
                    <QrCode size={17} />
                    Conectar WhatsApp
                  </button>
                }
              >
                Use seu WhatsApp pessoal ou Business.
                <br />
                Sem chave de API e sem cadastro adicional.
              </Empty>
            </div>
          ) : (
            <div className="account-grid">
              {state.accounts.map((account) => (
                <article className="card account-card" key={account.id}>
                  <div className="inline spread">
                    <span className="account-icon">
                      <Smartphone size={25} />
                    </span>
                    <Badge status={account.status} />
                  </div>
                  <h2>{account.name}</h2>
                  <p>{account.phone ? `+${account.phone}` : 'WhatsApp pessoal ou Business'}</p>
                  {account.status === 'ready' ? (
                    <div className="account-ready">
                      <CheckCircle2 size={39} />
                      <strong>Pronto para conversar</strong>
                      <p>
                        Você pode usar seu celular normalmente.
                        <br />
                        As respostas chegam no próprio WhatsApp.
                      </p>
                      <button
                        className="button small-button"
                        onClick={() => setDisconnect(account)}
                      >
                        <LogOut size={15} />
                        Desconectar
                      </button>
                    </div>
                  ) : account.qr ? (
                    <div className="qr-area">
                      <img
                        src={account.qr}
                        alt={`QR code para conectar a conta ${account.name}`}
                        width={250}
                        height={250}
                      />
                      <p>
                        Aponte a câmera pelo menu
                        <br />
                        <strong>Aparelhos conectados</strong> do WhatsApp.
                      </p>
                      <small>O código se atualiza automaticamente.</small>
                    </div>
                  ) : ['connecting', 'authenticated'].includes(account.status) ? (
                    <div className="account-ready">
                      <Busy>Preparando sua conexão…</Busy>
                      <p>
                        {account.progress ||
                          'Na primeira vez, o navegador pode levar alguns instantes para iniciar.'}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="account-placeholder">
                        <QrCode size={64} strokeWidth={1} />
                        <p>Seu QR code vai aparecer aqui.</p>
                      </div>
                      {account.error ? (
                        <div className="notice error-message">{account.error}</div>
                      ) : null}
                      <button
                        className="button primary full-width"
                        disabled={busy}
                        onClick={() => connect(account.id)}
                      >
                        <RefreshCw size={16} />
                        Conectar conta
                      </button>
                    </>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
        <aside>
          <div className="card instructions">
            <span className="instructions-icon">
              <QrCode size={27} />
            </span>
            <h2>Um minuto para conectar.</h2>
            <ol>
              <li>
                <strong>Abra o WhatsApp no celular</strong>
                <span>Use a conta que vai enviar as mensagens.</span>
              </li>
              <li>
                <strong>Toque em Aparelhos conectados</strong>
                <span>No Android, pelo menu ⋮. No iPhone, em Configurações.</span>
              </li>
              <li>
                <strong>Conecte um aparelho</strong>
                <span>Aponte o celular para o QR code que aparecer aqui.</span>
              </li>
            </ol>
            <div className="instructions-note">
              <ShieldCheck size={18} />
              <p>
                A sessão fica salva neste computador. Você pode desconectá-la pelo celular a
                qualquer momento.
              </p>
            </div>
          </div>
        </aside>
      </div>
      {adding ? (
        <Modal
          title="Como vamos chamar esta conta?"
          subtitle="Use um nome para reconhecer de onde você vai enviar."
          onClose={() => setAdding(false)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const name = new FormData(event.currentTarget).get('name');
              void perform(async () => {
                const account = await post<Account>('/accounts', { name });
                setAdding(false);
                await post(`/accounts/${account.id}/connect`);
              });
            }}
          >
            <fieldset disabled={busy}>
              <label>
                Nome da conta
                <input
                  name="name"
                  placeholder="Ex.: Atendimento, Meu número, Comercial"
                  maxLength={80}
                  required
                  autoFocus
                />
              </label>
              <div className="modal-actions">
                <button type="button" className="button" onClick={() => setAdding(false)}>
                  Cancelar
                </button>
                <button className="button primary">
                  {busy ? (
                    <Busy />
                  ) : (
                    <>
                      <QrCode size={17} />
                      Gerar QR code
                    </>
                  )}
                </button>
              </div>
            </fieldset>
          </form>
        </Modal>
      ) : null}
      {disconnect ? (
        <Modal title={`Desconectar ${disconnect.name}?`} onClose={() => setDisconnect(null)}>
          <p>
            A conta será desvinculada deste aplicativo. Para usá-la novamente, será necessário ler
            outro QR code. Os contatos e o histórico continuam salvos.
          </p>
          <div className="modal-actions">
            <button className="button" onClick={() => setDisconnect(null)}>
              Voltar
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await post(`/accounts/${disconnect.id}/disconnect`);
                  setDisconnect(null);
                  toast('Conta desconectada.');
                })
              }
            >
              Desconectar conta
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

export function Preferences({ state, busy, perform, toast }: Actions) {
  const [settings, setSettings] = useState<Settings>(state.settings);
  const save = (event: FormEvent) => {
    event.preventDefault();
    void perform(async () => {
      await api('/settings', { method: 'PUT', body: JSON.stringify(settings) });
      toast('Preferências salvas para as próximas campanhas.');
    });
  };
  return (
    <>
      <SectionTitle
        eyebrow="DO SEU JEITO"
        title="Preferências do espaço"
        description="Defina seus padrões. Ajuste cada campanha quando precisar."
      />
      <div className="settings-layout">
        <form onSubmit={save}>
          <fieldset disabled={busy}>
            <section className="card form-card">
              <div className="form-section-heading">
                <span className="settings-icon">
                  <Clock3 size={21} />
                </span>
                <div>
                  <h2>Padrões de envio</h2>
                  <p>Aplicados às novas campanhas. As existentes mantêm seus ajustes.</p>
                </div>
              </div>
              <div className="form-grid">
                <label>
                  Intervalo da conta entre destinatários (segundos)
                  <input
                    type="number"
                    min={3}
                    max={86400}
                    required
                    value={settings.intervalSeconds}
                    onChange={(event) =>
                      setSettings((previous) => ({
                        ...previous,
                        intervalSeconds: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  Indicador “digitando” (segundos)
                  <input
                    type="number"
                    min={0}
                    max={5}
                    required
                    value={settings.typingSeconds}
                    onChange={(event) =>
                      setSettings((previous) => ({
                        ...previous,
                        typingSeconds: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  Máximo de mensagens por hora
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    required
                    value={settings.hourlyLimit}
                    onChange={(event) =>
                      setSettings((previous) => ({
                        ...previous,
                        hourlyLimit: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  Máximo de mensagens em 24 horas
                  <input
                    type="number"
                    min={1}
                    max={100000}
                    required
                    value={settings.dailyLimit}
                    onChange={(event) =>
                      setSettings((previous) => ({
                        ...previous,
                        dailyLimit: Number(event.target.value),
                      }))
                    }
                  />
                </label>
              </div>
              <p className="small-text muted">
                Cada texto e cada anexo contam como uma mensagem. Os limites são compartilhados por
                todas as campanhas da mesma conta.
              </p>
              <label>
                País padrão dos contatos
                <select
                  value={settings.country}
                  onChange={(event) =>
                    setSettings((previous) => ({ ...previous, country: event.target.value }))
                  }
                >
                  {countries.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="modal-actions">
                <button className="button primary">
                  {busy ? (
                    <Busy />
                  ) : (
                    <>
                      <Save size={17} />
                      Salvar preferências
                    </>
                  )}
                </button>
              </div>
            </section>
          </fieldset>
        </form>
        <aside>
          <section className="card form-card">
            <div className="form-section-heading">
              <span className="settings-icon">
                <FolderLock size={21} />
              </span>
              <div>
                <h2>Seus dados ficam aqui</h2>
                <p>Armazenamento neste computador.</p>
              </div>
            </div>
            <code className="data-path">{state.system.dataDir}</code>
            <p className="small-text muted">
              Para fazer backup, feche o aplicativo e copie esta pasta. Ela contém contatos, listas,
              campanhas, workspaces, respostas registradas, anexos e sessões conectadas. Guarde a
              cópia em um local privado.
            </p>
            <div className="divider" />
            <h3>Antes de deixar uma campanha rodando</h3>
            <div className="settings-tips">
              <p>
                <Monitor size={17} />
                Mantenha o computador ligado e sem suspensão.
              </p>
              <p>
                <Clock3 size={17} />
                Deixe o Disparo aberto, inclusive nos agendamentos.
              </p>
              <p>
                <Smartphone size={17} />
                As respostas aparecem no seu WhatsApp.
              </p>
            </div>
          </section>
          <div className="about-card">
            <span className="brand-mark small-mark">
              <SendIcon />
            </span>
            <div>
              <strong>Disparo Desktop</strong>
              <small>
                Versão {state.system.version} ·{' '}
                {state.system.platform === 'win32' ? 'Windows' : state.system.platform}
              </small>
            </div>
            <a
              href="https://faq.whatsapp.com/"
              target="_blank"
              rel="noreferrer"
              aria-label="Abrir ajuda do WhatsApp"
            >
              <ExternalLink size={16} />
            </a>
          </div>
        </aside>
      </div>
    </>
  );
}
function SendIcon() {
  return <Smartphone size={20} />;
}
