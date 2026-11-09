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
