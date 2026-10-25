import { useEffect, useRef, type ReactNode } from 'react';
import { X, ArrowUpRight, Inbox, LoaderCircle } from 'lucide-react';
import { statusLabel } from './api';

export function Badge({ status, children }: { status?: string; children?: ReactNode }) {
  return (
    <span className={`badge ${status || ''}`}>
      <span className="status-dot" />
      {children || statusLabel[status || ''] || status}
    </span>
  );
}
export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon || <Inbox size={25} />}</div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function SectionTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    const cancel = (event: Event) => {
      event.preventDefault();
      closeRef.current();
    };
    dialog.addEventListener('cancel', cancel);
    return () => {
      dialog.removeEventListener('cancel', cancel);
      dialog.close();
    };
  }, []);
  return (
    <dialog ref={dialogRef} className={`modal ${wide ? 'wide' : ''}`} aria-labelledby="modal-title">
      <div className="modal-head">
        <div>
          <h2 id="modal-title">{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Fechar janela">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Busy({ children }: { children?: ReactNode }) {
  return (
    <span className="inline">
      <LoaderCircle className="spin" size={16} />
      {children || 'Aguarde…'}
    </span>
  );
}
export function Stat({
  title,
  value,
  detail,
  icon,
}: {
  title: string;
  value: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <div className="stat card">
      <div className="stat-top">
        <span>{title}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <strong>{value}</strong>
      <div className="stat-bottom">
        <span>{detail}</span>
        <ArrowUpRight size={15} />
      </div>
    </div>
  );
}
