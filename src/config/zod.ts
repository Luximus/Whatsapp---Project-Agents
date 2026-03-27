import type { ZodType } from "zod";

export function parseOrThrow<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const issues = result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message
  }));

  const error = new Error("validation_error") as Error & {
    statusCode?: number;
    details?: unknown;
  };
  error.statusCode = 400;
  error.details = issues;
  throw error;
}
