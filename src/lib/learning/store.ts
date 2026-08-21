import type { DailyConversation, LearningActor, LearningDb } from "./types.js";
import { isLearningEligibleMessage, redactLearningText } from "./redact.js";

const mapProposal = (row: any) => ({
  id: String(row.id), runId: String(row.run_id), projectKey: String(row.project_key),
  dateKey: row.date_key ? String(row.date_key).slice(0, 10) : null,
  ruleKey: String(row.rule_key), category: String(row.category), priority: String(row.priority),
  channelScope: String(row.channel_scope), title: String(row.title), rationale: String(row.rationale),
  expectedOutcome: String(row.expected_outcome), suggestedChange: String(row.suggested_change),
  evidence: Array.isArray(row.evidence) ? row.evidence : [], confidence: Number(row.confidence ?? 0),
  status: String(row.status), analysisProvider: row.analysis_provider ?? null,
  analysisModel: row.analysis_model ?? null, decidedByEmail: row.decided_by_email ?? null,
  decisionReason: row.decision_reason ?? null, decidedAt: row.decided_at ?? null,
  publishedAt: row.published_at ?? null, rolledBackAt: row.rolled_back_at ?? null,
  createdAt: row.created_at, updatedAt: row.updated_at,
  job: row.job_id ? {
    id: String(row.job_id), status: String(row.job_status), baseSha: row.base_sha ?? null,
    provider: row.job_provider ?? null, model: row.job_model ?? null,
    changedFiles: Array.isArray(row.changed_files) ? row.changed_files : [],
    diffText: String(row.diff_text ?? ""), checks: Array.isArray(row.checks) ? row.checks : [],
    commitSha: row.commit_sha ?? null, error: row.job_error ?? null,
    createdAt: row.job_created_at, updatedAt: row.job_updated_at
  } : null
});

export async function ensureLearningRun(db: LearningDb, projectKey: string, dateKey: string, timezone: string) {
  const result = await db.query(
    `insert into whatsapp_learning_runs (project_key,date_key,period_start,period_end)
     values ($1,$2::date,$2::date::timestamp at time zone $3,(($2::date+1)::timestamp at time zone $3))
     on conflict (project_key,date_key) do update set updated_at=now() returning *`,
    [projectKey, dateKey, timezone]
  );
  return result.rows[0];
}

export async function listDailyConversations(db: LearningDb, run: any): Promise<DailyConversation[]> {
  const result = await db.query(
    `select c.id,c.channel,
       jsonb_agg(jsonb_build_object('id',m.id,'actor',m.actor,'direction',m.direction,'kind',m.kind,
         'content',m.content,'deliveryStatus',m.delivery_status,'metadata',m.metadata,
         'createdAt',m.created_at) order by m.created_at,m.id) messages
     from whatsapp_inbox_conversations c join whatsapp_inbox_messages m on m.conversation_id=c.id
     where c.project_key=$1 and m.created_at >= $2 and m.created_at < $3
     group by c.id,c.channel order by min(m.created_at)`,
    [run.project_key, run.period_start, run.period_end]
  );
  return result.rows.map((row) => ({
    id: String(row.id), channel: row.channel,
    messages: (Array.isArray(row.messages) ? row.messages : [])
      .filter((message: any) => isLearningEligibleMessage(message))
      .map((message: any) => ({
        id: String(message.id), actor: message.actor, direction: message.direction,
        kind: String(message.kind), content: redactLearningText(String(message.content ?? "")),
        deliveryStatus: String(message.deliveryStatus), createdAt: String(message.createdAt)
      }))
  })).filter((row: DailyConversation) => row.messages.some((message) => message.actor === "contact"));
}

export async function startLearningRun(db: LearningDb, runId: string, count: number) {
  await db.query(`update whatsapp_learning_runs set status='running',conversation_count=$2,started_at=coalesce(started_at,now()),error=null,updated_at=now() where id=$1`, [runId, count]);
}

