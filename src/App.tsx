import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  LayoutDashboard,
  Send,
  Users,
  Smartphone,
  Settings2,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Check,
  ShieldCheck,
  Radio,
  Zap,
  Clock3,
  MessageSquare,
  X,
  CircleHelp,
  ChevronRight,
  AlertCircle,
  RefreshCw,
  Columns3,
} from 'lucide-react';
import { api, number, date } from './api';
import type { State, Campaign } from './types';
import { Badge, Empty, SectionTitle, Stat, Busy } from './components';
import { Contacts } from './Contacts';
import { Composer, Campaigns } from './Campaigns';
import { Connections, Preferences } from './Connections';
import { Workspace } from './Workspace';

type Page =
  'dashboard' | 'campaigns' | 'contacts' | 'connections' | 'settings' | 'compose' | 'workspace';
const nav: { id: Page; label: string; icon: ReactNode }[] = [
  { id: 'dashboard', label: 'Visão geral', icon: <LayoutDashboard size={19} /> },
  { id: 'campaigns', label: 'Campanhas', icon: <Send size={19} /> },
  { id: 'contacts', label: 'Contatos e listas', icon: <Users size={19} /> },
  { id: 'workspace', label: 'Workspace', icon: <Columns3 size={19} /> },
  { id: 'connections', label: 'WhatsApp', icon: <Smartphone size={19} /> },
];
export type Actions = {
  state: State;
  busy: boolean;
  perform: (task: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
  toast: (message: string) => void;
};

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [page, setPage] = useState<Page>('dashboard');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [duplicate, setDuplicate] = useState<Campaign | undefined>();
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const next = await api<State>('/state');
      if (current === generation.current) {
        setState(next);
        setError('');
      }
    } catch (failure) {
      if (current === generation.current)
        setError(failure instanceof Error ? failure.message : 'A conexão local foi interrompida.');
      throw failure;
    }
  }, []);
  useEffect(() => {
    void refresh().catch(() => {});
    const events = new EventSource('/api/events');
    let timer: ReturnType<typeof setTimeout>;
    events.addEventListener('change', () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh().catch(() => {}), 180);
    });
    events.onerror = () => setError('Reconectando ao aplicativo local…');
    events.onopen = () => void refresh().catch(() => {});
    return () => {
      events.close();
      clearTimeout(timer);
    };
  }, [refresh]);
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );
  const toast = (message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 6000);
  };
  const actionLock = useRef(false);
  const perform = async (task: () => Promise<void>) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    try {
      await task();
      await refresh();
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'A operação falhou.');
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };
  const newCampaign = () => {
    setDuplicate(undefined);
    setPage('compose');
  };
  const connected = state?.accounts.filter((account) => account.status === 'ready').length || 0;
  const props = state ? { state, busy, perform, refresh, toast } : null;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setPage('dashboard');
          }}
        >
          <span className="brand-mark">
            <Send size={22} fill="currentColor" />
          </span>
          <span>
            disparo<span className="brand-period">.</span>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-avatar">D</span>
          <div>
            <strong>Meu espaço</strong>
            <small>Aplicativo local</small>
          </div>
          <span className="workspace-dot" />
        </div>
        <div className="nav-caption">GERENCIAR</div>
        <nav aria-label="Navegação principal">
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${page === item.id || (item.id === 'campaigns' && page === 'compose') ? 'active' : ''}`}
              onClick={() => setPage(item.id)}
            >
              {item.icon}
              {item.label}
              {item.id === 'campaigns' && state?.campaigns.length ? (
                <span className="nav-count">{state.campaigns.length}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="local-note-icon">
              <ShieldCheck size={21} />
            </span>
            <strong>
              Seu computador.
              <br />
              Seus dados.
            </strong>
            <p>Contatos e histórico salvos localmente, sob seu controle.</p>
          </div>
          <button
            className={`nav-item ${page === 'settings' ? 'active' : ''}`}
            onClick={() => setPage('settings')}
          >
            <Settings2 size={19} />
            Configurações
          </button>
          <div className="sidebar-footer">
            <span className="avatar">D</span>
            <div>
              <strong>Minha base</strong>
              <small>Disparo Desktop · v{state?.system.version || '0.3'}</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Meu espaço
            <ChevronRight size={14} />
            <strong>
              {page === 'compose'
                ? 'Nova campanha'
                : page === 'settings'
                  ? 'Configurações'
                  : nav.find((item) => item.id === page)?.label}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="local-badge">
              <span className="status-dot" />
              Operação local
            </span>
            <button
              className="icon-button"
              aria-label="Como começar"
              onClick={() => setPage('settings')}
            >
              <CircleHelp size={20} />
            </button>
            <span className="avatar small">D</span>
          </div>
        </header>
        <main>
          {error ? (
            <div role="alert" className="connection-error">
              <AlertCircle size={16} />
              {error}
              <button className="text-button" onClick={() => void refresh().catch(() => {})}>
                <RefreshCw size={14} />
                Tentar novamente
              </button>
            </div>
          ) : null}
          {!props ? (
            <div className="loading-state">
              <Busy>Carregando seu espaço…</Busy>
            </div>
          ) : (
            <>
              {page === 'dashboard' ? (
                <Dashboard
                  {...props}
                  connected={connected}
                  onNew={newCampaign}
                  navigate={setPage}
                />
              ) : null}
              {page === 'contacts' ? <Contacts {...props} /> : null}
              {page === 'workspace' ? <Workspace {...props} /> : null}
              {page === 'connections' ? <Connections {...props} /> : null}
              {page === 'settings' ? <Preferences {...props} /> : null}
              {page === 'compose' ? (
                <Composer
                  {...props}
                  duplicate={duplicate}
                  onDone={() => setPage('campaigns')}
                  onBack={() => setPage('campaigns')}
                />
              ) : null}
              {page === 'campaigns' ? (
                <Campaigns
                  {...props}
                  onNew={newCampaign}
                  onDuplicate={(campaign) => {
                    setDuplicate(campaign);
                    setPage('compose');
                  }}
                />
              ) : null}
            </>
          )}
        </main>
        <footer className="main-footer">
          <span>
            <ShieldCheck size={13} />
            Feito para suas conversas, com controle em cada envio.
          </span>
          <span>Disparo Desktop</span>
        </footer>
      </div>
      {notice ? (
        <div className="toast" role="status">
          <MessageSquare size={19} />
          <span>{notice}</span>
          <button className="icon-button" onClick={() => setNotice('')} aria-label="Fechar aviso">
            <X size={17} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Dashboard({
  state,
  connected,
  onNew,
  navigate,
}: Actions & { connected: number; onNew: () => void; navigate: (page: Page) => void }) {
  const sent = state.campaigns.reduce((total, campaign) => total + (campaign.counts.sent || 0), 0);
  const active = state.campaigns.filter((campaign) =>
    ['running', 'scheduled'].includes(campaign.status),
  ).length;
  const steps = [
    {
      icon: <Smartphone size={20} />,
      label: 'Conecte seu WhatsApp',
      text: 'Uma leitura de QR code e pronto.',
      done: connected > 0,
      action: () => navigate('connections'),
    },
    {
      icon: <Users size={20} />,
      label: 'Traga sua base de contatos',
      text: 'Importe Excel, CSV ou vCard.',
      done: state.contacts.length > 0,
      action: () => navigate('contacts'),
    },
    {
      icon: <Send size={20} />,
      label: 'Comece uma conversa',
      text: 'Escreva, selecione e envie.',
      done: state.campaigns.some((campaign) => campaign.approvedAt),
      action: onNew,
    },
  ];
  return (
    <>
      <SectionTitle
        eyebrow="SEU CENTRO DE CONVERSAS"
        title="Boas conversas começam aqui."
        description="Sua base, suas mensagens. Tudo em um só lugar."
        action={
          <button className="button primary" onClick={onNew}>
            <Plus size={17} />
            Nova campanha
          </button>
        }
      />
      <section className="hero">
        <div className="hero-copy">
          <span className="hero-kicker">
            <span className="status-dot" />
            MAIS PROXIMIDADE. MENOS TRABALHO.
          </span>
          <h2>
            Uma mensagem.
            <br />
            Muitas conexões.
          </h2>
          <p>
            Fale com sua base de forma pessoal.
            <br />
            Você escreve uma vez. Cada conversa é única.
          </p>
          <button className="button hero-button" onClick={onNew}>
            Criar minha campanha
            <ArrowUpRight size={18} />
          </button>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="hero-phone">
            <div className="mini-phone-head">
              <span className="mini-avatar">M</span>
              <div>
                <strong>Sua próxima conversa</strong>
                <small>online</small>
              </div>
              <span>•••</span>
            </div>
            <div className="phone-date">HOJE</div>
            <div className="mini-bubble">
              Olá, Mariana! 👋
              <br />
              Tenho uma novidade que combina com a sua empresa.
              <small>
                10:42 <Check size={12} />
                <Check size={12} />
              </small>
            </div>
            <div className="mini-reply">
              Que legal! Pode me contar 😊<small>10:43</small>
            </div>
            <div className="phone-compose">
              <span>Mensagem</span>
              <Send size={16} />
            </div>
          </div>
          <div className="floating-tag">
            <span className="floating-check">
              <Check size={14} />
            </span>
            Uma conversa de cada vez
          </div>
          <span className="spark spark-one">✦</span>
          <span className="spark spark-two">✦</span>
        </div>
      </section>
      <div className="stats-grid">
        <Stat
          title="Contatos na base"
          value={number(state.contacts.length)}
          detail={`${state.lists.length} listas organizadas`}
          icon={<Users size={18} />}
        />
        <Stat
          title="Envios confirmados"
          value={number(sent)}
          detail={`${state.campaigns.reduce((total, campaign) => total + (campaign.stats?.responded || 0), 0)} contatos responderam`}
          icon={<MessageSquare size={18} />}
        />
        <Stat
          title="Campanhas ativas"
          value={number(active)}
          detail="Em andamento ou agendadas"
          icon={<Zap size={18} />}
        />
        <Stat
          title="Contas conectadas"
          value={number(connected)}
          detail={`${state.accounts.length} contas adicionadas`}
          icon={<Smartphone size={18} />}
        />
      </div>
      <div className="dashboard-grid">
        <section className="card recent-card">
          <div className="card-heading">
            <div>
              <h2>Suas campanhas</h2>
              <p>Acompanhe cada conversa que você iniciou.</p>
            </div>
            <button className="text-button" onClick={() => navigate('campaigns')}>
              Ver todas
              <ArrowRight size={15} />
            </button>
          </div>
          {state.campaigns.length ? (
            <div className="campaign-mini-list">
              {state.campaigns.slice(0, 5).map((campaign) => (
                <button
                  key={campaign.id}
                  className="campaign-mini"
                  onClick={() => navigate('campaigns')}
                >
                  <span className="campaign-icon">
                    <Send size={17} />
                  </span>
                  <span>
                    <strong>{campaign.name}</strong>
                    <small>
                      {campaign.total} destinatários · {date(campaign.createdAt)}
                    </small>
                  </span>
                  <Badge status={campaign.status} />
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          ) : (
            <Empty
              title="Sua primeira campanha vem aí"
              icon={<Send size={25} />}
              action={
                <button className="text-button" onClick={onNew}>
                  Criar campanha
                  <ArrowRight size={15} />
                </button>
              }
            >
              Selecione sua base e transforme uma mensagem
              <br />
              em novas conversas.
            </Empty>
          )}
        </section>
        <section className="card getting-started">
          <div className="card-heading">
            <div>
              <h2>Seu próximo passo</h2>
              <p>Do zero à primeira mensagem.</p>
            </div>
            <span className="step-count">{steps.filter((step) => step.done).length}/3</span>
          </div>
          {steps.map((step, index) => (
            <button className="setup-step" key={step.label} onClick={step.action}>
              <span className={`setup-number ${step.done ? 'done' : ''}`}>
                {step.done ? <Check size={17} /> : index + 1}
              </span>
              <span>
                <strong>{step.label}</strong>
                <small>{step.text}</small>
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
          <div className="setup-note">
            <Radio size={16} />
            <span>
              {connected
                ? 'Seu WhatsApp está pronto para conversar.'
                : 'Conecte uma conta para habilitar os envios.'}
            </span>
          </div>
        </section>
      </div>
      <div className="bottom-strip">
        <span className="strip-icon">
          <Clock3 size={20} />
        </span>
        <div>
          <strong>No seu ritmo, com total visibilidade.</strong>
          <span>Agende campanhas, acompanhe a fila e consulte o histórico de cada envio.</span>
        </div>
        <button className="text-button" onClick={() => navigate('settings')}>
          Ajustar preferências
          <ArrowUpRight size={16} />
        </button>
      </div>
    </>
  );
}
