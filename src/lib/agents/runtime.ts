import { createChatProvider, getDefaultChatProvider } from "../ai/chat/index.js";
import { isAiProviderName, type ChatMessage, type ChatProvider } from "../ai/types.js";
import { toChatToolDefinition, type AgentTool, type AgentToolContext, type LoadedAgent } from "./types.js";

const DEFAULT_MAX_TURNS = 6;

export interface RunAgentOptions {
  agent: LoadedAgent;
  /** Mensaje del usuario (texto ya transcrito si venía en audio). */
  userMessage: string;
  /** Historial previo de la conversación (sin el system). */
  history?: ChatMessage[];
  context: AgentToolContext;
  maxTurns?: number;
}

export interface RunAgentResult {
  text: string;
  /** Mensajes generados durante la ejecución (assistant + tool), para persistir. */
  newMessages: ChatMessage[];
  turns: number;
}

function resolveProvider(agent: LoadedAgent): ChatProvider {
  if (agent.chatProvider && isAiProviderName(agent.chatProvider)) {
    return createChatProvider(agent.chatProvider);
  }
  return getDefaultChatProvider();
}

async function executeTool(
  tool: AgentTool,
  rawArgs: string,
  context: AgentToolContext
): Promise<string> {
  let args: Record<string, unknown> = {};
  if (rawArgs && rawArgs.trim()) {
    try {
      args = JSON.parse(rawArgs);
    } catch {
      return `error: invalid_tool_arguments_json for ${tool.name}`;
    }
  }
  try {
    const result = await tool.execute(args, context);
    return typeof result === "string" ? result : JSON.stringify(result);
  } catch (err) {
    context.logger?.warn?.(`agent_tool_failed:${tool.name}: ${(err as Error)?.message}`);
    return `error: tool_execution_failed:${tool.name}`;
  }
}

/**
 * Ejecuta un agente: loop de tool-calling sobre la capa `ChatProvider`.
 * Agnóstico de proveedor. Termina cuando el modelo responde sin pedir tools
 * o cuando se alcanza `maxTurns` (protección contra loops infinitos).
 */
export async function runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
  const { agent, userMessage, context } = options;
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  const provider = resolveProvider(agent);
  const toolDefs = agent.tools.map(toChatToolDefinition);
  const toolsByName = new Map(agent.tools.map((tool) => [tool.name, tool]));

  const baseMessages: ChatMessage[] = [
    { role: "system", content: agent.systemPrompt },
    ...(options.history ?? []),
    { role: "user", content: userMessage }
  ];

  const newMessages: ChatMessage[] = [];
  let turns = 0;

  while (turns < maxTurns) {
    turns += 1;
    const result = await provider.complete({
      messages: [...baseMessages, ...newMessages],
      model: agent.chatModel || undefined,
      tools: toolDefs.length ? toolDefs : undefined
    });

    // El asistente respondió (puede traer texto y/o tool calls).
    newMessages.push({ role: "assistant", content: result.text });

    if (!result.toolCalls.length) {
      return { text: result.text, newMessages, turns };
    }

    // Ejecuta cada tool solicitada y añade su resultado al historial.
    for (const call of result.toolCalls) {
      const tool = toolsByName.get(call.name);
      const output = tool
        ? await executeTool(tool, call.arguments, context)
        : `error: unknown_tool:${call.name}`;
      newMessages.push({
        role: "tool",
        content: output,
        toolCallId: call.id,
        name: call.name
      });
    }
  }

  // Se agotaron los turnos sin respuesta final: devuelve el último texto.
  const lastAssistant = [...newMessages].reverse().find((m) => m.role === "assistant");
  return { text: lastAssistant?.content ?? "", newMessages, turns };
}
