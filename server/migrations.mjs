// Compatibility with installations created before the dispatch-only workspace.
// Archived content is never loaded as an active feature or returned by the API.
export function archiveRemovedModules(data) {
  const keys = [
    'ai',
    'offers',
    'calendar',
    'appointments',
    'conversations',
    'funnels',
    'opportunities',
  ];
  for (const key of keys) {
    if (data[key] === undefined) continue;
    data.legacyModules ||= {};
    data.legacyModules[key] = data[key];
    delete data[key];
  }
  for (const campaign of data.campaigns) {
    if (!campaign.attendance) continue;
    data.legacyModules ||= {};
    data.legacyModules.campaignAttendance ||= {};
    data.legacyModules.campaignAttendance[campaign.id] = campaign.attendance;
    delete campaign.attendance;
  }
}

export function historicalMessageUsage(data, accountId) {
  const usage = [];
  for (const conversation of data.legacyModules?.conversations || []) {
    if (conversation.accountId !== accountId) continue;
    for (const message of conversation.messages) {
      if (message.attemptedAt && message.status !== 'skipped') {
        usage.push({ at: Date.parse(message.attemptedAt), cost: 1 });
      }
    }
  }
  return usage;
}
