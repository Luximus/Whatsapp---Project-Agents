export default {
 name:'websitePageSales',description:'Oferta específica de una página como jmarin.luxisoft.com: paquetes 1/3/6/12 meses, beneficios, formulario privado de datos y pago Wompi, estado del pedido. No confundir con planes Plus/Premium de plataforma.',
 parameters:{type:'object',properties:{action:{type:'string',enum:['catalog','start','save','status']},details:{type:'object',properties:{name:{type:'string'},email:{type:'string'},business:{type:'string'},content:{type:'string'},contacts:{type:'string'}},additionalProperties:false}},required:['action'],additionalProperties:false},
 async execute(args,context){if(!context.actions?.websitePageSales)return 'Servicio no disponible en este canal. No inventar precios ni enlaces.';return JSON.stringify(await context.actions.websitePageSales({action:args.action,details:args.details}));}
};
