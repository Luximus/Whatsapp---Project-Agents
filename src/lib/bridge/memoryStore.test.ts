import { describe, it, expect } from "vitest";
import { MemoryBridgeStore } from "./memoryStore.js";
import type { CreateBridgeSessionInput } from "./store.js";

function sessionInput(over: Partial<CreateBridgeSessionInput> = {}): CreateBridgeSessionInput {
  return {
    id: over.id ?? "s1",
    projectKey: over.projectKey ?? "luxisoft",
    flow: over.flow ?? "verification",
    userRef: over.userRef ?? null,
    correlationId: over.correlationId ?? null,
    phoneE164: over.phoneE164 ?? "+573001112233",
    code: over.code ?? "123456",
    otpRef: over.otpRef ?? "ABCD1234",
    expiresAt: over.expiresAt ?? new Date(Date.now() + 60_000),
    callbackUrl: over.callbackUrl ?? "https://cb.test/hook",
    metadata: over.metadata ?? null
  };
}

describe("MemoryBridgeStore", () => {
  it("crea y recupera sesiones", async () => {
    const store = new MemoryBridgeStore();
    const created = await store.createSession(sessionInput());
    expect(created.status).toBe("pending");
    expect(created.attempts).toBe(0);
    const got = await store.getSessionById("s1");
    expect(got?.code).toBe("123456");
  });

  it("actualiza estado y attempts", async () => {
    const store = new MemoryBridgeStore();
    await store.createSession(sessionInput());
    const updated = await store.updateSession("s1", { status: "verified", attempts: 2 });
    expect(updated?.status).toBe("verified");
    expect(updated?.attempts).toBe(2);
  });

  it("lista pendientes por teléfono, más recientes primero", async () => {
    const store = new MemoryBridgeStore();
    await store.createSession(sessionInput({ id: "a", otpRef: "AAAA1111" }));
    await new Promise((r) => setTimeout(r, 2));
    await store.createSession(sessionInput({ id: "b", otpRef: "BBBB2222" }));
    await store.updateSession("a", { status: "verified", verified_at: new Date() });
    const pending = await store.listPendingSessionsByPhone("+573001112233");
    expect(pending.map((s) => s.id)).toEqual(["b"]);
  });

  it("encola eventos idempotentes por (session, type)", async () => {
    const store = new MemoryBridgeStore();
    const session = await store.createSession(sessionInput());
    const first = await store.createEventIfAbsent({
      session,
      eventType: "bridge.session.verified",
      payload: { a: 1 }
    });
    const dup = await store.createEventIfAbsent({
      session,
      eventType: "bridge.session.verified",
      payload: { a: 2 }
    });
    expect(first).toBe(true);
    expect(dup).toBe(false);
  });

  it("reclama solo eventos pending vencidos", async () => {
    const store = new MemoryBridgeStore();
    const session = await store.createSession(sessionInput());
    await store.createEventIfAbsent({ session, eventType: "e1", payload: {} });
    const due = await store.claimDueEvents({ limit: 10, now: new Date(Date.now() + 1000) });
    expect(due).toHaveLength(1);
    await store.updateEvent(due[0].id, { delivery_status: "delivered" });
    const after = await store.claimDueEvents({ limit: 10, now: new Date(Date.now() + 1000) });
    expect(after).toHaveLength(0);
  });
});