export async function saveConversationReview(db: LearningDb, input: {
  runId: string; conversation: DailyConversation; status: "completed" | "failed";
  provider?: string; model?: string; analysis?: unknown; error?: string;
}) {
  await db.query(
    `insert into whatsapp_learning_conversation_reviews
       (run_id,conversation_id,channel,message_count,status,provider,model,analysis,error)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
     on conflict (run_id,conversation_id) do update set status=excluded.status,provider=excluded.provider,
       model=excluded.model,analysis=excluded.analysis,error=excluded.error,updated_at=now()`,
    [input.runId,input.conversation.id,input.conversation.channel,input.conversation.messages.length,input.status,
      input.provider ?? null,input.model ?? null,JSON.stringify(input.analysis ?? {}),input.error ?? null]
  );
}

export async function replaceRunProposals(db: LearningDb, input: {
  runId: string; projectKey: string; proposals: any[]; provider: string; model: string;
}) {
  await db.query(`delete from whatsapp_learning_proposals where run_id=$1 and status='pending'`, [input.runId]);
  for (const proposal of input.proposals) {
    await db.query(
      `insert into whatsapp_learning_proposals
       (run_id,project_key,rule_key,category,priority,channel_scope,title,rationale,expected_outcome,
        suggested_change,evidence,confidence,analysis_provider,analysis_model)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)
       on conflict (run_id,rule_key) do nothing`,
      [input.runId,input.projectKey,proposal.ruleKey,proposal.category,proposal.priority,proposal.channelScope,
        proposal.title,proposal.rationale,proposal.expectedOutcome,proposal.suggestedChange,
        JSON.stringify(proposal.evidence ?? []),proposal.confidence,input.provider,input.model]
    );
  }
}

export async function finishLearningRun(db: LearningDb, input: {
  runId: string; analyzed: number; failed: number; proposalCount: number; metrics: unknown; error?: string;
}) {
  const status = input.analyzed === 0 && input.failed > 0 ? "failed" : input.failed > 0 ? "partial" : "completed";
  await db.query(
    `update whatsapp_learning_runs set status=$2,analyzed_count=$3,failed_count=$4,proposal_count=$5,
       metrics=$6::jsonb,error=$7,completed_at=now(),updated_at=now() where id=$1`,
    [input.runId,status,input.analyzed,input.failed,input.proposalCount,JSON.stringify(input.metrics),input.error ?? null]
  );
}

export async function purgeExpiredConversationText(db: LearningDb, retentionDays: number) {
  const result = await db.query(`delete from whatsapp_inbox_messages where created_at < now() - ($1::text || ' days')::interval`, [retentionDays]);
  return Number(result.rowCount ?? 0);
}

export async function learningOverview(db: LearningDb, projectKey: string) {
  const [run, counts] = await Promise.all([
    db.query(`select * from whatsapp_learning_runs where project_key=$1 order by date_key desc limit 1`, [projectKey]),
    db.query(`select status,count(*)::int count from whatsapp_learning_proposals where project_key=$1 group by status`, [projectKey])
  ]);
  return { latestRun: run.rows[0] ?? null, counts: Object.fromEntries(counts.rows.map((row) => [row.status, Number(row.count)])) };
}

export async function listLearningProposals(db: LearningDb, projectKey: string, input: { status?: string; limit?: number }) {
  const values: unknown[] = [projectKey]; const where = ["p.project_key=$1"];
  if (input.status) { values.push(input.status); where.push(`p.status=$${values.length}`); }
  values.push(Math.min(200, Math.max(1, input.limit ?? 100)));
  const result = await db.query(
    `select p.*,r.date_key,j.id job_id,j.status job_status,j.base_sha,j.provider job_provider,j.model job_model,
       j.changed_files,j.diff_text,j.checks,j.commit_sha,j.error job_error,j.created_at job_created_at,j.updated_at job_updated_at
     from whatsapp_learning_proposals p join whatsapp_learning_runs r on r.id=p.run_id
     left join lateral (select * from whatsapp_learning_change_jobs where proposal_id=p.id order by created_at desc limit 1) j on true
     where ${where.join(" and ")} order by p.created_at desc limit $${values.length}`,
    values
  );
  return result.rows.map(mapProposal);
}

