import { env } from "../env.js";

export async function chatBilling(
  phone: string,
  conversation: string,
  input: Record<string, unknown>
) {
  const base = process.env.LUXISOFT_PLATFORM_API_URL ?? "http://127.0.0.1:3200/api/v1";
  const response = await fetch(base.replace(/\/$/, "") + "/chat-billing/agent", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-project-key": env.defaultProject,
      authorization: "Bearer " + env.bridgeProjects[env.defaultProject]?.apiKey
    },
    body: JSON.stringify({ ...input, phone, conversation }),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok)
    return { status: response.status === 400 ? "invalid_fields" : "billing_unavailable" };
  return ((await response.json()) as { data: Record<string, unknown> }).data;
}
