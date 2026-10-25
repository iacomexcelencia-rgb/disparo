export function recipientStats(recipients) {
  const stats = {
    total: recipients.length,
    pending: 0,
    sending: 0,
    confirming: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    uncertain: 0,
    responded: 0,
    noReply: 0,
    responseEligible: 0,
    responseRate: 0,
    replies: 0,
    messagesConfirmed: 0,
    processed: 0,
  };
  for (const recipient of recipients) {
    if (['pending', 'sending', 'confirming', 'uncertain'].includes(recipient.status))
      stats[recipient.status]++;
    if (['skipped', 'failed'].includes(recipient.status)) stats.failed++;
    if (recipient.status === 'sent' && recipient.ack >= 1) {
      stats.sent++;
      if (recipient.ack >= 2) stats.delivered++;
      if (recipient.ack >= 3) stats.read++;
    }
    if (!['pending', 'sending'].includes(recipient.status)) stats.processed++;
    stats.messagesConfirmed += Object.values(recipient.messageAcks || {}).filter(
      (ack) => ack >= 1,
    ).length;
    if (recipient.reply?.firstAt) {
      stats.responded++;
      stats.replies += recipient.reply.count;
    }
    if (
      recipient.type === 'contact' &&
      ((recipient.status === 'sent' && recipient.ack >= 1) || recipient.reply?.firstAt)
    ) {
      stats.responseEligible++;
      if (!recipient.reply?.firstAt) stats.noReply++;
    }
  }
  stats.responseRate = stats.responseEligible
    ? Math.round((stats.responded / stats.responseEligible) * 1000) / 10
    : 0;
  return stats;
}

export function campaignSummary(campaign) {
  const { recipients, ...fields } = campaign;
  const counts = {};
  for (const recipient of recipients)
    counts[recipient.status] = (counts[recipient.status] || 0) + 1;
  return { ...fields, stats: recipientStats(recipients), counts, total: recipients.length };
}
