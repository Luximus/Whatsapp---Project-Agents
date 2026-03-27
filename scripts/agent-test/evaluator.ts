/**
 * Evaluator: checks a completed conversation against the test case assertions.
 *
 * Two layers:
 *  1. Deterministic rule-based checks (fast, no API calls)
 *  2. LLM-based quality evaluation via `claude --print` (richer, when available)
 */

import { spawnSync } from "child_process";
import type { TestCase, TurnRecord } from "./cases/index.js";
import type { ConversationRecord } from "./runner.js";

export type AssertionResult = {
  id: string;
  description: string;
  passed: boolean;
  detail?: string;
};

export type EvaluationResult = {
  caseId: string;
  passed: boolean;
  score: number; // 0–100
  assertionResults: AssertionResult[];
  llmFeedback?: string;
  failureSummary: string;
};

// ─── rule-based evaluation ───────────────────────────────────────────────────

export function evaluateRules(tc: TestCase, record: ConversationRecord): EvaluationResult {
  const results: AssertionResult[] = [];

  if (record.error) {
    return {
      caseId: tc.id,
      passed: false,
      score: 0,
      assertionResults: [
        { id: "runner_error", description: "Error del runner", passed: false, detail: record.error }
      ],
      failureSummary: `Error en el runner: ${record.error}`
    };
  }

  const lastTurn = record.turns[record.turns.length - 1] ?? null;

  for (const assertion of tc.assertions) {
    let passed = false;
    let detail: string | undefined;

    try {
      passed = assertion.check(record.turns, lastTurn);
    } catch (err: any) {
      passed = false;
      detail = `Error al evaluar: ${err.message}`;
    }

    results.push({
      id: assertion.id,
      description: assertion.description,
      passed,
      detail
    });
  }

  const passedCount = results.filter((r) => r.passed).length;
  const score = Math.round((passedCount / Math.max(results.length, 1)) * 100);
  const passed = results.every((r) => r.passed);

  const failureSummary = passed
    ? "Todas las aserciones pasaron"
    : results
        .filter((r) => !r.passed)
        .map((r) => `- [${r.id}] ${r.description}`)
        .join("\n");

  return { caseId: tc.id, passed, score, assertionResults: results, failureSummary };
}

// ─── LLM evaluation (optional, uses `claude --print`) ────────────────────────

export function evaluateWithLLM(
  tc: TestCase,
  record: ConversationRecord,
  ruleResult: EvaluationResult
): string | null {
  const prompt = buildLLMEvalPrompt(tc, record, ruleResult);

  try {
    const result = spawnSync("claude", ["--print"], {
      input: prompt,
      encoding: "utf-8",
      timeout: 90_000,
      stdio: ["pipe", "pipe", "pipe"]
    });

    if (result.status !== 0 || result.error) return null;
    return (result.stdout ?? "").trim() || null;
  } catch {
    return null;
  }
}

function buildLLMEvalPrompt(
  tc: TestCase,
  record: ConversationRecord,
  ruleResult: EvaluationResult
): string {
  const transcript = record.turns
    .map(
      (t) =>
        `Turn ${t.index}:\n  Usuario: ${t.user}\n  Agente: ${t.reply}\n  Tools: ${t.toolsUsed.join(", ") || "ninguna"}`
    )
    .join("\n\n");

  const failedRules = ruleResult.assertionResults
    .filter((r) => !r.passed)
    .map((r) => `- ${r.description}`)
    .join("\n");

  return `Eres un evaluador de calidad de agentes de ventas para LUXISOFT (empresa de software).

CASO DE PRUEBA: "${tc.name}"
TIPO: ${tc.case_type}
DESCRIPCION: ${tc.description}

CONVERSACION COMPLETA:
${transcript}

REGLAS QUE FALLARON (ya detectadas automaticamente):
${failedRules || "Ninguna (todas las reglas pasaron)"}

Evalua ADICIONALMENTE la calidad de la conversacion respondiendo SOLO con JSON valido (sin markdown, sin comentarios):
{
  "issues": [
    {
      "severity": "critical|warning",
      "turn": <numero de turno o null>,
      "description": "descripcion clara del problema en espanol"
    }
  ],
  "overall_comment": "comentario breve de maximo 2 oraciones sobre la calidad general"
}

Si no hay issues adicionales, responde: {"issues":[],"overall_comment":"Conversacion correcta y bien conducida."}`;
}

// ─── combined evaluation ─────────────────────────────────────────────────────

export function evaluate(
  tc: TestCase,
  record: ConversationRecord,
  useLLM = false
): EvaluationResult {
  const result = evaluateRules(tc, record);

  if (useLLM) {
    const feedback = evaluateWithLLM(tc, record, result);
    if (feedback) {
      result.llmFeedback = feedback;

      // If LLM found critical issues but rules passed, downgrade score slightly
      try {
        const parsed = JSON.parse(feedback);
        const criticals = (parsed.issues ?? []).filter((i: any) => i.severity === "critical");
        if (criticals.length > 0 && result.passed) {
          result.score = Math.max(0, result.score - criticals.length * 10);
          if (result.score < 70) {
            result.passed = false;
            result.failureSummary +=
              "\n\nProblemas adicionales detectados por LLM:\n" +
              criticals.map((i: any) => `- [Turn ${i.turn ?? "?"}] ${i.description}`).join("\n");
          }
        }
      } catch {
        /* ignore parse errors */
      }
    }
  }

  return result;
}

export function printEvaluationResult(result: EvaluationResult): void {
  const icon = result.passed ? "✓" : "✗";
  const color = result.passed ? "\x1b[32m" : "\x1b[31m";
  const reset = "\x1b[0m";

  console.log(`  ${color}${icon} Score: ${result.score}/100${reset}`);

  for (const ar of result.assertionResults) {
    const aIcon = ar.passed ? "  ✓" : "  ✗";
    const aColor = ar.passed ? "\x1b[32m" : "\x1b[31m";
    console.log(`  ${aColor}${aIcon} [${ar.id}] ${ar.description}${reset}`);
    if (!ar.passed && ar.detail) console.log(`       ${ar.detail}`);
  }

  if (result.llmFeedback) {
    try {
      const parsed = JSON.parse(result.llmFeedback);
      if (parsed.issues?.length > 0) {
        console.log("  [LLM issues]:");
        for (const issue of parsed.issues) {
          console.log(`    - [${issue.severity}] T${issue.turn ?? "?"}: ${issue.description}`);
        }
      }
      if (parsed.overall_comment) {
        console.log(`  [LLM] ${parsed.overall_comment}`);
      }
    } catch {
      console.log(`  [LLM raw] ${result.llmFeedback.slice(0, 200)}`);
    }
  }

  if (!result.passed) {
    console.log(`\n  Fallos:\n${result.failureSummary.split("\n").map((l) => "  " + l).join("\n")}`);
  }
}
