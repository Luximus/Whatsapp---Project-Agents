/** The inbox remains the authority for Messenger human ownership during model work. */
type Reader = { query(sql: string, values: unknown[]): Promise<{ rows: Array<{ paused: boolean }> }> };
let reader: Reader | null = null;
export function configureInboxOwnershipReader(value: Reader | null) { reader = value; }
export function messengerOwnershipGuard(projectKey: string, context?: { channel?: string | null; from?: string | null }) {
  const recipient = context?.channel === "messenger" && context.from?.startsWith("messenger:") ? context.from.slice(10) : null;
  const startedAt = new Date();
  return async () => {
    if (!recipient || !reader) return false;
    const result = await reader.query(`select not exists (
      select 1 from whatsapp_inbox_conversations c
      where c.project_key=$1 and c.channel='messenger' and c.contact_key=$2
    ) or exists (
      select 1 from whatsapp_inbox_conversations c
      where c.project_key=$1 and c.channel='messenger' and c.contact_key=$2
      and (c.status='human_active' or exists (
        select 1 from whatsapp_inbox_events e where e.conversation_id=c.id
        and e.event_type='conversation_claimed' and e.created_at >= $3::timestamptz
      ))
    ) as paused`, [projectKey, recipient, startedAt]);
    return result.rows[0]?.paused !== false;
  };
}
