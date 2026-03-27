#!/usr/bin/env tsx
/**
 * Agent Test Orchestrator
 *
 * Usage:
 *   npm run test:agent                      # run all cases
 *   npm run test:agent -- --case cot_web    # run specific case
 *   npm run test:agent -- --no-fix          # evaluate only, no auto-fix
 *   npm run test:agent -- --llm             # include LLM evaluation
 *   npm run test:agent -- --max-retries 3   # override max retry attempts
 *
 * Loop per case:
 *   run → evaluate → if fail: fix → run again → evaluate → ... until pass or max retries
 */

import fs from "fs";
import path from "path";
import { TEST_CASES } from "./cases/index.js";
import { runTestCase, formatTranscript } from "./runner.js";
import { evaluate, printEvaluationResult } from "./evaluator.js";
import { applyFix } from "./fixer.js";

// ─── Log file setup ───────────────────────────────────────────────────────────

const LOG_DIR = path.resolve("scripts/agent-test/logs");
fs.mkdirSync(LOG_DIR, { recursive: true });
const logFileName = `run-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
const LOG_PATH = path.join(LOG_DIR, logFileName);
const logStream = fs.createWriteStream(LOG_PATH, { flags: "w" });

function writeLog(msg: string) {
  // Strip ANSI color codes for the log file
  logStream.write(msg.replace(/\x1b\[[0-9;]*m/g, "") + "\n");
}

// Patch console methods to also write to log file
const _log = console.log.bind(console);
const _warn = console.warn.bind(console);
const _error = console.error.bind(console);
console.log = (...args: any[]) => { _log(...args); writeLog(args.join(" ")); };
console.warn = (...args: any[]) => { _warn(...args); writeLog("[WARN] " + args.join(" ")); };
console.error = (...args: any[]) => { _error(...args); writeLog("[ERROR] " + args.join(" ")); };

process.on("exit", () => { logStream.end(); });
console.log(`Log: ${LOG_PATH}`);

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const caseFilter = args.includes("--case") ? args[args.indexOf("--case") + 1] : null;
const enableAutoFix = !args.includes("--no-fix");
const useLLM = args.includes("--llm");
const maxRetriesArg = args.includes("--max-retries")
  ? parseInt(args[args.indexOf("--max-retries") + 1], 10)
  : 5;

// ─── summary types ────────────────────────────────────────────────────────────

type CaseSummary = {
  id: string;
  name: string;
  passed: boolean;
  attempts: number;
  score: number;
  fixApplied: boolean;
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function printHeader(text: string) {
  const line = "─".repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${text}`);
  console.log(line);
}

function printCaseLine(tc: { id: string; name: string }, idx: number, total: number) {
  console.log(`\n[${idx + 1}/${total}] ${tc.id} — ${tc.name}`);
}

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── main loop ────────────────────────────────────────────────────────────────

async function main() {
  const cases = caseFilter
    ? TEST_CASES.filter((tc) => tc.id === caseFilter || tc.case_type === caseFilter)
    : TEST_CASES;

  if (cases.length === 0) {
    console.error(`No se encontraron casos${caseFilter ? ` con id/tipo "${caseFilter}"` : ""}.`);
    process.exit(1);
  }

  printHeader(`AGENT TEST SUITE — ${cases.length} caso(s) — autofix: ${enableAutoFix} — llm: ${useLLM}`);

  const summaries: CaseSummary[] = [];

  for (let ci = 0; ci < cases.length; ci++) {
    const tc = cases[ci];
    printCaseLine(tc, ci, cases.length);

    let passed = false;
    let lastScore = 0;
    let fixApplied = false;
    let attempts = 0;

    while (attempts < maxRetriesArg) {
      attempts++;

      if (attempts > 1) {
        console.log(`\n  [retry ${attempts}] Ejecutando conversacion nuevamente...`);
        // Small pause after a fix to ensure file changes settle
        await delay(1500);
      }

      // 1. Run the conversation
      console.log(`  → Ejecutando ${tc.turns.length} turno(s)...`);
      const record = await runTestCase(tc);

      if (record.error && record.turns.length === 0) {
        console.error(`  ✗ Error fatal en el runner: ${record.error}`);
        break;
      }

      // 2. Evaluate
      const evalResult = evaluate(tc, record, useLLM);
      printEvaluationResult(evalResult);

      lastScore = evalResult.score;

      if (evalResult.passed) {
        passed = true;
        console.log(`  \x1b[32m✓ PASO en intento ${attempts}\x1b[0m`);
        break;
      }

      console.log(`  \x1b[31m✗ FALLO (score ${evalResult.score}/100)\x1b[0m`);

      // 3. Auto-fix if enabled and retries remain
      if (!enableAutoFix || attempts >= maxRetriesArg) {
        if (!enableAutoFix) console.log("  [info] Auto-fix deshabilitado (--no-fix)");
        break;
      }

      console.log(`  [fix] Intentando corregir (intento ${attempts}/${maxRetriesArg - 1})...`);
      const fixResult = await applyFix(tc, record, evalResult, attempts);
      fixApplied = true;

      if (!fixResult.success) {
        console.error(`  [fix] Fallo al aplicar corrección: ${fixResult.error}`);
        console.log(formatTranscript(record));
        break;
      }

      console.log("  [fix] Corrección aplicada. Re-ejecutando test...");
    }

    summaries.push({
      id: tc.id,
      name: tc.name,
      passed,
      attempts,
      score: lastScore,
      fixApplied
    });
  }

  // ─── final summary ─────────────────────────────────────────────────────────

  printHeader("RESUMEN FINAL");

  const totalPassed = summaries.filter((s) => s.passed).length;
  const totalFailed = summaries.length - totalPassed;

  for (const s of summaries) {
    const icon = s.passed ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    const fix = s.fixApplied ? " [corregido]" : "";
    const attempts = s.attempts > 1 ? ` (${s.attempts} intentos)` : "";
    console.log(`  ${icon} ${s.id} — score ${s.score}/100${attempts}${fix}`);
  }

  console.log(`\n  Pasados: ${totalPassed}/${summaries.length} | Fallados: ${totalFailed}`);

  if (totalFailed > 0) {
    console.log("\n\x1b[31m  Algunos casos fallaron. Revisa los logs arriba para detalles.\x1b[0m");
    process.exit(1);
  } else {
    console.log("\n\x1b[32m  Todos los casos pasaron.\x1b[0m");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Error fatal en el orchestrator:", err);
  process.exit(1);
});
