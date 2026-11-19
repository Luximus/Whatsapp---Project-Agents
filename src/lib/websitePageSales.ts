import {env} from '../env.js';
export async function websitePageSales(action:'catalog'|'start'|'save'|'status'|'quote'|'domain'|'checkout',phone:string,locale:string,details?:Record<string,unknown>, options?:{months?:number;domain?:string;acceptedTotalCop?:number}){
 const key=env.bridgeProjects[env.defaultProject]?.apiKey;if(!key)throw Error('sales_connection_unavailable');
 const response=await fetch((process.env.LUXISOFT_PLATFORM_API_URL??'http://127.0.0.1:3200/api/v1').replace(/\/$/,'')+'/website-sales/agent',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key,'x-project-key':env.defaultProject},body:JSON.stringify({...options,flow:"chat",action,phone,locale:locale==='en'?'en':'es',...(details?{details}:{})}),signal:AbortSignal.timeout(10000)});
 const result=await response.json() as {ok:boolean;data?:unknown};if(!response.ok||!result.ok)throw Error('sales_service_unavailable');return result.data;
}

export async function submitWebsiteMaterial(phone: string, messageId: string, data: Buffer, mime: string, filename: string) {
  const base = process.env.LUXISOFT_PLATFORM_API_URL ?? "http://127.0.0.1:3200/api/v1";
  const url = base.replace(/\/$/, "") + "/website-sales/material";
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: "Bearer " + env.bridgeProjects[env.defaultProject]?.apiKey,
      "x-project-key":env.defaultProject, "content-type":"application/json" },
    body: JSON.stringify({phone, messageId, mime, filename, file: data.toString("base64")}),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw Error("website_material_rejected");
}
