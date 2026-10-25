// A response is an observed incoming WhatsApp message, never a prediction.
export class ReplyTracker {
  constructor(store, { now = Date.now } = {}) {
    this.store = store;
    this.now = now;
    this.seen = new Set(
      (store.data.replyEvents || []).map((event) => `${event.accountId}:${event.messageId}`),
    );
  }
  receive(accountId, message) {
    if (
      !message.id ||
      message.fromMe ||
      message.isStatus ||
      message.broadcast ||
      !/@(c\.us|lid)$/.test(message.chatId || '')
    )
      return null;
    const key = `${accountId}:${message.id}`;
    if (this.seen.has(key)) return null;
    const at = Number(message.timestamp) * 1000;
    // Reject malformed/future timestamps instead of attributing an old event to a new send.
    if (!Number.isFinite(at) || at <= 0 || at > this.now() + 300000) return null;
    const phone = (message.phone || '').replace(/\D/g, '');
    const candidates = [];
    for (const campaign of this.store.data.campaigns) {
      if (campaign.accountId !== accountId || !campaign.approvedAt) continue;
      for (const recipient of campaign.recipients) {
        if (
          recipient.type !== 'contact' ||
          ['pending', 'skipped', 'failed'].includes(recipient.status)
        )
          continue;
        if (recipient.address.replace(/\D/g, '') !== phone) continue;
        const sentAt = Date.parse(recipient.attemptedAt || recipient.sentAt || '');
        // WhatsApp timestamps have one-second precision; a quick response can
        // share the send's second even when our local attempt includes millis.
        if (!Number.isFinite(sentAt) || Math.floor(sentAt / 1000) > Math.floor(at / 1000)) continue;
        candidates.push({ campaign, recipient, sentAt });
      }
    }
    const quoted = message.quotedMessageId || message.quotedStanzaId;
    const matchesQuote = (candidate) =>
      (candidate.recipient.messageIds || []).some(
        (id) => id === quoted || id.split('_')[2] === quoted,
      );
    // A quoted reply must not be attributed to an unrelated newer campaign.
    const pool = quoted ? candidates.filter(matchesQuote) : candidates;
    pool.sort(
      (a, b) => b.sentAt - a.sentAt || b.campaign.createdAt.localeCompare(a.campaign.createdAt),
    );
    if (!pool.length) return null;
    if (
      pool.length > 1 &&
      pool[0].sentAt === pool[1].sentAt &&
      pool[0].campaign.createdAt === pool[1].campaign.createdAt
    )
      return null;
    const { campaign, recipient } = pool[0];
    const event = {
      accountId,
      messageId: message.id,
      campaignId: campaign.id,
      recipientId: recipient.id,
      contactId: recipient.contactId || null,
      receivedAt: new Date(at).toISOString(),
      recordedAt: new Date(this.now()).toISOString(),
      body: String(message.body || '').slice(0, 10000),
      type: message.type || 'chat',
      hasMedia: Boolean(message.media),
      attribution: quoted ? 'quoted' : 'latest-campaign',
    };
    this.store.data.replyEvents.push(event);
    this.seen.add(key);
    const reply = (recipient.reply ||= {
      firstAt: event.receivedAt,
      lastAt: event.receivedAt,
      count: 0,
    });
    reply.firstAt = reply.firstAt < event.receivedAt ? reply.firstAt : event.receivedAt;
    reply.lastAt = reply.lastAt > event.receivedAt ? reply.lastAt : event.receivedAt;
    reply.count++;
    this.store.save();
    return event;
  }
}
