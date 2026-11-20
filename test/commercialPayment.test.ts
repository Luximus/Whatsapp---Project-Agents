import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { commercialPaymentsRoutes } from "../src/routes/commercialPayments.js";
const f = vi.hoisted(() => ({ text: vi.fn(), template: vi.fn(), inbox: vi.fn(), record: vi.fn() }));
vi.mock("../src/lib/whatsapp.js", () => ({
  sendWhatsappText: f.text,
  sendWhatsappTemplate: f.template
}));
vi.mock("../src/lib/inbox.js", () => ({
  ensureInboxConversation: f.inbox,
  recordInboxOutbound: f.record
}));
vi.mock("../src/lib/bridge.js", () => ({
  requireBridgeProjectAuth: () => ({ projectKey: "luxisoft" })
}));
it.each(["open", "closed", "pending", "duplicate", "ambiguous"])(
  "internal paid notice %s",
  async (mode) => {
    vi.clearAllMocks();
    f.inbox.mockResolvedValue({ id: "conv", lastInboundAt: mode === "open" ? new Date() : null });
    if (mode === "pending")
      f.template.mockRejectedValueOnce({ details: { error: { code: 132001 } } });
    if (mode === "ambiguous") f.template.mockRejectedValueOnce(Error("connection lost"));
    const app = Fastify();
    app.decorate("pg", {
      query: async (sql: string) =>
        sql.includes("INSERT")
          ? { rowCount: mode === "duplicate" ? 0 : 1 }
          : { rows: [{ status: "sent" }] }
    });
    await app.register(commercialPaymentsRoutes);
    const res = await app.inject({
      method: "POST",
      url: "/api/bridge/billing/commercial",
      payload: {
        marker: "payment:commercial:test",
        customer: "Prueba",
        product: "Recarga",
        price: "$100 COP",
        reference: "QA-1",
        origin: "WhatsApp (prueba)",
        orderUrl:
          "https://luxisoft.com/api/v1/platform/inbox/payment/00000000-0000-4000-8000-000000000001"
      }
    });
    expect(res.json().data.status).toBe(
      mode === "pending" ? "awaiting_template" : mode === "ambiguous" ? "needs_review" : "sent"
    );
    expect(f.text).toHaveBeenCalledTimes(mode === "open" ? 1 : 0);
    expect(f.template).toHaveBeenCalledTimes(
      ["closed", "pending", "ambiguous"].includes(mode) ? 1 : 0
    );
    if (mode === "closed")
      expect(f.template.mock.calls[0][0]).toMatchObject({
        toE164: "+573019289464",
        name: "luxisoft_aviso_pago_comercial"
      });
    await app.close();
  }
);
