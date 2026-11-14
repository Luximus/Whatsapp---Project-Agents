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
 parameters:{type:'object',properties:{locale:{type:'string',enum:['es','en','pt']},includeProvider:{type:'boolean',description:'Solo si el cliente pregunta directamente por la empresa o el proveedor.'},periodCode:{type:'string',enum:['m1','m3','m6','y1','y2']},includePrices:{type:'boolean'},compare:{type:'boolean'},planCode:{type:'string',enum:['free','plus','premium','business']}},additionalProperties:false},
 async execute(args,context){
  const locale=args?.locale==='en'?'en':'es';
  const language=args?.locale||'es';
  const result={status:'ok',registrationUrl:`https://luxisoft.com/${locale}/auth?next=%2F${locale}%2Fplataforma`,
   relationship:'Luxisoft ofrece una cuenta propia con Chatbox, el chat de IA de Luxisoft, para hacer consultas como en ChatGPT. Desde la plataforma puedes hacer consultas y trabajar en formularios, páginas y otras herramientas disponibles.',
   capabilities:['Hacer consultas y trabajar con información en Chatbox','Crear formularios y gestionar sus respuestas','Crear, modificar y publicar páginas y tiendas','Desarrollar aplicaciones y software','Crear y gestionar contenido multimedia','Administrar datos, ventas y canales del negocio según recursos conectados'],
   availability:'Funciones, modelos, cuotas, publicaciones e integraciones sujetos a disponibilidad, plan y conexiones de la cuenta. Confirmar capacidades concretas con las herramientas. No prometer todos los modelos, publicación en tiendas, acceso ilimitado ni cargos automáticos.',
   accountAction:'La persona completa el registro en el portal oficial. No solicitar contraseñas ni códigos por chat. Esto no crea pedidos ni activa una suscripción.',
   pricingStatus:'not_requested'};
  if(args?.includeProvider===true)result.provider="Chatbox puede utilizar modelos de OpenAI, la empresa creadora de ChatGPT, según disponibilidad.";
  {
   try{const response=await context.actions?.getCommercialCatalog?.({provider:'luxisoft',area:'plans'});const c=response?.catalog;
    if(response?.status==='ok'&&c&&c.expiresAt>Date.now()&&Array.isArray(c.data?.plans)){
     const available=c.data.plans;
     const free=available.find(p=>p.code==='free');
     result.freeAccessStatus=free?'verified':'unavailable';
     if(free)result.freeAccess=money({plan:free,allowance:c.data.freeAllowance});
     const requested=args?.planCode?available.find(p=>p.code===args.planCode):null;
     if(args?.planCode){
      const preview=!requested?(c.data.previewPackages??[]).find(p=>p.code===args.planCode):null;
      result.requestedPlan={code:args.planCode,available:Boolean(requested),previewOnly:Boolean(preview),customerRole:requested?.customerRole??preview?.customerRole??null};
     }
     result.unavailableProfiles=(c.data.previewPackages??[]).filter(p=>!available.some(a=>a.code===p.code)).map(p=>({code:p.code,name:p.customerRole?.name??p.name,customerRole:p.customerRole??null,purchasable:false,status:'preview'}));
     result.customerProfiles=available.map(p=>({code:p.code,name:p.customerRole?.name??p.name,customerRole:p.customerRole??null,aiUsage:p.aiUsage??p.customerRole?.aiUsage??null}));
     result.planAndTokens='El perfil comercial determina los modelos, nivel de razonamiento, generación y conexiones disponibles. Los Tokens aumentan saldo, conservando el perfil. Comprar un plan no asigna roles de soporte, moderador o administrador de Luxisoft. Usa customerRole verificado, nunca capacidades inferidas por precio o almacenamiento. Free permite vídeo nativo si customerRole.nativeVideo=true; cuotas según catálogo y saldo. Negocio en previewOnly no se ofrece para contratar.';
     const paid=available.filter(p=>p.code!=='free');
     result.paymentFacilities=paid.length?'Planes opcionales con modalidades mensuales, trimestrales, semestrales o anuales independientes, según catálogo. Cada modalidad tiene su propio precio y cobertura; no prometer crédito, intereses cero ni cargos automáticos.':null;
     if(free){
      const usage=free.aiUsage??free.customerRole?.aiUsage;
      if(![1,2].includes(usage?.version)){delete result.freeAccess;return JSON.stringify({...result,freeAccessStatus:'unavailable',orientation:'No se pudo verificar el cupo semanal vigente.'});}
      result.orientation=language==='en'?`You can create your free Luxisoft account and use Chatbox for questions, forms and pages. Free includes x${usage.multiplier} weekly AI usage; the period renews every 7 days from first use, without rollover. Paid plans offer more weekly usage and payment options. Token topups are optional and used automatically after the weekly allowance is exhausted.`:language==='pt'?`Você pode criar sua conta gratuita Luxisoft e usar o Chatbox para consultas, formulários e páginas. Free inclui x${usage.multiplier} de uso semanal de IA, renovado a cada 7 dias desde o primeiro uso, sem acumular. Há planos pagos com mais uso e opções de pagamento. Recargas de Tokens são opcionais e usadas após esgotar o uso semanal.`:`Puedes crear tu cuenta gratuita Luxisoft y usar Chatbox para consultas, formularios y páginas. Free incluye x${usage.multiplier} de uso semanal de IA, renovado cada 7 días desde el primer uso, sin acumular. Hay planes pagos con mayor cupo y modalidades de pago. Las recargas de Tokens son opcionales y se usan automáticamente al agotar el cupo semanal.`;

     }
     if(args?.includePrices===true){
     const selected=(args?.planCode?available.filter(p=>p.code===args.planCode):args.compare===true?available:[free,paid[0]].filter(Boolean)).map(p=>({...p,...(Array.isArray(p.periods)?{periods:[p.periods.find(x=>x.code===(args?.periodCode||'m1'))].filter(Boolean)}:{})}));
     if(selected.some(p=>p.code!=='free'&&p.pricingStatus==='pending'))return JSON.stringify({...result,pricingStatus:'pending_daily_update'});
     result.pricingStatus='verified';
     result.catalog={fetchedAt:c.fetchedAt,planFamily:c.data.planFamily,packageProgramActive:c.data.packageProgramActive,plans:money(selected)};
     }
    }else {result.freeAccessStatus='unavailable';if(args?.includePrices)result.pricingStatus='unavailable';}
   }catch{result.freeAccessStatus='unavailable';if(args?.includePrices)result.pricingStatus='unavailable';}
  }
  return JSON.stringify(result);
 }
};
