import {expect,it} from "vitest";
import {websitePackageSummary} from "../src/lib/websitePackageSummary.js";
const catalog={code:"page-like-this",initial:{display:"25,99 USD (89.975 COP)"},monthly:{display:"9,99 USD (34.585 COP)"},trm:{rate:3461.92},packages:[{months:3,display:"45,97 USD (159.144 COP)"}]};
it("quotes initial, monthly and requested prepaid term",()=>{
 const reply=websitePackageSummary(JSON.stringify(catalog),"es",3);
 for(const price of [catalog.initial.display,catalog.monthly.display,catalog.packages[0]!.display]) expect(reply).toContain(price);
});
it("quotes only the monthly rate for renewal",()=>expect(websitePackageSummary(JSON.stringify({...catalog,renewal:true}),"es")).not.toContain("25,99"));
it("omits peso amounts without an official exchange rate",()=>expect(websitePackageSummary(JSON.stringify({code:catalog.code,trmUnavailable:true,initialUsdCents:2599,monthlyUsdCents:999}),"es")).toMatch(/9,99 USD.*pendiente/));
it("includes catalog benefits, both prices and delivery in the default price answer",()=>{
 const benefits=["Página web","Alojamiento y dominio propio por un año","Tres videos","Atención por texto y voz"];
 const reply=websitePackageSummary(JSON.stringify({...catalog,benefits,deliveryBusinessDays:[3,5]}),"es");
 expect(reply).toContain("El paquete incluye página web, alojamiento y dominio propio por un año, tres videos y atención por texto y voz.");
 expect(reply).toContain(catalog.initial.display);
 expect(reply).toContain(catalog.monthly.display);
 expect(reply).toContain("3 a 5 días hábiles");
});
