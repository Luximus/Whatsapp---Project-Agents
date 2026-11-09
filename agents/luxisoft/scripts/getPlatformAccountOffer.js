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
 parameters:{type:'object',properties:{locale:{type:'string',enum:['es','en','pt']},includeProvider:{type:'boolean',description:'Solo si el cliente pregunta directamente por la empresa o el proveedor.'},periodCode:{type:'string',enum:['m1','m3','m6','y1','y2']},includePrices:{type:'boolean'},compare:{type:'boolean'}},additionalProperties:false},
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
     const paid=available.filter(p=>p.code!=='free');
     result.paymentFacilities=paid.length?'Planes opcionales con modalidades mensuales, trimestrales, semestrales o anuales independientes, según catálogo. Cada modalidad tiene su propio precio y cobertura; no prometer crédito, intereses cero ni cargos automáticos.':null;
     if(free){
      const tokens=c.data.freeAllowance?.tokens;
      const storage=Number.isFinite(free.storageBytes)?`${free.storageBytes/1024**3} GB`:null;
      const quota=Number.isSafeInteger(tokens)&&tokens>=0?new Intl.NumberFormat(language).format(tokens):null;
      result.orientation=language==='en'
       ? `You can create your free Luxisoft account and use Chatbox, the Luxisoft AI chat, for questions like in ChatGPT, forms and pages. ${quota?`It includes ${quota} Tokens of AI balance each calendar month, expiring without rollover; one allowance per verified identity.`:'The exact AI allowance must be checked in your account.'}${storage?` Storage: ${storage}.`:''} Optional advanced plans offer more capacity and payment options for different billing periods according to the published terms; additional AI balance is purchased separately.`
       : language==='pt'
       ? `Você pode criar sua conta gratuita na Luxisoft e usar o Chatbox, o chat de IA da Luxisoft, para consultas como no ChatGPT, formulários e páginas. ${quota?`Inclui ${quota} Tokens de saldo IA por mês, sem acumular; uma cota por identidade verificada.`:'O limite exato de IA deve ser confirmado na conta.'}${storage?` Armazenamento: ${storage}.`:''} Há planos avançados opcionais com mais capacidade e modalidades de pagamento conforme as condições publicadas; saldo adicional de IA é separado.`
       : `Puedes crear tu cuenta gratuita en Luxisoft y usar Chatbox, el chat de IA de Luxisoft, para consultas como en ChatGPT, formularios y páginas. ${quota?`Incluye ${quota} Tokens de saldo IA por mes calendario, sin acumular; una asignación por identidad verificada.`:'El límite exacto de IA debe confirmarse en tu cuenta.'}${storage?` Almacenamiento: ${storage}.`:''} Hay planes avanzados opcionales con más capacidad y modalidades de pago según las condiciones publicadas; el saldo adicional de IA se compra aparte.`;
     }
     if(args?.includePrices===true){
     const selected=(args.compare===true?available:[free,paid[0]].filter(Boolean)).map(p=>({...p,...(Array.isArray(p.periods)?{periods:[p.periods.find(x=>x.code===(args?.periodCode||'m1'))].filter(Boolean)}:{})}));
     result.pricingStatus='verified';
     result.catalog={fetchedAt:c.fetchedAt,planFamily:c.data.planFamily,packageProgramActive:c.data.packageProgramActive,plans:money(selected)};
     }
    }else {result.freeAccessStatus='unavailable';if(args?.includePrices)result.pricingStatus='unavailable';}
   }catch{result.freeAccessStatus='unavailable';if(args?.includePrices)result.pricingStatus='unavailable';}
  }
  return JSON.stringify(result);
 }
};
