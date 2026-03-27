/**
 * Auto-fixer: when a test case fails, builds a detailed context prompt and invokes
 * `claude --print --dangerously-skip-permissions` so Claude Code can edit the agent files.
 *
 * Files that Claude is directed to inspect and potentially modify:
 *   - agents/luxisoft/services.txt
 *   - agents/luxisoft/scripts/*.js  (the tool scripts)
 *   - src/application/agent/handleAgentMessage.ts (targeted sections only)
 */

import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { TestCase } from "./cases/index.js";
import type { ConversationRecord, } from "./runner.js";
import type { EvaluationResult } from "./evaluator.js";

const ROOT = resolve(import.meta.dirname, "../..");

function readFileSafe(relPath: string): string {
  try {
    return readFileSync(resolve(ROOT, relPath), "utf-8");
  } catch {
    return `(no disponible: ${relPath})`;
  }
}

function relevantScripts(tc: TestCase): string[] {
  const always = [
    "agents/luxisoft/scripts/classify_service_intent.js",
    "agents/luxisoft/scripts/extract_prospect_profile.js",
    "agents/luxisoft/scripts/next_intake_question.js"
  ];

  const byCase: Record<string, string[]> = {
    cotizacion: ["agents/luxisoft/scripts/schedule_meeting_request.js"],
    soporte_ours: ["agents/luxisoft/scripts/register_support_ticket.js"],
    soporte_third_party: [
      "agents/luxisoft/scripts/register_support_ticket.js",
      "agents/luxisoft/scripts/schedule_meeting_request.js"
    ],
    informacion: [
      "agents/luxisoft/scripts/lookup_project_status.js",
      "agents/luxisoft/scripts/register_project_followup.js"
    ],
    reunion_directa: ["agents/luxisoft/scripts/schedule_meeting_request.js"],
    seguimiento: [
      "agents/luxisoft/scripts/register_project_followup.js",
      "agents/luxisoft/scripts/lookup_project_status.js"
    ]
  };

  return [...new Set([...always, ...(byCase[tc.case_type] ?? [])])];
}

function buildFixPrompt(
  tc: TestCase,
  record: ConversationRecord,
  evalResult: EvaluationResult,
  attemptNumber: number
): string {
  const transcript = record.turns
    .map(
      (t) =>
        `  [T${t.index}] Usuario: ${t.user}\n  [T${t.index}] Agente:  ${t.reply}\n  [T${t.index}] Tools: ${t.toolsUsed.join(", ") || "ninguna"}`
    )
    .join("\n\n");

  const failedAssertions = evalResult.assertionResults
    .filter((r) => !r.passed)
    .map((r) => `  - [${r.id}] ${r.description}${r.detail ? `: ${r.detail}` : ""}`)
    .join("\n");

  const servicesPrompt = readFileSafe("agents/luxisoft/services.txt");
  const scriptFiles = relevantScripts(tc)
    .map((p) => `\n### ${p}\n\`\`\`javascript\n${readFileSafe(p)}\n\`\`\``)
    .join("\n");

  return `Eres un experto en el agente de WhatsApp de LUXISOFT. Un test automatizado ha fallado en el intento ${attemptNumber}.

Tu objetivo es encontrar y corregir la causa raiz del fallo editando los archivos del agente.

## CASO DE PRUEBA
ID: ${tc.id}
Nombre: ${tc.name}
Tipo: ${tc.case_type}
Descripcion: ${tc.description}

## CONVERSACION QUE FALLO
${transcript}

## ASERCIONES QUE FALLARON
${failedAssertions}

## RESUMEN DEL FALLO
${evalResult.failureSummary}

${evalResult.llmFeedback ? `## FEEDBACK ADICIONAL (LLM)\n${evalResult.llmFeedback}\n` : ""}

## ARCHIVOS ACTUALES DEL AGENTE

### agents/luxisoft/services.txt
\`\`\`
${servicesPrompt}
\`\`\`
${scriptFiles}

## INSTRUCCIONES

1. Analiza la conversacion fallida y los mensajes de error.
2. Identifica la causa raiz exacta del problema.
3. Modifica SOLO los archivos necesarios para corregir el fallo.
4. Usa las herramientas de edicion (Edit) para aplicar los cambios directamente en los archivos.
5. Haz cambios minimos y precisos. No refactorices codigo que no esta relacionado con el fallo.
6. Archivos que PUEDES modificar:
   - agents/luxisoft/services.txt
   - agents/luxisoft/scripts/*.js
   - src/application/agent/handleAgentMessage.ts (solo para ajustes de logica de routing o estado)
7. NO modifiques pruebas ni el runner del test.
8. Despues de aplicar los cambios, describe brevemente que cambiaste y por que.`;
}

export type FixResult = {
  attempted: boolean;
  success: boolean;
  output: string;
  error: string | null;
};

export async function applyFix(
  tc: TestCase,
  record: ConversationRecord,
  evalResult: EvaluationResult,
  attemptNumber: number
): Promise<FixResult> {
  const prompt = buildFixPrompt(tc, record, evalResult, attemptNumber);

  console.log(`\n  [fixer] Invocando Claude Code para corregir "${tc.id}" (intento ${attemptNumber})...`);

  const result = spawnSync("claude", ["--print", "--dangerously-skip-permissions"], {
    input: prompt,
    encoding: "utf-8",
    timeout: 300_000, // 5 minutes
    stdio: ["pipe", "pipe", "pipe"],
    cwd: ROOT
  });

  if (result.error) {
    return {
      attempted: true,
      success: false,
      output: "",
      error: String(result.error.message ?? result.error)
    };
  }

  const output = (result.stdout ?? "").trim();
  const stderr = (result.stderr ?? "").trim();

  if (result.status !== 0) {
    return {
      attempted: true,
      success: false,
      output,
      error: stderr || `Claude salió con código ${result.status}`
    };
  }

  if (!output) {
    return { attempted: true, success: false, output: "", error: "Claude no produjo ninguna salida" };
  }

  console.log(`  [fixer] Claude respondió (${output.length} chars)`);
  if (output.length > 0) {
    console.log(`  [fixer] Resumen: ${output.slice(0, 300).replace(/\n/g, " ")}...`);
  }

  return { attempted: true, success: true, output, error: null };
}
