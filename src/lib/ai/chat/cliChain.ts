import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { env } from "../../../env.js";
import {
  AiProviderError,
  type AiProviderName,
  type ChatCompletionRequest,
  type ChatCompletionResult,
  type ChatMessage,
  type ChatProvider
} from "../types.js";

export const CLI_CHAT_ENGINES = ["codex", "codex-qwen", "claude"] as const;
export type CliChatEngineName = (typeof CLI_CHAT_ENGINES)[number];

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_TOOL_CALLS = 4;
const COOLDOWN_MS = 60_000;
const QUOTA_COOLDOWN_MS = 15 * 60_000;

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
};

export type CliChatEngine = {
  name: CliChatEngineName;
  model: string;
  provider: AiProviderName;
  available: () => boolean;
  complete: (request: ChatCompletionRequest) => Promise<ChatCompletionResult>;
};

class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.queue.shift()?.();
    };
  }
}

let semaphore: Semaphore | null = null;
const cooldowns = new Map<CliChatEngineName, number>();

class CappedBuffer {
  private readonly chunks: Buffer[] = [];
  private size = 0;

  push(value: Buffer | string) {
    if (this.size >= MAX_OUTPUT_BYTES) return;
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const room = MAX_OUTPUT_BYTES - this.size;
    this.chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
    this.size += Math.min(chunk.length, room);
  }

  text() {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

function runCommand(input: {
  bin: string;
  args: string[];
  stdin: string;
  timeoutMs: number;
  cwd?: string;
  processEnv?: NodeJS.ProcessEnv;
}): Promise<CommandResult> {
  return new Promise((resolve) => {
    const stdout = new CappedBuffer();
    const stderr = new CappedBuffer();
    let child: ChildProcess;
    let timedOut = false;
    let settled = false;
    let timeout: NodeJS.Timeout | null = null;
    let killTimeout: NodeJS.Timeout | null = null;

    const finish = (result: Omit<CommandResult, "stdout" | "stderr">) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (killTimeout) clearTimeout(killTimeout);
      resolve({ ...result, stdout: stdout.text(), stderr: stderr.text() });
    };

    try {
      child = spawn(input.bin, input.args, {
        cwd: input.cwd,
        env: input.processEnv,
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (error) {
      finish({
        code: null,
        timedOut: false,
        spawnError: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    child.stdout?.on("data", (chunk) => stdout.push(chunk));
    child.stderr?.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => finish({ code: null, timedOut, spawnError: error.message }));
    child.on("close", (code) => finish({ code, timedOut }));

    timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
      killTimeout.unref?.();
    }, input.timeoutMs);
    timeout.unref?.();

    child.stdin?.on("error", () => undefined);
    child.stdin?.end(input.stdin);
  });
}

function renderTools(request: ChatCompletionRequest): string {
  if (!request.tools?.length) return "(sin herramientas disponibles)";
  return request.tools
    .map((tool) => {
      const schema = JSON.stringify(tool.parameters ?? {}).slice(0, 1_400);
      return `- ${tool.name}: ${tool.description ?? ""}\n  args: ${schema}`;
    })
    .join("\n");
}

function renderMessage(message: ChatMessage): string {
  const label =
    message.role === "user"
      ? "[usuario]"
      : message.role === "assistant"
        ? "[asistente]"
        : message.role === "tool"
          ? `[resultado de herramienta ${message.name ?? ""}]`
          : "[sistema]";
  const toolCalls = message.toolCalls?.length
    ? `\n${JSON.stringify({
        type: "tool_calls",
        calls: message.toolCalls.map((call) => ({
          name: call.name,
          args_json: call.arguments
        }))
      })}`
    : "";
  return `${label}\n${message.content || "(vacío)"}${toolCalls}`;
}

export function buildCliChatPrompt(request: ChatCompletionRequest): {
  system: string;
  conversation: string;
} {
  const systemMessage =
    request.messages.find((message) => message.role === "system")?.content ?? "";
  const transcript = request.messages
    .filter((message) => message.role !== "system")
    .map(renderMessage)
    .join("\n\n");
  const contract = [
    systemMessage,
    "",
    "## HERRAMIENTAS DISPONIBLES",
    renderTools(request),
    "",
    "## CONTRATO DE SALIDA OBLIGATORIO",
    "Responde con EXACTAMENTE un objeto JSON y nada más.",
    '{"type":"reply","text":"respuesta para la persona","calls":[]}',
    'o {"type":"tool_calls","text":"","calls":[{"name":"herramienta","args_json":"{}"}]}',
    `Máximo ${MAX_TOOL_CALLS} llamadas. No inventes resultados de herramientas.`
  ].join("\n");
  return {
    system: contract,
    conversation: `## CONVERSACIÓN\n${transcript}\n\n## TU TURNO\nResponde solo con el JSON del contrato.`
  };
}

const callSchema = z.object({
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional(),
  args_json: z.string().optional(),
  arguments: z.union([z.record(z.string(), z.unknown()), z.string()]).optional()
});
const turnSchema = z.union([
  z.object({ type: z.literal("reply"), text: z.string().nullish() }),
  z.object({
    type: z.literal("tool_calls"),
    text: z.string().nullish(),
    calls: z.array(callSchema)
  })
]);

function extractJsonObjects(raw: string): string[] {
  const text = raw.replace(/```[a-zA-Z0-9_-]*\s*\n?/g, "").replace(/```/g, "");
  const results: string[] = [];
  for (let start = 0; start < text.length && results.length < 8; start += 1) {
    if (text[start] !== "{") continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let cursor = start; cursor < text.length; cursor += 1) {
      const char = text[cursor];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === "{") depth += 1;
      else if (char === "}" && --depth === 0) {
        results.push(text.slice(start, cursor + 1));
        start = cursor;
        break;
      }
    }
  }
  return results;
}

function parseArgs(value: z.infer<typeof callSchema>): Record<string, unknown> {
  if (value.args) return value.args;
  if (value.arguments && typeof value.arguments === "object") return value.arguments;
  const raw = value.args_json ?? (typeof value.arguments === "string" ? value.arguments : "");
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function parseCliChatResult(
  raw: string,
  provider: AiProviderName,
  model: string
): ChatCompletionResult | null {
  for (const candidate of extractJsonObjects(raw)) {
    let payload: unknown;
    try {
      payload = JSON.parse(candidate);
    } catch {
      continue;
    }
    const parsed = turnSchema.safeParse(payload);
    if (!parsed.success) continue;
    if (parsed.data.type === "reply") {
      return {
        text: parsed.data.text?.trim() ?? "",
        toolCalls: [],
        provider,
        model,
        raw: payload
      };
    }
    return {
      text: parsed.data.text?.trim() ?? "",
      toolCalls: parsed.data.calls.slice(0, MAX_TOOL_CALLS).map((call, index) => ({
        id: `cli_call_${index + 1}`,
        name: call.name,
        arguments: JSON.stringify(parseArgs(call))
      })),
      provider,
      model,
      raw: payload
    };
  }
  // Si un CLI ignora el contrato pero entrega texto limpio, sigue siendo una
  // respuesta útil. Los adaptadores solo pasan aquí el mensaje final, no logs.
  const text = raw.trim();
  return text ? { text, toolCalls: [], provider, model, raw } : null;
}

function outputSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    // OpenAI strict structured outputs exige que todas las propiedades estén
    // en required. El discriminante decide cuáles contienen datos útiles.
    required: ["type", "text", "calls"],
    properties: {
      type: { type: "string", enum: ["reply", "tool_calls"] },
      text: { type: "string" },
      calls: {
        type: "array",
        maxItems: MAX_TOOL_CALLS,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "args_json"],
          properties: {
            name: { type: "string" },
            args_json: { type: "string", description: "Argumentos como objeto JSON serializado" }
          }
        }
      }
    }
  };
}

