import { tool } from "@openai/agents";
import type { AgentScript, AgentScriptRuntimeContext } from "../../agents/repository.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Converts an array of AgentScript definitions into OpenAI SDK tool instances.
 * The `toolsUsed` Set is mutated on each tool execution to record which tools ran.
 */
export function buildProjectAgentTools(
  scripts: AgentScript[],
  runtimeContext: AgentScriptRuntimeContext,
  toolsUsed: Set<string>
) {
  return scripts.map((script) =>
    tool({
      name: script.name,
      description: script.description,
      parameters: script.parameters as any,
      strict: false,
      execute: async (payload) => {
        toolsUsed.add(script.name);
        const args = isRecord(payload) ? payload : ({} as Record<string, unknown>);
        return script.run(args, runtimeContext);
      },
      errorFunction: (_context, error) =>
        JSON.stringify({
          ok: false,
          error: String((error as any)?.message ?? "tool_execution_failed")
        })
    })
  );
}
