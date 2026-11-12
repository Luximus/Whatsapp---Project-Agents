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
