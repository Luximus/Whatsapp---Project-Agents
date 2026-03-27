export type ModelUsage = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
};

export type DailyMetrics = {
  dateKey: string;
  uniqueContacts: Set<string>;
  incomingTotal: number;
  incomingText: number;
  incomingAudio: number;
  otpMessages: number;
  agentReplies: number;
  outboundText: number;
  outboundAudio: number;
  meetingsScheduled: number;
  meetingsNotifiedHuman: number;
  supportTicketsCreated: number;
  openaiFailures: number;
  errors: number;
  openaiByModel: Record<string, ModelUsage>;
};

export type MeetingRecord = {
  projectKey: string;
  userPhone: string;
  contactName: string;
  contactEmail: string;
  company: string;
  meetingDate: string;
  meetingDay: string;
  meetingTime: string | null;
  reason: string;
  notifiedHuman: boolean;
};

export type MeetingQuoteEmailInput = {
  projectKey: string;
  userPhone: string;
  contactName: string;
  contactEmail: string;
  company: string;
  meetingDay: string;
  meetingDate: string;
  meetingTime: string | null;
  reason: string;
  notifiedHuman: boolean;
};

export type SupportTicketEmailInput = {
  projectKey: string;
  userPhone: string;
  contactName: string;
  contactEmail: string;
  company: string;
  topic: string;
  summary: string;
  transcript?: string[];
};

export type ProjectFollowupEmailInput = {
  projectKey: string;
  projectName: string;
  userPhone: string;
  contactName: string;
  contactEmail: string;
  company: string;
  summary: string;
  urgency: string | null;
};

export type OpenAIUsageInput = {
  model: string;
  usage: Record<string, unknown> | null | undefined;
};
