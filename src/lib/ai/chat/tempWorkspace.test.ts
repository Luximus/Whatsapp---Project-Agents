import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCliWorkspace, cliWorkspaceEnvironment } from "./tempWorkspace.js";
let root: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});
describe("private CLI temporary workspace", () => {
  it("uses the valid configured temporary root with private permissions", async () => {
    root = await mkdtemp("/tmp/whatsapp-temp-test-");
    vi.stubEnv("TMPDIR", root);
    const dir = await createCliWorkspace();
    expect(path.dirname(dir)).toBe(root);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
  });
  it("recovers when the inherited interactive CLI directory has disappeared", async () => {
    root = await mkdtemp("/tmp/whatsapp-temp-test-");
    const removed = path.join(root, "claude-gone");
    vi.stubEnv("TMPDIR", removed);
    vi.spyOn(os, "homedir").mockReturnValue(root);
    const dir = await createCliWorkspace();
    expect(dir.startsWith(path.join(root, ".cache", "whatsapp-ai", "run-"))).toBe(true);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect(existsSync(removed)).toBe(false);
    const child = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "import os from 'node:os';import {mkdtempSync} from 'node:fs';import path from 'node:path';console.log(mkdtempSync(path.join(os.tmpdir(),'child-')));"
      ],
      { cwd: dir, env: cliWorkspaceEnvironment(dir), encoding: "utf8" }
    ).trim();
    expect(path.dirname(child)).toBe(dir);
  });
  it("keeps child temp variables scoped to the turn and preserves other configuration", () => {
    const inherited = {
      TMPDIR: "/removed",
      HOME: "/service-home",
      AI_CHAT_CHAIN: "codex,codex-qwen,claude"
    };
    expect(cliWorkspaceEnvironment("/private-turn", inherited)).toEqual({
      ...inherited,
      TMPDIR: "/private-turn",
      TMP: "/private-turn",
      TEMP: "/private-turn"
    });
    expect(inherited.TMPDIR).toBe("/removed");
  });
});
