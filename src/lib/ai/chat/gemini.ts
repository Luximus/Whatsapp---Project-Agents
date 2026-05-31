import { getProviderCredentials } from "../config.js";
import {
  AiProviderError,
  type ChatCompletionRequest,
  type ChatCompletionResult,
  type ChatMessage,
  type ChatProvider,
  type ChatToolCall,
  type ChatToolDefinition
} from "../types.js";

/**
 * Adaptador nativo de la API generateContent de Google Gemini.
 * Usa `contents` con roles "user"/"model", `systemInstruction` aparte y
 * `tools.functionDeclarations` para tool-calling.
 */
export class GeminiChatProvider implements ChatProvider {
  readonly name = "gemini" as const;

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const creds = getProviderCredentials("gemini");
    if (!creds.apiKey) {
      throw new AiProviderError("gemini", "gemini_not_configured");
    }

    const model = request.model || creds.defaultChatModel;
    const systemPrompt = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n")
      .trim();

    const body: Record<string, unknown> = {
      contents: request.messages.filter((m) => m.role !== "system").map(toGeminiContent)
    };
    if (systemPrompt) {
      body.systemInstruction = { parts: [{ text: systemPrompt }] };
    }
    const generationConfig: Record<string, unknown> = {};
    if (typeof request.temperature === "number") generationConfig.temperature = request.temperature;
    if (typeof request.maxTokens === "number") generationConfig.maxOutputTokens = request.maxTokens;
    if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;
    if (request.tools?.length) {
      body.tools = [{ functionDeclarations: request.tools.map(toGeminiTool) }];
    }

    const url = `${creds.baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(creds.apiKey)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });

    const rawText = await response.text().catch(() => "");
    if (!response.ok) {
      throw new AiProviderError("gemini", "gemini_chat_failed", {
        statusCode: response.status,
        details: rawText
      });
    }

    let parsed: any;
    try {
      parsed = rawText ? JSON.parse(rawText) : {};
    } catch {
      throw new AiProviderError("gemini", "gemini_chat_invalid_json", { details: rawText });
    }

    const parts: any[] = parsed?.candidates?.[0]?.content?.parts ?? [];
    const text = parts
      .filter((p) => typeof p?.text === "string")
      .map((p) => p.text)
      .join("")
      .trim();
    const toolCalls: ChatToolCall[] = parts
      .filter((p) => p?.functionCall)
      .map((p, index) => ({
        id: String(p.functionCall?.name ?? `call_${index}`),
        name: String(p.functionCall?.name ?? ""),
        arguments: JSON.stringify(p.functionCall?.args ?? {})
      }));

    return {
      text,
      toolCalls,
      model,
      provider: "gemini",
      raw: parsed
    };
  }
}

function safeParseArgs(raw: string): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function toGeminiContent(message: ChatMessage) {
  if (message.role === "tool") {
    return {
      role: "user" as const,
      parts: [
        {
          functionResponse: {
            name: message.name ?? message.toolCallId ?? "tool",
            response: { content: message.content }
          }
        }
      ]
    };
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    const parts: Array<Record<string, unknown>> = [];
    if (message.content) parts.push({ text: message.content });
    for (const call of message.toolCalls) {
      parts.push({ functionCall: { name: call.name, args: safeParseArgs(call.arguments) } });
    }
    return { role: "model" as const, parts };
  }
  return {
    role: message.role === "assistant" ? ("model" as const) : ("user" as const),
    parts: [{ text: message.content }]
  };
}

function toGeminiTool(tool: ChatToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  };
}
