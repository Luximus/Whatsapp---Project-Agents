import { describe, it, expect } from "vitest";
import { loadAgent, listAgentProjects, safeProjectKey } from "./registry.js";

describe("safeProjectKey", () => {
  it("normaliza a minúsculas", () => {
    expect(safeProjectKey("LuxiSoft")).toBe("luxisoft");
  });

  it("rechaza keys con caracteres peligrosos (path traversal)", () => {
    expect(() => safeProjectKey("../etc")).toThrow();
    expect(() => safeProjectKey("a/b")).toThrow();
    expect(() => safeProjectKey("")).toThrow();
    expect(() => safeProjectKey("con espacio")).toThrow();
  });
});

describe("registry (agente de ejemplo luxisoft)", () => {
  it("lista el proyecto luxisoft", () => {
    expect(listAgentProjects()).toContain("luxisoft");
  });

  it("carga el prompt y las tools desde disco", async () => {
    const agent = await loadAgent("luxisoft");
    expect(agent.projectKey).toBe("luxisoft");
    // El nombre se inyecta en runtime; el prompt en disco usa el token.
    expect(agent.systemPrompt).toContain("{{ASSISTANT_NAME}}");
    const toolNames = agent.tools.map((t) => t.name);
    expect(toolNames).toContain("getServiceCatalog");
  });

  it("la tool de ejemplo se ejecuta", async () => {
    const agent = await loadAgent("luxisoft");
    const tool = agent.tools.find((t) => t.name === "getServiceCatalog");
    const output = await tool!.execute({ area: "voz" }, { projectKey: "luxisoft" });
    expect(output).toContain("NAVAI");
  });

  it("expone las tools de agendamiento y transferencia a humano", async () => {
    const agent = await loadAgent("luxisoft");
    const names = agent.tools.map((t) => t.name);
    expect(names).toContain("scheduleMeeting");
    expect(names).toContain("escalateToHuman");
  });

  it("scheduleMeeting invoca la acción inyectada con el nombre normalizado", async () => {
    const agent = await loadAgent("luxisoft");
    const tool = agent.tools.find((t) => t.name === "scheduleMeeting");
    const calls: any[] = [];
    const output = await tool!.execute(
      { contactName: "  Carlos  ", meetingDate: "2026-06-02", service: "luxipanel" },
      {
        projectKey: "luxisoft",
        actions: {
          scheduleMeeting: async (input) => {
            calls.push(input);
            return { ok: true };
          }
        }
      }
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].contactName).toBe("Carlos");
    expect(calls[0].meetingDate).toBe("2026-06-02");
    expect(output).toContain("ok:");
  });

  it("scheduleMeeting degrada si falta nombre o no hay acción", async () => {
    const agent = await loadAgent("luxisoft");
    const tool = agent.tools.find((t) => t.name === "scheduleMeeting");
    const sinNombre = await tool!.execute(
      { meetingDate: "2026-06-02" },
      { projectKey: "luxisoft", actions: { scheduleMeeting: async () => ({ ok: true }) } }
    );
    expect(sinNombre).toContain("error: falta_nombre_del_contacto");

    const sinAccion = await tool!.execute({ contactName: "Ana" }, { projectKey: "luxisoft" });
    expect(sinAccion).toContain("error: agendamiento_no_disponible");
  });

  it("escalateToHuman invoca la acción inyectada", async () => {
    const agent = await loadAgent("luxisoft");
    const tool = agent.tools.find((t) => t.name === "escalateToHuman");
    let received: any = null;
    const output = await tool!.execute(
      { summary: "Cliente necesita acceso a su cuenta" },
      {
        projectKey: "luxisoft",
        actions: {
          escalateToHuman: async (input) => {
            received = input;
            return { ok: true };
          }
        }
      }
    );
    expect(received?.summary).toBe("Cliente necesita acceso a su cuenta");
    expect(output).toContain("ok:");
  });

  it("lanza si el proyecto no existe", async () => {
    await expect(loadAgent("no_existe_xyz")).rejects.toThrow("agent_prompt_not_found");
  });
});
