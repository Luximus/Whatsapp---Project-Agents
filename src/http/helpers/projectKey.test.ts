import { describe, it, expect } from "vitest";
import { resolveProjectKey } from "./projectKey.js";

// Provide a minimal env mock — the module imports env at load time via config/env
// We only need to test the resolution logic, so we mock the request shapes.

describe("resolveProjectKey", () => {
  const makeRequest = (overrides: {
    headers?: Record<string, string | string[]>;
    query?: Record<string, string>;
  } = {}) => ({
    headers: overrides.headers ?? {},
    query: overrides.query ?? {}
  });

  it("throws 400 for an invalid project key format", () => {
    expect(() =>
      resolveProjectKey(makeRequest(), "invalid key!")
    ).toThrowError("invalid_project_key");
  });

  it("uses explicit project key when provided", () => {
    const key = resolveProjectKey(makeRequest(), "my-project");
    expect(key).toBe("my-project");
  });

  it("normalizes project key to lowercase", () => {
    const key = resolveProjectKey(makeRequest(), "MyProject");
    expect(key).toBe("myproject");
  });

  it("reads key from x-project-key header", () => {
    const key = resolveProjectKey(
      makeRequest({ headers: { "x-project-key": "header-project" } })
    );
    expect(key).toBe("header-project");
  });

  it("reads key from query param when header missing", () => {
    const key = resolveProjectKey(
      makeRequest({ query: { project_key: "query-project" } })
    );
    expect(key).toBe("query-project");
  });

  it("explicit argument takes priority over header and query", () => {
    const key = resolveProjectKey(
      makeRequest({
        headers: { "x-project-key": "header-project" },
        query: { project_key: "query-project" }
      }),
      "explicit-project"
    );
    expect(key).toBe("explicit-project");
  });
});
