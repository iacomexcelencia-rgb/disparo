import { createHash } from 'node:crypto';
import { mergeAck } from './delivery.mjs';

// Observe the original send, not a second send or a scan of conversation history.
// The fallback requires one unique fresh outgoing message for the exact recipient
// and text/media hash. Ambiguous candidates stay unconfirmed.
export async function sendTrackedMessage(
  client,
  chatId,
  content,
  { aliases = [chatId], usedIds = [], onMessage, eventWaitMs = 2000, now = Date.now } = {},
) {
  const started = Math.floor(now() / 1000);
  const destinations = new Set(aliases);
  const used = new Set(usedIds);
  const mediaHash =
    typeof content === 'string'
      ? null
      : createHash('sha256').update(Buffer.from(content.data, 'base64')).digest('base64');
  const candidates = new Map();
  let wake;
  let timer;
  const observe = (message, incomingAck = message?.ack) => {
    const messageId = message?.id?._serialized;
    if (
      !messageId ||
      used.has(messageId) ||
      !message.fromMe ||
      !Number.isFinite(message.timestamp) ||
      message.timestamp < started
    )
      return;
    if (!destinations.has(message.to) && !destinations.has(message.id.remote)) return;
    if (
      mediaHash
        ? message.rawData?.filehash !== mediaHash
        : message.type !== 'chat' || message.body !== content
    )
      return;
    const previous = candidates.get(messageId);
    candidates.set(messageId, { messageId, ack: mergeAck(previous?.ack, incomingAck) });
    wake?.();
  };
  client.on('message_create', observe);
  client.on('message_ack', observe);
  try {
    let returned;
    let sendError;
    try {
      returned = await client.sendMessage(chatId, content, {
        sendSeen: false,
        waitUntilMsgSent: true,
      });
    } catch (error) {
      sendError = error;
    }
    const returnedId = returned?.id?._serialized;
    if (returnedId && !used.has(returnedId)) {
      const record = {
        messageId: returnedId,
        ack: mergeAck(candidates.get(returnedId)?.ack, returned.ack),
      };
      onMessage?.(record);
      return record;
    }
    if (!candidates.size && eventWaitMs > 0)
      await new Promise((resolve) => {
        wake = resolve;
        timer = setTimeout(resolve, eventWaitMs);
      });
    if (candidates.size === 1) {
      const record = [...candidates.values()][0];
      onMessage?.(record);
      return record;
    }
    throw new Error(
      candidates.size > 1
        ? 'Mais de uma mensagem compatível foi observada; não foi possível identificar este envio com segurança.'
        : sendError?.message ||
            'O WhatsApp não retornou o identificador nem um evento correspondente ao envio.',
    );
  } finally {
    clearTimeout(timer);
    client.off('message_create', observe);
    client.off('message_ack', observe);
  }
}
