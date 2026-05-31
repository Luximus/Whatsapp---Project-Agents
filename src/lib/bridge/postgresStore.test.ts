import { describe, it, expect, vi } from "vitest";
import { PostgresBridgeStore, type PgLike } from "./postgresStore.js";
import type { BridgeSessionRow, CreateBridgeSessionInput } from "./store.js";

function fakeSessionRow(over: Record<string, any> = {}) {
  const now = new Date();
  return {
    id: "11111111-1111-1111-1111-111111111111",
    project_key: "luxisoft",
    flow: "verification",
    user_ref: null,
    correlation_id: null,
    phone_e164: "+573001112233",
    code: "123456",
    otp_ref: "ABCD1234",
    status: "pending",
    attempts: 0,
    expires_at: now,
    verified_at: null,
    callback_url: "https://cb.test",
    metadata: null,
    created_at: now,
    updated_at: now,
    ...over
  };
}

function makePg(rows: any[] = [], rowCount = rows.length): PgLike & { query: any } {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount }) };
}

const createInput: CreateBridgeSessionInput = {
  id: "11111111-1111-1111-1111-111111111111",
  projectKey: "luxisoft",
  flow: "verification",
  userRef: null,
  correlationId: null,
  phoneE164: "+573001112233",
  code: "123456",
  otpRef: "ABCD1234",
  expiresAt: new Date(),
  callbackUrl: "https://cb.test",
  metadata: { a: 1 }
};

describe("PostgresBridgeStore", () => {
  it("createSession hace INSERT con los parámetros correctos y mapea la fila", async () => {
    const pg = makePg([fakeSessionRow()]);
    const store = new PostgresBridgeStore(pg);
    const session = await store.createSession(createInput);

    expect(session.id).toBe(createInput.id);
    expect(session.status).toBe("pending");
    const [sql, values] = pg.query.mock.calls[0];
    expect(sql).toContain("insert into whatsapp_bridge_sessions");
    expect(values[0]).toBe(createInput.id);
    expect(values[6]).toBe("123456"); // code
    expect(values[10]).toBe(JSON.stringify({ a: 1 })); // metadata serializado
  });

  it("updateSession construye SETs dinámicos solo con campos presentes", async () => {
    const pg = makePg([fakeSessionRow({ status: "verified", attempts: 1 })]);
    const store = new PostgresBridgeStore(pg);
    const updated = await store.updateSession("id-1", { status: "verified", attempts: 1 });

    expect(updated?.status).toBe("verified");
    const [sql, values] = pg.query.mock.calls[0];
    expect(sql).toContain("update whatsapp_bridge_sessions set status = $1, attempts = $2");
    expect(sql).toContain("where id = $3");
    expect(values).toEqual(["verified", 1, "id-1"]);
  });

  it("createEventIfAbsent devuelve false cuando ON CONFLICT no inserta", async () => {
    const pg = makePg([], 0);
    const store = new PostgresBridgeStore(pg);
    const inserted = await store.createEventIfAbsent({
      session: { id: "s", project_key: "luxisoft", callback_url: "https://cb" } as BridgeSessionRow,
      eventType: "bridge.session.verified",
      payload: {}
    });
    expect(inserted).toBe(false);
    expect(pg.query.mock.calls[0][0]).toContain("on conflict (session_id, event_type) do nothing");
  });

  it("claimDueEvents filtra por proyecto cuando se pasa", async () => {
    const pg = makePg([]);
    const store = new PostgresBridgeStore(pg);
    const now = new Date();
    await store.claimDueEvents({ projectKey: "luxisoft", limit: 5, now });
    const [sql, values] = pg.query.mock.calls[0];
    expect(sql).toContain("project_key = $2");
    expect(sql).toContain("limit $3");
    expect(values).toEqual([now, "luxisoft", 5]);
  });

  it("updateEvent ignora processing_started_at (no existe en el schema)", async () => {
    const pg = makePg([]);
    const store = new PostgresBridgeStore(pg);
    const res = await store.updateEvent(7, { processing_started_at: new Date() });
    // sin columnas válidas -> no ejecuta UPDATE y devuelve null
    expect(res).toBeNull();
    expect(pg.query).not.toHaveBeenCalled();
  });
});
