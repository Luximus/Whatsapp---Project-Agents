import type { Pool } from "pg";
import type { DailyMetrics, MeetingRecord, ModelUsage } from "../../../domain/reporting/types.js";

export type PersistedDailySnapshot = {
  metrics: Omit<DailyMetrics, "uniqueContacts"> & { uniqueContacts: string[] };
  meetings: MeetingRecord[];
};

export async function loadDailyMetricsFromDb(
  pool: Pool,
  dateKey: string,
  projectKey: string
): Promise<PersistedDailySnapshot | null> {
  const { rows } = await pool.query(
    `select * from agent_daily_metrics where date_key = $1 and project_key = $2 limit 1`,
    [dateKey, projectKey]
  );
  if (!rows[0]) return null;

  const row = rows[0] as Record<string, unknown>;
  return {
    metrics: {
      dateKey: row.date_key as string,
      uniqueContacts: (row.unique_contacts as string[]) ?? [],
      incomingTotal: (row.incoming_total as number) ?? 0,
      incomingText: (row.incoming_text as number) ?? 0,
      incomingAudio: (row.incoming_audio as number) ?? 0,
      otpMessages: (row.otp_messages as number) ?? 0,
      agentReplies: (row.agent_replies as number) ?? 0,
      outboundText: (row.outbound_text as number) ?? 0,
      outboundAudio: (row.outbound_audio as number) ?? 0,
      meetingsScheduled: (row.meetings_scheduled as number) ?? 0,
      meetingsNotifiedHuman: (row.meetings_notified_human as number) ?? 0,
      supportTicketsCreated: (row.support_tickets_created as number) ?? 0,
      openaiFailures: (row.openai_failures as number) ?? 0,
      errors: (row.errors as number) ?? 0,
      openaiByModel: (row.openai_by_model as Record<string, ModelUsage>) ?? {}
    },
    meetings: (row.meetings as MeetingRecord[]) ?? []
  };
}

export async function flushDailyMetricsToDb(
  pool: Pool,
  dateKey: string,
  projectKey: string,
  metrics: DailyMetrics,
  meetings: MeetingRecord[]
): Promise<void> {
  await pool.query(
    `insert into agent_daily_metrics (
       date_key, project_key,
       unique_contacts, incoming_total, incoming_text, incoming_audio,
       otp_messages, agent_replies, outbound_text, outbound_audio,
       meetings_scheduled, meetings_notified_human, support_tickets_created,
       openai_failures, errors, openai_by_model, meetings
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     on conflict (date_key, project_key) do update set
       unique_contacts        = excluded.unique_contacts,
       incoming_total         = excluded.incoming_total,
       incoming_text          = excluded.incoming_text,
       incoming_audio         = excluded.incoming_audio,
       otp_messages           = excluded.otp_messages,
       agent_replies          = excluded.agent_replies,
       outbound_text          = excluded.outbound_text,
       outbound_audio         = excluded.outbound_audio,
       meetings_scheduled     = excluded.meetings_scheduled,
       meetings_notified_human= excluded.meetings_notified_human,
       support_tickets_created= excluded.support_tickets_created,
       openai_failures        = excluded.openai_failures,
       errors                 = excluded.errors,
       openai_by_model        = excluded.openai_by_model,
       meetings               = excluded.meetings,
       updated_at             = now()`,
    [
      dateKey,
      projectKey,
      JSON.stringify([...metrics.uniqueContacts]),
      metrics.incomingTotal,
      metrics.incomingText,
      metrics.incomingAudio,
      metrics.otpMessages,
      metrics.agentReplies,
      metrics.outboundText,
      metrics.outboundAudio,
      metrics.meetingsScheduled,
      metrics.meetingsNotifiedHuman,
      metrics.supportTicketsCreated,
      metrics.openaiFailures,
      metrics.errors,
      JSON.stringify(metrics.openaiByModel),
      JSON.stringify(meetings)
    ]
  );
}
