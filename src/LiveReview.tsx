import { useDeferredValue, useMemo } from 'react';
import { AlertCircle, CheckCircle2, MessageSquare } from 'lucide-react';
import { reviewMessage } from '../shared/message-review.mjs';

export function LiveReview({
  template,
  recipientFields,
  attachmentCount,
}: {
  template: string;
  recipientFields: Record<string, string>[];
  attachmentCount: number;
}) {
  const input = useMemo(
    () => ({ template, recipientFields, attachmentCount }),
    [template, recipientFields, attachmentCount],
  );
  const deferred = useDeferredValue(input);
  const issues = useMemo(
    () =>
      reviewMessage(deferred.template, deferred.recipientFields, {
        attachmentCount: deferred.attachmentCount,
      }),
    [deferred],
  );
  return (
    <section
      className="live-review"
      aria-label="Revisão da mensagem"
      aria-busy={input !== deferred}
    >
      <div className="live-review-heading">
        <strong>Revisão enquanto você escreve</strong>
        <span>
          {input !== deferred
            ? 'Atualizando…'
            : `${issues.length} ${issues.length === 1 ? 'observação' : 'observações'}`}
        </span>
      </div>
      <p className="live-review-scope">
        Campos, sintaxe de links e sugestões de clareza. A revisão é local, não abre os links e não
        prevê banimento.
      </p>
      <div aria-live="polite" aria-atomic="true">
        {issues.length ? (
          <ul className="live-review-list">
            {issues.map((issue) => (
              <li key={issue.id} className={`review-issue ${issue.level}`}>
                {issue.level === 'warning' ? (
                  <AlertCircle size={16} />
                ) : (
                  <MessageSquare size={16} />
                )}
                <div>
                  <strong>{issue.title}</strong>
                  <p>{issue.explanation}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="review-clear">
            <CheckCircle2 size={16} />
            Nenhum problema encontrado nas verificações locais.
          </p>
        )}
      </div>
      <p className="live-review-footnote">
        As observações orientam sua revisão e não bloqueiam o envio. Um link com sintaxe válida
        ainda pode estar fora do ar.
      </p>
    </section>
  );
}
