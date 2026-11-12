# Atención humana desde Bandeja

Tomar un chat cambia el estado a `human_active`, registra usuario/correo en la
conversación y añade el evento `conversation_claimed`. Solo el responsable puede
enviar respuestas. Cerrar la conversación registra `conversation_closed`, retira
la asignación y devuelve el estado a `ai_active`; no envía un mensaje automático
al cliente y la IA retoma el flujo con el próximo mensaje entrante.

WhatsApp conserva sus controles de batching y estado. Messenger revalida la
propiedad durante la ejecución del agente y descarta texto/contenido generado
antes de una toma humana, aunque esa atención haya terminado entretanto. La
consulta usa el pool existente e identifica exactamente proyecto, canal y PSID.
No modifica firmas, OTP, herramientas comerciales, colas ni eventos originales.

El cierre exige `human_active` y el usuario asignado. Se corrigió el parámetro
SQL sin usar que impedía cerrar incluso una atención válida. La regresión usa
PostgreSQL aislado y comprueba competencia entre agentes, aislamiento de proyecto,
registro de actor y vuelta a IA en ambos canales. El módulo publicado conserva
los indicadores de entrada/duplicado que ya usa el webhook desplegado.

La cabecera interna x-inbox-viewer-id, fijada por Luxisoft desde la sesión y
protegida por autenticación de proyecto, limita a chats sin asignar o propios.
Se aplica antes de LIMIT y a historial/acciones/etiquetas. Sin cabecera se conserva
el acceso administrativo del consumidor de confianza. No se acepta identidad de
consulta para eludir el filtro. Al liberar, el chat vuelve a estar disponible.
