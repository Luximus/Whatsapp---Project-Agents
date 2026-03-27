/**
 * Conversation runner: executes a TestCase turn by turn against the live agent.
 * Each test case uses a unique phone number to avoid state contamination.
 */

import { handleProjectAgentMessage } from "../../src/application/agent/handleAgentMessage.js";
import type { TestCase, TurnRecord } from "./cases/index.js";

export type ConversationRecord = {
  caseId: string;
  turns: TurnRecord[];
  durationMs: number;
  error: string | null;
};

const TURN_TIMEOUT_MS = 60_000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Turn timed out after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}

export async function runTestCase(tc: TestCase): Promise<ConversationRecord> {
  const turns: TurnRecord[] = [];
  const startedAt = Date.now();

  try {
    for (let i = 0; i < tc.turns.length; i++) {
      const turn = tc.turns[i];
      const result = await withTimeout(
        handleProjectAgentMessage({ phoneE164: tc.phone, text: turn.user }),
        TURN_TIMEOUT_MS
      );

      const record: TurnRecord = {
        index: i,
        user: turn.user,
        reply: result.reply,
        toolsUsed: result.toolsUsed ?? [],
        escalated: result.escalated,
        escalationSent: result.escalationSent
      };

      turns.push(record);

      // Per-turn checks — logged as warnings but don't abort run
      if (turn.check) {
        if (turn.check.reply_contains) {
          for (const expected of turn.check.reply_contains) {
            if (!result.reply.toLowerCase().includes(expected.toLowerCase())) {
              console.warn(
                `  [warn] Turn ${i}: reply missing "${expected}"\n    Got: ${result.reply.slice(0, 120)}`
              );
            }
          }
        }
        if (turn.check.reply_not_contains) {
          for (const forbidden of turn.check.reply_not_contains) {
            if (result.reply.toLowerCase().includes(forbidden.toLowerCase())) {
              console.warn(
                `  [warn] Turn ${i}: reply unexpectedly contains "${forbidden}"\n    Got: ${result.reply.slice(0, 120)}`
              );
            }
          }
        }
      }

      // Small pause between turns (simulates human typing speed)
      if (i < tc.turns.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    return { caseId: tc.id, turns, durationMs: Date.now() - startedAt, error: null };
  } catch (err: any) {
    return {
      caseId: tc.id,
      turns,
      durationMs: Date.now() - startedAt,
      error: String(err?.message ?? err)
    };
  }
}

export function formatTranscript(record: ConversationRecord): string {
  const lines: string[] = [`=== CONVERSACION: ${record.caseId} ===`];
  for (const t of record.turns) {
    lines.push(`[T${t.index}] USUARIO: ${t.user}`);
    lines.push(
      `[T${t.index}] AGENTE:  ${t.reply.slice(0, 400)}${t.reply.length > 400 ? "..." : ""}`
    );
    if (t.toolsUsed.length > 0) {
      lines.push(`         Tools: ${t.toolsUsed.join(", ")}`);
    }
  }
  if (record.error) lines.push(`ERROR: ${record.error}`);
  return lines.join("\n");
}
