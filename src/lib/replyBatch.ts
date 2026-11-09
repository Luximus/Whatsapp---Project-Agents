/** Read-only batching over the durable inbox and accepted webhook jobs. */
type Db = { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
export function replyBatch(db: Db, project: string, conversationId: string, contact: string, externalId: string | null) {
  let ownHandoff = false;
  const newer = async () => {
    const r = await db.query(`select (
      exists(select 1 from whatsapp_inbox_conversations where id=$1 and project_key=$2 and (status='human_active' or (status='waiting_human' and not $5::boolean)))
      or exists(select 1 from whatsapp_inbox_messages n join whatsapp_inbox_messages c on c.conversation_id=n.conversation_id
        where c.conversation_id=$1 and c.external_message_id=$3 and n.direction='inbound'
        and (n.created_at,n.id)>(c.created_at,c.id))
      or exists(select 1 from whatsapp_webhook_jobs j
        cross join lateral (select j.payload#>'{entry,0,changes,0,value,messages,0}' as msg) p
        where j.project_key=$2 and j.channel='whatsapp' and j.state='pending'
        and regexp_replace(p.msg->>'from','[^0-9]','','g')=regexp_replace($4,'[^0-9]','','g')
        and p.msg->>'type' in ('text','audio','interactive')
        and coalesce(p.msg#>>'{text,body}','') !~ '^\\s*[0-9]{6}\\s*$'
        and coalesce(p.msg#>>'{text,body}','') !~* '^SOLICITAR CODIGO LUXISOFT REF '
      )) as newer`, [conversationId,project,externalId,contact,ownHandoff]);
    return r.rows[0]?.newer === true;
  };
  return {
    newer,
    confirmOwnHandoff() { ownHandoff = true; },
    async ready() {
      if (await newer()) return false;
      await new Promise(resolve => setTimeout(resolve,3000));
      return !await newer();
    },
    async text(fallback: string) {
      const result = await db.query(`select content from (
        select m.content,m.created_at,m.id from whatsapp_inbox_messages m
        join whatsapp_inbox_conversations c on c.id=m.conversation_id
        where c.id=$1 and c.project_key=$2 and c.channel='whatsapp' and c.contact_key=$3
        and m.direction='inbound' and m.actor='contact'
        and not exists(select 1 from whatsapp_inbox_messages o where o.conversation_id=c.id
          and o.direction='outbound' and o.delivery_status in ('sent','delivered','read')
          and (o.created_at,o.id)>=(m.created_at,m.id))
        order by m.created_at desc,m.id desc limit 50
      ) recent order by created_at,id`,[conversationId,project,contact]);
      return result.rows.map(r=>String(r.content??'')).filter(Boolean).join('\n').slice(-24000) || fallback;
    }
  };
}
