import {env} from '../env.js';
export async function websitePageSales(action:'catalog'|'start'|'save'|'status',phone:string,locale:string,details?:Record<string,unknown>){
 const key=env.bridgeProjects[env.defaultProject]?.apiKey;if(!key)throw Error('sales_connection_unavailable');
 const response=await fetch((process.env.LUXISOFT_PLATFORM_API_URL??'http://127.0.0.1:3200/api/v1').replace(/\/$/,'')+'/website-sales/agent',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key,'x-project-key':env.defaultProject},body:JSON.stringify({action,phone,locale:locale==='en'?'en':'es',...(details?{details}:{})}),signal:AbortSignal.timeout(10000)});
 const result=await response.json() as {ok:boolean;data?:unknown};if(!response.ok||!result.ok)throw Error('sales_service_unavailable');return result.data;
}
