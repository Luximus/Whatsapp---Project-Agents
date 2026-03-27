import { env } from "../../config/env.js";
import type { DailyMetrics, MeetingRecord, ModelUsage, OpenAIUsageInput } from "./types.js";

const metricsByDate = new Map<string, DailyMetrics>();
const meetingsByDate = new Map<string, MeetingRecord[]>();

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function zonedDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: env.reportTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(date);
  const byType = new Map(parts.map((item) => [item.type, item.value]));
  return {
    year: byType.get("year") ?? "0000",
    month: byType.get("month") ?? "00",
    day: byType.get("day") ?? "00"
  };
}

export function currentDateKey(): string {
  const { year, month, day } = zonedDateParts();
  return `${year}-${month}-${day}`;
}

function ensureDailyMetrics(dateKey = currentDateKey()): DailyMetrics {
  const existing = metricsByDate.get(dateKey);
  if (existing) return existing;

  const created: DailyMetrics = {
    dateKey,
    uniqueContacts: new Set<string>(),
    incomingTotal: 0,
    incomingText: 0,
    incomingAudio: 0,
    otpMessages: 0,
    agentReplies: 0,
    outboundText: 0,
    outboundAudio: 0,
    meetingsScheduled: 0,
    meetingsNotifiedHuman: 0,
    supportTicketsCreated: 0,
    openaiFailures: 0,
    errors: 0,
    openaiByModel: {}
  };
  metricsByDate.set(dateKey, created);
  return created;
}

function ensureModelUsage(metrics: DailyMetrics, model: string): ModelUsage {
  const key = model.trim() || "unknown_model";
  const existing = metrics.openaiByModel[key];
  if (existing) return existing;

  const created: ModelUsage = {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0
  };
  metrics.openaiByModel[key] = created;
  return created;
}

export function getDailySnapshot(dateKey = currentDateKey()) {
  const metrics = metricsByDate.get(dateKey) ?? ensureDailyMetrics(dateKey);
  const meetings = meetingsByDate.get(dateKey) ?? [];
  return { metrics, meetings, dateKey };
}

export function trackInboundMessage(input: {
  fromE164: string | null | undefined;
  messageType: "text" | "audio";
}) {
  const metrics = ensureDailyMetrics();
  const from = String(input.fromE164 ?? "").trim();
  if (from) metrics.uniqueContacts.add(from);
  metrics.incomingTotal += 1;
  if (input.messageType === "audio") metrics.incomingAudio += 1;
  else metrics.incomingText += 1;
}

export function trackOtpMessage() {
  ensureDailyMetrics().otpMessages += 1;
}

export function trackAgentReplyGenerated() {
  ensureDailyMetrics().agentReplies += 1;
}

export function trackOutboundMessage(input: { messageType: "text" | "audio" }) {
  const metrics = ensureDailyMetrics();
  if (input.messageType === "audio") metrics.outboundAudio += 1;
  else metrics.outboundText += 1;
}

export function trackOpenAIUsage(input: OpenAIUsageInput) {
  const metrics = ensureDailyMetrics();
  const modelUsage = ensureModelUsage(metrics, input.model);
  modelUsage.requests += 1;

  const usage = (input.usage ?? {}) as Record<string, unknown>;
  const inputTokens = toNumber(
    (usage as any)?.input_tokens ?? (usage as any)?.prompt_tokens
  );
  const outputTokens = toNumber(
    (usage as any)?.output_tokens ?? (usage as any)?.completion_tokens
  );
  const totalTokens = toNumber(
    (usage as any)?.total_tokens ?? inputTokens + outputTokens
  );
  const cachedInputTokens = toNumber(
    (usage as any)?.input_tokens_details?.cached_tokens ??
      (usage as any)?.prompt_tokens_details?.cached_tokens ??
      (usage as any)?.cache_read_input_tokens
  );
  const cacheWriteTokens = toNumber(
    (usage as any)?.input_tokens_details?.cache_creation_tokens ??
      (usage as any)?.cache_write_input_tokens
  );

  modelUsage.inputTokens += inputTokens;
  modelUsage.outputTokens += outputTokens;
  modelUsage.totalTokens += totalTokens;
  modelUsage.cachedInputTokens += cachedInputTokens;
  modelUsage.cacheWriteTokens += cacheWriteTokens;
}

export function trackOpenAIFailure() {
  ensureDailyMetrics().openaiFailures += 1;
}

export function trackMeetingScheduled(input: MeetingRecord) {
  const metrics = ensureDailyMetrics();
  metrics.meetingsScheduled += 1;
  if (input.notifiedHuman) metrics.meetingsNotifiedHuman += 1;

  const dateKey = currentDateKey();
  const current = meetingsByDate.get(dateKey) ?? [];
  current.push(input);
  meetingsByDate.set(dateKey, current);
}

export function trackSupportTicketCreated() {
  ensureDailyMetrics().supportTicketsCreated += 1;
}

export function trackOperationalError() {
  ensureDailyMetrics().errors += 1;
}
