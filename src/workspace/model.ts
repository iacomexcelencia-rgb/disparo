import type { DispatchStats, WorkspaceBoard, WorkspaceView } from '../types';
import { statusLabel } from '../api';

export type Card = {
  id: string;
  name: string;
  status: string;
  stats: DispatchStats;
  scheduledAt?: string | null;
  accountId?: string;
  contactCount?: number;
  campaigns?: { id: string; status: string }[];
  statusCounts?: Record<string, number>;
};
export const rate = (value: number) =>
  `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)}%`;
export const shortStatus = (status: string) =>
  status === 'draft' ? 'Rascunho' : statusLabel[status] || status;
export const cardColumn = (board: WorkspaceBoard, view: WorkspaceView, card: Card) => {
  const manual = board.placements[view][card.id];
  return (
    (manual?.status === card.status
      ? board.columns.find((column) => column.id === manual.columnId)
      : undefined) ||
    board.columns.find((column) => column.statuses.includes(card.status)) ||
    board.columns[0]
  );
};
