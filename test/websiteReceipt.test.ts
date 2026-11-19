import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { websiteSalesRoutes } from "../src/routes/websiteSales.js";
const f = vi.hoisted(() => ({ text: vi.fn(), template: vi.fn(), record: vi.fn() }));
vi.mock("../src/lib/whatsapp.js", () => ({
  sendWhatsappText: f.text,
  sendWhatsappTemplate: f.template
}));
vi.mock("../src/lib/inbox.js", () => ({ recordInboxOutbound: f.record }));
vi.mock("../src/lib/bridge.js", () => ({
  requireBridgeProjectAuth: () => ({ projectKey: "luxisoft" })
}));
it.each(["open", "closed", "declined", "optout"])("confirmed receipt %s", async (mode) => {
  vi.clearAllMocks();
  const app = Fastify(),
    phone = "+12025550146",
    text = "Pago confirmado por $566.370 COP para 7 meses. Referencia Wompi: QA.",
    order = "00000000-0000-4000-8000-000000000001";
  app.decorate("pg", {
    query: async (sql: string) => {
      if (sql.includes("INSERT INTO")) return { rows: [{ marker: "qa" }] };
      if (sql.includes("SELECT *"))
        return {
          rows: [
            { id: order, last_inbound_at: new Date(Date.now() - (mode === "open" ? 1000 : 9e7)) }
          ]
        };
      if (sql.includes("SELECT content"))
        return { rows: [{ content: mode === "optout" ? "STOP" : "hola" }] };
      return { rows: [] };
    }
  });
  await app.register(websiteSalesRoutes);
  if (mode === "declined")
    f.template.mockRejectedValueOnce(
      Object.assign(new Error(), { details: { error: { code: 132001 } } })
    );
  const res = await app.inject({
    method: "POST",
    url: "/api/bridge/website-sales/notice",
    payload: { marker: "qa", phone, text, receipt: { order, name: "Prueba" } }
  });
  expect(res.statusCode).toBe(200);
  expect(res.json().data.status).toBe(
    mode === "declined" ? "awaiting_template" : mode === "optout" ? "opted_out" : "sent"
  );
  expect(f.text).toHaveBeenCalledTimes(mode === "open" ? 1 : 0);
  if (mode === "closed")
    expect(f.template.mock.calls[0][0]).toMatchObject({
      name: "luxisoft_recibo_pago_web",
      components: [{ type: "body", parameters: [{ text: "Prueba" }, { text }] }]
    });
  if (mode === "optout") expect(f.template).not.toHaveBeenCalled();
  await app.close();
});
