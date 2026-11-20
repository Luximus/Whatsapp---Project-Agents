import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ChatProvider } from "../ai/types.js";
import { runAgent } from "./runtime.js";
import type { AgentTool, LoadedAgent } from "./types.js";

// Mockeamos la factoría de proveedores para inyectar un ChatProvider falso.
const completeMock = vi.fn();
vi.mock("../ai/chat/index.js", () => ({
  getDefaultChatProvider: (): ChatProvider => ({ name: "openai", complete: completeMock }),
  createChatProvider: (): ChatProvider => ({ name: "openai", complete: completeMock })
}));

function makeAgent(tools: AgentTool[] = []): LoadedAgent {
  return { projectKey: "test", systemPrompt: "system prompt", tools };
}

describe("runAgent", () => {
  beforeEach(() => completeMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("devuelve la respuesta directa cuando no hay tool calls", async () => {
    completeMock.mockResolvedValueOnce({
      text: "hola humano",
      toolCalls: [],
      model: "m",
      provider: "openai"
    });

    const result = await runAgent({
      agent: makeAgent(),
      userMessage: "hola",
      context: { projectKey: "test" }
    });

    expect(result.text).toBe("hola humano");
    expect(result.turns).toBe(1);
    expect(completeMock).toHaveBeenCalledTimes(1);
    // El system prompt y el mensaje del usuario deben ir en el request.
    const firstReq = completeMock.mock.calls[0][0];
    expect(firstReq.messages[0]).toEqual({ role: "system", content: "system prompt" });
    expect(firstReq.messages.at(-1)).toEqual({ role: "user", content: "hola" });
  });

  it("responde la consulta del clon con costos y proceso del catálogo", async () => {
    const execute = vi.fn().mockResolvedValue({code: "page-like-this", currency: "COP", packages: [{months: 3, totalCop: 269700}], benefits: ["Tres videos"], excluded: ["Dominio propio"], deliveryBusinessDays: [3, 5], autoRenew: false, startsAt: "delivery"});
    completeMock.mockResolvedValue({text: "", toolCalls: []});
    const result = await runAgent({
      agent: {projectKey: "luxisoft", systemPrompt: "", tools: [{name: "websitePageSales", parameters: {type: "object"}, execute}]},
      userMessage: "Hola, quiero crear mi clon virtual. Referencia: https://jmarin.luxisoft.com/es/ Me gustaría conocer los paquetes y cómo contratarlo.",
      context: {projectKey: "luxisoft", channel: "whatsapp"}
    });
    expect(result.text).toContain("3 meses por $269.700");
    expect(result.text).toContain("tres videos");
    expect(result.text).toContain("3 a 5 días hábiles");
    expect(result.text).toContain("una foto");
    expect(completeMock).not.toHaveBeenCalled();
    expect(result.text).toContain("enlace de Wompi");
    expect(execute.mock.calls.map(([args]) => args)).toEqual([{action: "catalog"}]);
  });

  it("atiende la consulta real del clon y su continuación de precios con el catálogo, sin crear un pedido", async () => {
    const catalog = {
      code: "page-like-this", currency: "COP", packages: [{months: 3, totalCop: 269700}],
      benefits: ["Página web", "Alojamiento y dominio propio por un año", "Tres videos", "Atención por texto y voz"],
      excluded: [], deliveryBusinessDays: [3, 5], autoRenew: false, startsAt: "delivery"
    };
    const execute = vi.fn().mockResolvedValue(catalog);
    const options = {
      agent: {projectKey: "luxisoft", systemPrompt: "", tools: [{name: "websitePageSales", parameters: {type: "object"}, execute}]},
      context: {projectKey: "luxisoft", channel: "whatsapp" as const}
    };
    const first = "buena noche, quisiera mas informacion sobre el clon virtual";
    const intro = await runAgent({...options, userMessage: first});
    expect(intro.text).toContain("dominio propio por un año");
    expect(intro.text).toContain("texto y voz");
    expect(intro.text).not.toMatch(/respuesta fiable|Tokens|enlace de pago/i);
    const next = await runAgent({...options, userMessage: "¿Y cuánto cuesta por 3 meses?", history: [
      {role: "user", content:first}, {role:"assistant",content:intro.text}
    ]});
    expect(next.text).toContain("3 meses por $269.700");
    expect(completeMock).not.toHaveBeenCalled();
    expect(execute.mock.calls.map(([args]) => args)).toEqual([{action: "catalog"}, {action: "catalog"}]);
  });

  it.each(["Quiero contratar el clon virtual por 3 meses", "Ya pagué mi clon virtual", "¿Cuánto cuesta el plan Plus?"])(
    "conserva el flujo pertinente para %s", async (raw) => {
      const execute = vi.fn();
      completeMock.mockResolvedValue({text:"Revisaré la solicitud.", toolCalls:[]});
      await runAgent({agent:{projectKey:"luxisoft",systemPrompt:"",tools:[{name:"websitePageSales",parameters:{type:"object"},execute}]},
        userMessage:raw,history:[{role:"assistant",content:"El clon virtual es una página personalizada."}],
        context:{projectKey:"luxisoft",channel:"whatsapp"}});
      expect(execute).not.toHaveBeenCalled();
      expect(completeMock).toHaveBeenCalled();
    }
  );

  it("sustituye el token {{ASSISTANT_NAME}} por el nombre del proveedor activo", async () => {
    completeMock.mockResolvedValueOnce({
      text: "hola",
      toolCalls: [],
      model: "m",
      provider: "openai"
    });

    await runAgent({
      agent: { projectKey: "test", systemPrompt: "Eres {{ASSISTANT_NAME}}.", tools: [] },
      userMessage: "hola",
      context: { projectKey: "test" }
    });

    const firstReq = completeMock.mock.calls[0][0];
    // provider mockeado = "openai" -> nombre por defecto "Luisa".
    expect(firstReq.messages[0]).toEqual({ role: "system", content: "Eres Luisa." });
  });

  it("ejecuta una tool y devuelve la respuesta final del segundo turno", async () => {
    const execute = vi.fn().mockResolvedValue("resultado-de-tool");
    const tool: AgentTool = {
      name: "miTool",
      parameters: { type: "object" },
      execute
    };

    completeMock
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ id: "c1", name: "miTool", arguments: '{"x":1}' }],
        model: "m",
        provider: "openai"
      })
      .mockResolvedValueOnce({
        text: "respuesta final",
        toolCalls: [],
        model: "m",
        provider: "openai"
      });

    const result = await runAgent({
      agent: makeAgent([tool]),
      userMessage: "usa la tool",
      context: { projectKey: "test", from: "+57300" }
    });

    expect(execute).toHaveBeenCalledWith({ x: 1 }, expect.objectContaining({ projectKey: "test" }));
    expect(result.text).toBe("respuesta final");
    expect(result.turns).toBe(2);
    // El historial debe incluir el resultado de la tool con su toolCallId.
    const toolMsg = result.newMessages.find((m) => m.role === "tool");
    expect(toolMsg).toMatchObject({ content: "resultado-de-tool", toolCallId: "c1" });
  });

  it("maneja tool desconocida sin romper", async () => {
    completeMock
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ id: "c1", name: "noExiste", arguments: "{}" }],
        model: "m",
        provider: "openai"
      })
      .mockResolvedValueOnce({ text: "ok", toolCalls: [], model: "m", provider: "openai" });

    const result = await runAgent({
      agent: makeAgent(),
      userMessage: "x",
      context: { projectKey: "test" }
    });

    const toolMsg = result.newMessages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("unknown_tool");
    expect(result.text).toBe("ok");
  });

  it("respeta maxTurns para evitar loops infinitos", async () => {
    // Siempre pide la misma tool -> nunca termina por sí solo.
    completeMock.mockResolvedValue({
      text: "pensando",
      toolCalls: [{ id: "c", name: "t", arguments: "{}" }],
      model: "m",
      provider: "openai"
    });
    const tool: AgentTool = { name: "t", parameters: { type: "object" }, execute: () => "r" };

    const result = await runAgent({
      agent: makeAgent([tool]),
      userMessage: "loop",
      context: { projectKey: "test" },
      maxTurns: 3
    });

    expect(result.turns).toBe(3);
    expect(completeMock).toHaveBeenCalledTimes(3);
  });

  it("captura errores de la tool y los reporta como resultado", async () => {
    const tool: AgentTool = {
      name: "falla",
      parameters: { type: "object" },
      execute: () => {
        throw new Error("boom");
      }
    };
    completeMock
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ id: "c1", name: "falla", arguments: "{}" }],
        model: "m",
        provider: "openai"
      })
      .mockResolvedValueOnce({ text: "recuperado", toolCalls: [], model: "m", provider: "openai" });

    const result = await runAgent({
      agent: makeAgent([tool]),
      userMessage: "x",
      context: { projectKey: "test", logger: { info() {}, warn() {}, error() {} } }
    });

    const toolMsg = result.newMessages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("tool_execution_failed");
    expect(result.text).toBe("recuperado");
  });
});
