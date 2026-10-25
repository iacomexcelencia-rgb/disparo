// Positive acknowledgements are evidence; delayed pending/error events cannot erase them.
export function mergeAck(previous = 0, incoming = 0) {
  if (!Number.isInteger(incoming) || incoming < -1 || incoming > 4) return previous;
  if (previous >= 1 || incoming >= 1) return Math.max(previous, incoming);
  return previous === -1 || incoming === -1 ? -1 : 0;
}

export function recordMessage(recipient, messageId, ack = 0) {
  if (!messageId) return;
  recipient.messageIds ||= [];
  if (!recipient.messageIds.includes(messageId)) recipient.messageIds.push(messageId);
  recipient.messageAcks ||= {};
  recipient.messageAcks[messageId] = mergeAck(recipient.messageAcks[messageId], ack);
  recipient.ack = Math.min(...recipient.messageIds.map((key) => recipient.messageAcks[key] || 0));
}

export function refreshDelivery(recipient, now = Date.now()) {
  if (['pending', 'sending', 'skipped'].includes(recipient.status)) return;
  const ids = recipient.messageIds || [];
  const expected = recipient.expectedMessages || recipient.messageCost || ids.length;
  const acks = ids.map((key) => recipient.messageAcks?.[key] || 0);
  const complete = ids.length >= expected && expected > 0;
  if (complete && acks.every((ack) => ack >= 1)) {
    recipient.status = 'sent';
    recipient.sentAt ||= new Date(now).toISOString();
    if (recipient.error) recipient.lastError = recipient.error;
    recipient.error = null;
  } else if (acks.some((ack) => ack < 0)) {
    recipient.status = acks.some((ack) => ack >= 1) ? 'uncertain' : 'failed';
    recipient.error =
      recipient.status === 'uncertain'
        ? 'Entrega parcial: o WhatsApp confirmou parte das mensagens e informou falha em outra. Confira antes de reenviar.'
        : 'O WhatsApp informou falha no envio. Nenhum reenvio automático foi realizado.';
  } else if (complete) {
    recipient.status = 'confirming';
  } else {
    recipient.status = 'uncertain';
  }
}
