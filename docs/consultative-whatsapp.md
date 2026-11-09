# Asesor consultivo de WhatsApp

Política por turno exclusiva de luxisoft + whatsapp. Usa el mensaje original y
el historial aislado: nunca deduce intención de los catálogos o páginas adjuntos.
El prompt común, Messenger, OTP, firma, probabilidades, modelo, facturación y el
botón del sitio conservan su configuración. La regla de conversación prioritaria
sustituye la presentación exhaustiva y cierres forzados del prompt anterior.

Precio: responder una opción pertinente cuando se pregunta; comparar cuando se
solicita. Interés, paquetes y cómo contratar son información y no consentimiento.
Las acciones start/save y captación/agendamiento se validan antes de ejecutarlas.
No se precargan pedidos: solo catálogo. Solo menú explícito. Resultados de tools
se usan como hechos; no como instrucciones para recitar precios o entregar URLs.
Una respuesta con precio/portal prematuro o extensión excesiva se reformula una
sola vez, sin tools. Si la reparación falla se conserva texto seguro y breve.

El overlay ops/consultative-runtime.patch modifica exclusivamente dos preloads,
el mensaje original y el menú en los TS/JS efectivos. Conserva la cola durable,
lectura de webs, historial, CRM y tareas ya desplegadas pero aún ajenas a main.
Aplicar con git apply --check antes de instalar los nuevos módulos compilados y
reiniciar únicamente con la cola pending/running vacía. No aplicar main completo
sobre el runtime. Compilar el commit publicado; verificar hashes y otros archivos.

Criterios: cero pedidos o enlaces prematuros; no se ocultan precios solicitados;
no se repite información conocida, no se inventan tarifas ni se presiona al
cliente. Verificar escenarios de saludo, referencia, tienda/app/IA/servidores,
precio, comparación, objeción, contratación, soporte y retorno en es/en/pt.
No se envían mensajes reales ni se crean pedidos durante la evaluación.

## Continuidad y saldo incluido (2026-11-09)

«Sí, por favor» retoma la última propuesta; las preguntas de seguimiento sobre
mensajes/saldo conservan el tema. Pedir modalidades habilita su explicación,
no precios ni pedidos. Evitar repetir preguntas y prometer pedidos completos
sin un alcance confirmado. Las gestiones aceptadas requieren tool y éxito real.

La mensualidad de la oferta de página incluye saldo IA mensual (70.000 unidades).
El excedente genera consumo por mensaje según su uso real, con saldo adicional
contratado; no se implementa ni anuncia un débito automático. No cambiar cuotas,
créditos, topes ni facturación. getAiUsagePricing consulta las recargas vigentes
por el contrato comercial, publica importe y saldo por separado sin marcas,
rechaza caché vencida/fallos y nunca convierte saldo en mensajes sin medición.
No atribuir esta inclusión a otros servicios del portafolio.

## Luisa y mensajes consecutivos (2026-11-09)

WhatsApp corporativo conserva la identidad Luisa, asistente comercial virtual de
LUXISOFT S.A.S., en todos los proveedores. El primer turno añade saludo,
presentación y cortesía; el cuerpo atiende una duda concreta sin imponer un
intercambio social. El historial evita repetir la introducción.

replyBatch espera tres segundos de calma por contacto y consulta tanto la
bandeja como los mensajes aceptados pendientes en la cola durable. Guarda cada
entrada, combina las pendientes de respuesta y descarta un turno obsoleto antes
de generar, ejecutar nuevas tools o enviar texto/audio. OTP, estados, reacciones
y otros contactos no bloquean una respuesta. La síntesis de voz vuelve a validar
antes de enviar. Una llamada externa ya iniciada o un mensaje entregado no se
pueden deshacer: nunca se reintentan efectos aceptados para aparentar cancelación.

ops/upgrade-reply-batch.mjs actualiza por anclas exactas el webhook efectivo,
conservando trabajo ajeno no publicado, historial, firma, OTP y colas. Compilar
el commit publicado e instalar únicamente sus módulos y este overlay validado.

## Mensaje final sin redundancias (2026-11-09)

Una única composición gestiona la apertura: el saludo aislado recibe únicamente
saludo, identidad y cortesía, sin llamada al modelo. Se respeta la franja indicada
por la persona; un «hola» usa America/Bogota (05–11 mañana, 12–18 tarde, 19–04
noche). Una consulta concreta recibe presentación y respuesta directa.

