import { describe, expect, it, vi } from "vitest";
import { MemoryConversationStore } from "./memoryStore.js";
import { PostgresConversationStore } from "./postgresStore.js";
import type { PgLike } from "./store.js";

describe("MemoryConversationStore", () => {
  it("guarda y recupera el historial en orden cronológico", async () => {
    const store = new MemoryConversationStore();
    await store.append({
      projectKey: "luxisoft",
      phoneE164: "+573001112233",
      ttlSeconds: 1800,
      messages: [
        { role: "user", content: "hola" },
        { role: "assistant", content: "¡Hola! ¿En qué te ayudo?" }
      ]
    });

    const history = await store.load({
      projectKey: "luxisoft",
      phoneE164: "+573001112233",
      limit: 20
    });
    expect(history).toEqual([
      { role: "user", content: "hola" },
      { role: "assistant", content: "¡Hola! ¿En qué te ayudo?" }
    ]);
  });

  it("respeta el límite devolviendo los mensajes más recientes", async () => {
    const store = new MemoryConversationStore();
    for (let i = 0; i < 5; i += 1) {
      await store.append({
        projectKey: "luxisoft",
        phoneE164: "+57300",
        ttlSeconds: 1800,
        messages: [{ role: "user", content: `m${i}` }]
      });
    }
    const history = await store.load({ projectKey: "luxisoft", phoneE164: "+57300", limit: 2 });
    expect(history.map((m) => m.content)).toEqual(["m3", "m4"]);
  });

  it("aísla conversaciones por número y por proyecto", async () => {
    const store = new MemoryConversationStore();
    await store.append({
      projectKey: "luxisoft",
      phoneE164: "+57300",
      ttlSeconds: 1800,
      messages: [{ role: "user", content: "a" }]
    });
    const other = await store.load({ projectKey: "luxisoft", phoneE164: "+57999", limit: 20 });
    expect(other).toEqual([]);
  });

  it("ignora mensajes vacíos", async () => {
    const store = new MemoryConversationStore();
    await store.append({
      projectKey: "luxisoft",
      phoneE164: "+57300",
      ttlSeconds: 1800,
      messages: [
        { role: "user", content: "   " },
        { role: "assistant", content: "ok" }
      ]
    });
    const history = await store.load({ projectKey: "luxisoft", phoneE164: "+57300", limit: 20 });
    expect(history).toEqual([{ role: "assistant", content: "ok" }]);
  });
});

describe("PostgresConversationStore", () => {
  it("carga el historial y lo devuelve en orden cronológico", async () => {
    const pg: PgLike = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { role: "assistant", content: "respuesta" },
          { role: "user", content: "pregunta" }
        ]
      })
    };
    const store = new PostgresConversationStore(pg);
    const history = await store.load({ projectKey: "luxisoft", phoneE164: "+57300", limit: 20 });

    // La query ordena desc por id; el store invierte a cronológico.
    expect(history).toEqual([
      { role: "user", content: "pregunta" },
      { role: "assistant", content: "respuesta" }
    ]);
    expect(pg.query).toHaveBeenCalledWith(expect.stringContaining("whatsapp_agent_messages"), [
      "luxisoft",
      "+57300",
      20
    ]);
  });

  it("inserta los mensajes del turno con placeholders correctos", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const store = new PostgresConversationStore({ query });
    await store.append({
      projectKey: "luxisoft",
      phoneE164: "+57300",
      ttlSeconds: 1800,
      messages: [
        { role: "user", content: "hola" },
        { role: "assistant", content: "hey" }
      ]
    });

    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain("insert into whatsapp_agent_messages");
    expect(sql).toContain("($1, $2, $4, $5, now() + ($3)::interval)");
    expect(sql).toContain("($1, $2, $6, $7, now() + ($3)::interval)");
    expect(values).toEqual([
      "luxisoft",
      "+57300",
      "1800 seconds",
      "user",
      "hola",
      "assistant",
      "hey"
    ]);
  });

  it("no ejecuta insert si no hay mensajes con contenido", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const store = new PostgresConversationStore({ query });
    await store.append({
      projectKey: "luxisoft",
      phoneE164: "+57300",
      ttlSeconds: 1800,
      messages: [{ role: "user", content: "  " }]
    });
    expect(query).not.toHaveBeenCalled();
  });
});
