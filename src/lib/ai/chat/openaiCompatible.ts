import { getProviderCredentials } from "../config.js";
import {
  AiProviderError,
  type AiProviderName,
  type ChatCompletionRequest,
  type ChatCompletionResult,
  type ChatMessage,
  type ChatProvider,
  type ChatToolCall,
  type ChatToolDefinition
} from "../types.js";

/**
 * Adaptador para cualquier API compatible con el formato
 * `POST {baseUrl}/chat/completions` de OpenAI. Se parametriza por proveedor
 * para reusarlo con OpenAI, Deepseek, MiniMax y Grok (xAI).
 */
export class OpenAiCompatibleChatProvider implements ChatProvider {
  readonly name: AiProviderName;

  constructor(name: AiProviderName) {
    this.name = name;
  }

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const creds = getProviderCredentials(this.name);
    if (!creds.apiKey) {
      throw new AiProviderError(this.name, `${this.name}_not_configured`);
    }

    const model = request.model || creds.defaultChatModel;
    const body: Record<string, unknown> = {
      model,
      messages: request.messages.map(toOpenAiMessage)
    };
    if (typeof request.temperature === "number") body.temperature = request.temperature;
    if (typeof request.maxTokens === "number") body.max_tokens = request.maxTokens;
    if (request.tools?.length) body.tools = request.tools.map(toOpenAiTool);

    const response = await fetch(`${creds.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${creds.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const rawText = await response.text().catch(() => "");
    if (!response.ok) {
      throw new AiProviderError(this.name, `${this.name}_chat_failed`, {
        statusCode: response.status,
        details: rawText
      });
    }

    let parsed: any;
    try {
      parsed = rawText ? JSON.parse(rawText) : {};
    } catch {
      throw new AiProviderError(this.name, `${this.name}_chat_invalid_json`, {
        details: rawText
      });
    }

    const message = parsed?.choices?.[0]?.message ?? {};
    const text = typeof message.content === "string" ? message.content : "";
    const toolCalls: ChatToolCall[] = Array.isArray(message.tool_calls)
      ? message.tool_calls.map((call: any) => ({
          id: String(call?.id ?? ""),
          name: String(call?.function?.name ?? ""),
          arguments: String(call?.function?.arguments ?? "")
        }))
      : [];

    return {
      text: text.trim(),
      toolCalls,
      model: String(parsed?.model ?? model),
      provider: this.name,
      raw: parsed
    };
  }
}

function toOpenAiMessage(message: ChatMessage) {
  if (message.role === "tool") {
    return {
      role: "tool" as const,
      tool_call_id: message.toolCallId ?? "",
      content: message.content
    };
  }
  return { role: message.role, content: message.content };
}

function toOpenAiTool(tool: ChatToolDefinition) {
  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  };
}
