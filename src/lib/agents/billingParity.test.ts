import {describe, expect, it, vi} from "vitest";
import {CommercialCatalog} from "../commercialCatalog.js";
// @ts-expect-error dynamic agent script
import pricing from "../../../agents/luxisoft/scripts/getAiUsagePricing.js";

describe("commercial quotations", () => {
  it("expires the catalog at midnight in Bogotá even inside the five minute TTL", async () => {
    let now = Date.parse("2026-11-20T04:59:45Z");
    const fetchJson = vi.fn(async () => ({ plans: [] }));
    let cache: string | null = null;
    const catalog = new CommercialCatalog({ now:()=>now, ttlSeconds:300, fetchJson, cache:{
      get:async()=>cache,set:async(_key, value)=>{cache=value;}
    }});
    expect((await catalog.get("luxisoft","plans")).expiresAt).toBe(now+15000);
    now += 15000;
    await catalog.get("luxisoft","plans");
    expect(fetchJson).toHaveBeenCalledTimes(2);
  });
  it("quotes the requested quantity with USD and COP cents", async () => {
    vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({ok:true,data:{tokens:140000,priceMicroUsd:5790000,priceCopCents:1926310,trm:{rate:3326.96}}})})));
    try {
      const result=JSON.parse(await pricing.execute({tokens:140000},{actions:{getCommercialCatalog:async()=>({status:"ok",catalog:{expiresAt:Date.now()+1000,data:{aiUsagePricing:{tokenRecharge:{minTokens:70000,minimumPriceMicroUsd:3050000}}}}})}}));
      expect(result.recarga.cotizacion).toMatchObject({tokens:140000,priceUsd:{amount:5.79},priceCop:{amount:19263.10}});
    }finally{vi.unstubAllGlobals();}
  });
});
