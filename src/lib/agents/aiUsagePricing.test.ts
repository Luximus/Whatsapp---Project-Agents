import { describe, it, expect, vi } from "vitest";
// @ts-expect-error Agent scripts are loaded dynamically in production.
import tool from "../../../agents/luxisoft/scripts/getAiUsagePricing.js";

const snapshot = () => ({
  status: "ok",
  catalog: {
    expiresAt: Date.now() + 300000,
    fetchedAt: new Date().toISOString(),
    data: { aiUsagePricing: { tokenRecharge: { minTokens: 70000, minimumPriceCopCents: 1000000 } } }
  }
});
describe("official additional AI usage prices", () => {
  it("reads the minimum price for a variable quantity from the current public catalog", async () => {
    const getCommercialCatalog = vi.fn(async () => snapshot());
    const result = JSON.parse(await tool.execute({}, { actions: { getCommercialCatalog } }));
    expect(getCommercialCatalog).toHaveBeenCalledWith({ provider: "luxisoft", area: "plans" });
    expect(result).toMatchObject({
      status: "ok",
      fixedPricePerMessage: null,
      recarga: { minimumPriceCop: 10000, minimumTokens: 70000 }
    });
    expect(JSON.stringify(result)).not.toMatch(/luxisoft|plus|premium/i);
  });

  it.each(["expired", "failed", "invalid minimum", "invalid price"])(
    "fails closed for %s",
    async (mode) => {
      const s = snapshot();
      if (mode === "expired") s.catalog.expiresAt = 1;
      if (mode === "failed") s.status = "failed";
      if (mode === "invalid minimum") s.catalog.data.aiUsagePricing.tokenRecharge.minTokens = 100;
      if (mode === "invalid price")
        s.catalog.data.aiUsagePricing.tokenRecharge.minimumPriceCopCents = -1;
      expect(
        JSON.parse(await tool.execute({}, { actions: { getCommercialCatalog: async () => s } }))
      ).toEqual({ status: "pricing_unavailable" });
    }
  );
});
