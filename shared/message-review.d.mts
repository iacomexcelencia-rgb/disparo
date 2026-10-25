export type ReviewIssue = {
  id: string;
  level: 'warning' | 'info';
  title: string;
  explanation: string;
};
export function reviewMessage(
  template: string,
  recipientFields?: ReadonlyArray<Record<string, unknown>>,
  options?: { attachmentCount?: number },
): ReviewIssue[];
