import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ erase: vi.fn(), labels: vi.fn(), list: vi.fn(), set: vi.fn() }));
vi.mock("../env.js", () => ({
  env: { bridgeProjects: { one: { apiKey: "test-one" }, two: { apiKey: "test-two" } } }
}));
vi.mock("../lib/metaMessaging.js", () => ({ sendMetaRich: vi.fn(), sendMetaText: vi.fn() }));
vi.mock("../lib/whatsapp.js", () => ({
  sendWhatsappRich: vi.fn(),
  sendWhatsappTemplate: vi.fn(),
  sendWhatsappText: vi.fn()
}));
vi.mock("../lib/reporting.js", () => ({ sendSupportTicketEmail: vi.fn() }));
vi.mock("../lib/inboxManagement.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/inboxManagement.js")>()),
  eraseInboxConversation: state.erase,
  listInboxTags: state.labels,
  listManagedInbox: state.list,
  setInboxTags: state.set
}));
import { inboxRoutes } from "./inbox.js";
describe("inbox bridge authentication", () => {
  let app: FastifyInstance;
  const id = "a088e680-e9dc-47cf-96d7-2157bc2c40f6";
  const headers = { "x-project-key": "one", "x-project-api-key": "test-one" };
  const payload = {
    userId: "operator",
    email: "operator@example.test",
    lastMessageAt: "2026-10-19T00:00:00Z"
  };
  beforeEach(async () => {
    vi.clearAllMocks();
    state.erase.mockResolvedValue({ id });
    state.labels.mockResolvedValue(["Ventas"]);
    state.list.mockResolvedValue([]);
    state.set.mockResolvedValue(true);
    app = Fastify();
    app.setErrorHandler((error: any, _request, reply) =>
      reply
        .code(error.name === "ZodError" ? 400 : (error.statusCode ?? 500))
        .send({ ok: false, error: error.message })
    );
    await app.register(inboxRoutes);
  });
  afterEach(async () => {
    await app.close();
  });
  it.each(["clear", "delete"])(
    "authenticates %s and binds project from the API key, not the body",
    async (mode) => {
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/bridge/inbox/conversations/${id}/${mode}`,
            payload
          })
        ).statusCode
      ).toBe(401);
      expect(state.erase).not.toHaveBeenCalled();
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/api/bridge/inbox/conversations/${id}/${mode}`,
            headers,
            payload: { ...payload, projectKey: "two" }
          })
        ).statusCode
      ).toBe(200);
      expect(state.erase).toHaveBeenCalledWith(expect.anything(), "one", id, { ...payload, mode });
    }
  );
  it("rejects mismatched credentials for another project", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/bridge/inbox/conversations/${id}/delete`,
      headers: { ...headers, "x-project-key": "two" },
      payload
    });
    expect(response.statusCode).toBe(401);
    expect(state.erase).not.toHaveBeenCalled();
  });
  it("validates the UUID and snapshot before attempting deletion", async () => {
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/bridge/inbox/conversations/${id}/delete`,
          headers,
          payload: { userId: "operator", email: "operator@example.test" }
        })
      ).statusCode
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/bridge/inbox/conversations/invalid/delete",
          headers,
          payload
        })
      ).statusCode
    ).toBe(400);
    expect(state.erase).not.toHaveBeenCalled();
  });
  it("passes labels, status and search to the project-scoped query", async () => {
    expect(
      (
        await app.inject({
          url: "/api/bridge/inbox/conversations?tag=Ventas&status=closed&search=Ana&limit=20",
          headers
        })
      ).statusCode
    ).toBe(200);
    expect(state.list).toHaveBeenCalledWith(expect.anything(), "one", {
      tag: "Ventas",
      status: "closed",
      search: "Ana",
      limit: 20
    });
    expect((await app.inject({ url: "/api/bridge/inbox/tags", headers })).json().data).toEqual([
      "Ventas"
    ]);
    expect((await app.inject({ url: "/api/bridge/inbox/tags" })).statusCode).toBe(401);
  });
  it("normalizes labels and returns 404 without changing a missing or foreign chat", async () => {
    state.set.mockResolvedValue(false);
    const response = await app.inject({
      method: "PATCH",
      url: `/api/bridge/inbox/conversations/${id}/tags`,
      headers,
      payload: { ...payload, tags: [" Ventas ", "Ventas"] }
    });
    expect(response.statusCode).toBe(404);
    expect(state.set).toHaveBeenCalledWith(expect.anything(), "one", id, ["Ventas"]);
  });
});
