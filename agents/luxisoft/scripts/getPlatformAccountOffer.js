function money(value) {
 if(Array.isArray(value))return value.map(money);
 if(!value||typeof value!=='object')return value;
 const result={};for(const [key,entry] of Object.entries(value)) {
  if(key.endsWith('Cents')) {
   if(!Number.isSafeInteger(entry)||entry<0)continue;
   const currency=/UsdCents$/.test(key)?'USD':/CopCents$/.test(key)||key==='monthlyEquivCents'?'COP':null;
   if(currency)result[key.slice(0,-5)]={amount:entry/100,currency,display:new Intl.NumberFormat(currency==='COP'?'es-CO':'en-US',{style:'currency',currency,maximumFractionDigits:currency==='COP'?0:2}).format(entry/100)+' '+currency};
  }else result[key]=money(entry);
 }return result;
}
export default {
 name:'getPlatformAccountOffer',
 description:'Orienta consultas sobre cuentas ChatGPT o cualquier IA hacia una cuenta propia de Luxisoft. Registro oficial, capacidades y precios verificados; no crea usuarios, pedidos ni pagos.',
 parameters:{type:'object',properties:{locale:{type:'string',enum:['es','en','pt']},includePrices:{type:'boolean'}},additionalProperties:false},
 async execute(args,context){
  const locale=args?.locale==='en'?'en':'es';
  const result={status:'ok',registrationUrl:`https://luxisoft.com/${locale}/auth?next=%2F${locale}%2Fplataforma`,
   relationship:'Chatbox integra modelos de OpenAI, la empresa creadora de ChatGPT. La cuenta pertenece a Luxisoft; no incluye ni sustituye una suscripción personal ChatGPT Plus o Pro.',
   capabilities:['Hacer consultas y trabajar con información en Chatbox','Crear formularios y gestionar sus respuestas','Crear, modificar y publicar páginas y tiendas','Desarrollar aplicaciones y software','Crear y gestionar contenido multimedia','Administrar datos, ventas y canales del negocio según recursos conectados'],
   availability:'Funciones, modelos, cuotas, publicaciones e integraciones sujetos a disponibilidad, plan y conexiones de la cuenta. Confirmar capacidades concretas con las herramientas. No prometer todos los modelos, publicación en tiendas, acceso ilimitado ni cargos automáticos.',
   accountAction:'La persona completa el registro en el portal oficial. No solicitar contraseñas ni códigos por chat. Esto no crea pedidos ni activa una suscripción.',
   pricingStatus:'not_requested'};
  if(args?.includePrices===true){
   try{const response=await context.actions?.getCommercialCatalog?.({provider:'luxisoft',area:'plans'});const c=response?.catalog;
    if(response?.status==='ok'&&c&&c.expiresAt>Date.now()&&Array.isArray(c.data?.plans)){
     result.pricingStatus='verified';
     result.catalog={fetchedAt:c.fetchedAt,planFamily:c.data.planFamily,packageProgramActive:c.data.packageProgramActive,plans:money(c.data.plans)};
    }else result.pricingStatus='unavailable';
   }catch{result.pricingStatus='unavailable';}
  }
  return JSON.stringify(result);
 }
};
