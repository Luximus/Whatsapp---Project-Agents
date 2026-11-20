import { expect, it, vi } from "vitest";
import type { ChatMessage } from "./ai/types.js";
import { beginBillingConversation } from "./billingConversation.js";

it("retains the requested quantity through a premature confirmation and a successful retry", async () => {
  const purchase = "Quiero comprar 100.000 Tokens";
  const history: ChatMessage[] = [{ role: "user", content: purchase }];
  const call = vi.fn().mockResolvedValue({ status: "verify_identity" });
  const start = await beginBillingConversation(purchase, [], call);
  history.push({ role: "assistant", content: start!.message! });
  call
    .mockResolvedValueOnce({ status: "verify_identity" })
    .mockResolvedValueOnce({ status: "check_email" });
  const identify = await beginBillingConversation(
    "Sandra López, sandra@example.test",
    history,
    call
  );
  expect(call).toHaveBeenLastCalledWith({
    action: "identify",
    name: "Sandra López",
    email: "sandra@example.test"
  });
  history.push({ role: "assistant", content: identify!.message! });
  const early = await beginBillingConversation("ya confirmé", history, call);
  history.push({ role: "assistant", content: early!.message! });
  call.mockResolvedValueOnce({ status: "identified", missing: [] }).mockResolvedValueOnce({
    status: "offer",
    environment: "sandbox",
    description: "100000 Tokens",
    totalCop: 20000,
    confirm: "PAGAR 01020304",
    expiresAt: "2030-01-01T14:00:00Z"
  });
  const offer = await beginBillingConversation("ya confirmé", history, call);
  expect(call).toHaveBeenLastCalledWith({
    action: "quote",
    selection: { product: "tokens", tokens: 100000 }
  });
  expect(offer!.message).toContain("PAGAR 01020304");
  expect(offer!.message).toContain("20.000 COP");
});
it("keeps a generic plan choice in a clone purchase and allows an explicit platform order", async () => {
  const call = vi.fn().mockResolvedValue({ status: "verify_identity" });
  const history: ChatMessage[] = [{ role: "user", content: "Me interesa el clon virtual" }];
  expect(
    await beginBillingConversation("Quiero contratar el plan por seis meses", history, call)
  ).toBeNull();
  expect(await beginBillingConversation("Quiero pagar el dominio", [], call, true)).toBeNull();
  expect(call).not.toHaveBeenCalled();
  expect(
    await beginBillingConversation("Quiero comprar el plan Plus mensual", history, call, true)
  ).toHaveProperty("message");
});
