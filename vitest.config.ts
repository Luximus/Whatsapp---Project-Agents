import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    alias: {
      "@config/": new URL("./src/config/", import.meta.url).pathname,
      "@errors/": new URL("./src/errors/", import.meta.url).pathname,
      "@domain/": new URL("./src/domain/", import.meta.url).pathname,
      "@infrastructure/": new URL("./src/infrastructure/", import.meta.url).pathname,
      "@application/": new URL("./src/application/", import.meta.url).pathname,
      "@http/": new URL("./src/http/", import.meta.url).pathname
    }
  }
});