export async function getLearningProposal(db: LearningDb, projectKey: string, id: string) {
  const result = await db.query(
    `select p.*,r.date_key,j.id job_id,j.status job_status,j.base_sha,j.provider job_provider,j.model job_model,
       j.changed_files,j.diff_text,j.checks,j.commit_sha,j.error job_error,j.created_at job_created_at,j.updated_at job_updated_at
     from whatsapp_learning_proposals p join whatsapp_learning_runs r on r.id=p.run_id
     left join lateral (select * from whatsapp_learning_change_jobs where proposal_id=p.id order by created_at desc limit 1) j on true
     where p.project_key=$1 and p.id=$2 limit 1`, [projectKey,id]
  );
  return result.rows[0] ? mapProposal(result.rows[0]) : null;
}

export async function createChangeJob(db: LearningDb, projectKey: string, proposalId: string, actor: LearningActor) {
  const result = await db.query(
    `with updated as (
       update whatsapp_learning_proposals set status='generating',decided_by_user_id=$3,decided_by_email=$4,
         decided_at=now(),updated_at=now() where id=$2 and project_key=$1 and status in ('pending','failed') returning id
     ) insert into whatsapp_learning_change_jobs (proposal_id,requested_by_user_id,requested_by_email)
       select id,$3,$4 from updated returning *`, [projectKey,proposalId,actor.userId,actor.email]
  );
  if (!result.rows[0]) return null;
  await db.query(`insert into whatsapp_learning_events(proposal_id,job_id,event_type,actor_user_id,actor_email) values($1,$2,'generation_requested',$3,$4)`, [proposalId,result.rows[0].id,actor.userId,actor.email]);
  return result.rows[0];
}

export async function discardLearningProposal(db: LearningDb, projectKey: string, proposalId: string, actor: LearningActor, reason: string) {
  const result = await db.query(
    `update whatsapp_learning_proposals set status='discarded',decided_by_user_id=$3,decided_by_email=$4,
       decision_reason=$5,decided_at=now(),updated_at=now()
     where id=$2 and project_key=$1 and status in ('pending','failed','ready_for_review') returning *`,
    [projectKey,proposalId,actor.userId,actor.email,reason]
  );
  if (result.rows[0]) await db.query(`insert into whatsapp_learning_events(proposal_id,event_type,actor_user_id,actor_email,payload) values($1,'discarded',$2,$3,$4::jsonb)`, [proposalId,actor.userId,actor.email,JSON.stringify({reason})]);
  return result.rows[0] ?? null;
}

export async function requestPublish(db: LearningDb, projectKey: string, proposalId: string, actor: LearningActor) {
  const result = await db.query(
    `update whatsapp_learning_change_jobs j set status='publishing',published_by_user_id=$3,published_by_email=$4,updated_at=now()
     from whatsapp_learning_proposals p where p.id=$2 and p.project_key=$1 and j.proposal_id=p.id and j.status='ready_for_review'
     returning j.*`, [projectKey,proposalId,actor.userId,actor.email]
  );
  if (!result.rows[0]) return null;
  await db.query(`update whatsapp_learning_proposals set status='publishing',updated_at=now() where id=$1`, [proposalId]);
  await db.query(`insert into whatsapp_learning_events(proposal_id,job_id,event_type,actor_user_id,actor_email) values($1,$2,'publish_requested',$3,$4)`, [proposalId,result.rows[0].id,actor.userId,actor.email]);
  return result.rows[0];
}

export async function requestRollback(db: LearningDb, projectKey: string, proposalId: string, actor: LearningActor) {
  const result = await db.query(
    `update whatsapp_learning_change_jobs j set status='rollback_queued',published_by_user_id=$3,
       published_by_email=$4,error=null,updated_at=now()
     from whatsapp_learning_proposals p where p.id=$2 and p.project_key=$1 and j.proposal_id=p.id
       and j.status='published' returning j.*`,
    [projectKey,proposalId,actor.userId,actor.email]
  );
  if (!result.rows[0]) return null;
  await db.query(`insert into whatsapp_learning_events(proposal_id,job_id,event_type,actor_user_id,actor_email) values($1,$2,'rollback_requested',$3,$4)`, [proposalId,result.rows[0].id,actor.userId,actor.email]);
  return result.rows[0];
}
