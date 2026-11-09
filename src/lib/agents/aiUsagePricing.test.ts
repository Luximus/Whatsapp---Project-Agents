import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error Agent scripts are loaded dynamically in production.
import tool from '../../../agents/luxisoft/scripts/getAiUsagePricing.js';
const snapshot = () => ({ status:'ok',catalog:{expiresAt:Date.now()+300000,fetchedAt:new Date().toISOString(),data:{aiUsagePricing:{},tokenPackages:[{oneTimeAvailable:true,priceCopCents:1000000,tokens:79000,balanceCopCents:790000}]}}});
describe('official additional AI usage prices',()=>{
 it('uses current prices without branding, account writes or message estimates',async()=>{const getCommercialCatalog=vi.fn(async()=>snapshot());const result=JSON.parse(await tool.execute({}, {actions:{getCommercialCatalog}}));expect(getCommercialCatalog).toHaveBeenCalledWith({provider:'luxisoft',area:'plans'});expect(result).toMatchObject({status:'ok',fixedPricePerMessage:null,recargas:[{priceCop:10000,creditedUnits:79000,creditedBalanceCop:7900}]});expect(JSON.stringify(result)).not.toMatch(/luxisoft|plus|premium/i);});
 it.each(['expired','failed','malformed','disabled'])('fails closed when %s',async mode=>{const s=snapshot();if(mode==='expired')s.catalog.expiresAt=1;if(mode==='failed')s.status='failed';if(mode==='malformed')s.catalog.data.tokenPackages[0].priceCopCents=-1;if(mode==='disabled')s.catalog.data.tokenPackages[0].oneTimeAvailable=false;expect(JSON.parse(await tool.execute({}, {actions:{getCommercialCatalog:async()=>s}}))).toEqual({status:'pricing_unavailable'});});
});
