import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("../env.js", () => ({
  env: {
    metaGraphVersion: "v25.0",
    metaPageAccessToken: "test-page-token",
    metaPageId: "page-1",
    metaInstagramAccountId: "ig-1"
  }
}));

import { flattenMetaMessagingEvents, sendMetaText } from "./metaMessaging.js";

afterEach(() => vi.unstubAllGlobals());

describe("flattenMetaMessagingEvents", () => {
  it("normaliza mensajes de Messenger e ignora echoes y receipts", () => {
    const events = flattenMetaMessagingEvents({
      object: "page",
      entry: [
        {
          id: "page-1",
          messaging: [
            {
              sender: { id: "psid-1" },
              recipient: { id: "page-1" },
              timestamp: 123,
              message: { mid: "mid-1", text: "Hola" }
            },
            {
              sender: { id: "page-1" },
              recipient: { id: "psid-1" },
              message: { mid: "mid-echo", text: "eco", is_echo: true }
            },
            { sender: { id: "psid-1" }, delivery: { mids: ["mid-1"] } }
          ]
        }
      ]
    });
    expect(events).toEqual([
      {
        channel: "messenger",
        senderId: "psid-1",
        recipientId: "page-1",
        messageId: "mid-1",
        text: "Hola",
        timestamp: 123
      }
    ]);
  });

  it("normaliza mensajes y postbacks de Instagram", () => {
    const events = flattenMetaMessagingEvents({
      object: "instagram",
      entry: [
        {
          id: "ig-1",
          messaging: [
            {
              sender: { id: "igsid-1" },
              recipient: { id: "ig-1" },
              message: { mid: "ig-mid-1", text: "Precio" }
            },
            {
              sender: { id: "igsid-1" },
              recipient: { id: "ig-1" },
              timestamp: 456,
              postback: { mid: "ig-mid-2", title: "Cotizar", payload: "QUOTE" }
            }
          ]
        }
      ]
    });
    expect(events.map((event) => event.text)).toEqual(["Precio", "Cotizar"]);
    expect(events.every((event) => event.channel === "instagram")).toBe(true);
  });
});

describe("sendMetaText", () => {
  it("envía texto por el endpoint del activo y no pone el token en la URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message_id: "out-1" })
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendMetaText({ channel: "messenger", recipientId: "psid-1", text: "Hola" })
    ).resolves.toEqual({ messageId: "out-1" });

    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain("access_token");
    expect(options.headers.authorization).toMatch(/^Bearer /);
    expect(JSON.parse(options.body)).toEqual({
      recipient: { id: "psid-1" },
      message: { text: "Hola" }
    });
  });
});
