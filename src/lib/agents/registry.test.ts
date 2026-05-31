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
    expect(agent.systemPrompt).toContain("Valeria");
    const toolNames = agent.tools.map((t) => t.name);
    expect(toolNames).toContain("getServiceCatalog");
  });

  it("la tool de ejemplo se ejecuta", async () => {
    const agent = await loadAgent("luxisoft");
    const tool = agent.tools.find((t) => t.name === "getServiceCatalog");
    const output = await tool!.execute({ area: "voz" }, { projectKey: "luxisoft" });
    expect(output).toContain("NAVAI");
  });

  it("lanza si el proyecto no existe", async () => {
    await expect(loadAgent("no_existe_xyz")).rejects.toThrow("agent_prompt_not_found");
  });
});
