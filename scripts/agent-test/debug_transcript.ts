#!/usr/bin/env tsx
import { TEST_CASES } from "./cases/index.js";
import { runTestCase, formatTranscript } from "./runner.js";

async function main() {
  const caseId = process.argv[2] || "cot_web_full";
  const tc = TEST_CASES.find(t => t.id === caseId);
  if (!tc) { console.error("Case not found:", caseId); process.exit(1); }
  const record = await runTestCase(tc);
  console.log(formatTranscript(record));
}
main().catch(e => { console.error(e); process.exit(1); });
