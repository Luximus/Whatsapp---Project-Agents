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
