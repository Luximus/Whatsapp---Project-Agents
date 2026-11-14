import {test} from 'node:test';import assert from 'node:assert/strict';
import pricing from '../scripts/getAiUsagePricing.js';
import catalog from '../scripts/getServiceCatalog.js';
const data={plans:[{code:'free',aiUsage:{version:2,multiplier:1}}],aiUsagePricing:{tokenRecharge:{minTokens:70000,minimumPriceCopCents:1444800,pricingVersion:'variable-test',expires:false}},tokenPackages:[]};
const context=(body=data,expires=Date.now()+60000)=>({actions:{getCommercialCatalog:async()=>({status:'ok',catalog:{fetchedAt:new Date().toISOString(),expiresAt:expires,data:body}})}});
test('quotes variable recharge conditions without offering fixed packages',async()=>{const out=JSON.parse(await pricing.execute({},context()));assert.equal(out.status,'ok');assert.equal(out.recarga.minimumTokens,70000);assert.equal(out.recarga.minimumPriceCop,14448);assert.equal(out.recarga.expires,false);assert.equal(out.recargas,undefined);});
test('fails closed for expired catalogs or missing recharge policy',async()=>{assert.equal(JSON.parse(await pricing.execute({},context(data,Date.now()-1))).status,'pricing_unavailable');assert.equal(JSON.parse(await pricing.execute({},context({plans:[]}))).status,'pricing_unavailable');});
test('accepts current weekly usage schema without substituting old multipliers',async()=>{const out=await catalog.execute({provider:'luxisoft',area:'plans'},context());assert.equal(out.includes('no se pudo verificar el contrato'),false);assert.ok(out.includes('1'));});

test('does not quote stale daily plan prices',async()=>{const out=await catalog.execute({provider:'luxisoft',area:'plans'},context({...data,plans:[...data.plans,{code:'plus',aiUsage:{version:2,multiplier:1.25},pricingStatus:'pending'}]}));assert.ok(out.startsWith('pricing_pending_daily_update'));});
