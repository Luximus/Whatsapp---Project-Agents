import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
    // Valores mínimos para que `src/env.ts` valide al importarse en tests,
    // sin depender de un `.env` real (importante en CI). dotenv no sobrescribe
    // variables ya presentes, así que estas tienen prioridad.
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgres://test:test@localhost:5432/test"
    }
  }
});
