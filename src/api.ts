export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'X-Disparo': '1',
      ...(!(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
  return data;
}
export const post = <T = unknown>(path: string, body: unknown = {}) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const date = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(value),
      )
    : '—';
export const number = (value: number) => new Intl.NumberFormat('pt-BR').format(value);
export const statusLabel: Record<string, string> = {
  draft: 'Rascunho',
  running: 'Em andamento',
  paused: 'Pausada',
  completed: 'Concluída',
  cancelled: 'Cancelada',
  scheduled: 'Agendada',
  pending: 'Pendente',
  sending: 'Enviando',
  confirming: 'Aguardando confirmação',
  sent: 'Enviada',
  delivered: 'Entregue',
  read: 'Lida',
  skipped: 'Não enviada',
  uncertain: 'Conferir envio',
  failed: 'Não enviada',
  ready: 'Conectado',
  disconnected: 'Desconectado',
  connecting: 'Conectando',
  qr: 'Aguardando QR',
  authenticated: 'Sincronizando',
  error: 'Falha na conexão',
};
export const deliveryStatus = (recipient: { status: string; ack?: number }) =>
  recipient.status === 'sent'
    ? (recipient.ack || 0) >= 3
      ? 'read'
      : (recipient.ack || 0) >= 2
        ? 'delivered'
        : (recipient.ack || 0) >= 1
          ? 'sent'
          : 'confirming'
    : recipient.status;
