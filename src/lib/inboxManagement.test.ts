import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import {
  eraseInboxConversation,
  inboxListSchema,
  inboxTagsSchema,
  listInboxTags,
  listManagedInbox,
  setInboxTags
} from "./inboxManagement.js";

const presence = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("./whatsapp.js", () => ({ sendWhatsappTypingIndicator: presence.send }));
import { sendInboxTyping } from "./inboxTyping.js";

const bin = "/usr/lib/postgresql/17/bin";
describe.skipIf(!existsSync(`${bin}/initdb`))("inbox management on isolated PostgreSQL", () => {
  let root: string,
    pool: pg.Pool,
    host: FastifyInstance,
    started = false;
  const timestamp = "2026-10-19T00:00:00.000Z";
  const actor = { userId: "operator", email: "operator@example.test", lastMessageAt: timestamp };
  let own: string, otherProject: string, otherChannel: string;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "whatsapp-inbox-test-"));
    execFileSync(
      `${bin}/initdb`,
      ["-D", join(root, "pg"), "--auth=trust", "--no-locale", "--encoding=UTF8"],
      { stdio: "ignore" }
    );
    execFileSync(
      `${bin}/pg_ctl`,
      [
        "-D",
        join(root, "pg"),
        "-l",
        join(root, "pg.log"),
        "-o",
        `-h '' -k ${root} -p 55431`,
        "-w",
        "start"
      ],
      { stdio: "ignore" }
    );
    started = true;
    pool = new pg.Pool({
      host: root,
      port: 55431,
      user: userInfo().username,
      database: "postgres",
      max: 3
    });
    host = { pg: pool } as unknown as FastifyInstance;
    const schema = readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8");
    await pool.query(
      schema.slice(
        schema.indexOf("create table if not exists whatsapp_agent_messages"),
        schema.indexOf("-- Aprendizaje supervisado")
      )
    );
  }, 30000);
  afterAll(async () => {
    await pool?.end();
    if (started)
      execFileSync(`${bin}/pg_ctl`, ["-D", join(root, "pg"), "-m", "fast", "-w", "stop"], {
        stdio: "ignore"
      });
    if (root) rmSync(root, { recursive: true, force: true });
  });
  beforeEach(async () => {
    await pool.query(
      "truncate whatsapp_inbox_conversations,whatsapp_inbox_messages,whatsapp_inbox_events,whatsapp_agent_messages cascade"
    );
    [own, otherProject, otherChannel] = [randomUUID(), randomUUID(), randomUUID()];
    for (const [id, project, channel] of [
      [own, "one", "whatsapp"],
      [otherProject, "two", "whatsapp"],
      [otherChannel, "one", "messenger"]
    ]) {
      await pool.query(
        `insert into whatsapp_inbox_conversations (id,project_key,channel,contact_key,last_message_at,handoff_summary,metadata)
        values ($1,$2,$3,'123',$4,'old summary','{"tags":["Ventas"],"commercialSignal":{"reason":"old"},"welcomeMenu":{}}')`,
        [id, project, channel, timestamp]
      );
      await pool.query(
        "insert into whatsapp_inbox_messages(conversation_id,direction,actor,content) values ($1,'inbound','contact','private history')",
        [id]
      );
      await pool.query(
        "insert into whatsapp_inbox_events(conversation_id,event_type,payload) values ($1,'handoff','{\"summary\":\"old\"}')",
        [id]
      );
      await pool.query(
        "insert into whatsapp_agent_messages(project_key,phone_e164,role,content,expires_at) values ($1,$2,'user','old memory',now()+interval '1 hour')",
        [project, channel === "whatsapp" ? "123" : "messenger:123"]
      );
    }
  });
  it("sends typing only for the current owner and throttles concurrent tabs", async () => {
    presence.send.mockReset().mockResolvedValue({ success: true });
    await pool.query("update whatsapp_inbox_conversations set status='human_active', assigned_user_id='agent-A' where id=$1", [own]);
    await pool.query("update whatsapp_inbox_messages set external_message_id='wamid.own' where conversation_id=$1", [own]);
    const results = await Promise.all([sendInboxTyping(host, 'one', own, 'agent-A'), sendInboxTyping(host, 'one', own, 'agent-A')]);
    expect(results.filter(result => result.sent)).toHaveLength(1);
    expect(presence.send).toHaveBeenCalledExactlyOnceWith('wamid.own');
    expect(results).toContainEqual({ sent: false, reason: 'throttled' });
    const metadata=(await pool.query('select metadata from whatsapp_inbox_conversations where id=$1', [own])).rows[0].metadata;
    expect(metadata.tags).toEqual(['Ventas']);
    expect(metadata.humanTypingAt).toBeTruthy();
    await expect(sendInboxTyping(host, 'one', own, 'agent-B')).rejects.toMatchObject({statusCode:409});
    await expect(sendInboxTyping(host, 'two', own, 'agent-A')).rejects.toMatchObject({statusCode:404});
    await pool.query("update whatsapp_inbox_conversations set status='ai_active', assigned_user_id=null where id=$1", [own]);
    await expect(sendInboxTyping(host, 'one', own, 'agent-A')).rejects.toMatchObject({statusCode:409});
    expect(presence.send).toHaveBeenCalledTimes(1);
  });
  it("skips unsupported channels and chats without a recent inbound provider ID", async () => {
    presence.send.mockReset();
    await pool.query("update whatsapp_inbox_conversations set status='human_active', assigned_user_id='agent-A' where id=any($1::uuid[])", [[own,otherChannel]]);
    expect(await sendInboxTyping(host,'one',otherChannel,'agent-A')).toEqual({sent:false,reason:'unsupported_channel'});
    expect(await sendInboxTyping(host,'one',own,'agent-A')).toEqual({sent:false,reason:'no_recent_inbound_message'});
    await pool.query("update whatsapp_inbox_messages set external_message_id='wamid.old', created_at=now()-interval '25 hours' where conversation_id=$1",[own]);
    expect(await sendInboxTyping(host,'one',own,'agent-A')).toEqual({sent:false,reason:'no_recent_inbound_message'});
    expect(presence.send).not.toHaveBeenCalled();
  });
  it("rolls back presence on provider failure so the next attempt can succeed",async()=>{
    await pool.query("update whatsapp_inbox_conversations set status='human_active', assigned_user_id='agent-A' where id=$1",[own]);
    await pool.query("update whatsapp_inbox_messages set external_message_id='wamid.retry' where conversation_id=$1",[own]);
    presence.send.mockReset().mockRejectedValueOnce(new Error('provider failed')).mockResolvedValueOnce({success:true});
    await expect(sendInboxTyping(host,'one',own,'agent-A')).rejects.toThrow('provider failed');
    expect(await sendInboxTyping(host,'one',own,'agent-A')).toEqual({sent:true});
    expect(presence.send).toHaveBeenCalledTimes(2);
  });
  it("clears archive and memory in the chosen project/channel while keeping chat and labels", async () => {
    expect(
      await eraseInboxConversation(host, "one", own, { ...actor, mode: "clear" })
    ).toMatchObject({ deletedMessages: 1, mode: "clear" });
    const row = (await pool.query("select * from whatsapp_inbox_conversations where id=$1", [own]))
      .rows[0];
    expect(row.handoff_summary).toBeNull();
    expect(row.metadata).toEqual({ tags: ["Ventas"] });
    expect(
      (
        await pool.query(
          "select conversation_id from whatsapp_inbox_messages order by conversation_id"
        )
      ).rows
        .map((row) => row.conversation_id)
        .sort()
    ).toEqual([otherProject, otherChannel].sort());
    expect(
      (
        await pool.query(
          "select project_key,phone_e164 from whatsapp_agent_messages order by project_key"
        )
      ).rows
    ).toEqual([
      { project_key: "one", phone_e164: "messenger:123" },
      { project_key: "two", phone_e164: "123" }
    ]);
    expect(
      (
        await pool.query(
          "select event_type,payload from whatsapp_inbox_events where conversation_id=$1",
          [own]
        )
      ).rows
    ).toEqual([{ event_type: "history_cleared", payload: {} }]);
  });
  it("deletes a Messenger chat and its archive without deleting a matching WhatsApp identity", async () => {
    await eraseInboxConversation(host, "one", otherChannel, { ...actor, mode: "delete" });
    expect(
      (await pool.query("select id from whatsapp_inbox_conversations where id=$1", [otherChannel]))
        .rowCount
    ).toBe(0);
    expect(
      (
        await pool.query("select * from whatsapp_inbox_messages where conversation_id=$1", [
          otherChannel
        ])
      ).rowCount
    ).toBe(0);
    expect(
      (
        await pool.query(
          "select * from whatsapp_agent_messages where project_key='one' and phone_e164='123'"
        )
      ).rowCount
    ).toBe(1);
  });
  it("rejects another project, missing chats and stale confirmations without deleting anything", async () => {
    for (const [project, id, date, statusCode] of [
      ["two", own, timestamp, 404],
      ["one", randomUUID(), timestamp, 404],
      ["one", own, "2020-01-01T00:00:00Z", 409]
    ] as const) {
      await expect(
        eraseInboxConversation(host, project, id, { ...actor, mode: "delete", lastMessageAt: date })
      ).rejects.toMatchObject({ statusCode });
    }
    expect((await pool.query("select * from whatsapp_inbox_messages")).rowCount).toBe(3);
    expect((await pool.query("select * from whatsapp_agent_messages")).rowCount).toBe(3);
  });
  it("rolls back archive and memory if deleting the conversation fails", async () => {
    await pool.query(
      "create table protected_chat (id uuid references whatsapp_inbox_conversations(id)); insert into protected_chat values ('" +
        own +
        "')"
    );
    try {
      await expect(
        eraseInboxConversation(host, "one", own, { ...actor, mode: "delete" })
      ).rejects.toMatchObject({ code: "23503" });
      expect(
        (await pool.query("select * from whatsapp_inbox_messages where conversation_id=$1", [own]))
          .rowCount
      ).toBe(1);
      expect(
        (
          await pool.query(
            "select * from whatsapp_agent_messages where project_key='one' and phone_e164='123'"
          )
        ).rowCount
      ).toBe(1);
    } finally {
      await pool.query("drop table protected_chat");
    }
  });
  it("filters tags before pagination, combines search/status and isolates tag discovery", async () => {
    await setInboxTags(host, "one", own, ["Especial"]);
    await setInboxTags(host, "two", otherProject, ["Privada"]);
    await pool.query(
      "insert into whatsapp_inbox_conversations(project_key,channel,contact_key) select 'one','whatsapp','recent-'||n from generate_series(1,105) n"
    );
    const rows = await listManagedInbox(
      host,
      "one",
      inboxListSchema.parse({ tag: "Especial", search: "123", status: "ai_active", limit: 1 })
    );
    expect(rows.map((row) => row.id)).toEqual([own]);
    expect(await listInboxTags(host, "one")).toEqual(["Especial", "Ventas"]);
    expect(await listManagedInbox(host, "one", inboxListSchema.parse({ tag: "Privada" }))).toEqual(
      []
    );
    expect(await listManagedInbox(host, "one", inboxListSchema.parse({ search: "%" }))).toEqual([]);
    expect(await setInboxTags(host, "two", own, ["Intruso"])).toBe(false);
  });
  it('filters assignments before limit and hides private labels until release',async()=>{
    await pool.query("update whatsapp_inbox_conversations set assigned_user_id='agent-A',status='human_active',metadata='{\"tags\":[\"private-A\"]}' where id=$1",[own]);
    const b=await listManagedInbox(host,'one',{limit:200,viewerUserId:'agent-B'});
    expect(b.some(row=>row.id===own)).toBe(false);
    expect((await listManagedInbox(host,'one',{limit:200,viewerUserId:'agent-A'})).some(row=>row.id===own)).toBe(true);
    expect(await listInboxTags(host,'one','agent-B')).not.toContain('private-A');
    await pool.query('update whatsapp_inbox_conversations set assigned_user_id=null,status=\'ai_active\' where id=$1',[own]);
    expect((await listManagedInbox(host,'one',{limit:200,viewerUserId:'agent-B'})).some(row=>row.id===own)).toBe(true);
  });
});

describe("inbox input bounds", () => {
  it("normalizes labels and rejects empty/oversized collections", () => {
    expect(inboxTagsSchema.parse([" Ventas ", "Ventas", "Cafe\u0301"])).toEqual(["Ventas", "Café"]);
    expect(inboxTagsSchema.safeParse([""]).success).toBe(false);
    expect(inboxTagsSchema.safeParse(["x".repeat(41)]).success).toBe(false);
    expect(inboxTagsSchema.safeParse(Array(11).fill("a")).success).toBe(false);
    expect(inboxListSchema.safeParse({ limit: 201 }).success).toBe(false);
  });


});