El webhook consulta respuestas AI efectivamente enviadas del mismo contacto,
canal y proyecto; truncar el contexto o reiniciar no reinicia la presentación.
Ante fallo de lectura no se presupone un contacto nuevo. Limpiar el historial
por su API vuelve a permitir una presentación sin migraciones nuevas.

El cuerpo generado elimina solo aperturas conversacionales y repeticiones
exactas; citas/traducciones y consultas de identidad se preservan. Preguntas
aceptadas repetidas, solicitudes de datos ya conocidos y respuestas calcadas
provocan una reformulación sin tools, una sola vez. No se eliminan condiciones
comerciales ni comparaciones solicitadas. Si la reformulación falla, se informa
la limitación sin reiniciar un cuestionario. El resultado se compone nuevamente,
de forma idempotente, después de los filtros comerciales y antes del menú/TTS.
El historial conserva exactamente lo enviado. La captación comercial usa la
misma política de intención del agente, sin ampliar la autorización.

El overlay publicado ops/upgrade-advisor-response.mjs aplica anclas exactas al
webhook runtime sin sustituir sus cambios ajenos, colas o controles OTP/firma.

## Título comercial (2026-11-09)

La apertura usa «Luisa, asistente comercial de LUXISOFT S.A.S.» sin etiquetas
técnicas no solicitadas, también en inglés/portugués. Las consultas explícitas
sobre si se trata de una persona reciben una respuesta transparente; nunca se
presenta como humana. Sin cambios en servicios, precios, saldo ni herramientas.

## Consultas sobre ChatGPT y otras IA (2026-11-09)

Para prospectos que mencionen cuentas ChatGPT, OpenAI u otras IA, orientar hacia
una cuenta propia de Luxisoft: consultas, formularios y sitios como primeras
capacidades, ampliando el portafolio según el objetivo y disponibilidad. La
integración con modelos de OpenAI no equivale a vender ni incluir ChatGPT Plus
/Pro. La herramienta de solo lectura getPlatformAccountOffer proporciona URL de
registro oficial y, únicamente al pedir precios, catálogo vigente con importes
convertidos. Precio/cuenta consultados no autorizan pedidos de página, CRM o citas.

Conservar soporte, saldo, pedidos previos y negativas; no insistir en registrar
una cuenta ya existente. Una aceptación de registro entrega el enlace sin otra
confirmación. La persona completa el registro sin dar contraseñas/códigos en
WhatsApp. No interpretar «se llama» como una referencia al modelo Llama.


### Orientación afirmativa y saludos de regreso (2026-11-08)

Para interés general en ChatGPT/IA, presentar directamente una cuenta propia de
Luxisoft con modelos integrados de OpenAI, consultas, formularios y páginas. Evitar
comparaciones no solicitadas con Plus/Pro; las diferencias se explican fielmente
cuando se pregunta expresamente por equivalencia o inclusión de una suscripción.
Una validación y una reformulación evitan el discurso de rechazo; el fallback
conserva una oferta factual sin prometer suscripciones ajenas.

El archivo de mensajes enviados determina si ya hubo presentación. Un saludo
aislado, incluso «buena nche», recibe saludo y cortesía tanto al inicio como al
regresar. El regreso conserva el contexto y omite otra presentación. Una primera
consulta concreta recibe presentación y respuesta sin obligar a un intercambio
social. La composición sigue siendo idempotente para texto y audio.

## Free primero (2026-11-09)
Orientación inicial: cuenta gratuita, saldo mensual y almacenamiento verificados; después planes opcionales con facilidades de pago. No convertir saldo a mensajes ni atribuir más saldo a un plan de pago sin confirmación. El catálogo público expone freeAllowance independientemente del piloto.

## Información sin sondeos (2026-11-09)
En WhatsApp y Messenger: responder y terminar sin preguntas ni invitaciones a ampliar. Saludo sin pregunta de cortesía. Reformulación única sin tools; respaldo conserva frases informativas completas. Se permiten preguntas solicitadas y entradas indispensables exigidas por tools para gestiones expresas. Mantener Free, límites y condiciones de pago pertinentes.

## Marca conocida (2026-11-09)
Orientación general: Chatbox de Luxisoft y ChatGPT como referencia conocida, sin presentar suscripciones personales como incluidas. OpenAI solo ante pregunta directa por empresa/proveedor; no por historial o datos precargados. Regla en WhatsApp y Messenger, herramientas y respaldos.

## Saludo y períodos independientes
Saludo actual reconocido incluso junto a consulta y con historial, sin repetir identidad. Mensual por defecto y anual solo al solicitarlo, cada modalidad con precio/cobertura propios, sin doce cuotas implícitas. Catálogo/cache v5 alineados con contratación por período.
