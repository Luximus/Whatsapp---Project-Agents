import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Do not depend on temporary directories inherited from an interactive CLI. */
export async function createCliWorkspace(): Promise<string> {
  try {
    return await mkdtemp(path.join(os.tmpdir(), "whatsapp-ai-"));
  } catch (error) {
    if (!["ENOENT", "ENOTDIR", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? ""))
      throw error;
  }
  const fallback = path.join(os.homedir(), ".cache", "whatsapp-ai");
  await mkdir(fallback, { recursive: true, mode: 0o700 });
  return mkdtemp(path.join(fallback, "run-"));
}

/** Child CLIs need a valid temp root too; keep each turn's files together. */
export function cliWorkspaceEnvironment(
  dir: string,
  inherited: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  return { ...inherited, TMPDIR: dir, TMP: dir, TEMP: dir };
}