function failure(engine: CliChatEngine, result: CommandResult): AiProviderError {
  const detail = [result.spawnError, result.stderr, result.stdout]
    .filter(Boolean)
    .join("\n")
    .slice(-2_000);
  const quota = /quota|usage limit|rate.?limit|429|too many requests|exhausted/i.test(detail);
  const statusCode = quota ? 429 : result.timedOut ? 504 : undefined;
  return new AiProviderError(engine.provider, `cli_chat_failed:${engine.name}`, {
    statusCode,
    details: { engine: engine.name, detail }
  });
}

function makeCodexEngine(name: "codex" | "codex-qwen"): CliChatEngine {
  const qwen = name === "codex-qwen";
  const model = qwen ? env.qwenChatModel : env.codexChatModel;
  const provider: AiProviderName = "openai";
  const engine: CliChatEngine = {
    name,
    model,
    provider,
    available: () => {
      if (!existsSync(env.codexChatBin)) return false;
      if (qwen) {
        const configFile = path.join(os.homedir(), ".codex", `${env.qwenChatProfile}.config.toml`);
        return existsSync(configFile) && Boolean(env.qwenApiKey || process.env.QWEN_API_KEY);
      }
      return existsSync(path.join(os.homedir(), ".codex", "auth.json"));
    },
    complete: async (request) => {
      const prompt = buildCliChatPrompt(request);
      const dir = await mkdtemp(path.join(os.tmpdir(), "whatsapp-ai-"));
      const outputFile = path.join(dir, "output.json");
      const schemaFile = path.join(dir, "schema.json");
      try {
        await writeFile(schemaFile, JSON.stringify(outputSchema()), "utf8");
        const result = await runCommand({
          bin: env.codexChatBin,
          args: [
            "exec",
            "--ephemeral",
            "--skip-git-repo-check",
            "--color",
            "never",
            "-s",
            "read-only",
            "-C",
            os.tmpdir(),
            ...(qwen ? ["-p", env.qwenChatProfile] : []),
            "-m",
            model,
            "-c",
            'model_reasoning_effort="medium"',
            "--output-schema",
            schemaFile,
            "-o",
            outputFile,
            "-"
          ],
          stdin: `# SYSTEM\n${prompt.system}\n\n${prompt.conversation}`,
          timeoutMs: env.aiChatCliTimeoutMs,
          cwd: os.tmpdir(),
          processEnv: {
            ...process.env,
            ...(env.qwenApiKey ? { QWEN_API_KEY: env.qwenApiKey } : {})
          }
        });
        const output = await readFile(outputFile, "utf8").catch(() => "");
        const parsed = parseCliChatResult(output, provider, model);
        if (result.code !== 0 || result.timedOut || result.spawnError || !parsed) {
          throw failure(engine, { ...result, stdout: `${result.stdout}\n${output}` });
        }
        return parsed;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  };
  return engine;
}

function makeClaudeEngine(): CliChatEngine {
  const model = env.claudeChatModel;
  const engine: CliChatEngine = {
    name: "claude",
    model,
    provider: "anthropic",
    available: () => existsSync(env.claudeChatBin),
    complete: async (request) => {
      const prompt = buildCliChatPrompt(request);
      const result = await runCommand({
        bin: env.claudeChatBin,
        args: [
          "-p",
          "--no-session-persistence",
          "--tools",
          "",
          "--strict-mcp-config",
          "--output-format",
          "json",
          "--model",
          model,
          "--system-prompt",
          prompt.system
        ],
        stdin: prompt.conversation,
        timeoutMs: env.aiChatCliTimeoutMs,
        cwd: os.tmpdir(),
        processEnv: process.env
      });
      let answer = "";
      try {
        const payload = JSON.parse(result.stdout) as { result?: string; is_error?: boolean };
        answer = payload.result ?? "";
        if (payload.is_error) throw failure(engine, result);
      } catch (error) {
        if (error instanceof AiProviderError) throw error;
        throw failure(engine, result);
      }
      const parsed = parseCliChatResult(answer, "anthropic", model);
      if (result.code !== 0 || result.timedOut || result.spawnError || !parsed) {
        throw failure(engine, { ...result, stdout: `${result.stdout}\n${answer}` });
      }
      return parsed;
    }
  };
  return engine;
}

export function resolveCliChatEngines(): CliChatEngine[] {
  const factories: Record<CliChatEngineName, () => CliChatEngine> = {
    codex: () => makeCodexEngine("codex"),
    "codex-qwen": () => makeCodexEngine("codex-qwen"),
    claude: makeClaudeEngine
  };
  const seen = new Set<string>();
  return env.aiChatChain
    .filter((name): name is CliChatEngineName =>
      (CLI_CHAT_ENGINES as readonly string[]).includes(name)
    )
    .filter((name) => !seen.has(name) && Boolean(seen.add(name)))
    .map((name) => factories[name]());
}

export class CliFallbackChatProvider implements ChatProvider {
  readonly name: AiProviderName = "openai";

  constructor(private readonly engines: CliChatEngine[] = resolveCliChatEngines()) {}

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const attempts: string[] = [];
    const now = Date.now();
    for (const engine of this.engines) {
      if (!engine.available()) {
        attempts.push(`${engine.name}:unavailable`);
        continue;
      }
      const coolingUntil = cooldowns.get(engine.name) ?? 0;
      if (coolingUntil > now) {
        attempts.push(`${engine.name}:cooldown`);
        continue;
      }
      const release = await (semaphore ??= new Semaphore(env.aiChatCliConcurrency)).acquire();
      try {
        const result = await engine.complete(request);
        if (attempts.length) {
          console.warn("AI chat fallback selected", { engine: engine.name, attempts });
        }
        return result;
      } catch (error) {
        const statusCode = error instanceof AiProviderError ? error.statusCode : undefined;
        cooldowns.set(
          engine.name,
          Date.now() + (statusCode === 429 ? QUOTA_COOLDOWN_MS : COOLDOWN_MS)
        );
        attempts.push(`${engine.name}:${statusCode ?? "error"}`);
        console.warn("AI chat engine failed", {
          engine: engine.name,
          model: engine.model,
          statusCode,
          error: error instanceof Error ? error.message : String(error)
        });
      } finally {
        release();
      }
    }
    throw new AiProviderError("openai", "ai_chat_chain_exhausted", {
      statusCode: 503,
      details: { attempts }
    });
  }
}

let cachedProvider: CliFallbackChatProvider | null = null;

export function getCliFallbackChatProvider(): CliFallbackChatProvider {
  return (cachedProvider ??= new CliFallbackChatProvider());
}

export function resetCliChatChainForTests() {
  cachedProvider = null;
  semaphore = null;
  cooldowns.clear();
}
